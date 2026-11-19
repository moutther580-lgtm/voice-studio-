import '@fontsource/fraunces/600.css';
import '@fontsource/fraunces/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/noto-nastaliq-urdu/400.css';
import '@fontsource/noto-nastaliq-urdu/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import type { User } from 'firebase/auth';
import type { Unsubscribe } from 'firebase/firestore';
import {
  ROUTES,
  ROUTE_BY_PAGE_ID,
  ROUTE_BY_PATH,
  SAMPLE_CLIPS,
  buildJsonLdForRoute,
  normalizePathname,
  type RouteDef,
} from '../shared/routes-data.mjs';
import { ensureAuthListener, getFirebaseMod, hasLikelyFirebaseAuthSession } from './firebase-loader';
import type { LedgerEntryDoc, UserWalletDoc } from './firebase';
import { ACCOUNT_CARD_HTML, CONVERTER_WORKSPACE_HTML, VERIFY_BOX_HTML } from './private-screens';
import {
  MODELS,
  VOICES,
  applyDictionary,
  buildBody,
  buildDialogueItems,
  buildSubtitleSegments,
  chunks,
  classify,
  estimateStats,
  formatSubtitles,
  getModelFallbackOrder,
  safePreviewSlice,
  toPcm,
  totalPcmDurationSeconds,
  wavBlob,
} from './tts-core';
import type {
  AudioFormat,
  ChapterItem,
  GenerationJob,
  GenerationMode,
  InlineAudioData,
  OutlineEntry,
  PdfAgentOutputMode,
  PdfAgentPlan,
  PronunciationRule,
  QuotaState,
  SpeechItem,
  SubtitleSegment,
  VoiceConfig,
} from './types';
import type { VideoAspect } from './video-export';

const $ = <T extends HTMLElement>(selector: string): T => {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el as T;
};

const byId = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

const store = {
  get<T>(k: string, fallback: T): T {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      // Ignore storage quota errors
    }
  },
};

const DEFAULT_CFG: VoiceConfig = {
  model: MODELS[0].id,
  voice: 'Kore',
  voiceB: 'Puck',
  mode: 'single',
  style: '',
  chunk: 1800,
  pause: 1,
  sil: 250,
  format: 'mp3',
  mp3Kbps: 64,
  cleanDocs: true,
  speed: 1,
};

let currentUser: User | null = null;
let authMode: 'signin' | 'signup' = 'signin';
let activeQuota: QuotaState | null = null;
let walletUnsub: Unsubscribe | null = null;
let ledgerUnsub: Unsubscribe | null = null;
let refUnsub: Unsubscribe | null = null;

const refParamInit = new URLSearchParams(location.search).get('ref')?.trim() || '';
if (/^[a-zA-Z0-9_-]{6,128}$/.test(refParamInit)) {
  store.set('vs.pendingRef', refParamInit);
}

let byokEnabled = store.get<boolean>('vs.byokEnabled', false);
let byokKey = store.get<string>('vs.byokKey', '');

function isByokActive(): boolean {
  return Boolean(byokEnabled && byokKey.trim().length > 0);
}

let authResolved = false;
let verifiedAdminSession = false;
let verifiedAdminUid = '';
let adminDataLoaded = false;
let signedInScreensMounted = false;
let workspaceEventsBound = false;

function isAdminActive(user: User | null): boolean {
  return Boolean(user && user.emailVerified && verifiedAdminUid && user.uid === verifiedAdminUid && verifiedAdminSession);
}

let dictRules: PronunciationRule[] = store.get<PronunciationRule[]>('vs.dict', []);
let job: GenerationJob | null = null;
let running = false;
let previewing = false;
let extracting = false;
let studioBusy = false;
let videoBusy = false;
let ctl: AbortController | null = null;
let videoCtl: AbortController | null = null;
let audioUrl: string | null = null;
let videoUrl: string | null = null;
let lastBlob: Blob | null = null;
let lastSrtBlob: Blob | null = null;
let lastVttBlob: Blob | null = null;
let lastSubtitleSegments: SubtitleSegment[] = [];
let lastName = '';
let lastSrtName = '';
let lastVttName = '';
let loadedDocTitle = '';
let fullLoadedDocText = '';
let pendingEditorText = '';
let pendingAudioTitle = '';
let detectedChapters: ChapterItem[] = [];
let loadedFile: File | null = null;
let loadedPagesText: string[] = [];
let loadedOutlineItems: OutlineEntry[] = [];
let currentTextOrigin: 'user' | 'sample' | 'doc' = 'user';
let sampleReplaceArmed = false;
const sessionTitleCounts = new Map<string, number>();

const loadedCfg = store.get<Partial<VoiceConfig>>('vs.cfg', {});
const cfg: VoiceConfig = {
  ...DEFAULT_CFG,
  ...loadedCfg,
  model: MODELS.some((m) => m.id === loadedCfg.model) ? (loadedCfg.model as string) : DEFAULT_CFG.model,
  voice: VOICES.includes(loadedCfg.voice || '') ? (loadedCfg.voice as string) : DEFAULT_CFG.voice,
  voiceB: VOICES.includes(loadedCfg.voiceB || '') ? (loadedCfg.voiceB as string) : DEFAULT_CFG.voiceB,
  mode: loadedCfg.mode === 'dialogue' ? 'dialogue' : 'single',
  format: loadedCfg.format === 'wav' ? 'wav' : 'mp3',
  mp3Kbps: loadedCfg.mp3Kbps === 128 ? 128 : 64,
  cleanDocs: loadedCfg.cleanDocs !== false,
  speed: [1, 1.25, 1.5, 2].includes(Number(loadedCfg.speed)) ? Number(loadedCfg.speed) : 1,
};

function cleanDocBasename(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function cleanTitleSlug(raw: string): string {
  const stripped = raw
    .replace(/^(?:host|guest|speaker\s*[ab12]?|a|b)\s*:\s*/gim, '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ');
  const words = stripped.match(/[\p{L}\p{N}]+/gu) || [];
  if (!words.length) return '';

  const picked: string[] = [];
  let totalLen = 0;
  for (const w of words.slice(0, 6)) {
    const normalized = w.toLowerCase();
    const nextLen = totalLen + (picked.length ? 1 : 0) + normalized.length;
    if (picked.length > 0 && nextLen > 48) break;
    picked.push(normalized);
    totalLen = nextLen;
  }
  return picked.join('-');
}

function buildDownloadFilename(
  ext: AudioFormat,
  customTitle: string,
  docTitle: string,
  rawText: string,
  mode: GenerationMode,
  voiceA: string,
  voiceB: string
): string {
  const baseSlug =
    cleanTitleSlug(customTitle) || cleanTitleSlug(docTitle) || cleanTitleSlug(rawText) || 'audio-narration';
  const voiceSuffix =
    mode === 'dialogue' ? `${voiceA.toLowerCase()}-${voiceB.toLowerCase()}` : voiceA.toLowerCase();
  const stem = `${baseSlug}-${voiceSuffix}`;
  const key = `${stem}.${ext}`;
  const seen = sessionTitleCounts.get(key) || 0;
  sessionTitleCounts.set(key, seen + 1);
  return seen === 0 ? key : `${stem}-${seen + 1}.${ext}`;
}

function getEditorTextValue(): string {
  const el = byId<HTMLTextAreaElement>('text');
  return el ? el.value : pendingEditorText;
}

function getAudioTitleValue(): string {
  const el = byId<HTMLInputElement>('audioTitle');
  return el ? el.value : pendingAudioTitle;
}

function setAudioTitleValue(val: string) {
  pendingAudioTitle = val;
  const el = byId<HTMLInputElement>('audioTitle');
  if (el) el.value = val;
}

function say(msg: string) {
  const errEl = byId('statusErr');
  const okEl = byId('status');
  if (errEl) errEl.textContent = '';
  if (okEl) okEl.textContent = msg;
}

function sayError(msg: string) {
  const okEl = byId('status');
  const errEl = byId('statusErr');
  if (okEl) okEl.textContent = '';
  if (errEl) errEl.textContent = msg;
}

function sayAuth(msg: string) {
  const authMsg = byId('authMsg');
  const verifyMsg = byId('verifyMsg');
  const accountMsg = byId('accountMsg');
  if (!currentUser) {
    if (authMsg) authMsg.textContent = msg;
    if (verifyMsg) verifyMsg.textContent = '';
    if (accountMsg) accountMsg.textContent = '';
  } else if (!currentUser.emailVerified) {
    if (authMsg) authMsg.textContent = '';
    if (verifyMsg) verifyMsg.textContent = msg;
    if (accountMsg) accountMsg.textContent = '';
  } else {
    if (authMsg) authMsg.textContent = '';
    if (verifyMsg) verifyMsg.textContent = '';
    if (accountMsg) accountMsg.textContent = msg;
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const signal = ctl?.signal;
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function num(id: string, lo: number, hi: number, fallback: number): number {
  const el = document.querySelector<HTMLInputElement>(id);
  if (!el) return fallback;
  const v = parseFloat(el.value);
  return Number.isNaN(v) ? fallback : Math.min(hi, Math.max(lo, v));
}

function formatAuthError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('auth/popup-blocked'))
    return 'Google sign-in popup was blocked by your browser. Allow popups for this site or sign in with Email below.';
  if (msg.includes('auth/popup-closed-by-user') || msg.includes('auth/cancelled-popup-request'))
    return 'Google sign-in popup was closed before completing sign-in.';
  if (msg.includes('auth/unauthorized-domain'))
    return 'This website domain is not authorized in Firebase Console yet. Add it under Authentication > Settings > Authorized domains.';
  if (msg.includes('auth/network-request-failed'))
    return 'Network error while contacting Firebase. Check your internet connection and try again.';
  if (msg.includes('auth/invalid-email')) return 'Please enter a valid email address.';
  if (msg.includes('auth/missing-password')) return 'Please enter your password.';
  if (msg.includes('auth/invalid-credential') || msg.includes('auth/wrong-password'))
    return 'Incorrect email or password.';
  if (msg.includes('auth/user-not-found')) return 'No account found with that email.';
  if (msg.includes('auth/email-already-in-use')) return 'An account already exists with that email. Try signing in.';
  if (msg.includes('auth/weak-password')) return 'Password must be at least 6 characters.';
  if (msg.includes('auth/too-many-requests')) return 'Too many attempts. Please wait a minute and try again.';
  if (msg.includes('auth/operation-not-allowed'))
    return 'This sign-in method is not enabled in Firebase Authentication yet.';
  return msg;
}

/* ---- Routing, Outlet Rendering & Accessibility Drawers ---- */
type PageId = string;

function resolveRoute(): RouteDef {
  const cleanPath = normalizePathname(location.pathname);
  const direct = ROUTE_BY_PATH.get(cleanPath);
  if (direct) return direct;
  if (location.hash) {
    const hashSlug = location.hash.slice(1).trim();
    const byIdMatch = ROUTE_BY_PAGE_ID.get(hashSlug);
    if (byIdMatch) return byIdMatch;
    const byPathMatch = ROUTE_BY_PATH.get(normalizePathname(hashSlug));
    if (byPathMatch) return byPathMatch;
  }
  return ROUTE_BY_PATH.get('/404') || ROUTES[0];
}

function setBackgroundInert(isInert: boolean) {
  for (const id of ['siteHeader', 'main', 'siteFooter']) {
    const el = document.getElementById(id) as (HTMLElement & { inert?: boolean }) | null;
    if (!el) continue;
    if ('inert' in el) el.inert = isInert;
    if (isInert) el.setAttribute('aria-hidden', 'true');
    else el.removeAttribute('aria-hidden');
  }
}

function getFocusableInside(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => !el.hidden && el.offsetParent !== null);
}

interface A11yPrefs {
  contrast: 'system' | 'light' | 'dark' | 'hc-dark' | 'hc-light';
  fontScale: string;
  fontFamily: 'default' | 'readable' | 'serif' | 'mono';
  spacing: boolean;
  strongFocus: boolean;
  highlightLinks: boolean;
  reduceMotion: boolean;
}

const DEFAULT_A11Y: A11yPrefs = {
  contrast: 'system',
  fontScale: '1',
  fontFamily: 'default',
  spacing: false,
  strongFocus: false,
  highlightLinks: false,
  reduceMotion: false,
};

const loadedA11y = store.get<Partial<A11yPrefs>>('vs.a11y', {});
const a11yPrefs: A11yPrefs = {
  contrast: ['system', 'light', 'dark', 'hc-dark', 'hc-light'].includes(String(loadedA11y.contrast))
    ? (loadedA11y.contrast as A11yPrefs['contrast'])
    : DEFAULT_A11Y.contrast,
  fontScale: ['1', '1.15', '1.3', '1.5', '1.75', '2'].includes(String(loadedA11y.fontScale))
    ? String(loadedA11y.fontScale)
    : DEFAULT_A11Y.fontScale,
  fontFamily: ['default', 'readable', 'serif', 'mono'].includes(String(loadedA11y.fontFamily))
    ? (loadedA11y.fontFamily as A11yPrefs['fontFamily'])
    : DEFAULT_A11Y.fontFamily,
  spacing: Boolean(loadedA11y.spacing),
  strongFocus: Boolean(loadedA11y.strongFocus),
  highlightLinks: Boolean(loadedA11y.highlightLinks),
  reduceMotion: Boolean(loadedA11y.reduceMotion),
};

function applyA11ySettings() {
  const root = document.documentElement;
  if (a11yPrefs.contrast === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', a11yPrefs.contrast);
  }

  root.style.setProperty('--a11y-scale', a11yPrefs.fontScale || '1');

  if (a11yPrefs.fontFamily === 'readable') {
    root.style.setProperty('--a11y-font', "Verdana, Tahoma, 'Segoe UI', sans-serif");
  } else if (a11yPrefs.fontFamily === 'serif') {
    root.style.setProperty('--a11y-font', "Georgia, 'Times New Roman', serif");
  } else if (a11yPrefs.fontFamily === 'mono') {
    root.style.setProperty('--a11y-font', "'IBM Plex Mono', ui-monospace, Consolas, monospace");
  } else {
    root.style.removeProperty('--a11y-font');
  }

  root.setAttribute('data-spacing', a11yPrefs.spacing ? 'on' : 'off');
  root.setAttribute('data-strong-focus', a11yPrefs.strongFocus ? 'on' : 'off');
  root.setAttribute('data-highlight-links', a11yPrefs.highlightLinks ? 'on' : 'off');
  root.setAttribute('data-reduce-motion', a11yPrefs.reduceMotion ? 'on' : 'off');
}

applyA11ySettings();

function openA11yDrawer() {
  closeDrawer(false);
  const drawer = $('#a11yDrawer');
  const backdrop = $('#a11yBackdrop');
  const openBtn = $('#openA11yBtn');
  if (!drawer.hidden) return;
  backdrop.hidden = false;
  drawer.hidden = false;
  openBtn.setAttribute('aria-expanded', 'true');
  setBackgroundInert(true);
  $('#closeA11yBtn').focus();
}

function closeA11yDrawer(restoreFocus = true) {
  const drawer = $('#a11yDrawer');
  const backdrop = $('#a11yBackdrop');
  const openBtn = $('#openA11yBtn');
  if (drawer.hidden) return;
  drawer.hidden = true;
  backdrop.hidden = true;
  openBtn.setAttribute('aria-expanded', 'false');
  setBackgroundInert(false);
  if (restoreFocus) openBtn.focus();
}

function bindA11ySettings() {
  const contrastEl = $<HTMLSelectElement>('#a11yContrast');
  const scaleEl = $<HTMLSelectElement>('#a11yFontScale');
  const fontEl = $<HTMLSelectElement>('#a11yFontFamily');
  const spacingEl = $<HTMLInputElement>('#a11ySpacing');
  const strongFocusEl = $<HTMLInputElement>('#a11yStrongFocus');
  const highlightLinksEl = $<HTMLInputElement>('#a11yHighlightLinks');
  const reduceMotionEl = $<HTMLInputElement>('#a11yReduceMotion');
  const statusEl = $('#a11yStatus');

  const syncInputs = () => {
    contrastEl.value = a11yPrefs.contrast;
    scaleEl.value = a11yPrefs.fontScale;
    fontEl.value = a11yPrefs.fontFamily;
    spacingEl.checked = a11yPrefs.spacing;
    strongFocusEl.checked = a11yPrefs.strongFocus;
    highlightLinksEl.checked = a11yPrefs.highlightLinks;
    reduceMotionEl.checked = a11yPrefs.reduceMotion;
  };
  syncInputs();

  const saveAndApply = (msg: string) => {
    store.set('vs.a11y', a11yPrefs);
    applyA11ySettings();
    statusEl.textContent = msg;
  };

  contrastEl.addEventListener('change', () => {
    a11yPrefs.contrast = contrastEl.value as A11yPrefs['contrast'];
    const label = contrastEl.options[contrastEl.selectedIndex]?.text || a11yPrefs.contrast;
    saveAndApply(`Theme updated: ${label}.`);
  });

  scaleEl.addEventListener('change', () => {
    a11yPrefs.fontScale = scaleEl.value;
    saveAndApply(`Text size set to ${Math.round(Number(a11yPrefs.fontScale) * 100)}%.`);
  });

  fontEl.addEventListener('change', () => {
    a11yPrefs.fontFamily = fontEl.value as A11yPrefs['fontFamily'];
    const label = fontEl.options[fontEl.selectedIndex]?.text || a11yPrefs.fontFamily;
    saveAndApply(`Reading font changed to ${label}.`);
  });

  spacingEl.addEventListener('change', () => {
    a11yPrefs.spacing = spacingEl.checked;
    saveAndApply(a11yPrefs.spacing ? 'Increased text spacing enabled.' : 'Default text spacing restored.');
  });

  strongFocusEl.addEventListener('change', () => {
    a11yPrefs.strongFocus = strongFocusEl.checked;
    saveAndApply(a11yPrefs.strongFocus ? 'Thick focus border always active.' : 'Default keyboard focus ring restored.');
  });

  highlightLinksEl.addEventListener('change', () => {
    a11yPrefs.highlightLinks = highlightLinksEl.checked;
    saveAndApply(a11yPrefs.highlightLinks ? 'Link highlights enabled.' : 'Default link styling restored.');
  });

  reduceMotionEl.addEventListener('change', () => {
    a11yPrefs.reduceMotion = reduceMotionEl.checked;
    saveAndApply(a11yPrefs.reduceMotion ? 'Reduced motion enabled.' : 'Default motion restored.');
  });

  $('#a11yResetBtn').onclick = () => {
    Object.assign(a11yPrefs, DEFAULT_A11Y);
    syncInputs();
    saveAndApply('Display settings reset to defaults.');
    contrastEl.focus();
  };
}

function openDrawer() {
  closeA11yDrawer(false);
  const drawer = $('#navDrawer');
  const backdrop = $('#drawerBackdrop');
  const openBtn = $('#openDrawerBtn');
  if (!drawer.hidden) return;
  backdrop.hidden = false;
  drawer.hidden = false;
  openBtn.setAttribute('aria-expanded', 'true');
  setBackgroundInert(true);
  $('#closeDrawerBtn').focus();
}

function closeDrawer(restoreFocus = true) {
  const drawer = $('#navDrawer');
  const backdrop = $('#drawerBackdrop');
  const openBtn = $('#openDrawerBtn');
  if (drawer.hidden) return;
  drawer.hidden = true;
  backdrop.hidden = true;
  openBtn.setAttribute('aria-expanded', 'false');
  setBackgroundInert(false);
  if (restoreFocus) openBtn.focus();
}

function openExportModal() {
  closeDrawer(false);
  closeA11yDrawer(false);
  const modal = byId('exportModal');
  const backdrop = byId('exportBackdrop');
  const openBtn = byId('openExportModalBtn');
  if (!modal || !backdrop || !modal.hidden) return;
  const exportMsg = byId('exportPopupMsg');
  if (exportMsg) exportMsg.textContent = '';
  backdrop.hidden = false;
  modal.hidden = false;
  openBtn?.setAttribute('aria-expanded', 'true');
  setBackgroundInert(true);
  const closeBtn = byId('closeExportBtn');
  (closeBtn || modal).focus();
}

function closeExportModal(restoreFocus = true) {
  const modal = byId('exportModal');
  const backdrop = byId('exportBackdrop');
  const openBtn = byId('openExportModalBtn');
  if (!modal || !backdrop || modal.hidden) return;
  modal.hidden = true;
  backdrop.hidden = true;
  openBtn?.setAttribute('aria-expanded', 'false');
  setBackgroundInert(false);
  if (restoreFocus && openBtn && openBtn.offsetParent !== null) {
    openBtn.focus();
  }
}

/* ---- Interactive Public Controls (Samples, Hero Drop Zone, Before/After, Auth Card, Contact, Studios) ---- */
let activeSampleId: string | null = null;

function stopInteractiveSample(announce = false) {
  try {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  } catch {
    // Ignore
  }
  activeSampleId = null;
  document.querySelectorAll<HTMLButtonElement>('.sample-play-btn').forEach((btn) => {
    btn.setAttribute('aria-pressed', 'false');
    btn.textContent = 'Play sample';
  });
  const statusEl = byId('samplePlaybackStatus');
  if (announce && statusEl) statusEl.textContent = 'Sample playback stopped.';
}

function speakInteractiveText(text: string, langHint: string, statusTargetId: string, onEnd?: () => void) {
  const statusEl = byId(statusTargetId);
  if ('speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined') {
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = langHint;
      utter.rate = 0.96;
      const voices = window.speechSynthesis.getVoices();
      const langBase = langHint.split('-')[0].toLowerCase();
      const matchedVoice = voices.find((v) => v.lang.toLowerCase().startsWith(langBase));
      if (matchedVoice) utter.voice = matchedVoice;
      utter.onend = () => {
        if (statusEl) statusEl.textContent = 'Finished sample preview.';
        onEnd?.();
      };
      utter.onerror = () => {
        if (statusEl) statusEl.textContent = 'Sign in with a verified account for full studio neural voice audio.';
        onEnd?.();
      };
      window.speechSynthesis.speak(utter);
      if (statusEl) {
        statusEl.textContent = 'Playing quick browser preview — sign in for full Studio voices and MP3 download.';
      }
      return;
    } catch {
      // Fallback below
    }
  }
  if (statusEl) {
    statusEl.textContent =
      'Instant voice preview is unavailable in this browser. Sign in with a verified account to generate and download MP3 audio.';
  }
  onEnd?.();
}

function bindAuthCardControls() {
  const tabSignIn = byId('tabSignIn');
  const tabSignUp = byId('tabSignUp');
  const googleBtn = byId('googleSignIn');
  const authForm = byId<HTMLFormElement>('authForm');
  const authResetBtn = byId('authReset');
  if (!tabSignIn || !tabSignUp || !googleBtn || !authForm || !authResetBtn) return;

  tabSignIn.onclick = () => setAuthTab('signin');
  tabSignUp.onclick = () => setAuthTab('signup');

  googleBtn.onclick = async () => {
    sayAuth('Opening Google sign-in…');
    try {
      const fb = await ensureAuthListener(handleAuthUser);
      await fb.signInWithGoogle();
      sayAuth('Signed in with Google.');
    } catch (err) {
      sayAuth(formatAuthError(err));
    }
  };

  authForm.onsubmit = async (e) => {
    e.preventDefault();
    const emailEl = $<HTMLInputElement>('#authEmail');
    const passEl = $<HTMLInputElement>('#authPass');
    const email = emailEl.value.trim();
    const pass = passEl.value;
    const name = byId<HTMLInputElement>('authName')?.value.trim() || '';

    emailEl.removeAttribute('aria-invalid');
    passEl.removeAttribute('aria-invalid');

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailEl.setAttribute('aria-invalid', 'true');
      sayAuth('Please enter a valid email address.');
      emailEl.focus();
      return;
    }
    if (pass.length < 6) {
      passEl.setAttribute('aria-invalid', 'true');
      sayAuth('Password must be at least 6 characters.');
      passEl.focus();
      return;
    }

    sayAuth(authMode === 'signup' ? 'Creating your account…' : 'Signing in…');
    try {
      const fb = await ensureAuthListener(handleAuthUser);
      if (authMode === 'signup') {
        await fb.signUpEmail(email, pass, name);
        sayAuth('Account created. Check your inbox for a verification link.');
      } else {
        await fb.signInEmail(email, pass);
        sayAuth('Signed in.');
      }
    } catch (err) {
      sayAuth(formatAuthError(err));
    }
  };

  authResetBtn.onclick = async () => {
    const emailEl = byId<HTMLInputElement>('authEmail');
    const email = emailEl?.value.trim() || '';
    if (!email) {
      sayAuth('Type your email address above first, then press Reset password.');
      emailEl?.focus();
      return;
    }
    try {
      const fb = await ensureAuthListener(handleAuthUser);
      await fb.sendResetEmail(email);
      sayAuth(`Password reset email sent to ${email}.`);
    } catch (err) {
      sayAuth(formatAuthError(err));
    }
  };
}

function bindHomeInteractiveControls() {
  byId('startConvertingFreeBtn')?.addEventListener('click', () => {
    const authCard = byId('authCard');
    authCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    byId('googleSignIn')?.focus();
  });

  byId('finalCtaSignInBtn')?.addEventListener('click', () => {
    const authCard = byId('authCard');
    authCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    byId('googleSignIn')?.focus();
  });

  byId('hearSampleBtn')?.addEventListener('click', () => {
    const samplesSec = byId('samplesSection');
    samplesSec?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const firstBtn = document.querySelector<HTMLButtonElement>('.sample-play-btn');
    firstBtn?.focus();
  });

  const dropZone = byId('landingDropZone');
  const pickBtn = byId('landingPickFileBtn');
  const fileInput = byId<HTMLInputElement>('landingFileInput');
  const playExcerptBtn = byId('landingPlayExcerptBtn');

  if (pickBtn && fileInput) {
    pickBtn.onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      await handleSelectedFile(f);
      fileInput.value = '';
    };
  }

  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-active');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-active');
    });
    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-active');
      const f = e.dataTransfer?.files?.[0];
      if (f && !running && !extracting) {
        await handleSelectedFile(f);
      }
    });
  }

  if (playExcerptBtn) {
    playExcerptBtn.onclick = () => {
      const previewText = byId('landingSampleTextPreview')?.textContent?.trim() || getEditorTextValue().slice(0, 220);
      if (previewText) {
        speakInteractiveText(previewText.slice(0, 240), 'en-US', 'landingDropStatus');
      }
    };
  }

  // Before / After PDF cleanup interactive switch
  const baToggle = byId('beforeAfterToggleBtn');
  const baListen = byId('beforeAfterListenBtn');
  const baTitle = byId('beforeAfterStateTitle');
  const baDisplay = byId('beforeAfterDisplay');
  if (baToggle && baTitle && baDisplay) {
    let showingClean = true;
    const cleanText =
      'Chapter 3: Cell Structure. Every living organism relies on tiny compartments called cells to produce energy and carry genetic instructions.';
    const rawText =
      '14 | Journal of Plant Biology Vol. 8 — Chapter 3: Cell Struc-\nture. Every living organism [Ref 12] relies on tiny com-\npartments called cells. Page 14 of 220 · www.journal.example.org';

    baToggle.onclick = () => {
      showingClean = !showingClean;
      baToggle.setAttribute('aria-pressed', String(showingClean));
      if (showingClean) {
        baTitle.textContent = 'Clean Voice Studio script (page clutter swept away)';
        baDisplay.textContent = cleanText;
        baToggle.textContent = 'Show raw noisy PDF text';
      } else {
        baTitle.textContent = 'Raw PDF text (what regular readers say aloud)';
        baDisplay.textContent = rawText;
        baToggle.textContent = 'Show clean Voice Studio script';
      }
    };

    if (baListen) {
      baListen.onclick = () => {
        speakInteractiveText(baDisplay.textContent || cleanText, 'en-US', 'beforeAfterStateTitle');
      };
    }
  }
}

function bindSamplePlayerButtons() {
  document.querySelectorAll<HTMLButtonElement>('.sample-play-btn').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.sampleId as keyof typeof SAMPLE_CLIPS | undefined;
      if (!id || !SAMPLE_CLIPS[id]) return;
      if (activeSampleId === id) {
        stopInteractiveSample(true);
        return;
      }
      stopInteractiveSample(false);
      activeSampleId = id;
      btn.setAttribute('aria-pressed', 'true');
      btn.textContent = 'Stop preview';
      const clip = SAMPLE_CLIPS[id];
      speakInteractiveText(clip.script, clip.voiceLang, 'samplePlaybackStatus', () => {
        if (activeSampleId === id) {
          activeSampleId = null;
          btn.setAttribute('aria-pressed', 'false');
          btn.textContent = 'Play sample';
        }
      });
    };
  });
}

function bindContactForm() {
  const form = byId<HTMLFormElement>('contactForm');
  const submitBtn = byId<HTMLButtonElement>('contactSubmit');
  const statusEl = byId('contactStatus');
  const errEl = byId('contactErr');
  if (!form || !submitBtn || !statusEl || !errEl) return;

  if (currentUser?.displayName && !byId<HTMLInputElement>('contactName')?.value.trim()) {
    const el = byId<HTMLInputElement>('contactName');
    if (el) el.value = currentUser.displayName;
  }
  if (currentUser?.email && !byId<HTMLInputElement>('contactEmail')?.value.trim()) {
    const el = byId<HTMLInputElement>('contactEmail');
    if (el) el.value = currentUser.email;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    statusEl.textContent = '';

    const nameEl = $<HTMLInputElement>('#contactName');
    const emailEl = $<HTMLInputElement>('#contactEmail');
    const subjectEl = $<HTMLSelectElement>('#contactSubject');
    const messageEl = $<HTMLTextAreaElement>('#contactMessage');

    nameEl.removeAttribute('aria-invalid');
    emailEl.removeAttribute('aria-invalid');
    messageEl.removeAttribute('aria-invalid');

    if (nameEl.value.trim().length < 2) {
      nameEl.setAttribute('aria-invalid', 'true');
      errEl.textContent = 'Enter your full name (at least 2 characters).';
      nameEl.focus();
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEl.value.trim())) {
      emailEl.setAttribute('aria-invalid', 'true');
      errEl.textContent = 'Enter a valid reply email address.';
      emailEl.focus();
      return;
    }
    if (messageEl.value.trim().length < 10) {
      messageEl.setAttribute('aria-invalid', 'true');
      errEl.textContent = 'Enter a message of at least 10 characters.';
      messageEl.focus();
      return;
    }

    submitBtn.disabled = true;
    statusEl.textContent = 'Sending your message…';

    try {
      const fb = await getFirebaseMod();
      const refId = await fb.submitContactMessage({
        name: nameEl.value,
        email: emailEl.value,
        subject: subjectEl.value,
        message: messageEl.value,
      });
      messageEl.value = '';
      statusEl.textContent = `Message sent. Reference: ${refId}.`;
      statusEl.focus?.();
    } catch (err) {
      statusEl.textContent = '';
      const raw = err instanceof Error ? err.message : 'Could not send message right now.';
      errEl.textContent = raw.includes('"error":')
        ? 'Message could not be saved right now. Please check all fields and try again.'
        : raw;
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function bindPdfAndPodcastOutletControls() {
  const pdfPickBtn = byId('pdfAgentPickFileBtn');
  if (pdfPickBtn) {
    pdfPickBtn.onclick = () => {
      const wsFile = byId<HTMLInputElement>('file');
      if (wsFile) {
        wsFile.click();
        return;
      }
      // Fallback file picker when visiting /pdf-to-audio logged out
      const tmpInput = document.createElement('input');
      tmpInput.type = 'file';
      tmpInput.accept =
        '.pdf,.docx,.epub,.txt,.md,text/plain,application/pdf,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      tmpInput.onchange = async () => {
        const f = tmpInput.files?.[0];
        if (f) await handleSelectedFile(f);
      };
      tmpInput.click();
    };
  }

  const pdfRunBtn = byId('pdfAgentRunBtn');
  if (pdfRunBtn) pdfRunBtn.onclick = () => void runPdfRecordingAgent(false);
  const pdfLoadBtn = byId('pdfAgentLoadOnlyBtn');
  if (pdfLoadBtn) pdfLoadBtn.onclick = () => void runPdfRecordingAgent(true);

  if (loadedFile) {
    const infoEl = byId('pdfStudioFileInfo');
    if (infoEl) {
      infoEl.textContent = `Loaded: ${loadedFile.name}. Enter which chapter, topic, or page range to extract below.`;
    }
  }

  const applyTplBtn = byId('applyTemplateBtn');
  if (applyTplBtn) {
    applyTplBtn.onclick = () => {
      const key = byId<HTMLSelectElement>('templateSelect')?.value || '';
      const tpl = CREATOR_TEMPLATES[key];
      if (!tpl) return;
      const current = getEditorTextValue().trim();
      if (current && currentTextOrigin !== 'sample' && !sampleReplaceArmed) {
        sampleReplaceArmed = true;
        setStudioStatus('Your Speech Studio editor already has text. Press Load selected template again to replace it.');
        return;
      }
      cfg.mode = tpl.mode;
      cfg.style = tpl.style;
      const modeEl = byId<HTMLSelectElement>('mode');
      if (modeEl) modeEl.value = tpl.mode;
      const styleEl = byId<HTMLInputElement>('style');
      if (styleEl) styleEl.value = tpl.style;
      syncStylePresetSelect(tpl.style);
      syncOptionVisibility();
      store.set('vs.cfg', cfg);
      loadedDocTitle = '';
      setAudioTitleValue(tpl.title);
      setText(tpl.text, 'sample');
      setStudioStatus(
        `Loaded "${tpl.title}" (${tpl.mode === 'dialogue' ? '2-speaker dialogue' : 'single voice'}). Open Speech Studio or generate audio below.`
      );
    };
  }

  const genPodcastBtn = byId('genPodcastBtn');
  if (genPodcastBtn) {
    genPodcastBtn.onclick = async () => {
      if (!isByokActive() && !requireSignedInUser()) return;
      const topicInput = byId<HTMLInputElement>('podcastTopic')?.value.trim() || '';
      const editorText = getEditorTextValue().trim();
      const topic = topicInput || editorText.slice(0, 5000);
      const length = byId<HTMLSelectElement>('podcastLen')?.value || 'short';

      if (topic.length < 3) {
        setStudioErr('Enter a podcast topic above, or paste notes in Speech Studio first.');
        byId('podcastTopic')?.focus();
        return;
      }

      studioBusy = true;
      ui();
      setStudioStatus('Generating 2-speaker podcast script…');
      try {
        const script = await runStudioAction({ action: 'podcast', topic, length });
        cfg.mode = 'dialogue';
        const modeEl = byId<HTMLSelectElement>('mode');
        if (modeEl) modeEl.value = 'dialogue';
        syncOptionVisibility();
        store.set('vs.cfg', cfg);
        setText(script, 'user');
        if (topicInput && !getAudioTitleValue().trim()) {
          setAudioTitleValue(`${topicInput.slice(0, 50)} Podcast`);
        }
        setStudioStatus(
          `Generated 2-speaker podcast script (${[...script].length.toLocaleString()} chars). Press Open script in Speech Studio or Generate audio now.`
        );
      } catch (err) {
        setStudioErr(err instanceof Error ? err.message : 'Could not generate podcast script.');
      } finally {
        studioBusy = false;
        ui();
      }
    };
  }

  const translateBtn = byId('translateBtn');
  if (translateBtn) {
    translateBtn.onclick = async () => {
      if (!isByokActive() && !requireSignedInUser()) return;
      const currentText = getEditorTextValue().trim();
      const targetLang = byId<HTMLSelectElement>('translateLang')?.value || 'Urdu';
      if (!currentText) {
        setStudioErr('Enter or load text in Speech Studio first before translating.');
        return;
      }

      studioBusy = true;
      ui();
      setStudioStatus(`Translating & adapting script into ${targetLang}…`);
      try {
        const translated = await runStudioAction({
          action: 'translate',
          text: currentText.slice(0, 8000),
          targetLang,
        });
        setText(translated, 'user');
        setStudioStatus(
          `Translated into ${targetLang} (${[...translated].length.toLocaleString()} chars). Press Open script in Speech Studio or Generate audio now.`
        );
      } catch (err) {
        setStudioErr(err instanceof Error ? err.message : 'Could not translate text.');
      } finally {
        studioBusy = false;
        ui();
      }
    };
  }

  const sendBtn = byId('sendStudioToSpeechBtn');
  if (sendBtn) {
    sendBtn.onclick = () => {
      if (!getEditorTextValue().trim()) {
        setStudioErr('Load a template, generate a podcast script, or enter text first.');
        return;
      }
      navigateToPage('tool', false);
      byId('text')?.focus();
    };
  }

  const recBtn = byId('recordFromStudioBtn');
  if (recBtn) {
    recBtn.onclick = () => {
      if (!getEditorTextValue().trim()) {
        setStudioErr('Load a template, generate a podcast script, or enter text first.');
        return;
      }
      if (!requireSignedInUser()) return;
      navigateToPage('tool', false);
      byId('gen')?.click();
    };
  }
}

function bindOutletLinks(container: ParentNode) {
  container.querySelectorAll<HTMLAnchorElement>('a[data-page]').forEach((link) => {
    link.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const page = link.dataset.page;
      if (page && ROUTE_BY_PAGE_ID.has(page)) {
        e.preventDefault();
        navigateToPage(page, true);
      }
    });
  });
}

function bindCurrentOutletControls() {
  const outlet = byId('pageOutlet');
  if (!outlet) return;
  bindOutletLinks(outlet);
  bindAuthCardControls();
  bindHomeInteractiveControls();
  bindSamplePlayerButtons();
  bindContactForm();
  bindPdfAndPodcastOutletControls();
}

function focusActivePageHeading(container: HTMLElement) {
  const visibleHeading = Array.from(container.querySelectorAll<HTMLElement>('h1[tabindex="-1"]')).find(
    (h) => h.offsetParent !== null
  );
  (visibleHeading || $('#main')).focus();
}

function syncPrivateWorkspaceVisibility(activePageId: PageId) {
  const outlet = byId('pageOutlet');
  const privateRoot = byId('appPrivateRoot');
  const verifyBox = byId('authVerifyBox');
  const converterWs = byId('converterWorkspace');

  if (!outlet || !privateRoot) return;

  if (activePageId === 'tool' && currentUser) {
    outlet.hidden = true;
    privateRoot.hidden = false;
    if (verifyBox) verifyBox.hidden = currentUser.emailVerified;
    if (converterWs) converterWs.hidden = !currentUser.emailVerified;
  } else {
    outlet.hidden = false;
    privateRoot.hidden = true;
    if (verifyBox) verifyBox.hidden = true;
    if (converterWs) converterWs.hidden = true;
  }

  if (activePageId === 'account' && currentUser && currentUser.emailVerified) {
    mountAccountCardIntoOutlet();
  }
}

function route(moveFocus: boolean) {
  let targetRoute = resolveRoute();
  let id = targetRoute.pageId;

  if (authResolved) {
    if (id === 'admin' && !isAdminActive(currentUser)) {
      targetRoute = ROUTE_BY_PAGE_ID.get('tool') || targetRoute;
      id = targetRoute.pageId;
      history.replaceState(null, '', '/');
    } else if (id === 'account' && (!currentUser || !currentUser.emailVerified)) {
      targetRoute = ROUTE_BY_PAGE_ID.get('tool') || targetRoute;
      id = targetRoute.pageId;
      history.replaceState(null, '', '/');
    }
  } else if (id === 'account' || id === 'admin') {
    void ensureAuthListener(handleAuthUser);
  }

  const outlet = byId('pageOutlet');
  if (outlet) {
    const renderedId = outlet.getAttribute('data-rendered-page');
    if (renderedId !== id) {
      stopInteractiveSample(false);
      outlet.innerHTML = targetRoute.html;
      outlet.setAttribute('data-rendered-page', id);
      bindCurrentOutletControls();
    }
  }

  syncPrivateWorkspaceVisibility(id);

  document.querySelectorAll<HTMLAnchorElement>('.drawer-nav a[data-page]').forEach((a) => {
    if (a.dataset.page === id) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  const canonicalUrl = `${window.location.origin}${targetRoute.path === '/404' ? '' : targetRoute.path}`;
  document.title = targetRoute.title;
  document.querySelector('meta[name="robots"]')?.setAttribute('content', targetRoute.robots);
  document.querySelector('meta[name="description"]')?.setAttribute('content', targetRoute.description);
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', targetRoute.title);
  document.querySelector('meta[property="og:description"]')?.setAttribute('content', targetRoute.description);
  document.querySelector('meta[name="twitter:title"]')?.setAttribute('content', targetRoute.title);
  document.querySelector('meta[name="twitter:description"]')?.setAttribute('content', targetRoute.description);
  document.getElementById('canonicalLink')?.setAttribute('href', canonicalUrl);
  document.getElementById('ogUrl')?.setAttribute('content', canonicalUrl);

  const ldScript = document.getElementById('ldJsonScript');
  if (ldScript) {
    ldScript.textContent = buildJsonLdForRoute(targetRoute, window.location.origin);
  }

  if (id === 'admin' && isAdminActive(currentUser)) {
    void (async () => {
      const { mountAdminPanel } = await import('./admin-panel');
      if (!document.getElementById('adminRefreshAll')) {
        mountAdminPanel({
          getCurrentUser: () => currentUser,
          isAdminActive,
          navigateToPage: (target, focus) => navigateToPage(target, focus),
          fetchBackendQuota,
          loadPublicSiteStatus,
        });
      }
      if (!adminDataLoaded) {
        adminDataLoaded = true;
        document.getElementById('adminRefreshAll')?.click();
      }
    })();
  }

  if ($('#navDrawer').hidden && $('#a11yDrawer').hidden && $('#exportModal').hidden) {
    setBackgroundInert(false);
  }

  if (moveFocus) {
    window.scrollTo(0, 0);
    const activeContainer = id === 'tool' && currentUser ? byId('appPrivateRoot') || outlet || $('#main') : outlet || $('#main');
    focusActivePageHeading(activeContainer);
  }
}

function navigateToPage(id: PageId, moveFocus = true) {
  if (id === 'admin' && !isAdminActive(currentUser)) {
    closeDrawer(false);
    id = 'tool';
  }
  if (id === 'account' && (!currentUser || !currentUser.emailVerified)) {
    closeDrawer(false);
    id = 'tool';
  }
  const targetRoute = ROUTE_BY_PAGE_ID.get(id) || ROUTE_BY_PAGE_ID.get('tool');
  const targetPath = targetRoute?.path || '/';
  if (location.pathname !== targetPath || location.hash) {
    history.pushState(null, '', targetPath);
  }
  closeDrawer(false);
  closeA11yDrawer(false);
  closeExportModal(false);
  route(moveFocus);
}

window.addEventListener('popstate', () => route(true));
window.addEventListener('hashchange', () => route(true));

document.addEventListener('keydown', (e) => {
  const navDrawer = document.getElementById('navDrawer');
  const a11yDrawer = document.getElementById('a11yDrawer');
  const exportModal = document.getElementById('exportModal');
  const activeDrawer =
    exportModal && !exportModal.hidden
      ? exportModal
      : navDrawer && !navDrawer.hidden
        ? navDrawer
        : a11yDrawer && !a11yDrawer.hidden
          ? a11yDrawer
          : null;
  if (!activeDrawer) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    if (activeDrawer === exportModal) closeExportModal(true);
    else if (activeDrawer === navDrawer) closeDrawer(true);
    else closeA11yDrawer(true);
    return;
  }

  if (e.key === 'Tab') {
    const focusables = getFocusableInside(activeDrawer);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (!active || active === first || !activeDrawer.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (!active || active === last || !activeDrawer.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }
});

const bindClickById = (id: string, handler: () => void) => {
  const el = byId(id);
  if (el) el.onclick = handler;
};

bindClickById('openDrawerBtn', () => openDrawer());
bindClickById('closeDrawerBtn', () => closeDrawer(true));
bindClickById('drawerBackdrop', () => closeDrawer(true));
bindClickById('openA11yBtn', () => openA11yDrawer());
bindClickById('closeA11yBtn', () => closeA11yDrawer(true));
bindClickById('a11yBackdrop', () => closeA11yDrawer(true));
bindClickById('closeExportBtn', () => closeExportModal(true));
bindClickById('exportBackdrop', () => closeExportModal(true));

bindOutletLinks(document);

function renderServerHealthStatus(state: 'checking' | 'ready' | 'nokey' | 'missing404' | 'offline') {
  const el = document.getElementById('serverHealthStatus');
  if (el) {
    el.classList.remove('status-ok', 'status-bad', 'status-mut');
    if (state === 'checking') {
      el.classList.add('status-mut');
      el.textContent = 'Speech server status: Checking connection…';
    } else if (state === 'ready') {
      el.classList.add('status-ok');
      el.textContent = 'Speech server status: Connected — server speech key is active and ready.';
    } else if (state === 'nokey') {
      el.classList.add('status-bad');
      el.textContent =
        'Speech server status: Server is online, but no server speech key is active yet. Turn on Own Gemini API Key (Unlimited Mode) in Step 1.';
    } else if (state === 'missing404') {
      el.classList.add('status-bad');
      el.textContent =
        'Speech server status: Backend API returned 404 on this URL. Turn on Own Gemini API Key (Unlimited Mode) in Step 1.';
    } else {
      el.classList.add('status-bad');
      el.textContent =
        'Speech server status: Backend speech endpoint could not be verified right now. Turn on Own Gemini API Key (Unlimited Mode) in Step 1 if needed.';
    }
  }

  const notice = document.getElementById('backendNotice');
  if (notice) {
    if (!isByokActive() && (state === 'nokey' || state === 'missing404' || state === 'offline')) {
      notice.hidden = false;
      notice.textContent =
        state === 'nokey'
          ? 'Shared server speech key is not configured on this server yet. Open Step 1 -> Own Gemini API Key (Unlimited Mode) to generate audio with your free key.'
          : state === 'missing404'
            ? 'Speech server route was not found on this deployment. Open Step 1 -> Own Gemini API Key (Unlimited Mode) to generate audio directly from your browser.'
            : 'Shared speech server returned an error checking availability. You can turn on Own Gemini API Key (Unlimited Mode) in Step 1 anytime.';
    } else if (state === 'ready' || isByokActive()) {
      notice.hidden = true;
      notice.textContent = '';
    }
  }
}

/* ---- Account & Quota UI ---- */
function updateWorkspaceBalanceBar() {
  const barEl = document.getElementById('workspaceBalanceText');
  if (!barEl) return;
  if (!currentUser || !currentUser.emailVerified) {
    barEl.textContent = 'Checking balance…';
    return;
  }
  const emailLabel = activeQuota?.email || currentUser.email || 'Verified account';
  if (!activeQuota) {
    barEl.textContent = isByokActive() ? `${emailLabel} · Unlimited Mode active` : `${emailLabel} · Loading balance…`;
    return;
  }
  const byokNote = isByokActive() ? ' · Unlimited Mode ON' : '';
  barEl.textContent =
    `${emailLabel} · Free today: ${activeQuota.remainingDaily.toLocaleString()} / ` +
    `${activeQuota.dailyLimit.toLocaleString()} chars · Credits: ${activeQuota.paidCredits.toLocaleString()}${byokNote}`;
}

function renderQuota(q: QuotaState) {
  activeQuota = q;
  const remEl = byId('statDailyRemaining');
  if (remEl) remEl.textContent = `${q.remainingDaily.toLocaleString()} chars`;
  const credEl = byId('statPaidCredits');
  if (credEl) credEl.textContent = `${q.paidCredits.toLocaleString()} chars`;
  const usedEl = byId('statTotalUsed');
  if (usedEl) usedEl.textContent = `${q.totalCharsUsed.toLocaleString()} chars`;
  const planEl = byId('statAccountPlan');
  if (planEl) planEl.textContent = q.plan === 'pro' ? 'Extended' : 'Free';

  const emailText = q.email || currentUser?.email || '';
  const metaEl = byId('userAccountMeta');
  if (metaEl) {
    metaEl.textContent = emailText
      ? `${emailText} · ${q.dailyLimit.toLocaleString()} chars daily allowance`
      : `${q.dailyLimit.toLocaleString()} chars daily allowance`;
  }

  const bar = byId<HTMLProgressElement>('dailyBar');
  if (bar) {
    bar.max = Math.max(1, q.dailyLimit);
    bar.value = Math.min(q.dailyLimit, q.dailyUsedChars);
  }
  const barLabel = byId('dailyBarLabel');
  if (barLabel) {
    barLabel.textContent = `Daily free allowance used: ${q.dailyUsedChars.toLocaleString()} of ${q.dailyLimit.toLocaleString()} characters`;
  }

  updateWorkspaceBalanceBar();

  if (typeof q.backendConfigured === 'boolean') {
    renderServerHealthStatus(q.backendConfigured ? 'ready' : 'nokey');
  }

  const notice = byId('backendNotice');
  if (notice) {
    if (q.backendConfigured === false && !isByokActive()) {
      notice.hidden = false;
      notice.textContent =
        'Shared server allowance is currently unavailable on this deployment. You can turn on Own Gemini API Key (Unlimited Mode) in Step 1 to generate audio directly from your browser.';
    } else {
      notice.hidden = true;
      notice.textContent = '';
    }
  }

  updateCounts();
}

function renderWalletDoc(w: UserWalletDoc) {
  const today = new Date().toISOString().slice(0, 10);
  const usedToday = w.dailyDate === today ? w.dailyUsedChars : 0;
  const kvUsed = activeQuota ? activeQuota.dailyUsedChars : 0;
  const mergedUsed = Math.max(usedToday, kvUsed);
  const mergedRemaining = Math.max(0, w.dailyLimit - mergedUsed);

  renderQuota({
    uid: w.uid,
    email: w.email,
    dailyLimit: w.dailyLimit,
    dailyUsedChars: mergedUsed,
    remainingDaily: mergedRemaining,
    paidCredits: w.paidCredits,
    totalCharsUsed: Math.max(w.totalCharsUsed, activeQuota?.totalCharsUsed || 0),
    plan: w.plan,
    backendConfigured: activeQuota?.backendConfigured,
  });
}

function renderLedger(entries: LedgerEntryDoc[]) {
  const ul = byId('ledgerList');
  if (!ul) return;
  ul.innerHTML = '';
  if (!entries.length) {
    const li = document.createElement('li');
    li.textContent = 'No usage or credit entries recorded yet.';
    ul.appendChild(li);
    return;
  }
  for (const e of entries) {
    const li = document.createElement('li');
    const when = e.createdAt?.toDate?.()?.toLocaleString() || 'Recent';
    const delta = e.creditsDelta !== 0 ? ` (${e.creditsDelta > 0 ? '+' : ''}${e.creditsDelta.toLocaleString()} credits)` : '';
    li.textContent = `${when}: ${e.note}${delta}`;
    ul.appendChild(li);
  }
}

async function fetchBackendQuota(user: User) {
  renderServerHealthStatus('checking');
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/quota', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = (await res.json()) as QuotaState;
      renderQuota(data);
      return;
    }
    if (res.status === 404) {
      renderServerHealthStatus('missing404');
      return;
    }
    const healthRes = await fetch('/api/health');
    if (healthRes.status === 404) {
      renderServerHealthStatus('missing404');
      return;
    }
    if (healthRes.ok) {
      const h = (await healthRes.json()) as { backendConfigured?: boolean };
      renderServerHealthStatus(h.backendConfigured ? 'ready' : 'nokey');
      return;
    }
    renderServerHealthStatus('offline');
  } catch {
    renderServerHealthStatus('offline');
  }
}

function clearFirestoreListeners() {
  walletUnsub?.();
  walletUnsub = null;
  ledgerUnsub?.();
  ledgerUnsub = null;
  refUnsub?.();
  refUnsub = null;
}

function setAuthTab(mode: 'signin' | 'signup') {
  authMode = mode;
  const isSignUp = mode === 'signup';
  byId('tabSignIn')?.setAttribute('aria-pressed', String(!isSignUp));
  byId('tabSignUp')?.setAttribute('aria-pressed', String(isSignUp));
  const nameWrap = byId('authNameWrap');
  if (nameWrap) nameWrap.hidden = !isSignUp;
  const submitBtn = byId('authSubmit');
  if (submitBtn) submitBtn.textContent = isSignUp ? 'Create account' : 'Sign in';
  const passEl = byId<HTMLInputElement>('authPass');
  if (passEl) passEl.autocomplete = isSignUp ? 'new-password' : 'current-password';
}

const handleSignOut = async () => {
  const fb = await getFirebaseMod();
  await fb.signOutUser();
  sayAuth('Signed out.');
};

function triggerHeaderOrDrawerAuth() {
  closeDrawer(false);
  if (currentUser) {
    void handleSignOut();
    return;
  }
  if (resolveRoute().pageId !== 'tool') {
    navigateToPage('tool', false);
  }
  byId('authCard')?.scrollIntoView({ block: 'nearest' });
  byId('googleSignIn')?.focus();
}

$('#headerAuthBtn').onclick = triggerHeaderOrDrawerAuth;
$('#drawerAuthBtn').onclick = triggerHeaderOrDrawerAuth;
$('#headerAdminBtn').onclick = () => {
  if (isAdminActive(currentUser)) {
    navigateToPage('admin', true);
  }
};

async function loadPublicSiteStatus() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return;
    const h = (await res.json()) as {
      backendConfigured?: boolean;
      maintenanceMode?: boolean;
      siteNotice?: string;
    };
    const banner = document.getElementById('siteNoticeBanner');
    const bannerText = document.getElementById('siteNoticeText');
    if (banner && bannerText) {
      const msg = h.maintenanceMode
        ? h.siteNotice || 'Shared speech generation is temporarily paused for maintenance. Personal key mode remains available.'
        : h.siteNotice || '';
      if (msg) {
        banner.hidden = false;
        bannerText.textContent = msg;
      } else {
        banner.hidden = true;
        bannerText.textContent = '';
      }
    }
    if (typeof h.backendConfigured === 'boolean') {
      renderServerHealthStatus(h.backendConfigured ? 'ready' : 'nokey');
    }
  } catch {
    // Ignore transient health check error
  }
}

/* ---- Lazy Mounting of Private Screens (#authVerifyBox, #converterWorkspace, #account) ---- */
function mountSignedInScreensOnce() {
  if (signedInScreensMounted) return;
  const root = byId('appPrivateRoot');
  if (!root) return;
  root.innerHTML = `${VERIFY_BOX_HTML}\n${CONVERTER_WORKSPACE_HTML}`;
  signedInScreensMounted = true;

  byId('signOutVerify')?.addEventListener('click', () => {
    void handleSignOut();
  });

  byId('resendVerify')?.addEventListener('click', async () => {
    if (!currentUser) return;
    try {
      const fb = await getFirebaseMod();
      await fb.resendVerificationEmail(currentUser);
      sayAuth('Verification email sent again. Check your inbox or spam folder.');
    } catch (err) {
      sayAuth(formatAuthError(err));
    }
  });

  byId('refreshVerify')?.addEventListener('click', async () => {
    if (!currentUser) return;
    try {
      const fb = await getFirebaseMod();
      await currentUser.reload();
      if (fb.auth.currentUser?.emailVerified) {
        await handleAuthUser(fb.auth.currentUser);
        sayAuth('Email verified! Your 3,000 characters/day free allowance is now active.');
      } else {
        sayAuth('Your email is not verified yet. Open the link we sent to your inbox first.');
      }
    } catch (err) {
      sayAuth(formatAuthError(err));
    }
  });

  bindWorkspaceInteractionsOnce();
  drawDict();
  renderChaptersBox();

  if (pendingEditorText) {
    setText(pendingEditorText, currentTextOrigin);
  }
  if (pendingAudioTitle) {
    setAudioTitleValue(pendingAudioTitle);
  }
  ui();
}

function unmountSignedInScreens() {
  const root = byId('appPrivateRoot');
  if (root) {
    root.innerHTML = '';
    root.hidden = true;
  }
  const accountMount = byId('accountMount');
  if (accountMount) accountMount.innerHTML = '';
  signedInScreensMounted = false;
  workspaceEventsBound = false;
}

function mountAccountCardIntoOutlet() {
  const accountMount = byId('accountMount');
  if (!accountMount || !currentUser || !currentUser.emailVerified) return;
  if (!byId('accountCard')) {
    accountMount.innerHTML = ACCOUNT_CARD_HTML;
    byId('signOutBtn')?.addEventListener('click', () => {
      void handleSignOut();
    });
    byId('refreshQuota')?.addEventListener('click', async () => {
      if (!currentUser) return;
      sayAuth('Refreshing balance…');
      await fetchBackendQuota(currentUser);
      sayAuth('Balance updated.');
    });
    bindReferralUi();
  }
  const userDisp = byId('userDisplay');
  if (userDisp) userDisp.textContent = currentUser.displayName || currentUser.email || 'Account';
  const userMeta = byId('userAccountMeta');
  if (userMeta) userMeta.textContent = currentUser.email ? `${currentUser.email} · 3,000 chars daily allowance` : '';
  const refInput = byId<HTMLInputElement>('refLinkInput');
  if (refInput) {
    refInput.value = `${window.location.origin}/?ref=${encodeURIComponent(currentUser.uid)}`;
  }
  if (activeQuota) {
    renderQuota(activeQuota);
  }
}

async function handleAuthUser(user: User | null) {
  authResolved = true;
  clearFirestoreListeners();
  currentUser = user;
  activeQuota = null;
  verifiedAdminSession = false;
  adminDataLoaded = false;
  const { unmountAdminPanel } = await import('./admin-panel');
  unmountAdminPanel();

  const headerUser = $('#headerUser');
  const headerAuthBtn = $('#headerAuthBtn');
  const headerAdminBtn = $('#headerAdminBtn');
  const drawerUser = $('#drawerUser');
  const drawerAuthBtn = $('#drawerAuthBtn');
  const navAccountLink = $('#navAccountLink');
  const navAdminLink = $('#navAdminLink');

  const setVerifyPrompt = (email?: string | null) => {
    const promptEl = document.getElementById('verifyPromptText');
    if (!promptEl) return;
    promptEl.textContent = '';
    if (!email) return;
    promptEl.appendChild(document.createTextNode('We sent a verification link to '));
    const emailStrong = document.createElement('strong');
    emailStrong.textContent = email;
    promptEl.appendChild(emailStrong);
    promptEl.appendChild(document.createTextNode('. Open the link in your inbox, then select '));
    const actionStrong = document.createElement('strong');
    actionStrong.textContent = 'I verified — refresh status';
    promptEl.appendChild(actionStrong);
    promptEl.appendChild(
      document.createTextNode(' to open the converter workspace and activate your 3,000 characters/day free allowance.')
    );
  };

  if (!user) {
    unmountSignedInScreens();
    headerUser.hidden = true;
    headerUser.textContent = '';
    headerAdminBtn.hidden = true;
    headerAdminBtn.textContent = '';
    headerAuthBtn.textContent = 'Sign in';
    drawerUser.hidden = true;
    drawerUser.textContent = '';
    drawerAuthBtn.textContent = 'Sign in to Converter';
    navAccountLink.hidden = true;
    navAccountLink.textContent = '';
    navAdminLink.hidden = true;
    navAdminLink.textContent = '';
    route(false);
    return;
  }

  mountSignedInScreensOnce();

  const label = user.email || user.displayName || 'Account';
  headerUser.hidden = false;
  headerUser.textContent = label;
  headerAuthBtn.textContent = 'Sign out';
  drawerUser.hidden = false;
  drawerUser.textContent = `Signed in as ${label}`;
  drawerAuthBtn.textContent = 'Sign out';

  if (!user.emailVerified) {
    setVerifyPrompt(user.email || 'your email address');
    headerAdminBtn.hidden = true;
    headerAdminBtn.textContent = '';
    navAccountLink.hidden = true;
    navAccountLink.textContent = '';
    navAdminLink.hidden = true;
    navAdminLink.textContent = '';
    updateWorkspaceBalanceBar();
    updateCounts();
    route(false);
    return;
  }

  setVerifyPrompt(null);
  const fb = await getFirebaseMod();
  verifiedAdminUid = fb.ADMIN_UID;
  const adminAuthorized = await fb.verifyStrictAdmin(user);
  verifiedAdminSession = adminAuthorized;
  navAccountLink.hidden = false;
  navAccountLink.textContent = 'My Account';
  navAdminLink.hidden = !adminAuthorized;
  navAdminLink.textContent = adminAuthorized ? 'Admin Panel' : '';
  headerAdminBtn.hidden = !adminAuthorized;
  headerAdminBtn.textContent = adminAuthorized ? 'Admin Panel' : '';

  updateWorkspaceBalanceBar();
  if (resolveRoute().pageId === 'account') {
    mountAccountCardIntoOutlet();
  }

  try {
    await fb.ensureUserAndWallet(user);
    walletUnsub = fb.subscribeWallet(
      user.uid,
      (w) => {
        if (w) renderWalletDoc(w);
      },
      () => {
        sayAuth('Could not sync live account balance. Using server tracker.');
      }
    );
    ledgerUnsub = fb.subscribeLedger(
      user.uid,
      renderLedger,
      () => {
        // Ignore offline error
      }
    );
    refUnsub = fb.subscribeMyReferrals(
      user.uid,
      (rows) => {
        const granted = rows.filter((r) => r.bonusGranted).length;
        const msgEl = document.getElementById('refStatsMsg');
        if (msgEl) {
          msgEl.textContent =
            `Invited friends: ${rows.length} (${granted} verified & credited) · ` +
            `Bonus credits earned: ${(granted * 2000).toLocaleString()} chars`;
        }
      },
      () => {
        // Ignore offline error
      }
    );
  } catch {
    sayAuth('Could not load account balance right now.');
  }

  const pendingRef = store.get<string>('vs.pendingRef', '').trim();
  if (pendingRef && pendingRef !== user.uid && /^[a-zA-Z0-9_-]{6,128}$/.test(pendingRef)) {
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/referral', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ referrerUid: pendingRef }),
      });
      const data = res.ok ? ((await res.json()) as { credited?: boolean; pending?: boolean }) : {};
      if (!res.ok || data.pending) {
        await fb.recordPendingReferralClient(user, pendingRef);
      }
      store.set('vs.pendingRef', '');
    } catch {
      await fb.recordPendingReferralClient(user, pendingRef);
      store.set('vs.pendingRef', '');
    }
  }

  const cName = byId<HTMLInputElement>('contactName');
  if (user.displayName && cName && !cName.value.trim()) cName.value = user.displayName;
  const cEmail = byId<HTMLInputElement>('contactEmail');
  if (user.email && cEmail && !cEmail.value.trim()) cEmail.value = user.email;

  await fetchBackendQuota(user);

  if (adminAuthorized && resolveRoute().pageId === 'admin') {
    const { mountAdminPanel } = await import('./admin-panel');
    mountAdminPanel({
      getCurrentUser: () => currentUser,
      isAdminActive,
      navigateToPage: (target, focus) => navigateToPage(target, focus),
      fetchBackendQuota,
      loadPublicSiteStatus,
    });
  }
  route(false);
}

/* ---- Settings & Workspace Bindings ---- */
function populateSelects() {
  const modelEl = byId<HTMLSelectElement>('model');
  const voiceEl = byId<HTMLSelectElement>('voice');
  const voiceBEl = byId<HTMLSelectElement>('voiceB');
  if (!modelEl || !voiceEl || !voiceBEl) return;

  modelEl.innerHTML = '';
  for (const m of MODELS) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    modelEl.appendChild(opt);
  }

  voiceEl.innerHTML = '';
  voiceBEl.innerHTML = '';
  for (const v of VOICES) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    voiceEl.appendChild(opt.cloneNode(true));
    voiceBEl.appendChild(opt);
  }
}

function syncAdvancedSummary() {
  const summaryEl = byId('advancedSummary');
  if (!summaryEl) return;
  const fmtText = cfg.format === 'mp3' ? `MP3 ${cfg.mp3Kbps} kbps` : 'WAV 24 kHz';
  const modelShort = MODELS.find((m) => m.id === cfg.model)?.label.split('(')[0].trim() || cfg.model;
  summaryEl.textContent = `Audio format & advanced settings (${fmtText} · ${modelShort})`;
}

function syncOptionVisibility() {
  const isDialogue = cfg.mode === 'dialogue';
  const voiceBWrap = byId('voiceBWrap');
  if (voiceBWrap) voiceBWrap.hidden = !isDialogue;
  const dHint = byId('dialogueHint');
  if (dHint) dHint.hidden = !isDialogue;
  const sSingle = byId('sampleSingle');
  if (sSingle) sSingle.hidden = isDialogue;
  const sDlg = byId('sampleDialogue');
  if (sDlg) sDlg.hidden = !isDialogue;
  const vLabel = byId('voiceLabel');
  if (vLabel) vLabel.textContent = isDialogue ? 'Speaker A voice' : 'Voice';
  const mp3Wrap = byId('mp3QualityWrap');
  if (mp3Wrap) mp3Wrap.hidden = cfg.format !== 'mp3';
  syncAdvancedSummary();
}

function syncByokUi() {
  const byokWrap = byId('byokWrap');
  if (byokWrap) byokWrap.hidden = !byokEnabled;
  const byokSum = byId('byokSummary');
  if (byokSum) {
    if (isByokActive()) {
      byokSum.textContent = 'Own Gemini API Key (Unlimited Mode active)';
    } else if (byokEnabled) {
      byokSum.textContent = 'Own Gemini API Key (enter key to activate Unlimited Mode)';
    } else {
      byokSum.textContent = 'Own Gemini API Key (optional Unlimited Mode)';
    }
  }
  const notice = byId('backendNotice');
  if (notice && isByokActive()) {
    notice.hidden = true;
    notice.textContent = '';
  }
}

function updateCounts() {
  const countEl = byId('count');
  const textEl = byId<HTMLTextAreaElement>('text');
  if (!countEl || !textEl) return;
  const text = textEl.value;
  const chunkSize = num('#chunk', 300, 3000, 1800);
  const stats = estimateStats(text, chunkSize, cfg.model);
  if (!stats.chars) {
    countEl.textContent = 'Characters: 0';
    return;
  }
  const estMins = Math.max(1, Math.round(stats.estMinutes));
  let quotaMsg = '';
  if (isByokActive()) {
    quotaMsg = ' Unlimited Mode active (using your own browser-saved Gemini API key).';
  } else if (activeQuota) {
    const available = activeQuota.remainingDaily + activeQuota.paidCredits;
    quotaMsg =
      stats.chars <= available
        ? ` Within your available balance (${available.toLocaleString()} chars).`
        : ` Exceeds your current balance (${available.toLocaleString()} chars) by ${(stats.chars - available).toLocaleString()} chars.`;
  }
  countEl.textContent =
    `Characters: ${stats.chars.toLocaleString()} (${stats.words.toLocaleString()} words). ` +
    `About ${stats.estParts} parts, ~${estMins} min audio.${quotaMsg}`;
}

function syncStylePresetSelect(styleValue: string) {
  const sel = byId<HTMLSelectElement>('stylePreset');
  if (!sel) return;
  const trimmed = styleValue.trim();
  if (!trimmed) {
    sel.value = '';
    return;
  }
  const hasMatch = Array.from(sel.options).some((opt) => opt.value !== '__custom__' && opt.value === trimmed);
  sel.value = hasMatch ? trimmed : '__custom__';
}

function drawDict() {
  const ul = byId('dictList');
  const sumEl = byId('dictSummary');
  if (!ul || !sumEl) return;
  ul.innerHTML = '';
  const activeCount = dictRules.filter((r) => r.enabled).length;
  sumEl.textContent = `Pronunciation dictionary (${activeCount} active rule${activeCount === 1 ? '' : 's'})`;

  if (!dictRules.length) {
    const li = document.createElement('li');
    li.textContent = 'No custom pronunciation rules yet.';
    ul.appendChild(li);
    return;
  }

  dictRules.forEach((rule, idx) => {
    const li = document.createElement('li');
    const info = document.createElement('span');
    info.textContent = `"${rule.find}" -> "${rule.replace}"${rule.wholeWord ? ' (whole word)' : ''}`;

    const actions = document.createElement('div');
    actions.className = 'dict-item-actions';

    const toggleLabel = document.createElement('label');
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = rule.enabled;
    toggle.setAttribute('aria-label', `Enable rule ${rule.find} to ${rule.replace}`);
    toggle.onchange = () => {
      dictRules[idx].enabled = toggle.checked;
      store.set('vs.dict', dictRules);
      const countNow = dictRules.filter((r) => r.enabled).length;
      sumEl.textContent = `Pronunciation dictionary (${countNow} active rule${countNow === 1 ? '' : 's'})`;
    };
    toggleLabel.appendChild(toggle);
    toggleLabel.appendChild(document.createTextNode('Active'));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'sec';
    del.textContent = 'Remove';
    del.setAttribute('aria-label', `Remove pronunciation rule ${rule.find}`);
    del.onclick = () => {
      dictRules.splice(idx, 1);
      store.set('vs.dict', dictRules);
      drawDict();
      const msgEl = byId('dictMsg');
      if (msgEl) msgEl.textContent = 'Rule removed.';
      const nextRemove = ul.querySelector<HTMLButtonElement>('button.sec');
      if (nextRemove) nextRemove.focus();
      else byId('dictFind')?.focus();
    };

    actions.appendChild(toggleLabel);
    actions.appendChild(del);
    li.appendChild(info);
    li.appendChild(actions);
    ul.appendChild(li);
  });
}

function bindWorkspaceInteractionsOnce() {
  if (workspaceEventsBound || !byId('converterWorkspace')) return;
  workspaceEventsBound = true;

  populateSelects();

  const modelSel = $<HTMLSelectElement>('#model');
  modelSel.value = cfg.model;
  if (!modelSel.value && MODELS.length) {
    cfg.model = MODELS[0].id;
    modelSel.value = cfg.model;
  }
  $<HTMLSelectElement>('#voice').value = cfg.voice;
  $<HTMLSelectElement>('#voiceB').value = cfg.voiceB;
  $<HTMLSelectElement>('#mode').value = cfg.mode;
  $<HTMLInputElement>('#style').value = cfg.style;
  syncStylePresetSelect(cfg.style);
  $<HTMLInputElement>('#chunk').value = String(cfg.chunk);
  $<HTMLInputElement>('#pause').value = String(cfg.pause);
  $<HTMLInputElement>('#sil').value = String(cfg.sil);
  $<HTMLSelectElement>('#format').value = cfg.format;
  $<HTMLSelectElement>('#mp3Kbps').value = String(cfg.mp3Kbps);
  $<HTMLInputElement>('#cleanDocs').checked = cfg.cleanDocs;
  $<HTMLSelectElement>('#speed').value = String(cfg.speed);
  $<HTMLInputElement>('#byokEnabled').checked = byokEnabled;
  $<HTMLInputElement>('#byokKey').value = byokKey;

  byId('openPdfStudioShortcut')?.addEventListener('click', () => navigateToPage('pdfStudio', true));
  byId('openPodcastStudioShortcut')?.addEventListener('click', () => navigateToPage('podcastStudio', true));
  byId('openExportModalBtn')?.addEventListener('click', () => openExportModal());

  const saveCfg = () => store.set('vs.cfg', cfg);

  $('#byokEnabled').addEventListener('change', (e) => {
    byokEnabled = (e.target as HTMLInputElement).checked;
    store.set('vs.byokEnabled', byokEnabled);
    syncByokUi();
    updateWorkspaceBalanceBar();
    updateCounts();
    if (byokEnabled) {
      $('#byokStatus').textContent = byokKey.trim()
        ? 'Unlimited Mode enabled using your browser-saved Gemini API key.'
        : 'Paste your free Gemini API key below to activate Unlimited Mode.';
      if (!byokKey.trim()) $('#byokKey').focus();
    } else {
      $('#byokStatus').textContent = 'Switched back to built-in Voice Studio quota (3,000 characters/day).';
    }
  });

  $('#byokKey').addEventListener('input', (e) => {
    byokKey = (e.target as HTMLInputElement).value.trim();
    store.set('vs.byokKey', byokKey);
    syncByokUi();
    updateWorkspaceBalanceBar();
    updateCounts();
    $('#byokStatus').textContent = byokKey
      ? 'API key saved locally in this browser.'
      : 'API key cleared. Built-in quota will be used unless a key is entered.';
  });

  $('#byokToggleVis').addEventListener('click', () => {
    const input = $<HTMLInputElement>('#byokKey');
    const btn = $('#byokToggleVis');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(show));
    btn.textContent = show ? 'Hide key' : 'Show key';
  });

  $('#byokClear').addEventListener('click', () => {
    byokKey = '';
    byokEnabled = false;
    store.set('vs.byokKey', '');
    store.set('vs.byokEnabled', false);
    $<HTMLInputElement>('#byokKey').value = '';
    $<HTMLInputElement>('#byokEnabled').checked = false;
    syncByokUi();
    updateWorkspaceBalanceBar();
    updateCounts();
    $('#byokStatus').textContent = 'Saved API key removed from browser storage.';
    $('#byokEnabled').focus();
  });

  $('#model').addEventListener('change', (e) => {
    cfg.model = (e.target as HTMLSelectElement).value;
    syncAdvancedSummary();
    saveCfg();
    updateCounts();
  });
  $('#voice').addEventListener('change', (e) => {
    cfg.voice = (e.target as HTMLSelectElement).value;
    saveCfg();
  });
  $('#voiceB').addEventListener('change', (e) => {
    cfg.voiceB = (e.target as HTMLSelectElement).value;
    saveCfg();
  });
  $('#mode').addEventListener('change', (e) => {
    cfg.mode = (e.target as HTMLSelectElement).value as GenerationMode;
    syncOptionVisibility();
    saveCfg();
  });
  $('#style').addEventListener('input', (e) => {
    cfg.style = (e.target as HTMLInputElement).value;
    syncStylePresetSelect(cfg.style);
    saveCfg();
  });
  $('#stylePreset').addEventListener('change', (e) => {
    const val = (e.target as HTMLSelectElement).value;
    if (val === '__custom__') {
      $('#style').focus();
      say('Type your custom speaking style instruction in the text field below.');
      return;
    }
    cfg.style = val;
    $<HTMLInputElement>('#style').value = val;
    saveCfg();
    say(val ? `Speaking style set to: ${val}.` : 'Speaking style reset to standard natural delivery.');
  });
  $('#chunk').addEventListener('input', () => {
    cfg.chunk = num('#chunk', 300, 3000, 1800);
    saveCfg();
    updateCounts();
  });
  $('#pause').addEventListener('input', () => {
    cfg.pause = num('#pause', 0, 60, 1);
    saveCfg();
  });
  $('#sil').addEventListener('input', () => {
    cfg.sil = num('#sil', 0, 3000, 250);
    saveCfg();
  });
  $('#format').addEventListener('change', (e) => {
    cfg.format = (e.target as HTMLSelectElement).value as AudioFormat;
    syncOptionVisibility();
    saveCfg();
  });
  $('#mp3Kbps').addEventListener('change', (e) => {
    cfg.mp3Kbps = Number((e.target as HTMLSelectElement).value) === 128 ? 128 : 64;
    syncAdvancedSummary();
    saveCfg();
  });
  $('#cleanDocs').addEventListener('change', (e) => {
    cfg.cleanDocs = (e.target as HTMLInputElement).checked;
    saveCfg();
  });
  $('#speed').addEventListener('change', (e) => {
    cfg.speed = Number((e.target as HTMLSelectElement).value) || 1;
    $<HTMLAudioElement>('#player').playbackRate = cfg.speed;
    saveCfg();
  });

  $('#text').addEventListener('input', () => {
    pendingEditorText = $<HTMLTextAreaElement>('#text').value;
    currentTextOrigin = 'user';
    sampleReplaceArmed = false;
    updateCounts();
  });

  $('#addDict').onclick = () => {
    const findEl = $<HTMLInputElement>('#dictFind');
    const repEl = $<HTMLInputElement>('#dictReplace');
    const wholeEl = $<HTMLInputElement>('#dictWhole');
    const find = findEl.value.trim().slice(0, 120);
    const replace = repEl.value.trim().slice(0, 120);

    if (!find || !replace) {
      $('#dictMsg').textContent = 'Enter both the written word and how it should be spoken.';
      return;
    }
    if (dictRules.length >= 200) {
      $('#dictMsg').textContent = 'Maximum 200 pronunciation rules allowed.';
      return;
    }
    dictRules.push({
      id: String(Date.now()) + Math.random().toString(16).slice(2, 6),
      find,
      replace,
      wholeWord: wholeEl.checked,
      enabled: true,
    });
    store.set('vs.dict', dictRules);
    findEl.value = '';
    repEl.value = '';
    drawDict();
    $('#dictMsg').textContent = `Saved rule: "${find}" will be spoken as "${replace}".`;
    findEl.focus();
  };

  $('#presetDict').onclick = () => {
    const presets: Omit<PronunciationRule, 'id'>[] = [
      { find: 'Dr.', replace: 'Doctor', wholeWord: false, enabled: true },
      { find: 'Prof.', replace: 'Professor', wholeWord: false, enabled: true },
      { find: 'e.g.', replace: 'for example', wholeWord: false, enabled: true },
      { find: 'i.e.', replace: 'that is', wholeWord: false, enabled: true },
      { find: 'etc.', replace: 'et cetera', wholeWord: false, enabled: true },
      { find: 'vs.', replace: 'versus', wholeWord: false, enabled: true },
      { find: 'Jieshuo', replace: 'Jay-shwoh', wholeWord: true, enabled: true },
    ];
    let added = 0;
    for (const p of presets) {
      if (dictRules.length >= 200) break;
      if (!dictRules.some((r) => r.find.toLowerCase() === p.find.toLowerCase())) {
        dictRules.push({ ...p, id: String(Date.now()) + added });
        added++;
      }
    }
    store.set('vs.dict', dictRules);
    drawDict();
    $('#dictMsg').textContent = added
      ? `Added ${added} common academic presets.`
      : 'All presets are already in your dictionary.';
  };

  $('#gen').onclick = () => {
    if (!requireSignedInUser()) return;
    const text = getEditorTextValue().trim();
    if (!text) {
      say('Please enter some text first.');
      $('#text').focus();
      return;
    }
    const chunkSize = num('#chunk', 300, 3000, 1800);
    const items = prepareSpeechItems(text, chunkSize);
    if (!items.length) {
      say('There is nothing readable in the text.');
      return;
    }
    job = {
      items,
      done: 0,
      parts: [],
      rate: 24000,
      model: cfg.model,
      style: cfg.style,
      pause: num('#pause', 0, 60, 1),
      sil: num('#sil', 0, 3000, 250),
      format: cfg.format,
      mp3Kbps: cfg.mp3Kbps,
    };
    lastBlob = null;
    lastSrtBlob = null;
    lastVttBlob = null;
    lastSubtitleSegments = [];
    lastName = '';
    lastSrtName = '';
    lastVttName = '';
    closeExportModal(false);
    $('#result').hidden = true;
    $<HTMLProgressElement>('#prog').value = 0;
    void run();
  };

  $('#resume').onclick = () => {
    if (job) void run();
  };

  $('#cancel').onclick = () => {
    if (ctl) ctl.abort();
  };

  $('#voiceDemo').onclick = async () => {
    if (!requireSignedInUser()) return;
    const demoLine = `Hello! You are testing the ${cfg.voice} voice in Voice Studio. Your own text box stays untouched.`;
    await playQuickAudioClip(demoLine, cfg.voice, `${cfg.voice} voice demo`);
  };

  $('#prev').onclick = async () => {
    if (!requireSignedInUser()) return;
    const raw = getEditorTextValue().trim();
    if (!raw) {
      say('Type some text to preview first, or press Test selected voice.');
      $('#text').focus();
      return;
    }

    const previewItems = prepareSpeechItems(safePreviewSlice(raw, 200), 200);
    const firstItem = previewItems[0];
    if (!firstItem) {
      say('There is nothing readable to preview.');
      return;
    }

    await playQuickAudioClip(firstItem.text, firstItem.voice, 'preview');
  };

  $('#clear').onclick = () => {
    if (!running) {
      job = null;
      const progEl = $<HTMLProgressElement>('#prog');
      progEl.value = 0;
      progEl.setAttribute('aria-valuetext', '0 percent');
      ui();
    }
    setText('', 'user');
    loadedDocTitle = '';
    fullLoadedDocText = '';
    detectedChapters = [];
    loadedFile = null;
    loadedPagesText = [];
    loadedOutlineItems = [];
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = null;
    }
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
      videoUrl = null;
    }
    $<HTMLAudioElement>('#player').removeAttribute('src');
    lastBlob = null;
    lastSrtBlob = null;
    lastVttBlob = null;
    lastSubtitleSegments = [];
    lastName = '';
    lastSrtName = '';
    lastVttName = '';
    $<HTMLButtonElement>('#dl').disabled = true;
    $<HTMLButtonElement>('#dlSrt').disabled = true;
    $<HTMLButtonElement>('#dlVtt').disabled = true;
    closeExportModal(false);
    $('#result').hidden = true;
    renderChaptersBox();
    setAudioTitleValue('');
    const pdfInfoEl = document.getElementById('pdfStudioFileInfo');
    if (pdfInfoEl) {
      pdfInfoEl.textContent =
        'No file loaded yet. Choose a PDF, EPUB, DOCX, or TXT file below (everything stays on your device).';
    }
    say('Text cleared.');
    $('#text').focus();
  };

  $('#paste').onclick = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t) {
        say('The clipboard is empty.');
        return;
      }
      if (loadedDocTitle && getAudioTitleValue().trim() === loadedDocTitle) {
        setAudioTitleValue('');
      }
      loadedDocTitle = '';
      const wasSample = currentTextOrigin === 'sample';
      setText(t, 'user');
      say(
        wasSample
          ? `Replaced sample text with ${[...t].length.toLocaleString()} pasted characters.`
          : `Pasted ${[...t].length.toLocaleString()} characters.`
      );
    } catch {
      say('Your browser did not allow clipboard access. Paste with Ctrl+V instead.');
      $('#text').focus();
    }
  };

  $('#sampleSingle').onclick = () => {
    insertSampleWithGuard(
      'Voice Studio converts study notes, PDF textbooks, and bilingual English or Urdu paragraphs into clear speech you can download as a single MP3 or WAV file.',
      'Inserted sample script. Clear text or paste your own before converting real notes.'
    );
  };

  $('#sampleDialogue').onclick = () => {
    insertSampleWithGuard(
      'Host: Welcome back to our study session. Today we are reviewing how long-form text-to-speech works.\n' +
        'Guest: Thanks for having me. Splitting text at natural sentence boundaries keeps the pacing smooth and easy to follow.\n' +
        'Host: Let us test two different Gemini voices in one audio file!',
      'Inserted a sample dialogue script. Edit it or clear text before pasting your own.'
    );
  };

  $('#load').onclick = () => $<HTMLInputElement>('#file').click();

  $('#file').onchange = async (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    await handleSelectedFile(f);
    input.value = '';
  };

  const textareaEl = $<HTMLTextAreaElement>('#text');
  textareaEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    textareaEl.classList.add('drag-active');
  });
  textareaEl.addEventListener('dragleave', () => {
    textareaEl.classList.remove('drag-active');
  });
  textareaEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    textareaEl.classList.remove('drag-active');
    const f = e.dataTransfer?.files?.[0];
    if (f && !running && !extracting) {
      await handleSelectedFile(f);
    }
  });

  $('#detectChaptersBtn').onclick = async () => {
    const raw = getEditorTextValue().trim();
    if (!raw) {
      say('Enter or load some text before splitting into chapters.');
      $('#text').focus();
      return;
    }
    const { splitTextIntoChapters } = await import('./doc-extract');
    const found = splitTextIntoChapters(raw, 'Chapter');
    if (found.length < 2) {
      say('Only 1 section was detected. Add headings like "Chapter 1" or "Part 1", or paste longer text (4,500+ chars) to split automatically.');
      return;
    }
    fullLoadedDocText = raw;
    detectedChapters = found;
    renderChaptersBox();
    say(`Detected ${found.length} chapters. Select one to load, or export all as an Audiobook ZIP.`);
    $('#chapterSelect').focus();
  };

  $('#loadChapterBtn').onclick = () => {
    const idx = parseInt($<HTMLSelectElement>('#chapterSelect').value, 10) || 0;
    const ch = detectedChapters[idx];
    if (!ch) return;
    setText(ch.text, 'doc');
    const baseTitle = loadedDocTitle || 'audiobook';
    setAudioTitleValue(`${baseTitle} - ${ch.title}`.slice(0, 80));
    say(`Loaded ${ch.title} (${[...ch.text].length.toLocaleString()} characters).`);
    $('#text').focus();
  };

  $('#loadAllChaptersBtn').onclick = () => {
    if (!fullLoadedDocText) return;
    setText(fullLoadedDocText, 'doc');
    if (loadedDocTitle) {
      setAudioTitleValue(loadedDocTitle);
    }
    say(`Restored full book text (${[...fullLoadedDocText].length.toLocaleString()} characters).`);
    $('#text').focus();
  };

  $('#exportChaptersZipBtn').onclick = async () => {
    if (!requireSignedInUser()) return;
    if (detectedChapters.length < 2) {
      say('Load a multi-chapter document or split your text into chapters first.');
      return;
    }

    const chunkSize = num('#chunk', 300, 3000, 1800);
    const pauseSec = num('#pause', 0, 60, 1);
    const silMs = num('#sil', 0, 3000, 250);
    const progEl = $<HTMLProgressElement>('#prog');

    running = true;
    ctl = new AbortController();
    ui();
    progEl.hidden = false;
    progEl.value = 0;
    say(`Preparing Audiobook ZIP (${detectedChapters.length} chapters)…`);

    try {
      const JSZip = (await import('jszip')).default;
      const { encodeMp3Blob } = cfg.format === 'mp3' ? await import('./mp3-encode') : { encodeMp3Blob: null };
      const zip = new JSZip();
      const tocLines: string[] = [`Voice Studio Audiobook Export`, `Chapters: ${detectedChapters.length}`, ''];

      for (let c = 0; c < detectedChapters.length; c++) {
        if (ctl.signal.aborted) {
          say(`Audiobook ZIP export cancelled at chapter ${c + 1}.`);
          return;
        }

        const chapter = detectedChapters[c];
        const items = prepareSpeechItems(chapter.text, chunkSize);
        if (!items.length) continue;

        const parts: Uint8Array[] = [];
        let rate = 24000;

        for (let i = 0; i < items.length; i++) {
          if (ctl.signal.aborted) {
            say(`Audiobook ZIP export cancelled at chapter ${c + 1}.`);
            return;
          }
          say(`Chapter ${c + 1}/${detectedChapters.length} (${chapter.title}) · Part ${i + 1}/${items.length}…`);
          const r = await callServerTts(cfg.model, items[i].voice, cfg.style, items[i].text, ctl.signal);
          if (r.kind === 'abort') return;
          if (r.kind !== 'ok') {
            sayError(`Chapter ${c + 1} paused: ${r.msg}`);
            return;
          }
          const pcmObj = toPcm(r.d);
          if (!parts.length) rate = pcmObj.rate;
          parts.push(pcmObj.pcm);
          if (i < items.length - 1) await sleep(pauseSec * 1000);
        }

        const audioBlob =
          cfg.format === 'mp3' && encodeMp3Blob
            ? await encodeMp3Blob(parts, rate, silMs, cfg.mp3Kbps)
            : wavBlob(parts, rate, silMs);

        const segments = buildSubtitleSegments(items, parts, rate, silMs);
        const srtText = formatSubtitles(segments, 'srt');

        const pad = String(c + 1).padStart(2, '0');
        const chapterSlug = cleanTitleSlug(chapter.title) || `chapter-${c + 1}`;
        const audioFilename = `${pad}-${chapterSlug}.${cfg.format}`;
        const srtFilename = `${pad}-${chapterSlug}.srt`;

        zip.file(audioFilename, audioBlob);
        zip.file(srtFilename, srtText);
        tocLines.push(`${pad}. ${chapter.title} -> ${audioFilename} + ${srtFilename}`);

        const pct = Math.round(((c + 1) * 100) / detectedChapters.length);
        progEl.value = pct;
        progEl.setAttribute('aria-valuetext', `${pct} percent (${c + 1} of ${detectedChapters.length} chapters)`);
      }

      zip.file('00-chapters-index.txt', tocLines.join('\n') + '\n');
      say('Packaging chapters & synced subtitles into ZIP archive…');
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const zipStem = cleanTitleSlug(getAudioTitleValue() || loadedDocTitle) || 'voice-studio';
      const zipName = `${zipStem}-audiobook.zip`;

      const tmpUrl = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = tmpUrl;
      a.download = zipName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(tmpUrl), 60000);
      say(`Finished! Downloaded ${zipName} with ${detectedChapters.length} chapters and synced .SRT subtitles.`);
    } catch {
      sayError('Audiobook ZIP export encountered an unexpected error. Try lowering Chapters/chunks or export chapters individually.');
    } finally {
      running = false;
      ctl = null;
      progEl.value = 0;
      progEl.hidden = true;
      ui();
    }
  };

  syncOptionVisibility();
  syncByokUi();
  updateCounts();
}

/* ---- Backend TTS Proxy Call ---- */
type ServerTtsResult =
  | { kind: 'ok'; d: InlineAudioData; quota?: QuotaState }
  | { kind: 'abort' | 'network' | 'auth' | 'quota' | 'bad' | 'retry'; msg: string };

const workingByokModelMap = new Map<string, string>();

async function callByokTts(
  model: string,
  voice: string,
  style: string,
  text: string,
  userApiKey: string,
  signal?: AbortSignal
): Promise<ServerTtsResult> {
  const cachedModel = workingByokModelMap.get(model);
  const candidates = getModelFallbackOrder(cachedModel || model);
  let lastStatus = 0;
  let lastRawText = '';

  for (const candidateModel of candidates) {
    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${candidateModel}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': userApiKey,
        },
        body: JSON.stringify(buildBody(candidateModel, voice, style, text)),
        signal,
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      return {
        kind: name === 'AbortError' ? 'abort' : 'network',
        msg: name === 'AbortError' ? 'Cancelled.' : 'Network error reaching Google Gemini API.',
      };
    }

    lastStatus = res.status;
    lastRawText = await res.text();

    if (res.ok) {
      try {
        const parsed = JSON.parse(lastRawText) as {
          candidates?: Array<{ content?: { parts?: Array<{ inlineData?: InlineAudioData }> } }>;
        };
        const parts = parsed.candidates?.[0]?.content?.parts || [];
        const inlineAudio = parts.map((p) => p.inlineData).find((d) => d && d.data);
        if (!inlineAudio) {
          return { kind: 'bad', msg: 'No audio returned from your Gemini key. Try adjusting text or style.' };
        }
        workingByokModelMap.set(model, candidateModel);
        return { kind: 'ok', d: inlineAudio };
      } catch {
        return { kind: 'retry', msg: 'Could not parse audio response from Gemini.' };
      }
    }

    if (res.status === 404) {
      continue;
    }

    const info = classify(res.status, lastRawText);
    if (info.kind === 'badkey') {
      return { kind: 'bad', msg: 'Your personal Gemini API key appears invalid or lacks permission.' };
    }
    if (info.kind === 'minute' || info.kind === 'day') {
      return { kind: 'retry', msg: 'Your personal Gemini API key hit a temporary rate limit. Retrying…' };
    }
    if (info.kind === 'bad') {
      return { kind: 'bad', msg: `Gemini API rejected the request (${res.status}).` };
    }
    return { kind: 'retry', msg: `Gemini API temporary error (${res.status}).` };
  }

  return {
    kind: 'bad',
    msg: `No compatible Gemini TTS speech model accepted this API key (HTTP ${lastStatus || 404}). Enable the Generative Language API on your Google AI Studio key or select Gemini 2.5 Flash TTS.`,
  };
}

async function callServerTts(
  model: string,
  voice: string,
  style: string,
  text: string,
  signal?: AbortSignal
): Promise<ServerTtsResult> {
  if (isByokActive()) {
    return callByokTts(model, voice, style, text, byokKey.trim(), signal);
  }

  if (!currentUser || !currentUser.emailVerified) {
    return { kind: 'auth', msg: 'Please sign in and verify your email first.' };
  }

  let token: string;
  try {
    token = await currentUser.getIdToken();
  } catch {
    return { kind: 'auth', msg: 'Session expired. Please sign in again.' };
  }

  let res: Response;
  try {
    res = await fetch('/api/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ model, voice, style, text }),
      signal,
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    return {
      kind: name === 'AbortError' ? 'abort' : 'network',
      msg: name === 'AbortError' ? 'Cancelled.' : 'Network error reaching Voice Studio server.',
    };
  }

  let rawText = '';
  let data: {
    audio?: InlineAudioData;
    quota?: QuotaState;
    error?: string;
    code?: string;
  } = {};
  try {
    rawText = await res.text();
    data = JSON.parse(rawText) as typeof data;
  } catch {
    // Non-JSON response
  }

  if (res.ok && data.audio?.data) {
    if (data.quota) renderQuota(data.quota);
    return { kind: 'ok', d: data.audio, quota: data.quota };
  }

  if (res.status === 404) {
    if (data.code === 'UPSTREAM_MODEL_404') {
      return {
        kind: 'bad',
        msg: 'The selected Gemini speech model was unavailable upstream (404). Please select Gemini 2.5 Flash TTS and try again.',
      };
    }
    return {
      kind: 'bad',
      msg: 'The speech endpoint returned 404 on this host. You can turn on Own Gemini API Key (Unlimited Mode) in Step 1 to generate audio right away.',
    };
  }

  if (res.status === 500) {
    const cleanRaw = rawText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
    const serverMsg =
      data.error ||
      (cleanRaw
        ? `Speech server error (500): ${cleanRaw}. You can turn on Own Gemini API Key (Unlimited Mode) in Step 1.`
        : 'The shared speech server hit an unexpected error (500). Turn on Own Gemini API Key (Unlimited Mode) in Step 1 or check your server environment variables.');
    return { kind: 'bad', msg: serverMsg };
  }

  const msg = data.error || `Server error (${res.status}).`;
  if (res.status === 401 || res.status === 403) return { kind: 'auth', msg };
  if (res.status === 429) {
    if (data.quota) renderQuota(data.quota);
    if (data.code === 'QUOTA_EXCEEDED' || data.code === 'GLOBAL_CAP_REACHED') {
      return { kind: 'quota', msg };
    }
    return { kind: 'retry', msg };
  }
  if (res.status === 400 || res.status === 503) return { kind: 'bad', msg };
  return { kind: 'retry', msg };
}

/* ---- UI State & Generation ---- */
function ui() {
  const busy = running || previewing || extracting || studioBusy || videoBusy;
  const setDisabled = (id: string, val: boolean) => {
    const el = document.getElementById(id) as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | null;
    if (el) el.disabled = val;
  };
  const setHidden = (id: string, val: boolean) => {
    const el = document.getElementById(id);
    if (el) el.hidden = val;
  };

  setDisabled('gen', busy);
  setDisabled('prev', busy);
  setDisabled('voiceDemo', busy);
  setDisabled('clear', busy);
  setDisabled('paste', busy);
  setDisabled('load', busy);
  setDisabled('sampleSingle', busy);
  setDisabled('sampleDialogue', busy);
  setDisabled('detectChaptersBtn', busy);
  setDisabled('loadChapterBtn', busy);
  setDisabled('loadAllChaptersBtn', busy);
  setDisabled('exportChaptersZipBtn', busy);
  setDisabled('genPodcastBtn', busy);
  setDisabled('translateBtn', busy);
  setDisabled('templateSelect', busy);
  setDisabled('applyTemplateBtn', busy);
  setDisabled('pdfAgentPickFileBtn', busy);
  setDisabled('pdfAgentRunBtn', busy);
  setDisabled('pdfAgentLoadOnlyBtn', busy);
  setDisabled('pdfAgentOutputStyle', busy);
  setDisabled('videoAspect', busy);
  setDisabled('dlVideoBtn', busy);
  setHidden('cancelVideoBtn', !videoBusy);

  setDisabled('model', running);
  setDisabled('voice', running);
  setDisabled('voiceB', running);
  setDisabled('mode', running);
  setDisabled('chunk', running);
  setDisabled('format', running);
  setDisabled('mp3Kbps', running);

  setHidden('cancel', !running);
  const canResume = Boolean(job && job.done < job.items.length);
  setHidden('resume', busy || !canResume);
  setHidden('prog', !running && !canResume);
}

function fail(m: string) {
  running = false;
  sayError(m + (job ? ` ${job.done} of ${job.items.length} parts are done. You can press Resume.` : ''));
  ui();
}

async function finishOutput(currentJob: GenerationJob) {
  const progEl = byId<HTMLProgressElement>('prog');
  let blob: Blob;

  if (currentJob.format === 'mp3') {
    say('Encoding MP3 audio… please wait.');
    if (progEl) {
      progEl.value = 0;
      progEl.setAttribute('aria-valuetext', 'Encoding MP3 0 percent');
    }
    const { encodeMp3Blob } = await import('./mp3-encode');
    blob = await encodeMp3Blob(currentJob.parts, currentJob.rate, currentJob.sil, currentJob.mp3Kbps, (pct) => {
      if (progEl) {
        progEl.value = pct;
        progEl.setAttribute('aria-valuetext', `Encoding MP3 ${pct} percent`);
      }
    });
  } else {
    blob = wavBlob(currentJob.parts, currentJob.rate, currentJob.sil);
  }

  const segments = buildSubtitleSegments(currentJob.items, currentJob.parts, currentJob.rate, currentJob.sil);
  const srtContent = formatSubtitles(segments, 'srt');
  const vttContent = formatSubtitles(segments, 'vtt');

  running = false;
  job = null;
  if (progEl) {
    progEl.value = 0;
    progEl.setAttribute('aria-valuetext', '0 percent');
    progEl.hidden = true;
  }

  if (audioUrl) URL.revokeObjectURL(audioUrl);
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = null;

  audioUrl = URL.createObjectURL(blob);

  const player = byId<HTMLAudioElement>('player');
  if (player) {
    player.src = audioUrl;
    player.playbackRate = cfg.speed;
  }

  lastBlob = blob;
  lastSrtBlob = segments.length ? new Blob([srtContent], { type: 'application/x-subrip;charset=utf-8' }) : null;
  lastVttBlob = segments.length ? new Blob([vttContent], { type: 'text/vtt;charset=utf-8' }) : null;
  lastSubtitleSegments = segments;
  lastName = buildDownloadFilename(
    currentJob.format,
    getAudioTitleValue(),
    loadedDocTitle,
    getEditorTextValue(),
    cfg.mode,
    cfg.voice,
    cfg.voiceB
  );

  const dl = $<HTMLButtonElement>('#dl');
  dl.disabled = false;
  dl.textContent = currentJob.format === 'mp3' ? `Download MP3 (${currentJob.mp3Kbps} kbps)` : 'Download WAV (24 kHz)';

  const baseStem = lastName.replace(/\.[^.]+$/, '');
  lastSrtName = `${baseStem}.srt`;
  lastVttName = `${baseStem}.vtt`;

  const dlSrt = $<HTMLButtonElement>('#dlSrt');
  dlSrt.hidden = !segments.length;
  dlSrt.disabled = !segments.length;

  const dlVtt = $<HTMLButtonElement>('#dlVtt');
  dlVtt.hidden = !segments.length;
  dlVtt.disabled = !segments.length;

  const dlVideoBtn = $<HTMLButtonElement>('#dlVideoBtn');
  dlVideoBtn.hidden = !(blob && segments.length > 0);
  $('#videoStatus').textContent = '';
  $('#exportPopupMsg').textContent = '';

  const secs = Math.round(totalPcmDurationSeconds(currentJob.parts, currentJob.rate, currentJob.sil));
  const mb = (blob.size / 1048576).toFixed(2);
  const summaryLine = `${lastName} · ${mb} MB (${currentJob.format.toUpperCase()}) · ${Math.floor(secs / 60)}m ${secs % 60}s · ${segments.length} subtitle cues`;
  const infoEl = byId('info');
  if (infoEl) infoEl.textContent = summaryLine;
  $('#exportMetaSummary').textContent = summaryLine;
  const resultEl = byId('result');
  if (resultEl) resultEl.hidden = false;
  setupShare();

  say(`Finished. Audio is ready (${summaryLine}). Open Export Popup to download MP3, subtitles, or video.`);
  ui();
  player?.focus();
}

function triggerSafeBlobDownload(blob: Blob | null, filename: string, missingMsg: string) {
  const popupMsg = document.getElementById('exportPopupMsg');
  if (!blob || blob.size === 0 || !filename) {
    if (popupMsg) popupMsg.textContent = missingMsg;
    sayError(missingMsg);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  if (popupMsg) popupMsg.textContent = `Download started: ${filename}`;
}

$('#dl').onclick = () => {
  triggerSafeBlobDownload(lastBlob, lastName || 'audio-narration.mp3', 'Generate audio first before downloading.');
};

$('#dlSrt').onclick = () => {
  triggerSafeBlobDownload(lastSrtBlob, lastSrtName || 'subtitles.srt', 'Generate audio first to download .SRT subtitles.');
};

$('#dlVtt').onclick = () => {
  triggerSafeBlobDownload(lastVttBlob, lastVttName || 'subtitles.vtt', 'Generate audio first to download .VTT subtitles.');
};

$('#dlVideoBtn').onclick = async () => {
  if (!lastBlob || !lastSubtitleSegments.length) {
    $('#videoStatus').textContent = 'Generate audio with subtitles first before exporting video.';
    return;
  }

  const aspect = ($<HTMLSelectElement>('#videoAspect').value || '16:9') as VideoAspect;
  const videoStatusEl = $('#videoStatus');
  videoBusy = true;
  videoCtl = new AbortController();
  ui();
  videoStatusEl.textContent = `Rendering ${aspect} video with burned-in subtitles (0%)… Keep this tab active.`;

  try {
    const { renderSubtitleVideoBlob } = await import('./video-export');
    const titleInput = getAudioTitleValue().trim();
    const displayTitle = titleInput || loadedDocTitle || 'Voice Studio';

    const out = await renderSubtitleVideoBlob({
      audioBlob: lastBlob,
      title: displayTitle,
      segments: lastSubtitleSegments,
      aspect,
      signal: videoCtl.signal,
      onProgress: (pct) => {
        videoStatusEl.textContent = `Rendering ${aspect} video with burned-in subtitles (${pct}%)…`;
      },
    });

    if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoUrl = URL.createObjectURL(out.blob);
    const baseStem = (lastName || 'voice-studio').replace(/\.[^.]+$/, '');
    const videoFilename = `${baseStem}-${aspect.replace(':', 'x')}.${out.ext}`;

    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = videoFilename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();

    const mb = (out.blob.size / 1048576).toFixed(2);
    videoStatusEl.textContent = `Video ready: ${videoFilename} (${mb} MB, ${out.ext.toUpperCase()} with burned-in subtitles).`;
  } catch (err) {
    if (videoCtl?.signal.aborted) {
      videoStatusEl.textContent = 'Video render cancelled.';
    } else {
      videoStatusEl.textContent = err instanceof Error ? err.message : 'Could not render video in this browser.';
    }
  } finally {
    videoBusy = false;
    videoCtl = null;
    ui();
  }
};

$('#cancelVideoBtn').onclick = () => {
  if (videoCtl) videoCtl.abort();
};

async function run() {
  if (!job) return;
  const currentJob = job;

  if (!currentUser || !currentUser.emailVerified) {
    fail('Please sign in and verify your email first.');
    (!currentUser ? byId('authCard') : byId('authVerifyBox'))?.focus();
    return;
  }

  running = true;
  ctl = new AbortController();
  ui();
  say(`Generating audio. ${currentJob.items.length - currentJob.done} parts to go.`);

  let tries = 0;

  while (currentJob.done < currentJob.items.length) {
    if (ctl.signal.aborted) {
      running = false;
      say(`Cancelled. ${currentJob.done} of ${currentJob.items.length} parts are done. Press Resume to continue.`);
      ui();
      return;
    }

    const item = currentJob.items[currentJob.done];
    const r = await callServerTts(currentJob.model, item.voice, currentJob.style, item.text, ctl.signal);

    if (r.kind === 'abort') continue;

    if (r.kind === 'ok') {
      try {
        const o = toPcm(r.d);
        if (!currentJob.parts.length) currentJob.rate = o.rate;
        currentJob.parts.push(o.pcm);
        currentJob.done++;
        tries = 0;
        const pc = Math.floor((currentJob.done * 100) / currentJob.items.length);
        const progEl = byId<HTMLProgressElement>('prog');
        if (progEl) {
          progEl.value = pc;
          progEl.setAttribute('aria-valuetext', `${pc} percent (${currentJob.done} of ${currentJob.items.length} parts)`);
        }
        if (currentJob.done === 1 || currentJob.done % 5 === 0 || currentJob.done === currentJob.items.length) {
          say(`Part ${currentJob.done} of ${currentJob.items.length} done, ${pc} percent.`);
        }
        if (currentJob.done < currentJob.items.length) {
          await sleep(currentJob.pause * 1000);
        }
        continue;
      } catch {
        // Treat decode error as retryable
      }
    }

    if (r.kind === 'auth' || r.kind === 'quota' || r.kind === 'bad') {
      fail(r.msg);
      return;
    }

    if (++tries > 4) {
      fail(`Part ${currentJob.done + 1} failed after several tries. ${r.kind === 'retry' || r.kind === 'network' ? r.msg : ''}`);
      return;
    }
    say(`Part ${currentJob.done + 1} had a temporary problem. Retrying, attempt ${tries}.`);
    await sleep(3000 * tries);
  }

  await finishOutput(currentJob);
}

function requireSignedInUser(): boolean {
  if (!currentUser) {
    const msg = 'Please sign in with Google or Email first.';
    if (resolveRoute().pageId !== 'tool') {
      navigateToPage('tool', false);
    }
    say(msg);
    sayAuth(msg);
    byId('authCard')?.scrollIntoView({ block: 'nearest' });
    byId('authCard')?.focus();
    return false;
  }
  if (!currentUser.emailVerified) {
    const msg = 'Please verify your email address to activate your 3,000 characters/day allowance.';
    if (resolveRoute().pageId !== 'tool') {
      navigateToPage('tool', false);
    }
    say(msg);
    sayAuth(msg);
    byId('authVerifyBox')?.scrollIntoView({ block: 'nearest' });
    byId('authVerifyBox')?.focus();
    return false;
  }
  return true;
}

function prepareSpeechItems(rawText: string, chunkSize: number): SpeechItem[] {
  const spokenText = applyDictionary(rawText, dictRules);
  if (cfg.mode === 'dialogue') {
    return buildDialogueItems(spokenText, chunkSize, cfg.voice, cfg.voiceB);
  }
  return chunks(spokenText, chunkSize).map((text) => ({ text, voice: cfg.voice }));
}

async function playQuickAudioClip(text: string, voice: string, announceLabel: string) {
  previewing = true;
  ui();
  say(`Generating ${announceLabel}…`);

  const result = await callServerTts(cfg.model, voice, cfg.style, text);
  previewing = false;
  ui();

  if (result.kind !== 'ok') {
    sayError(`${announceLabel} failed: ${result.msg}`);
    return;
  }

  const o = toPcm(result.d);
  const u = URL.createObjectURL(wavBlob([o.pcm], o.rate, 0));
  const a = new Audio(u);
  a.playbackRate = cfg.speed;
  a.onended = () => URL.revokeObjectURL(u);
  a.onerror = () => URL.revokeObjectURL(u);
  a.play()
    .then(() => say(`Playing ${announceLabel}.`))
    .catch(() => say(`The ${announceLabel} is ready, but your browser blocked playback.`));
}

function setText(t: string, origin: 'user' | 'sample' | 'doc' = 'user') {
  pendingEditorText = t;
  const el = byId<HTMLTextAreaElement>('text');
  if (el) {
    el.value = t;
    updateCounts();
  }
  currentTextOrigin = origin;
  sampleReplaceArmed = false;
}

function insertSampleWithGuard(sampleText: string, okMsg: string) {
  const current = getEditorTextValue().trim();
  if (current && currentTextOrigin !== 'sample' && !sampleReplaceArmed) {
    sampleReplaceArmed = true;
    say(
      'Your text box already has text. Press Insert sample script again to replace it, or press Test selected voice to hear the voice without changing your text.'
    );
    return;
  }
  loadedDocTitle = '';
  setText(sampleText, 'sample');
  say(okMsg);
  byId('text')?.focus();
}

function renderChaptersBox() {
  const box = byId('chaptersBox');
  const sel = byId<HTMLSelectElement>('chapterSelect');
  const summary = byId('chaptersSummary');
  if (!box || !sel || !summary) return;
  sel.innerHTML = '';

  if (detectedChapters.length < 2) {
    box.hidden = true;
    summary.textContent = '';
    return;
  }

  detectedChapters.forEach((ch, idx) => {
    const opt = document.createElement('option');
    opt.value = String(idx);
    opt.textContent = `${idx + 1}. ${ch.title} (${[...ch.text].length.toLocaleString()} chars)`;
    sel.appendChild(opt);
  });

  summary.textContent = `${detectedChapters.length} chapters ready — load one chapter into the editor or export all chapters as one Audiobook ZIP.`;
  box.hidden = false;
}

async function handleSelectedFile(f: File) {
  const isPdfUpload = f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf';
  const maxBytes = isPdfUpload ? 30 * 1024 * 1024 : 15 * 1024 * 1024;
  if (f.size > maxBytes) {
    const errMsg = `File is too large (${Math.round(f.size / (1024 * 1024))} MB). Maximum allowed is ${isPdfUpload ? 30 : 15} MB.`;
    say(errMsg);
    const lStatus = byId('landingDropStatus');
    if (lStatus) lStatus.textContent = errMsg;
    return;
  }

  extracting = true;
  loadedFile = f;
  ui();
  say(`Reading ${f.name}…`);
  const lStatus = byId('landingDropStatus');
  if (lStatus) lStatus.textContent = `Reading ${f.name} on your device…`;

  try {
    const { extractDocument } = await import('./doc-extract');
    const res = await extractDocument(f, cfg.cleanDocs);
    const prevDocTitle = loadedDocTitle;
    loadedDocTitle = cleanDocBasename(f.name);
    loadedPagesText = res.pagesText || [];
    loadedOutlineItems = res.outlineItems || [];

    if (!res.text.trim()) {
      fullLoadedDocText = '';
      detectedChapters = [];
      renderChaptersBox();
      const msg = isPdfUpload
        ? `${f.name} appears to be a scanned image PDF. Open PDF & Book Studio to read scanned pages.`
        : `No readable text was found inside ${f.name}.`;
      const agentStatus = byId('pdfAgentStatus');
      if (agentStatus) agentStatus.textContent = msg;
      const pdfInfoEl = byId('pdfStudioFileInfo');
      if (pdfInfoEl) pdfInfoEl.textContent = msg;
      if (lStatus) lStatus.textContent = msg;
      const lPrev = byId('landingSampleTextPreview');
      if (lPrev) lPrev.hidden = true;
      const lPlay = byId('landingPlayExcerptBtn');
      if (lPlay) lPlay.hidden = true;
      say(msg);
      return;
    }

    fullLoadedDocText = res.text;
    detectedChapters = res.chaptersList || [];
    renderChaptersBox();

    if (!getAudioTitleValue().trim() || getAudioTitleValue().trim() === prevDocTitle) {
      setAudioTitleValue(loadedDocTitle);
    }
    setText(res.text, 'doc');
    const details: string[] = [res.formatLabel];
    if (res.pages) details.push(`${res.pages} pages`);
    if (res.chapters) details.push(`${res.chapters} chapters`);
    const cleanNote = res.removedLines ? ` Swept away ${res.removedLines} header or page-number lines.` : '';
    const okMsg = `Loaded ${f.name} (${details.join(', ')}), ${[...res.text].length.toLocaleString()} characters.${cleanNote}`;
    say(okMsg);

    const readyMsg = `Loaded: ${f.name} (${details.join(', ')}). Enter which chapter, topic, or page range to extract below.`;
    const agentStatus = byId('pdfAgentStatus');
    if (agentStatus) agentStatus.textContent = readyMsg;
    const pdfInfoEl = byId('pdfStudioFileInfo');
    if (pdfInfoEl) pdfInfoEl.textContent = readyMsg;

    if (lStatus) lStatus.textContent = `${okMsg} Sign in on the right to convert to MP3 audio.`;
    const lPrev = byId('landingSampleTextPreview');
    if (lPrev) {
      lPrev.hidden = false;
      lPrev.textContent = safePreviewSlice(res.text, 320);
    }
    const lPlay = byId('landingPlayExcerptBtn');
    if (lPlay) lPlay.hidden = false;
  } catch {
    const errText = `Could not read ${f.name}. Make sure it is a valid PDF, DOCX, EPUB, or text file.`;
    say(errText);
    if (lStatus) lStatus.textContent = errText;
  } finally {
    extracting = false;
    ui();
  }
}

/* ---- Share & Unload Protection ---- */
function setupShare() {
  let ok = false;
  const shareBtn = byId('share');
  if (!shareBtn) return;
  if (!lastBlob) {
    shareBtn.hidden = true;
    return;
  }
  const mime = lastName.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav';
  try {
    ok = !!(navigator.canShare && navigator.canShare({ files: [new File([lastBlob], lastName, { type: mime })] }));
  } catch {
    ok = false;
  }
  shareBtn.hidden = !ok;
}

$('#share').onclick = async () => {
  if (!lastBlob) return;
  const mime = lastName.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav';
  try {
    await navigator.share({
      files: [new File([lastBlob], lastName, { type: mime })],
      title: 'Audio from Voice Studio',
    });
    say('Shared.');
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    say(name === 'AbortError' ? 'Sharing was cancelled.' : 'Sharing failed. Please use Download instead.');
  }
};

window.addEventListener('beforeunload', (e) => {
  if (running) {
    e.preventDefault();
    e.returnValue = '';
  }
});

/* ---- PWA Install & Social Share Loop ---- */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function bindPwaAndShare() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  let deferredPrompt: BeforeInstallPromptEvent | null = null;
  const installBtn = $<HTMLButtonElement>('#installAppBtn');
  const drawerShareMsg = $('#drawerShareMsg');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    installBtn.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installBtn.hidden = true;
    drawerShareMsg.textContent = 'Voice Studio has been installed to your device.';
  });

  installBtn.onclick = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.hidden = true;
    drawerShareMsg.textContent =
      choice.outcome === 'accepted' ? 'Installing Voice Studio app…' : 'Install cancelled.';
    $('#shareDrawerBtn').focus();
  };

  $('#shareDrawerBtn').onclick = async () => {
    const shareUrl = window.location.origin;
    const shareText =
      'Try Voice Studio: free PDF, EPUB & Word DOCX to MP3/WAV audiobook and subtitled video converter with Urdu & English neural voices.';
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Voice Studio', text: shareText, url: shareUrl });
        drawerShareMsg.textContent = 'Thanks for sharing Voice Studio!';
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      drawerShareMsg.textContent = 'Website link copied! Share it anywhere with students or colleagues.';
    } catch {
      drawerShareMsg.textContent = `Share link: ${shareUrl}`;
    }
  };
}

/* ---- Creator Studio Templates, Podcast Writer, Translator & PDF Agent ---- */
const CREATOR_TEMPLATES: Record<
  string,
  { title: string; mode: GenerationMode; style: string; text: string }
> = {
  youtube: {
    title: 'YouTube Explainer Hook',
    mode: 'single',
    style: 'clear, energetic YouTube narrator',
    text:
      'Have you ever wondered why some study videos grab your attention in the first five seconds?\n\n' +
      'Today we are breaking down the three simple ideas behind clearer storytelling: start with one surprising question, give one concrete example, and end with one memorable takeaway.',
  },
  lecture: {
    title: 'Urdu English Lecture Notes',
    mode: 'single',
    style: 'slowly, clearly, and calmly',
    text:
      'Assalam-o-Alaikum students! Aaj ke lecture mein hum Machine Learning ke teen basic concepts samjhenge.\n\n' +
      'Sab se pehle Supervised Learning aata hai, jahan model labeled examples se seekhta hai. Doosra Unsupervised Learning hai jo hidden patterns dhoondta hai, aur teesra Reinforcement Learning hai jo trial and feedback se improve hota hai.',
  },
  podcast: {
    title: 'Two Speaker Study Podcast',
    mode: 'dialogue',
    style: 'warm, conversational podcast hosts',
    text:
      'Host: Welcome back to Learning Radio! Today we are talking about turning long PDFs into audio flashcards.\n' +
      'Guest: Honestly, listening while walking or revising before an exam saves hours of screen fatigue.\n' +
      'Host: Especially when you can export every chapter with synced subtitles and listen at one-point-five x speed.',
  },
  story: {
    title: 'Midnight Lighthouse Story',
    mode: 'single',
    style: 'warm, expressive audiobook storyteller',
    text:
      'The old brass lantern on the cliffside flickered to life just as rain tapped against the glass. Down in the harbor, the last fishing boat turned toward the steady golden beam, guided safely home through the fog.',
  },
};

function setStudioStatus(msg: string) {
  const errEl = byId('studioErr');
  const stEl = byId('studioStatus');
  if (errEl) errEl.textContent = '';
  if (stEl) stEl.textContent = msg;
}
function setStudioErr(msg: string) {
  const stEl = byId('studioStatus');
  const errEl = byId('studioErr');
  if (stEl) stEl.textContent = '';
  if (errEl) errEl.textContent = msg;
}

async function callByokStudioText(systemInstruction: string, prompt: string, key: string): Promise<string> {
  const models = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];
  let lastStatus = 0;
  let lastMsg = '';
  for (const m of models) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      }),
    });
    lastStatus = res.status;
    const raw = await res.text();
    if (res.ok) {
      const parsed = JSON.parse(raw) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const out = (parsed.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
      if (!out) throw new Error('Gemini returned an empty script.');
      return out;
    }
    if (res.status !== 404) {
      try {
        lastMsg = (JSON.parse(raw) as { error?: { message?: string } }).error?.message || '';
      } catch {
        // Ignore
      }
      throw new Error(lastMsg || `Gemini API returned HTTP ${res.status}.`);
    }
  }
  throw new Error(`No compatible Gemini text model accepted your API key (HTTP ${lastStatus || 404}).`);
}

async function callByokStudioStructured(
  systemInstruction: string,
  parts: Array<Record<string, unknown>>,
  responseSchema: Record<string, unknown>,
  key: string
): Promise<Record<string, unknown>> {
  const models = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];
  let lastStatus = 0;
  let lastMsg = '';
  for (const m of models) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema,
        },
      }),
    });
    lastStatus = res.status;
    const raw = await res.text();
    if (res.ok) {
      const parsed = JSON.parse(raw) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const jsonText = (parsed.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
      if (!jsonText) throw new Error('Gemini returned an empty plan.');
      return JSON.parse(jsonText) as Record<string, unknown>;
    }
    if (res.status !== 404) {
      try {
        lastMsg = (JSON.parse(raw) as { error?: { message?: string } }).error?.message || '';
      } catch {
        // Ignore
      }
      throw new Error(lastMsg || `Gemini API returned HTTP ${res.status}.`);
    }
  }
  throw new Error(`No compatible Gemini model accepted your API key (HTTP ${lastStatus || 404}).`);
}

async function postStudioEndpoint<T extends Record<string, unknown>>(payload: Record<string, unknown>): Promise<T> {
  if (!currentUser || !currentUser.emailVerified) {
    throw new Error('Please sign in and verify your email first.');
  }
  const token = await currentUser.getIdToken();
  const res = await fetch('/api/studio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as T & { error?: string; quota?: QuotaState };
  if (!res.ok) {
    throw new Error(data.error || `AI studio failed (${res.status}).`);
  }
  if (data.quota) {
    renderQuota(data.quota);
  }
  return data;
}

async function runStudioAction(
  payload:
    | { action: 'podcast'; topic: string; length: string }
    | { action: 'translate'; text: string; targetLang: string }
): Promise<string> {
  if (isByokActive()) {
    const key = byokKey.trim();
    if (payload.action === 'podcast') {
      const sys =
        'You write natural two-speaker conversational podcast scripts for text-to-speech playback. Output ONLY lines prefixed with "Host: " or "Guest: ". Never use markdown formatting, asterisks, or stage directions.';
      const prompt =
        payload.length === 'medium'
          ? `Write a conversational 8 to 10 turn podcast discussion between Host and Guest about:\n\n${payload.topic}`
          : `Write a crisp 5 to 6 turn podcast discussion between Host and Guest about:\n\n${payload.topic}`;
      return callByokStudioText(sys, prompt, key);
    }
    const sys =
      'You translate and adapt scripts for natural human speech synthesis. Preserve any speaker labels like "Host:", "Guest:", "A:", or "B:" verbatim if present. Return ONLY the translated spoken text.';
    const prompt = `Translate and naturally adapt the following text into ${payload.targetLang} so it reads smoothly aloud:\n\n${payload.text}`;
    return callByokStudioText(sys, prompt, key);
  }

  const data = await postStudioEndpoint<{ script?: string }>(payload);
  if (!data.script) {
    throw new Error('AI studio returned an empty script.');
  }
  return data.script;
}

function setPdfAgentStatus(msg: string) {
  const errEl = byId('pdfAgentErr');
  const stEl = byId('pdfAgentStatus');
  if (errEl) errEl.textContent = '';
  if (stEl) stEl.textContent = msg;
}
function setPdfAgentErr(msg: string) {
  const stEl = byId('pdfAgentStatus');
  const errEl = byId('pdfAgentErr');
  if (stEl) stEl.textContent = '';
  if (errEl) errEl.textContent = msg;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = typeof reader.result === 'string' ? reader.result : '';
      const idx = res.indexOf(',');
      resolve(idx >= 0 ? res.slice(idx + 1) : res);
    };
    reader.onerror = () => reject(new Error('Could not read file bytes.'));
    reader.readAsDataURL(file);
  });
}

async function runPdfRecordingAgent(forceLoadOnly = false) {
  const userPrompt = byId<HTMLInputElement>('pdfAgentPrompt')?.value.trim() || '';
  const outputMode = (byId<HTMLSelectElement>('pdfAgentOutputStyle')?.value || 'narrated') as PdfAgentOutputMode;
  const shouldRecord = !forceLoadOnly && Boolean(byId<HTMLInputElement>('pdfAgentAutoRecord')?.checked);
  const editorText = getEditorTextValue().trim();

  if (!loadedFile && !loadedPagesText.length && !detectedChapters.length && !editorText) {
    setPdfAgentErr('Load a PDF or document first before extracting a section.');
    byId('pdfAgentPickFileBtn')?.focus();
    return;
  }
  if (!userPrompt) {
    setPdfAgentErr('Describe which chapter, topic, or pages you want to extract and convert.');
    byId('pdfAgentPrompt')?.focus();
    return;
  }

  studioBusy = true;
  ui();
  setPdfAgentStatus('Analyzing document structure and selecting matching content…');

  try {
    const {
      buildPdfAgentIndex,
      cleanScriptForSpeech,
      localPdfAgentFallback,
      parsePageRangeFromPrompt,
      renderPdfPagesToJpegs,
      slicePdfPages,
      splitTextIntoChapters,
    } = await import('./doc-extract');

    const isPdfFile = Boolean(
      loadedFile && (loadedFile.name.toLowerCase().endsWith('.pdf') || loadedFile.type === 'application/pdf')
    );
    const hasReadablePages = loadedPagesText.some((t) => t.trim().length >= 25);
    const isScannedPdf = isPdfFile && (!loadedPagesText.length || !hasReadablePages);
    const byok = isByokActive();
    const canUseServerAi = Boolean(currentUser && currentUser.emailVerified);

    let extractedScript = '';
    let resolvedTitle = loadedDocTitle || 'Selected Audio Section';
    let methodNote = 'local extractor';

    if (isScannedPdf && loadedFile) {
      if (!byok && !canUseServerAi) {
        throw new Error('Scanned image PDFs require sign-in or your own Gemini API key in Step 1.');
      }

      setPdfAgentStatus('Reading scanned PDF pages with Gemini Vision…');
      const styleRule =
        outputMode === 'podcast'
          ? 'Format script as alternating lines starting strictly with "Host: " or "Guest: ".'
          : 'Write script as clean, fluent spoken prose with zero markdown, asterisks, citations, or page numbers.';
      const visionSchema = {
        type: 'OBJECT',
        properties: {
          sectionTitle: { type: 'STRING' },
          script: { type: 'STRING' },
        },
        required: ['sectionTitle', 'script'],
      };
      const maxPagesEstimate = Math.max(1, loadedPagesText.length || 200);
      const explicitRange = parsePageRangeFromPrompt(userPrompt, maxPagesEstimate);
      const targetPages: number[] = [];
      if (explicitRange) {
        for (let p = explicitRange.start; p <= explicitRange.end && targetPages.length < 6; p++) {
          targetPages.push(p);
        }
      } else {
        targetPages.push(1, 2, 3, 4, 5, 6);
      }

      const maxDirectBytes = byok ? 9_000_000 : 2_700_000;
      if (loadedFile.size <= maxDirectBytes) {
        const pdfBase64 = await fileToBase64(loadedFile);
        if (byok) {
          const out = await callByokStudioStructured(
            'You convert scanned PDF documents into clean, accurate spoken audio scripts without markdown or visual page artifacts.',
            [
              { inlineData: { mimeType: 'application/pdf', data: pdfBase64 } },
              {
                text: `User request: "${userPrompt}". Mode: ${outputMode}. ${styleRule} Extract accurately from the attached document pages and return JSON with sectionTitle and script.`,
              },
            ],
            visionSchema,
            byokKey.trim()
          );
          resolvedTitle = String(out.sectionTitle || resolvedTitle);
          extractedScript = cleanScriptForSpeech(String(out.script || ''));
          methodNote = 'Gemini Vision (BYOK PDF)';
        } else {
          const out = await postStudioEndpoint<{ sectionTitle?: string; script?: string }>({
            action: 'pdf_multimodal',
            pdfBase64,
            userPrompt,
            outputMode,
          });
          resolvedTitle = out.sectionTitle || resolvedTitle;
          extractedScript = cleanScriptForSpeech(out.script || '');
          methodNote = 'Gemini Vision (Scanned PDF)';
        }
      } else {
        const pageImages = await renderPdfPagesToJpegs(loadedFile, targetPages);
        if (!pageImages.length) {
          throw new Error('Could not render pages from this scanned PDF.');
        }
        if (byok) {
          const parts: Array<Record<string, unknown>> = pageImages.map((img) => ({
            inlineData: { mimeType: img.mimeType, data: img.data },
          }));
          parts.push({
            text: `User request: "${userPrompt}". Mode: ${outputMode}. ${styleRule} Extract accurately from the attached document pages and return JSON with sectionTitle and script.`,
          });
          const out = await callByokStudioStructured(
            'You convert scanned PDF documents into clean, accurate spoken audio scripts without markdown or visual page artifacts.',
            parts,
            visionSchema,
            byokKey.trim()
          );
          resolvedTitle = String(out.sectionTitle || resolvedTitle);
          extractedScript = cleanScriptForSpeech(String(out.script || ''));
          methodNote = `Gemini Vision (${pageImages.length} scanned pages, BYOK)`;
        } else {
          const out = await postStudioEndpoint<{ sectionTitle?: string; script?: string }>({
            action: 'pdf_multimodal',
            pageImages,
            userPrompt,
            outputMode,
          });
          resolvedTitle = out.sectionTitle || resolvedTitle;
          extractedScript = cleanScriptForSpeech(out.script || '');
          methodNote = `Gemini Vision (${pageImages.length} scanned pages)`;
        }
      }
    } else {
      const activeChapters =
        detectedChapters.length > 0
          ? detectedChapters
          : editorText
            ? splitTextIntoChapters(editorText, 'Section')
            : [];

      let usedAi = false;
      if (byok || canUseServerAi) {
        try {
          let rawExcerpt = '';
          if (loadedPagesText.length > 0) {
            const indexText = buildPdfAgentIndex(loadedPagesText, activeChapters, loadedOutlineItems);
            let plan: PdfAgentPlan;
            if (byok) {
              const planSys =
                'You are a precision document-indexing agent. Given PDF bookmarks and page previews plus a user request (which may be in English, Urdu, or Roman Urdu), identify the exact 1-based startPage and endPage range (and optional extraPages) to extract for audio recording. Keep spans focused (typically 1-25 pages) covering what the user asked for.';
              const planSchema = {
                type: 'OBJECT',
                properties: {
                  startPage: { type: 'INTEGER' },
                  endPage: { type: 'INTEGER' },
                  extraPages: { type: 'ARRAY', items: { type: 'INTEGER' } },
                  sectionTitle: { type: 'STRING' },
                  reason: { type: 'STRING' },
                },
                required: ['startPage', 'endPage', 'sectionTitle', 'reason'],
              };
              const resJson = await callByokStudioStructured(
                planSys,
                [
                  {
                    text: `Total pages: ${loadedPagesText.length}\nUser request: "${userPrompt}"\n\nDocument Index:\n${indexText}`,
                  },
                ],
                planSchema,
                byokKey.trim()
              );
              plan = resJson as unknown as PdfAgentPlan;
            } else {
              const resPlan = await postStudioEndpoint<{ plan?: PdfAgentPlan }>({
                action: 'pdf_plan',
                indexText,
                totalPages: loadedPagesText.length,
                userPrompt,
              });
              if (!resPlan.plan) throw new Error('Planner returned no page range.');
              plan = resPlan.plan;
            }

            const sliced = slicePdfPages(
              loadedPagesText,
              plan.startPage,
              plan.endPage,
              Array.isArray(plan.extraPages) ? plan.extraPages : []
            );
            rawExcerpt = sliced.text;
            resolvedTitle = plan.sectionTitle || resolvedTitle;
            methodNote = `Index (pages ${sliced.pagesUsed[0] || plan.startPage}–${sliced.pagesUsed[sliced.pagesUsed.length - 1] || plan.endPage})`;
          } else {
            const matched = localPdfAgentFallback(userPrompt, [], activeChapters, []);
            rawExcerpt = matched.text || editorText;
            resolvedTitle = matched.title || resolvedTitle;
            methodNote = matched.strategyNote;
          }

          if (rawExcerpt.trim()) {
            if (outputMode === 'verbatim') {
              extractedScript = cleanScriptForSpeech(rawExcerpt);
            } else {
              setPdfAgentStatus(`Preparing clean ${outputMode} audio script for "${resolvedTitle}"…`);
              if (byok) {
                const modeInstructions: Record<PdfAgentOutputMode, string> = {
                  verbatim:
                    'Extract strictly the matching sections verbatim, removing only page numbers, broken citations like [12], URLs, and table formatting.',
                  narrated:
                    'Extract what the user asked for and format it as clean, natural spoken lecture prose ready for text-to-speech. Turn noisy tables/bullets into smooth spoken sentences and omit URLs/footnotes/citations. Match the language requested by the user (or keep document language if unspecified).',
                  summary:
                    'Create a thorough, high-clarity study summary covering every key definition, formula intuition, and takeaway requested by the user, written strictly for natural spoken listening with zero markdown symbols.',
                  podcast:
                    'Convert the requested parts of the excerpt into a focused 2-speaker Host & Guest study discussion. Every line MUST start with "Host: " or "Guest: ". Zero markdown or asterisks.',
                };
                const sys = `${modeInstructions[outputMode]} Never use markdown formatting (*, #, backticks) or stage directions. Return ONLY the clean spoken script.`;
                const prepared = await callByokStudioText(
                  sys,
                  `User instruction: ${userPrompt}\n\nDocument Excerpt:\n${rawExcerpt.slice(0, 18000)}`,
                  byokKey.trim()
                );
                extractedScript = cleanScriptForSpeech(prepared);
              } else {
                const preparedRes = await postStudioEndpoint<{ script?: string }>({
                  action: 'pdf_prepare',
                  rawExcerpt: rawExcerpt.slice(0, 18000),
                  userPrompt,
                  outputMode,
                });
                extractedScript = cleanScriptForSpeech(preparedRes.script || '');
              }
              methodNote += ` + AI ${outputMode}`;
            }
            usedAi = Boolean(extractedScript.trim());
          }
        } catch (aiErr) {
          usedAi = false;
          const reason = aiErr instanceof Error ? aiErr.message : 'AI unavailable';
          const fallback = localPdfAgentFallback(userPrompt, loadedPagesText, activeChapters, loadedOutlineItems);
          extractedScript = fallback.text || cleanScriptForSpeech(editorText);
          resolvedTitle = fallback.title || resolvedTitle;
          methodNote = `${fallback.strategyNote} (local fallback: ${reason})`;
        }
      }

      if (!usedAi && !extractedScript.trim()) {
        const fallback = localPdfAgentFallback(userPrompt, loadedPagesText, activeChapters, loadedOutlineItems);
        extractedScript = fallback.text || cleanScriptForSpeech(editorText);
        resolvedTitle = fallback.title || resolvedTitle;
        methodNote = fallback.strategyNote;
      }
    }

    if (!extractedScript.trim()) {
      setPdfAgentErr('Could not match any readable section for that instruction. Try specifying exact page numbers (e.g. "pages 5-10").');
      return;
    }

    if (outputMode === 'podcast') {
      cfg.mode = 'dialogue';
      const modeEl = byId<HTMLSelectElement>('mode');
      if (modeEl) modeEl.value = 'dialogue';
      syncOptionVisibility();
      store.set('vs.cfg', cfg);
    }

    const cleanTitle = resolvedTitle.replace(/[\r\n]+/g, ' ').trim().slice(0, 80);
    if (cleanTitle) {
      setAudioTitleValue(cleanTitle);
    }
    setText(extractedScript, 'doc');
    setPdfAgentStatus(
      `Ready: "${cleanTitle}" (${[...extractedScript].length.toLocaleString()} chars) via ${methodNote}.`
    );

    if (shouldRecord) {
      if (!requireSignedInUser()) return;
      navigateToPage('tool', false);
      say(`Extracted "${cleanTitle}". Starting audio recording…`);
      byId('gen')?.click();
    } else if (currentUser && currentUser.emailVerified) {
      navigateToPage('tool', false);
      say(`Extracted "${cleanTitle}" into the Speech Studio editor.`);
      byId('text')?.focus();
    }
  } catch (err) {
    setPdfAgentErr(err instanceof Error ? err.message : 'PDF Recording Agent could not process this request.');
  } finally {
    studioBusy = false;
    ui();
  }
}

function bindReferralUi() {
  const copyBtn = document.getElementById('copyRefBtn');
  const shareBtn = document.getElementById('shareRefBtn');
  const input = document.getElementById('refLinkInput') as HTMLInputElement | null;
  const msg = document.getElementById('refActionMsg');
  if (!copyBtn || !shareBtn || !input || !msg) return;

  copyBtn.onclick = async () => {
    const link = input.value.trim();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      msg.textContent = 'Invite link copied! Share it with friends to earn +2,000 bonus credits each.';
    } catch {
      input.select();
      msg.textContent = 'Select and copy your invite link above.';
    }
  };

  shareBtn.onclick = async () => {
    const link = input.value.trim();
    if (!link) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join Voice Studio',
          text: 'Turn PDFs, EPUBs, and Urdu/English notes into natural audio & synced subtitles for free!',
          url: link,
        });
        msg.textContent = 'Invite shared!';
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
      }
    }
    copyBtn.click();
  };
}

/* ---- Init ---- */
bindA11ySettings();
bindPwaAndShare();
bindCurrentOutletControls();
route(false);
ui();
void loadPublicSiteStatus();

// Only boot Firebase SDK automatically if the browser already holds a signed-in Firebase session
void hasLikelyFirebaseAuthSession().then((hasSession) => {
  if (hasSession) {
    void ensureAuthListener(handleAuthUser);
  }
});
