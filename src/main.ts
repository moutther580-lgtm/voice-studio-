import { onAuthStateChanged, type User } from 'firebase/auth';
import type { Unsubscribe } from 'firebase/firestore';
import {
  ADMIN_UID,
  adminApproveReferral,
  adminDeleteContactMessage,
  adminFindWallet,
  adminGetServerConfig,
  adminGrantBulkCredits,
  adminGrantCredits,
  adminListContactMessages,
  adminListRecentLedger,
  adminListReferrals,
  adminListUsers,
  adminListWallets,
  adminResetUserDailyUsage,
  adminSaveServerConfig,
  adminSetContactMessageStatus,
  adminUpdateUserRole,
  auth,
  ensureUserAndWallet,
  recordPendingReferralClient,
  resendVerificationEmail,
  sendResetEmail,
  signInEmail,
  signInWithGoogle,
  signOutUser,
  signUpEmail,
  submitContactMessage,
  subscribeLedger,
  subscribeMyReferrals,
  subscribeWallet,
  verifyStrictAdmin,
  type ContactMessageDoc,
  type LedgerEntryDoc,
  type ReferralRecordDoc,
  type ServerConfigDoc,
  type UserProfileDoc,
  type UserWalletDoc,
} from './firebase';
import {
  MODELS,
  VOICES,
  applyDictionary,
  buildBody,
  buildDialogueItems,
  buildSubtitleSegments,
  chunks,
  classify,
  encodeMp3Blob,
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
let adminDataLoaded = false;

function isAdminActive(user: User | null): boolean {
  return Boolean(user && user.emailVerified && user.uid === ADMIN_UID && verifiedAdminSession);
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
let srtUrl: string | null = null;
let vttUrl: string | null = null;
let videoUrl: string | null = null;
let lastBlob: Blob | null = null;
let lastSubtitleSegments: SubtitleSegment[] = [];
let lastName = '';
let loadedDocTitle = '';
let fullLoadedDocText = '';
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

function say(msg: string) {
  $('#statusErr').textContent = '';
  $('#status').textContent = msg;
}

function sayError(msg: string) {
  $('#status').textContent = '';
  $('#statusErr').textContent = msg;
}

function sayAuth(msg: string) {
  if (!currentUser) {
    $('#authMsg').textContent = msg;
    $('#verifyMsg').textContent = '';
    $('#accountMsg').textContent = '';
  } else if (!currentUser.emailVerified) {
    $('#authMsg').textContent = '';
    $('#verifyMsg').textContent = msg;
    $('#accountMsg').textContent = '';
  } else {
    $('#authMsg').textContent = '';
    $('#verifyMsg').textContent = '';
    $('#accountMsg').textContent = msg;
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
  const v = parseFloat($<HTMLInputElement>(id).value);
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

/* ---- Routing & Navigation Drawer ---- */
const SEO_HOME_TITLE = 'Voice Studio – PDF, EPUB & Urdu/English Docs to MP3 Audio & Video';
const SEO_HOME_DESC =
  'Convert academic PDFs, EPUB ebooks, and Word DOCX notes into clean MP3 audiobooks with Urdu & English neural voices, synced .SRT captions, and burned-in subtitle videos.';
const pages = [
  'tool',
  'pdfStudio',
  'podcastStudio',
  'urduTts',
  'videoSubtitles',
  'account',
  'admin',
  'guides',
  'formats',
  'faq',
  'about',
  'contact',
  'privacy',
  'terms',
] as const;
type PageId = (typeof pages)[number];

const PAGE_PATHS: Record<PageId, string> = {
  tool: '/',
  pdfStudio: '/pdf-to-audio',
  podcastStudio: '/podcast-studio',
  urduTts: '/urdu-tts',
  videoSubtitles: '/video-subtitles',
  account: '/account',
  admin: '/admin',
  guides: '/guides',
  formats: '/formats',
  faq: '/faq',
  about: '/about',
  contact: '/contact',
  privacy: '/privacy',
  terms: '/terms',
};

function matchPageSlug(rawSlug: string): PageId | null {
  const clean = rawSlug.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (!clean) return 'tool';
  for (const id of pages) {
    const targetSlug = PAGE_PATHS[id].replace(/^\/+/, '').toLowerCase();
    if (clean === targetSlug || clean === id.toLowerCase()) {
      return id;
    }
  }
  return null;
}

function resolvePageId(): PageId {
  const fromPath = matchPageSlug(location.pathname);
  if (fromPath && (fromPath !== 'tool' || location.pathname === '/' || location.pathname === '')) {
    return fromPath;
  }
  if (location.hash) {
    const fromHash = matchPageSlug(location.hash.slice(1));
    if (fromHash) return fromHash;
  }
  return 'tool';
}

function getPagePath(id: PageId): string {
  return PAGE_PATHS[id];
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
    root.style.setProperty('--a11y-font', "ui-monospace, 'Cascadia Mono', Consolas, monospace");
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

function focusActivePageHeading(section: HTMLElement) {
  const visibleHeading = Array.from(section.querySelectorAll<HTMLElement>('h1[tabindex="-1"]')).find(
    (h) => h.offsetParent !== null
  );
  (visibleHeading || $('#main')).focus();
}

function route(moveFocus: boolean) {
  let id = resolvePageId();

  if (authResolved) {
    if (id === 'admin' && !isAdminActive(currentUser)) {
      id = 'tool';
      history.replaceState(null, '', '/');
    } else if (id === 'account' && (!currentUser || !currentUser.emailVerified)) {
      id = 'tool';
      history.replaceState(null, '', '/');
    }
  }

  pages.forEach((p) => {
    $('#' + p).hidden = p !== id;
  });
  document.querySelectorAll<HTMLAnchorElement>('.drawer-nav a[data-page]').forEach((a) => {
    if (a.dataset.page === id) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  const section = $('#' + id);
  const nextTitle = id === 'tool' ? SEO_HOME_TITLE : `${section.dataset.title || 'Voice Studio'} | Voice Studio`;
  const nextDesc = id === 'tool' ? SEO_HOME_DESC : section.dataset.description || SEO_HOME_DESC;
  const canonicalUrl = `${window.location.origin}${getPagePath(id)}`;
  const robotsPolicy =
    id === 'account' || id === 'admin' ? 'noindex, nofollow' : 'index, follow, max-snippet:-1, max-image-preview:large';

  document.title = nextTitle;
  document.querySelector('meta[name="robots"]')?.setAttribute('content', robotsPolicy);
  document.querySelector('meta[name="description"]')?.setAttribute('content', nextDesc);
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', nextTitle);
  document.querySelector('meta[property="og:description"]')?.setAttribute('content', nextDesc);
  document.querySelector('meta[name="twitter:title"]')?.setAttribute('content', nextTitle);
  document.querySelector('meta[name="twitter:description"]')?.setAttribute('content', nextDesc);
  document.getElementById('canonicalLink')?.setAttribute('href', canonicalUrl);
  document.getElementById('ogUrl')?.setAttribute('content', canonicalUrl);

  if (id === 'admin' && isAdminActive(currentUser) && !adminDataLoaded) {
    adminDataLoaded = true;
    document.getElementById('adminRefreshAll')?.click();
  }

  if ($('#navDrawer').hidden && $('#a11yDrawer').hidden) {
    setBackgroundInert(false);
  }

  if (moveFocus) {
    window.scrollTo(0, 0);
    focusActivePageHeading(section);
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
  const targetPath = getPagePath(id);
  if (location.pathname !== targetPath || location.hash) {
    history.pushState(null, '', targetPath);
  }
  closeDrawer(false);
  closeA11yDrawer(false);
  route(moveFocus);
}

window.addEventListener('popstate', () => route(true));
window.addEventListener('hashchange', () => route(true));

document.addEventListener('keydown', (e) => {
  const navDrawer = document.getElementById('navDrawer');
  const a11yDrawer = document.getElementById('a11yDrawer');
  const activeDrawer =
    navDrawer && !navDrawer.hidden ? navDrawer : a11yDrawer && !a11yDrawer.hidden ? a11yDrawer : null;
  if (!activeDrawer) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    if (activeDrawer === navDrawer) closeDrawer(true);
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

$('#openDrawerBtn').onclick = () => openDrawer();
$('#closeDrawerBtn').onclick = () => closeDrawer(true);
$('#drawerBackdrop').onclick = () => closeDrawer(true);
$('#openA11yBtn').onclick = () => openA11yDrawer();
$('#closeA11yBtn').onclick = () => closeA11yDrawer(true);
$('#a11yBackdrop').onclick = () => closeA11yDrawer(true);

document.querySelectorAll<HTMLAnchorElement>('a[data-page]').forEach((link) => {
  link.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const page = link.dataset.page as PageId | undefined;
    if (page && (pages as readonly string[]).includes(page)) {
      e.preventDefault();
      navigateToPage(page, true);
    }
  });
});

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
        'Speech server status: Server is online, but no server speech key is active yet. Turn on Own Gemini API Key (Unlimited Mode) in Step 1 or add GEMINI_API_KEY in hosting secrets.';
    } else if (state === 'missing404') {
      el.classList.add('status-bad');
      el.textContent =
        'Speech server status: Backend API returned 404 on this URL. Re-deploy with Worker/API routes, or turn on Own Gemini API Key (Unlimited Mode) in Step 1.';
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
          ? 'Shared server speech key is not configured on this server yet. Open Step 1 → Own Gemini API Key (Unlimited Mode) to generate audio with your free key, or add GEMINI_API_KEY in hosting secrets.'
          : state === 'missing404'
            ? 'Speech server route was not found on this deployment. Open Step 1 → Own Gemini API Key (Unlimited Mode) to generate audio directly from your browser.'
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
  $('#statDailyRemaining').textContent = `${q.remainingDaily.toLocaleString()} chars`;
  $('#statPaidCredits').textContent = `${q.paidCredits.toLocaleString()} chars`;
  $('#statTotalUsed').textContent = `${q.totalCharsUsed.toLocaleString()} chars`;
  $('#statAccountPlan').textContent = q.plan === 'pro' ? 'Extended' : 'Free';
  const emailText = q.email || currentUser?.email || '';
  $('#userAccountMeta').textContent = emailText
    ? `${emailText} · ${q.dailyLimit.toLocaleString()} chars daily allowance`
    : `${q.dailyLimit.toLocaleString()} chars daily allowance`;

  const bar = $<HTMLProgressElement>('#dailyBar');
  bar.max = Math.max(1, q.dailyLimit);
  bar.value = Math.min(q.dailyLimit, q.dailyUsedChars);
  $('#dailyBarLabel').textContent =
    `Daily free allowance used: ${q.dailyUsedChars.toLocaleString()} of ${q.dailyLimit.toLocaleString()} characters`;

  updateWorkspaceBalanceBar();

  if (typeof q.backendConfigured === 'boolean') {
    renderServerHealthStatus(q.backendConfigured ? 'ready' : 'nokey');
  }

  const notice = $('#backendNotice');
  if (q.backendConfigured === false && !isByokActive()) {
    notice.hidden = false;
    notice.textContent =
      'Shared server allowance is currently unavailable on this deployment. You can turn on Own Gemini API Key (Unlimited Mode) in Step 1 to generate audio directly from your browser.';
  } else {
    notice.hidden = true;
    notice.textContent = '';
  }

  updateCounts();
}

function renderWalletDoc(w: UserWalletDoc) {
  const today = new Date().toISOString().slice(0, 10);
  const usedToday = w.dailyDate === today ? w.dailyUsedChars : 0;
  // Keep higher dailyUsedChars if KV tracked usage without Firestore Service Account
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
  const ul = $('#ledgerList');
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
    // Probe public /api/health fallback if quota failed (e.g. token refresh)
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
  $('#tabSignIn').setAttribute('aria-pressed', String(!isSignUp));
  $('#tabSignUp').setAttribute('aria-pressed', String(isSignUp));
  $('#authNameWrap').hidden = !isSignUp;
  $('#authSubmit').textContent = isSignUp ? 'Create account' : 'Sign in';
  $<HTMLInputElement>('#authPass').autocomplete = isSignUp ? 'new-password' : 'current-password';
}

$('#tabSignIn').onclick = () => setAuthTab('signin');
$('#tabSignUp').onclick = () => setAuthTab('signup');

$('#googleSignIn').onclick = async () => {
  sayAuth('Opening Google sign-in…');
  try {
    await signInWithGoogle();
    sayAuth('Signed in with Google.');
  } catch (err) {
    sayAuth(formatAuthError(err));
  }
};

$('#authForm').onsubmit = async (e) => {
  e.preventDefault();
  const emailEl = $<HTMLInputElement>('#authEmail');
  const passEl = $<HTMLInputElement>('#authPass');
  const email = emailEl.value.trim();
  const pass = passEl.value;
  const name = $<HTMLInputElement>('#authName').value.trim();

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
    if (authMode === 'signup') {
      await signUpEmail(email, pass, name);
      sayAuth('Account created. Check your inbox for a verification link.');
    } else {
      await signInEmail(email, pass);
      sayAuth('Signed in.');
    }
  } catch (err) {
    sayAuth(formatAuthError(err));
  }
};

$('#authReset').onclick = async () => {
  const email = $<HTMLInputElement>('#authEmail').value.trim();
  if (!email) {
    sayAuth('Type your email address above first, then press Forgot password.');
    $('#authEmail').focus();
    return;
  }
  try {
    await sendResetEmail(email);
    sayAuth(`Password reset email sent to ${email}.`);
  } catch (err) {
    sayAuth(formatAuthError(err));
  }
};

$('#resendVerify').onclick = async () => {
  if (!currentUser) return;
  try {
    await resendVerificationEmail(currentUser);
    sayAuth('Verification email sent again. Check your inbox or spam folder.');
  } catch (err) {
    sayAuth(formatAuthError(err));
  }
};

$('#refreshVerify').onclick = async () => {
  if (!currentUser) return;
  try {
    await currentUser.reload();
    if (auth.currentUser?.emailVerified) {
      await handleAuthUser(auth.currentUser);
      sayAuth('Email verified! Your 3,000 characters/day free allowance is now active.');
    } else {
      sayAuth('Your email is not verified yet. Open the link we sent to your inbox first.');
    }
  } catch (err) {
    sayAuth(formatAuthError(err));
  }
};

$('#refreshQuota').onclick = async () => {
  if (!currentUser) return;
  sayAuth('Refreshing balance…');
  await fetchBackendQuota(currentUser);
  sayAuth('Balance updated.');
};

const handleSignOut = async () => {
  await signOutUser();
  sayAuth('Signed out.');
};
$('#signOutBtn').onclick = handleSignOut;
$('#signOutVerify').onclick = handleSignOut;

function triggerHeaderOrDrawerAuth() {
  closeDrawer(false);
  if (currentUser) {
    void handleSignOut();
    return;
  }
  if (resolvePageId() !== 'tool') {
    navigateToPage('tool', false);
  }
  $('#authCard').scrollIntoView({ block: 'nearest' });
  $('#googleSignIn').focus();
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

async function handleAuthUser(user: User | null) {
  clearFirestoreListeners();
  currentUser = user;
  activeQuota = null;
  verifiedAdminSession = false;
  unmountAdminPanel();

  const headerUser = $('#headerUser');
  const headerAuthBtn = $('#headerAuthBtn');
  const headerAdminBtn = $('#headerAdminBtn');
  const drawerUser = $('#drawerUser');
  const drawerAuthBtn = $('#drawerAuthBtn');
  const navAccountLink = $('#navAccountLink');
  const navAdminLink = $('#navAdminLink');

  if (!user) {
    $('#authGate').hidden = false;
    $('#authVerifyBox').hidden = true;
    $('#converterWorkspace').hidden = true;
    headerUser.hidden = true;
    headerUser.textContent = '';
    headerAdminBtn.hidden = true;
    headerAuthBtn.textContent = 'Sign in';
    drawerUser.hidden = true;
    drawerUser.textContent = '';
    drawerAuthBtn.textContent = 'Sign in to Converter';
    navAccountLink.hidden = true;
    navAdminLink.hidden = true;
    updateWorkspaceBalanceBar();
    updateCounts();
    route(false);
    return;
  }

  const label = user.email || user.displayName || 'Account';
  headerUser.hidden = false;
  headerUser.textContent = label;
  headerAuthBtn.textContent = 'Sign out';
  drawerUser.hidden = false;
  drawerUser.textContent = `Signed in as ${label}`;
  drawerAuthBtn.textContent = 'Sign out';

  if (!user.emailVerified) {
    $('#authGate').hidden = true;
    $('#authVerifyBox').hidden = false;
    $('#converterWorkspace').hidden = true;
    $('#verifyEmailText').textContent = user.email || 'your email';
    headerAdminBtn.hidden = true;
    navAccountLink.hidden = true;
    navAdminLink.hidden = true;
    updateWorkspaceBalanceBar();
    updateCounts();
    route(false);
    return;
  }

  const adminAuthorized = await verifyStrictAdmin(user);
  verifiedAdminSession = adminAuthorized;
  navAccountLink.hidden = false;
  navAdminLink.hidden = !adminAuthorized;
  headerAdminBtn.hidden = !adminAuthorized;

  $('#authGate').hidden = true;
  $('#authVerifyBox').hidden = true;
  $('#converterWorkspace').hidden = false;
  $('#userDisplay').textContent = user.displayName || user.email || 'Account';
  $('#userAccountMeta').textContent = user.email ? `${user.email} · 3,000 chars daily allowance` : '';
  updateWorkspaceBalanceBar();

  const refInput = document.getElementById('refLinkInput') as HTMLInputElement | null;
  if (refInput) {
    refInput.value = `${window.location.origin}/?ref=${encodeURIComponent(user.uid)}`;
  }

  try {
    await ensureUserAndWallet(user);
    walletUnsub = subscribeWallet(
      user.uid,
      (w) => {
        if (w) renderWalletDoc(w);
      },
      () => {
        sayAuth('Could not sync live account balance. Using server tracker.');
      }
    );
    ledgerUnsub = subscribeLedger(
      user.uid,
      renderLedger,
      () => {
        // Ignore live history error silently if offline
      }
    );
    refUnsub = subscribeMyReferrals(
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
        // Ignore live referral listener error if offline
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
        await recordPendingReferralClient(user, pendingRef);
      }
      store.set('vs.pendingRef', '');
    } catch {
      await recordPendingReferralClient(user, pendingRef);
      store.set('vs.pendingRef', '');
    }
  }

  if (user.displayName && !$<HTMLInputElement>('#contactName').value.trim()) {
    $<HTMLInputElement>('#contactName').value = user.displayName;
  }
  if (user.email && !$<HTMLInputElement>('#contactEmail').value.trim()) {
    $<HTMLInputElement>('#contactEmail').value = user.email;
  }

  await fetchBackendQuota(user);

  if (adminAuthorized) {
    mountAdminPanel();
  }
  route(false);
}

onAuthStateChanged(auth, (user) => {
  authResolved = true;
  void handleAuthUser(user);
});

/* ---- Admin Panel (Strictly Mounted Only for Verified Primary Admin) ---- */
function unmountAdminPanel() {
  adminDataLoaded = false;
  const mount = document.getElementById('adminMount');
  if (mount) mount.innerHTML = '';
}

function mountAdminPanel() {
  if (!isAdminActive(currentUser)) {
    unmountAdminPanel();
    return;
  }
  const mount = $('#adminMount');
  mount.innerHTML = `
    <div class="card" id="adminOverviewCard">
      <div class="account-head">
        <div>
          <h2>Control Room Overview</h2>
          <p class="account-meta">Manage API keys, hosting environment variables, limits, user accounts, roles, and visitor inbox from one place.</p>
        </div>
        <div class="btn-group compact-actions">
          <button id="adminRefreshAll" type="button">Refresh All</button>
        </div>
      </div>

      <div class="admin-badge-row">
        <span class="admin-status-tag" id="adminKeySourceBadge">Key source: Checking…</span>
        <span class="admin-status-tag" id="adminMaintBadge">Mode: Checking…</span>
        <span class="admin-status-tag" id="adminSyncBadge">Sync: Checking…</span>
      </div>

      <div class="quota-metrics">
        <div class="quota-metric">
          <span class="quota-label">User accounts</span>
          <strong id="adminStatWallets">—</strong>
        </div>
        <div class="quota-metric">
          <span class="quota-label">Total credits available</span>
          <strong id="adminStatCredits">—</strong>
        </div>
        <div class="quota-metric">
          <span class="quota-label">Characters used today</span>
          <strong id="adminStatDaily">—</strong>
        </div>
        <div class="quota-metric">
          <span class="quota-label">Unread messages</span>
          <strong id="adminStatUnread">—</strong>
        </div>
      </div>
      <p id="adminOverviewMsg" class="hint" role="status" aria-live="polite"></p>
    </div>

    <div class="card" id="adminServerConfigCard">
      <h2>Server API Key, Limits &amp; Hosting Env Push</h2>
      <p class="hint">Update and test the shared Gemini API key live, switch features or maintenance mode on or off, or push keys &amp; limits directly to Vercel Environment Variables without leaving the Admin Panel.</p>
      <p class="hint" id="adminMaskedKeysInfo">Active Admin Key: Loading… · Host Env Key: Loading…</p>

      <label for="adminCfgApiKey">Shared Server Gemini API Key (leave blank to keep current saved key)</label>
      <div class="input-inline-row">
        <input id="adminCfgApiKey" type="password" autocomplete="off" spellcheck="false" placeholder="AIza… paste new Gemini key to update live">
        <button id="adminToggleKeyVis" type="button" class="sec">Show</button>
      </div>

      <div class="row">
        <div>
          <label for="adminCfgDailyLimit">Default Daily Free Characters per User</label>
          <input id="adminCfgDailyLimit" type="number" min="0" max="1000000" value="3000">
        </div>
        <div>
          <label for="adminCfgGlobalCap">Global Daily Free Character Cap</label>
          <input id="adminCfgGlobalCap" type="number" min="0" max="100000000" value="100000">
        </div>
      </div>

      <label for="adminCfgNotice">Public Site Announcement / Maintenance Notice</label>
      <input id="adminCfgNotice" type="text" maxlength="400" placeholder="Optional banner shown at the top of the app">

      <label class="inline-check">
        <input id="adminCfgMaintenance" type="checkbox">
        <span>Maintenance mode (pause shared speech &amp; studio API for standard users)</span>
      </label>
      <label class="inline-check">
        <input id="adminCfgPdfStudio" type="checkbox" checked>
        <span>Enable AI PDF &amp; Book Chapter Studio proxy for users</span>
      </label>
      <label class="inline-check">
        <input id="adminCfgPodcastStudio" type="checkbox" checked>
        <span>Enable Podcast &amp; Translator Studio proxy for users</span>
      </label>

      <div class="btn-group">
        <button id="adminSaveServerBtn" type="button">Save &amp; Activate Key &amp; Settings</button>
        <button id="adminTestKeyBtn" type="button" class="sec">Test Key Now</button>
        <button id="adminClearKeyBtn" type="button" class="dng">Clear Admin Key (Revert to Host Env)</button>
      </div>
      <p id="adminServerMsg" class="hint" tabindex="-1" role="status" aria-live="polite"></p>
      <p id="adminServerErr" class="hint err-msg" role="alert" aria-live="assertive"></p>

      <details class="panel" id="adminVercelDetails">
        <summary>Push Key &amp; Limits directly to Vercel Environment Variables</summary>
        <p class="hint">Upserts <code>GEMINI_API_KEY</code>, <code>DAILY_FREE_CHAR_LIMIT</code>, and <code>GLOBAL_DAILY_FREE_CHARS</code> directly in your Vercel project. Leave fields blank if already set in server hosting variables. Tokens are never saved in browser storage or Firestore.</p>
        <div class="row">
          <div>
            <label for="adminVercelProject">Vercel Project ID or Name</label>
            <input id="adminVercelProject" type="text" autocomplete="off" placeholder="prj_... or voice-studio">
          </div>
          <div>
            <label for="adminVercelTeam">Vercel Team ID (optional)</label>
            <input id="adminVercelTeam" type="text" autocomplete="off" placeholder="team_... (leave blank for personal account)">
          </div>
        </div>
        <label for="adminVercelToken">Vercel API Access Token</label>
        <input id="adminVercelToken" type="password" autocomplete="off" spellcheck="false" placeholder="Optional if VERCEL_API_TOKEN is configured on server">
        <label for="adminVercelHook">Vercel Deploy Hook URL (optional, triggers immediate redeploy)</label>
        <input id="adminVercelHook" type="url" autocomplete="off" placeholder="https://api.vercel.com/v1/integrations/deploy/...">
        <div class="btn-group">
          <button id="adminPushVercelBtn" type="button" class="sec">Push Key &amp; Limits to Vercel Env</button>
        </div>
        <p id="adminVercelMsg" class="hint" role="status" aria-live="polite"></p>
        <p id="adminVercelErr" class="hint err-msg" role="alert" aria-live="assertive"></p>
      </details>
    </div>

    <div class="card" id="adminCard">
      <h2>Users, Wallets, Roles &amp; Credits</h2>
      <p class="hint">Search for any user, view registered accounts and roles, reset today's daily usage, grant credits, or assign Co-Admin access.</p>
      <div class="row">
        <div>
          <label for="adminSearchInput">Find user by Email or Account ID</label>
          <input id="adminSearchInput" type="text" placeholder="user@example.com or Account ID">
        </div>
      </div>
      <div class="btn-group">
        <button id="adminFindBtn" type="button" class="sec">Search user</button>
        <button id="adminLoadUsers" type="button" class="sec">Show all users</button>
        <button id="adminLoadProfiles" type="button" class="sec">Show profiles &amp; roles</button>
      </div>
      <div class="admin-table-wrap" id="adminTableWrap" hidden>
        <table class="admin-table">
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Account ID</th>
              <th scope="col">Plan</th>
              <th scope="col">Used Today</th>
              <th scope="col">Total Used</th>
              <th scope="col">Credits</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody id="adminUsersBody"></tbody>
        </table>
      </div>
      <div class="admin-table-wrap" id="adminProfilesWrap" hidden>
        <table class="admin-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Account ID</th>
              <th scope="col">Role</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody id="adminProfilesBody"></tbody>
        </table>
      </div>

      <hr class="divider">

      <h3>Update Credits &amp; Daily Limit</h3>
      <div class="row">
        <div>
          <label for="adminUid">Selected User (Email or Account ID)</label>
          <input id="adminUid" type="text" placeholder="Choose a user above or enter Email / ID">
        </div>
        <div>
          <label for="adminAddCredits">Add or Remove Credits (characters)</label>
          <input id="adminAddCredits" type="number" value="10000" step="1000">
        </div>
      </div>
      <div class="btn-group">
        <button type="button" class="sec admin-preset-credit" data-credits="10000">+10,000</button>
        <button type="button" class="sec admin-preset-credit" data-credits="50000">+50,000</button>
        <button type="button" class="sec admin-preset-credit" data-credits="100000">+100,000</button>
        <button type="button" class="sec admin-preset-credit" data-credits="0">0 (Limit / Plan only)</button>
      </div>
      <div class="row">
        <div>
          <label for="adminDailyLimit">Daily Free Limit</label>
          <input id="adminDailyLimit" type="number" value="3000" min="0" max="1000000">
        </div>
        <div>
          <label for="adminPlan">Plan</label>
          <select id="adminPlan">
            <option value="free">Free</option>
            <option value="pro">Extended</option>
          </select>
        </div>
      </div>
      <label for="adminNote">Reason / Note</label>
      <input id="adminNote" type="text" maxlength="240" placeholder="Reason for adding credits or changing limit">
      <div class="btn-group">
        <button id="adminApply" type="button">Save Changes</button>
      </div>

      <details class="panel">
        <summary>Bulk Credit Grant (All Loaded User Accounts)</summary>
        <div class="row">
          <div>
            <label for="adminBulkCredits">Bonus Credits per Account</label>
            <input id="adminBulkCredits" type="number" value="5000" step="1000">
          </div>
          <div>
            <label for="adminBulkNote">Campaign Note</label>
            <input id="adminBulkNote" type="text" maxlength="240" value="Community appreciation bonus credits">
          </div>
        </div>
        <div class="btn-group">
          <button id="adminBulkGrantBtn" type="button" class="sec">Grant Bonus to All Active Accounts</button>
        </div>
      </details>

      <p id="adminMsg" class="hint" tabindex="-1" role="status" aria-live="polite"></p>
      <p id="adminErr" class="hint err-msg" role="alert" aria-live="assertive"></p>
    </div>

    <div class="card" id="adminLedgerCard">
      <h2>Activity History</h2>
      <p class="hint">See recent credit changes, quota updates, and audio generations across all user accounts.</p>
      <div class="row">
        <div>
          <label for="adminLedgerFilter">Filter by User or Note</label>
          <input id="adminLedgerFilter" type="text" placeholder="Type email, user ID, or note">
        </div>
        <div>
          <label for="adminLedgerType">Activity Type</label>
          <select id="adminLedgerType">
            <option value="all">All activity</option>
            <option value="admin_grant">Admin updates</option>
            <option value="credit_purchase">Credits added</option>
            <option value="tts_usage">Audio generated</option>
          </select>
        </div>
      </div>
      <div class="btn-group">
        <button id="adminLoadLedger" type="button" class="sec">Load Recent History</button>
        <button id="adminExportCsvBtn" type="button" class="sec">Export Filtered CSV</button>
      </div>
      <p id="adminLedgerMsg" class="hint" role="status" aria-live="polite"></p>
      <p id="adminLedgerErr" class="hint err-msg" role="alert" aria-live="assertive"></p>
      <div class="admin-table-wrap" id="adminLedgerWrap" hidden>
        <table class="admin-table">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">User</th>
              <th scope="col">Activity</th>
              <th scope="col">Credits</th>
              <th scope="col">Characters</th>
              <th scope="col">Voice Model</th>
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody id="adminLedgerBody"></tbody>
        </table>
      </div>
    </div>

    <div class="card" id="adminReferralsCard">
      <h2>Referral Invites</h2>
      <p class="hint">Monitor friend invites and grant pending 2,000-character invite bonuses if automatic crediting is inactive.</p>
      <div class="btn-group">
        <button id="adminLoadReferrals" type="button" class="sec">Load Referrals</button>
      </div>
      <p id="adminRefMsg" class="hint" role="status" aria-live="polite"></p>
      <p id="adminRefErr" class="hint err-msg" role="alert" aria-live="assertive"></p>
      <div class="admin-table-wrap" id="adminRefWrap" hidden>
        <table class="admin-table">
          <thead>
            <tr>
              <th scope="col">Invited User ID</th>
              <th scope="col">Referrer User ID</th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody id="adminRefBody"></tbody>
        </table>
      </div>
    </div>

    <div class="card" id="adminInboxCard">
      <h2>Contact Messages</h2>
      <p class="hint">Read and manage messages sent by visitors from the Contact page.</p>
      <div class="btn-group">
        <button id="adminLoadInbox" type="button" class="sec">Load Messages</button>
        <button id="adminUnreadOnly" type="button" class="sec" aria-pressed="false">Show unread only</button>
      </div>
      <p id="adminInboxMsg" class="hint" tabindex="-1" role="status" aria-live="polite"></p>
      <p id="adminInboxErr" class="hint err-msg" role="alert" aria-live="assertive"></p>
      <ul class="inbox-list" id="adminInboxList"></ul>
    </div>

    <div class="card" id="adminHealthCard">
      <h2>Server &amp; Integration Diagnostics</h2>
      <p class="hint" id="adminSessionIdentity"></p>
      <p class="hint" id="adminDiagDetails">Service account: Checking… · Edge KV: Checking… · Vercel Env: Checking…</p>
      <p class="hint" id="adminSystemStatus" role="status" aria-live="polite">Press Check Server Status to verify that speech generation is ready.</p>
      <div class="btn-group">
        <button id="adminCheckHealth" type="button" class="sec">Check Server Status</button>
      </div>
    </div>
  `;

  let cachedWallets: Array<{ docId: string; wallet: UserWalletDoc }> = [];
  let cachedLedger: LedgerEntryDoc[] = [];
  let cachedFilteredLedger: LedgerEntryDoc[] = [];
  let cachedInbox: ContactMessageDoc[] = [];
  let cachedServerDoc: ServerConfigDoc | null = null;
  let unreadOnlyFilter = false;
  let pendingDeleteId: string | null = null;

  const formatActivityLabel = (type: LedgerEntryDoc['type']): string => {
    if (type === 'credit_purchase') return 'Credits added';
    if (type === 'tts_usage') return 'Audio generated';
    return 'Admin update';
  };

  $('#adminSessionIdentity').textContent =
    `Signed in as verified primary admin (${currentUser?.email || ''}). Access is restricted strictly to this account.`;

  const formatUiError = (err: unknown, fallback: string): string => {
    const raw = err instanceof Error ? err.message : String(err || '');
    if (raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw) as { error?: string };
        if (parsed.error) return parsed.error;
      } catch {
        // Fall through
      }
    }
    return raw || fallback;
  };
  const setAdminStatus = (msg: string) => {
    $('#adminErr').textContent = '';
    $('#adminMsg').textContent = msg;
  };
  const setAdminError = (msg: string) => {
    $('#adminMsg').textContent = '';
    $('#adminErr').textContent = msg;
  };
  const setServerStatus = (msg: string) => {
    $('#adminServerErr').textContent = '';
    $('#adminServerMsg').textContent = msg;
  };
  const setServerError = (msg: string) => {
    $('#adminServerMsg').textContent = '';
    $('#adminServerErr').textContent = msg;
  };
  const setVercelStatus = (msg: string) => {
    $('#adminVercelErr').textContent = '';
    $('#adminVercelMsg').textContent = msg;
  };
  const setVercelError = (msg: string) => {
    $('#adminVercelMsg').textContent = '';
    $('#adminVercelErr').textContent = msg;
  };

  const maskShort = (raw: string): string => {
    const s = raw.trim();
    if (!s) return 'Not set';
    return s.length <= 8 ? '••••' : `${s.slice(0, 6)}••••${s.slice(-4)}`;
  };

  const applyServerBadges = (data: {
    keySource?: string;
    adminKeyMasked?: string;
    envKeyMasked?: string;
    dailyFreeCharLimit?: number;
    globalDailyFreeChars?: number;
    maintenanceMode?: boolean;
    siteNotice?: string;
    allowPdfStudio?: boolean;
    allowPodcastStudio?: boolean;
    serviceAccountConfigured?: boolean;
    kvConfigured?: boolean;
    vercelEnvConfigured?: boolean;
  }) => {
    const srcLabel =
      data.keySource === 'admin' ? 'Admin Panel Key' : data.keySource === 'env' ? 'Host Env Var' : 'None Configured';
    $('#adminKeySourceBadge').textContent = `Key source: ${srcLabel}`;
    $('#adminMaintBadge').textContent = data.maintenanceMode ? 'Mode: Maintenance PAUSED' : 'Mode: Live Active';
    $('#adminMaskedKeysInfo').textContent =
      `Active Admin Key: ${data.adminKeyMasked || 'Not set'} · Host Env Key: ${data.envKeyMasked || 'Not set'}`;
    $('#adminDiagDetails').textContent =
      `Service account: ${data.serviceAccountConfigured ? 'Ready' : 'Not set'} · Edge KV: ${data.kvConfigured ? 'Connected' : 'Memory only'} · Vercel Env Token: ${data.vercelEnvConfigured ? 'Configured' : 'Manual input'}`;
    if (typeof data.dailyFreeCharLimit === 'number') {
      $<HTMLInputElement>('#adminCfgDailyLimit').value = String(data.dailyFreeCharLimit);
    }
    if (typeof data.globalDailyFreeChars === 'number') {
      $<HTMLInputElement>('#adminCfgGlobalCap').value = String(data.globalDailyFreeChars);
    }
    if (typeof data.siteNotice === 'string') {
      $<HTMLInputElement>('#adminCfgNotice').value = data.siteNotice;
    }
    if (typeof data.maintenanceMode === 'boolean') {
      $<HTMLInputElement>('#adminCfgMaintenance').checked = data.maintenanceMode;
    }
    if (typeof data.allowPdfStudio === 'boolean') {
      $<HTMLInputElement>('#adminCfgPdfStudio').checked = data.allowPdfStudio;
    }
    if (typeof data.allowPodcastStudio === 'boolean') {
      $<HTMLInputElement>('#adminCfgPodcastStudio').checked = data.allowPodcastStudio;
    }
  };

  const loadServerConfig = async () => {
    try {
      cachedServerDoc = await adminGetServerConfig().catch(() => null);
      if (cachedServerDoc) {
        $('#adminSyncBadge').textContent = 'Sync: Firestore synced';
        applyServerBadges({
          keySource: cachedServerDoc.geminiApiKey ? 'admin' : 'env',
          adminKeyMasked: maskShort(cachedServerDoc.geminiApiKey || ''),
          dailyFreeCharLimit: cachedServerDoc.dailyFreeCharLimit,
          globalDailyFreeChars: cachedServerDoc.globalDailyFreeChars,
          maintenanceMode: cachedServerDoc.maintenanceMode,
          siteNotice: cachedServerDoc.siteNotice,
          allowPdfStudio: cachedServerDoc.allowPdfStudio,
          allowPodcastStudio: cachedServerDoc.allowPodcastStudio,
        });
      }
      if (!currentUser) return;
      const token = await currentUser.getIdToken();
      const res = await fetch('/api/admin-config', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        $('#adminSyncBadge').textContent = cachedServerDoc ? 'Sync: Firestore only (API offline)' : 'Sync: Check server';
        return;
      }
      const data = (await res.json()) as Parameters<typeof applyServerBadges>[0];
      $('#adminSyncBadge').textContent = data.kvConfigured || data.serviceAccountConfigured ? 'Sync: Server + DB Ready' : 'Sync: Runtime Memory';
      applyServerBadges(data);
    } catch (err) {
      setServerError(formatUiError(err, 'Could not load server runtime config.'));
    }
  };

  $('#adminToggleKeyVis').onclick = () => {
    const inp = $<HTMLInputElement>('#adminCfgApiKey');
    const btn = $<HTMLButtonElement>('#adminToggleKeyVis');
    const isHidden = inp.type === 'password';
    inp.type = isHidden ? 'text' : 'password';
    btn.textContent = isHidden ? 'Hide' : 'Show';
  };

  $('#adminTestKeyBtn').onclick = async () => {
    if (!currentUser) return;
    const btn = $<HTMLButtonElement>('#adminTestKeyBtn');
    const candidate = $<HTMLInputElement>('#adminCfgApiKey').value.trim();
    btn.disabled = true;
    setServerStatus('Testing Gemini API key against Google servers…');
    try {
      const token = await currentUser.getIdToken();
      const res = await fetch('/api/admin-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'test_key',
          geminiApiKey: candidate || undefined,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (!res.ok || !data.ok) {
        setServerError(data.error || 'Key verification failed.');
      } else {
        setServerStatus(data.message || 'Gemini API key verified successfully.');
      }
    } catch (err) {
      setServerError(formatUiError(err, 'Could not reach server to test API key.'));
    } finally {
      btn.disabled = false;
    }
  };

  const commitServerSettings = async (clearKey: boolean) => {
    if (!currentUser) return;
    const saveBtn = $<HTMLButtonElement>('#adminSaveServerBtn');
    const clearBtn = $<HTMLButtonElement>('#adminClearKeyBtn');
    const typedKey = $<HTMLInputElement>('#adminCfgApiKey').value.trim();
    const dailyFreeCharLimit = Math.max(
      0,
      Math.min(1000000, parseInt($<HTMLInputElement>('#adminCfgDailyLimit').value, 10) || 3000)
    );
    const globalDailyFreeChars = Math.max(
      0,
      Math.min(100000000, parseInt($<HTMLInputElement>('#adminCfgGlobalCap').value, 10) || 100000)
    );
    const maintenanceMode = $<HTMLInputElement>('#adminCfgMaintenance').checked;
    const allowPdfStudio = $<HTMLInputElement>('#adminCfgPdfStudio').checked;
    const allowPodcastStudio = $<HTMLInputElement>('#adminCfgPodcastStudio').checked;
    const siteNotice = $<HTMLInputElement>('#adminCfgNotice').value.trim().slice(0, 400);

    saveBtn.disabled = true;
    clearBtn.disabled = true;
    setServerStatus(clearKey ? 'Clearing admin API key and saving settings…' : 'Saving and activating API key & settings…');

    try {
      const token = await currentUser.getIdToken();
      const res = await fetch('/api/admin-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'save_config',
          clearApiKey: clearKey,
          geminiApiKey: clearKey ? '' : typedKey || '__KEEP__',
          dailyFreeCharLimit,
          globalDailyFreeChars,
          maintenanceMode,
          siteNotice,
          allowPdfStudio,
          allowPodcastStudio,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        persistedToKv?: boolean;
        persistedToFirestore?: boolean;
      } & Parameters<typeof applyServerBadges>[0];

      if (res.status !== 404 && (!res.ok || !data.ok)) {
        setServerError(data.error || 'Could not save server configuration.');
        return;
      }

      const firestoreKeyToSave = clearKey ? '' : typedKey || cachedServerDoc?.geminiApiKey || '';
      await adminSaveServerConfig({
        geminiApiKey: firestoreKeyToSave,
        dailyFreeCharLimit,
        globalDailyFreeChars,
        maintenanceMode,
        siteNotice,
        allowPdfStudio,
        allowPodcastStudio,
        updatedBy: currentUser.email || 'moutther580@gmail.com',
      });
      cachedServerDoc = await adminGetServerConfig().catch(() => cachedServerDoc);
      $<HTMLInputElement>('#adminCfgApiKey').value = '';

      if (res.ok && data.ok) {
        applyServerBadges(data);
        setServerStatus(
          clearKey
            ? 'Admin override key cleared and reverted to Host Env key cleanly.'
            : 'Saved & activated live on server and synced to Firestore.'
        );
      } else {
        applyServerBadges({
          keySource: firestoreKeyToSave ? 'admin' : 'env',
          adminKeyMasked: maskShort(firestoreKeyToSave),
          dailyFreeCharLimit,
          globalDailyFreeChars,
          maintenanceMode,
          siteNotice,
          allowPdfStudio,
          allowPodcastStudio,
        });
        setServerStatus('Saved configuration directly to Firestore.');
      }

      await loadPublicSiteStatus();
      await fetchBackendQuota(currentUser);
      await checkHealth();
    } catch (err) {
      setServerError(formatUiError(err, 'Could not save server configuration.'));
    } finally {
      saveBtn.disabled = false;
      clearBtn.disabled = false;
    }
  };

  $('#adminSaveServerBtn').onclick = () => {
    void commitServerSettings(false);
  };
  $('#adminClearKeyBtn').onclick = () => {
    void commitServerSettings(true);
  };

  $('#adminPushVercelBtn').onclick = async () => {
    if (!currentUser) return;
    const btn = $<HTMLButtonElement>('#adminPushVercelBtn');
    const typedKey = $<HTMLInputElement>('#adminCfgApiKey').value.trim();
    const dailyFreeCharLimit = Math.max(
      0,
      Math.min(1000000, parseInt($<HTMLInputElement>('#adminCfgDailyLimit').value, 10) || 3000)
    );
    const globalDailyFreeChars = Math.max(
      0,
      Math.min(100000000, parseInt($<HTMLInputElement>('#adminCfgGlobalCap').value, 10) || 100000)
    );
    const vercelProject = $<HTMLInputElement>('#adminVercelProject').value.trim();
    const vercelTeamId = $<HTMLInputElement>('#adminVercelTeam').value.trim();
    const vercelToken = $<HTMLInputElement>('#adminVercelToken').value.trim();
    const deployHookUrl = $<HTMLInputElement>('#adminVercelHook').value.trim();

    btn.disabled = true;
    setVercelStatus('Pushing environment variables to Vercel…');
    try {
      const token = await currentUser.getIdToken();
      const res = await fetch('/api/admin-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'push_vercel_env',
          geminiApiKey: typedKey || undefined,
          dailyFreeCharLimit,
          globalDailyFreeChars,
          vercelProject: vercelProject || undefined,
          vercelTeamId: vercelTeamId || undefined,
          vercelToken: vercelToken || undefined,
          deployHookUrl: deployHookUrl || undefined,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string; maskedKey?: string };
      if (!res.ok || !data.ok) {
        setVercelError(data.error || 'Could not push environment variables to Vercel.');
        return;
      }
      $<HTMLInputElement>('#adminVercelToken').value = '';
      if (typedKey) {
        await adminSaveServerConfig({
          geminiApiKey: typedKey,
          dailyFreeCharLimit,
          globalDailyFreeChars,
          maintenanceMode: $<HTMLInputElement>('#adminCfgMaintenance').checked,
          siteNotice: $<HTMLInputElement>('#adminCfgNotice').value.trim(),
          allowPdfStudio: $<HTMLInputElement>('#adminCfgPdfStudio').checked,
          allowPodcastStudio: $<HTMLInputElement>('#adminCfgPodcastStudio').checked,
          updatedBy: currentUser.email || 'moutther580@gmail.com',
        }).catch(() => {});
        $<HTMLInputElement>('#adminCfgApiKey').value = '';
      }
      setVercelStatus(data.message || 'Environment variables pushed to Vercel.');
      await loadServerConfig();
      await loadPublicSiteStatus();
    } catch (err) {
      setVercelError(formatUiError(err, 'Could not reach server to push Vercel environment variables.'));
    } finally {
      btn.disabled = false;
    }
  };

  mount.querySelectorAll<HTMLButtonElement>('.admin-preset-credit').forEach((btn) => {
    btn.onclick = () => {
      const val = btn.dataset.credits || '0';
      $<HTMLInputElement>('#adminAddCredits').value = val;
      setAdminStatus(`Credit amount set to ${Number(val).toLocaleString()} characters.`);
    };
  });

  const updateWalletOverview = (wallets: Array<{ docId: string; wallet: UserWalletDoc }>) => {
    cachedWallets = wallets;
    const today = new Date().toISOString().slice(0, 10);
    const totalCredits = wallets.reduce((acc, item) => acc + (item.wallet.paidCredits || 0), 0);
    const totalDaily = wallets.reduce(
      (acc, item) => acc + (item.wallet.dailyDate === today ? item.wallet.dailyUsedChars || 0 : 0),
      0
    );
    $('#adminStatWallets').textContent = wallets.length.toLocaleString();
    $('#adminStatCredits').textContent = totalCredits.toLocaleString();
    $('#adminStatDaily').textContent = totalDaily.toLocaleString();
  };

  const renderLedgerTable = () => {
    const filterText = $<HTMLInputElement>('#adminLedgerFilter').value.trim().toLowerCase();
    const typeFilter = $<HTMLSelectElement>('#adminLedgerType').value;
    const filtered = cachedLedger.filter((entry) => {
      if (typeFilter !== 'all' && entry.type !== typeFilter) return false;
      if (!filterText) return true;
      return (
        entry.uid.toLowerCase().includes(filterText) ||
        entry.note.toLowerCase().includes(filterText) ||
        entry.model.toLowerCase().includes(filterText)
      );
    });
    cachedFilteredLedger = filtered;

    const tbody = $('#adminLedgerBody');
    tbody.innerHTML = '';
    for (const e of filtered) {
      const tr = document.createElement('tr');
      const tdTime = document.createElement('td');
      tdTime.textContent = e.createdAt?.toDate?.()?.toLocaleString() || 'Recent';
      const tdUid = document.createElement('td');
      tdUid.textContent = e.uid;
      const tdType = document.createElement('td');
      tdType.textContent = formatActivityLabel(e.type);
      const tdDelta = document.createElement('td');
      tdDelta.textContent = `${e.creditsDelta > 0 ? '+' : ''}${e.creditsDelta.toLocaleString()}`;
      const tdChars = document.createElement('td');
      tdChars.textContent = e.chars.toLocaleString();
      const tdModel = document.createElement('td');
      tdModel.textContent = e.model === 'admin-portal' ? 'Admin Panel' : e.model || '—';
      const tdNote = document.createElement('td');
      tdNote.textContent = e.note || '—';
      tr.append(tdTime, tdUid, tdType, tdDelta, tdChars, tdModel, tdNote);
      tbody.appendChild(tr);
    }
    $('#adminLedgerWrap').hidden = filtered.length === 0;
    $('#adminLedgerMsg').textContent = `Showing ${filtered.length} of ${cachedLedger.length} recent record(s).`;
  };

  const loadLedger = async () => {
    $('#adminLedgerErr').textContent = '';
    $('#adminLedgerMsg').textContent = 'Loading recent history…';
    try {
      cachedLedger = await adminListRecentLedger();
      renderLedgerTable();
    } catch (err) {
      $('#adminLedgerMsg').textContent = '';
      $('#adminLedgerErr').textContent = formatUiError(err, 'Could not load activity history.');
    }
  };

  const renderWalletRows = (wallets: Array<{ docId: string; wallet: UserWalletDoc }>, focusGrantDocId?: string) => {
    const tbody = $('#adminUsersBody');
    tbody.innerHTML = '';
    for (const { docId, wallet: w } of wallets) {
      const tr = document.createElement('tr');

      const tdEmail = document.createElement('td');
      tdEmail.textContent = w.email;
      const tdId = document.createElement('td');
      tdId.textContent = docId;
      const tdPlan = document.createElement('td');
      tdPlan.textContent = w.plan === 'pro' ? 'Extended' : 'Free';
      const tdDaily = document.createElement('td');
      tdDaily.textContent = `${w.dailyUsedChars.toLocaleString()}/${w.dailyLimit.toLocaleString()}`;
      const tdLifetime = document.createElement('td');
      tdLifetime.textContent = (w.totalCharsUsed || 0).toLocaleString();
      const tdPaid = document.createElement('td');
      tdPaid.textContent = w.paidCredits.toLocaleString();

      const tdAct = document.createElement('td');
      const wrap = document.createElement('div');
      wrap.className = 'admin-row-actions';

      const selBtn = document.createElement('button');
      selBtn.type = 'button';
      selBtn.className = 'sec';
      selBtn.textContent = 'Select';
      selBtn.setAttribute('aria-label', `Select account for ${w.email}`);
      selBtn.onclick = () => {
        $<HTMLInputElement>('#adminUid').value = docId;
        $<HTMLInputElement>('#adminDailyLimit').value = String(w.dailyLimit);
        $<HTMLSelectElement>('#adminPlan').value = w.plan;
        setAdminStatus(`Selected ${w.email}. Current credits: ${w.paidCredits.toLocaleString()}.`);
        $('#adminAddCredits').focus();
      };

      const quickGrantBtn = document.createElement('button');
      quickGrantBtn.type = 'button';
      quickGrantBtn.className = 'sec';
      quickGrantBtn.textContent = '+10k';
      quickGrantBtn.setAttribute('aria-label', `Add 10,000 credits to ${w.email}`);
      quickGrantBtn.dataset.grantDoc = docId;
      quickGrantBtn.onclick = async () => {
        setAdminStatus(`Adding 10,000 credits to ${w.email}…`);
        try {
          const updated = await adminGrantCredits(
            docId,
            10000,
            w.dailyLimit,
            w.plan,
            'Added 10,000 credits from Admin Panel'
          );
          setAdminStatus(`Added 10,000 credits to ${updated.email}. New balance: ${updated.paidCredits.toLocaleString()}.`);
          const refreshed = await adminListWallets();
          updateWalletOverview(refreshed);
          renderWalletRows(refreshed, docId);
          if (cachedLedger.length) await loadLedger();
          if (updated.uid === currentUser?.uid || updated.email === currentUser?.email) {
            await fetchBackendQuota(currentUser);
          }
        } catch (err) {
          setAdminError(formatUiError(err, 'Could not add credits.'));
        }
      };

      const resetTodayBtn = document.createElement('button');
      resetTodayBtn.type = 'button';
      resetTodayBtn.className = 'sec';
      resetTodayBtn.textContent = 'Reset Today';
      resetTodayBtn.setAttribute('aria-label', `Reset today's usage to 0 for ${w.email}`);
      resetTodayBtn.onclick = async () => {
        setAdminStatus(`Resetting today's usage for ${w.email}…`);
        try {
          await adminResetUserDailyUsage(docId, w.email);
          setAdminStatus(`Reset today's character usage to 0 for ${w.email}.`);
          const refreshed = await adminListWallets();
          updateWalletOverview(refreshed);
          renderWalletRows(refreshed, docId);
          if (cachedLedger.length) await loadLedger();
          if (docId === currentUser?.uid || w.email === currentUser?.email) {
            await fetchBackendQuota(currentUser);
          }
        } catch (err) {
          setAdminError(formatUiError(err, 'Could not reset daily usage.'));
        }
      };

      const ledgerBtn = document.createElement('button');
      ledgerBtn.type = 'button';
      ledgerBtn.className = 'sec';
      ledgerBtn.textContent = 'History';
      ledgerBtn.setAttribute('aria-label', `View activity history for ${w.email}`);
      ledgerBtn.onclick = async () => {
        $<HTMLInputElement>('#adminLedgerFilter').value = docId;
        $<HTMLSelectElement>('#adminLedgerType').value = 'all';
        if (!cachedLedger.length) await loadLedger();
        else renderLedgerTable();
        $('#adminLedgerFilter').focus();
      };

      wrap.append(selBtn, quickGrantBtn, resetTodayBtn, ledgerBtn);
      tdAct.appendChild(wrap);

      tr.append(tdEmail, tdId, tdPlan, tdDaily, tdLifetime, tdPaid, tdAct);
      tbody.appendChild(tr);

      if (focusGrantDocId && focusGrantDocId === docId) {
        quickGrantBtn.focus();
      }
    }
    $('#adminTableWrap').hidden = wallets.length === 0;
  };

  const renderProfilesRows = (profiles: UserProfileDoc[]) => {
    const tbody = $('#adminProfilesBody');
    tbody.innerHTML = '';
    for (const u of profiles) {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.textContent = u.displayName || '—';
      const tdEmail = document.createElement('td');
      tdEmail.textContent = u.email;
      const tdUid = document.createElement('td');
      tdUid.textContent = u.uid;
      const tdRole = document.createElement('td');
      tdRole.textContent = u.uid === ADMIN_UID ? 'Primary Admin' : u.role === 'admin' ? 'Co-Admin' : 'User';

      const tdAct = document.createElement('td');
      const wrap = document.createElement('div');
      wrap.className = 'admin-row-actions';

      const selBtn = document.createElement('button');
      selBtn.type = 'button';
      selBtn.className = 'sec';
      selBtn.textContent = 'Select';
      selBtn.setAttribute('aria-label', `Select user ${u.email}`);
      selBtn.onclick = () => {
        $<HTMLInputElement>('#adminUid').value = u.uid;
        setAdminStatus(`Selected user ${u.email}.`);
        $('#adminAddCredits').focus();
      };
      wrap.appendChild(selBtn);

      if (u.uid !== ADMIN_UID) {
        const makeAdmin = u.role !== 'admin';
        const roleBtn = document.createElement('button');
        roleBtn.type = 'button';
        roleBtn.className = 'sec';
        roleBtn.textContent = makeAdmin ? 'Make Co-Admin' : 'Remove Co-Admin';
        roleBtn.setAttribute('aria-label', `${roleBtn.textContent} for ${u.email}`);
        roleBtn.onclick = async () => {
          setAdminStatus(`Updating role for ${u.email}…`);
          try {
            await adminUpdateUserRole(u.uid, u.email, makeAdmin);
            const refreshedProfiles = await adminListUsers();
            renderProfilesRows(refreshedProfiles);
            setAdminStatus(`${u.email} role updated to ${makeAdmin ? 'Co-Admin' : 'Standard User'}.`);
          } catch (err) {
            setAdminError(formatUiError(err, 'Could not update user role.'));
          }
        };
        wrap.appendChild(roleBtn);
      }

      tdAct.appendChild(wrap);
      tr.append(tdName, tdEmail, tdUid, tdRole, tdAct);
      tbody.appendChild(tr);
    }
    $('#adminProfilesWrap').hidden = profiles.length === 0;
  };

  const findBtn = $<HTMLButtonElement>('#adminFindBtn');
  const loadUsersBtn = $<HTMLButtonElement>('#adminLoadUsers');
  const loadProfilesBtn = $<HTMLButtonElement>('#adminLoadProfiles');
  const applyBtn = $<HTMLButtonElement>('#adminApply');

  findBtn.onclick = async () => {
    const queryVal = $<HTMLInputElement>('#adminSearchInput').value.trim();
    if (!queryVal) {
      setAdminError('Enter an email address or account ID to search.');
      $('#adminSearchInput').focus();
      return;
    }
    findBtn.disabled = true;
    setAdminStatus(`Searching for ${queryVal}…`);
    try {
      const found = await adminFindWallet(queryVal);
      if (!found) {
        renderWalletRows([]);
        $<HTMLInputElement>('#adminUid').value = queryVal;
        setAdminStatus(
          queryVal.includes('@')
            ? `No existing account for ${queryVal}. Target field is filled if you want to set it up.`
            : `No user found with ID ${queryVal}.`
        );
        return;
      }
      renderWalletRows([found]);
      $<HTMLInputElement>('#adminUid').value = found.docId;
      $<HTMLInputElement>('#adminDailyLimit').value = String(found.wallet.dailyLimit);
      $<HTMLSelectElement>('#adminPlan').value = found.wallet.plan;
      setAdminStatus(`Found account for ${found.wallet.email}.`);
    } catch (err) {
      setAdminError(formatUiError(err, 'Search failed.'));
    } finally {
      findBtn.disabled = false;
    }
  };

  loadUsersBtn.onclick = async () => {
    loadUsersBtn.disabled = true;
    setAdminStatus('Loading user accounts…');
    try {
      const wallets = await adminListWallets();
      updateWalletOverview(wallets);
      renderWalletRows(wallets);
      setAdminStatus(`Loaded ${wallets.length} user account(s).`);
    } catch (err) {
      setAdminError(formatUiError(err, 'Could not load user accounts.'));
    } finally {
      loadUsersBtn.disabled = false;
    }
  };

  loadProfilesBtn.onclick = async () => {
    loadProfilesBtn.disabled = true;
    setAdminStatus('Loading user profiles…');
    try {
      const profiles = await adminListUsers();
      renderProfilesRows(profiles);
      setAdminStatus(`Loaded ${profiles.length} user profile(s).`);
    } catch (err) {
      setAdminError(formatUiError(err, 'Could not load user profiles.'));
    } finally {
      loadProfilesBtn.disabled = false;
    }
  };

  applyBtn.onclick = async () => {
    const target = $<HTMLInputElement>('#adminUid').value.trim();
    const addCredits = parseInt($<HTMLInputElement>('#adminAddCredits').value, 10) || 0;
    const parsedLimit = parseInt($<HTMLInputElement>('#adminDailyLimit').value, 10);
    const dailyLimit = Number.isNaN(parsedLimit) ? 3000 : Math.max(0, parsedLimit);
    const plan = $<HTMLSelectElement>('#adminPlan').value === 'pro' ? 'pro' : 'free';
    const note = $<HTMLInputElement>('#adminNote').value;

    if (!target) {
      setAdminError('Choose or enter a user email or account ID first.');
      $('#adminUid').focus();
      return;
    }
    applyBtn.disabled = true;
    setAdminStatus('Saving changes…');
    try {
      const updated = await adminGrantCredits(target, addCredits, dailyLimit, plan, note);
      setAdminStatus(
        `Saved for ${updated.email}: Credits ${updated.paidCredits.toLocaleString()}, Daily limit ${updated.dailyLimit.toLocaleString()}, Plan ${updated.plan === 'pro' ? 'Extended' : 'Free'}.`
      );
      $('#adminMsg').focus();
      const wallets = await adminListWallets();
      updateWalletOverview(wallets);
      renderWalletRows(wallets);
      await loadLedger();
      if (updated.uid === currentUser?.uid || updated.email === currentUser?.email) {
        await fetchBackendQuota(currentUser);
      }
    } catch (err) {
      setAdminError(formatUiError(err, 'Could not save changes.'));
    } finally {
      applyBtn.disabled = false;
    }
  };

  $('#adminBulkGrantBtn').onclick = async () => {
    const bulkBtn = $<HTMLButtonElement>('#adminBulkGrantBtn');
    const bonus = parseInt($<HTMLInputElement>('#adminBulkCredits').value, 10) || 0;
    const note = $<HTMLInputElement>('#adminBulkNote').value;
    if (bonus === 0) {
      setAdminError('Enter a non-zero bonus character amount.');
      return;
    }
    bulkBtn.disabled = true;
    setAdminStatus('Granting bonus credits to all active user accounts…');
    try {
      const targets = cachedWallets.length ? cachedWallets : await adminListWallets();
      const count = await adminGrantBulkCredits(targets, bonus, note);
      const refreshed = await adminListWallets();
      updateWalletOverview(refreshed);
      renderWalletRows(refreshed);
      await loadLedger();
      if (currentUser) await fetchBackendQuota(currentUser);
      setAdminStatus(`Granted ${bonus >= 0 ? '+' : ''}${bonus.toLocaleString()} credits across ${count} account(s).`);
    } catch (err) {
      setAdminError(formatUiError(err, 'Bulk grant failed.'));
    } finally {
      bulkBtn.disabled = false;
    }
  };

  $('#adminLoadLedger').onclick = () => {
    void loadLedger();
  };
  $('#adminExportCsvBtn').onclick = () => {
    const rows = cachedFilteredLedger.length ? cachedFilteredLedger : cachedLedger;
    if (!rows.length) {
      $('#adminLedgerErr').textContent = 'Load recent activity history before exporting CSV.';
      return;
    }
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['Time', 'UID', 'Activity', 'CreditsDelta', 'Characters', 'Model', 'Note'].map(esc).join(','),
      ...rows.map((r) =>
        [
          r.createdAt?.toDate?.()?.toISOString() || '',
          r.uid,
          formatActivityLabel(r.type),
          r.creditsDelta,
          r.chars,
          r.model,
          r.note,
        ]
          .map(esc)
          .join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voice-studio-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    $('#adminLedgerMsg').textContent = `Exported ${rows.length} ledger row(s) to CSV.`;
  };
  $('#adminLedgerFilter').addEventListener('input', () => {
    if (cachedLedger.length) renderLedgerTable();
  });
  $('#adminLedgerType').addEventListener('change', () => {
    if (cachedLedger.length) renderLedgerTable();
  });

  const setInboxStatus = (msg: string) => {
    $('#adminInboxErr').textContent = '';
    $('#adminInboxMsg').textContent = msg;
  };
  const setInboxError = (msg: string) => {
    $('#adminInboxMsg').textContent = '';
    $('#adminInboxErr').textContent = msg;
  };

  type InboxFocusTarget =
    | { kind: 'toggle'; id: string }
    | { kind: 'confirm'; id: string }
    | { kind: 'delete'; id: string }
    | { kind: 'status' };

  const renderInbox = (focusTarget?: InboxFocusTarget) => {
    const unreadCount = cachedInbox.filter((m) => m.status === 'unread').length;
    $('#adminStatUnread').textContent = unreadCount.toLocaleString();

    const visible = unreadOnlyFilter ? cachedInbox.filter((m) => m.status === 'unread') : cachedInbox;
    const ul = $('#adminInboxList');
    ul.innerHTML = '';
    if (!visible.length) {
      const li = document.createElement('li');
      li.className = 'hint';
      li.textContent = unreadOnlyFilter ? 'No unread messages.' : 'No contact messages found.';
      ul.appendChild(li);
      if (focusTarget?.kind === 'status') $('#adminInboxMsg').focus();
      return;
    }

    for (const m of visible) {
      const li = document.createElement('li');
      li.className = 'inbox-item';

      const heading = document.createElement('strong');
      heading.textContent = `[${m.status === 'unread' ? 'UNREAD' : 'READ'}] ${m.subject}`;

      const meta = document.createElement('div');
      meta.className = 'inbox-meta';
      const when = m.createdAt?.toDate?.()?.toLocaleString() || 'Recent';
      meta.textContent = `From: ${m.name} (${m.email}) · ${when}`;

      const body = document.createElement('p');
      body.className = 'inbox-body';
      body.textContent = m.message;

      const actions = document.createElement('div');
      actions.className = 'btn-group';

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'sec';
      const nextStatus = m.status === 'unread' ? 'read' : 'unread';
      toggleBtn.textContent = m.status === 'unread' ? 'Mark as read' : 'Mark as unread';
      toggleBtn.setAttribute('aria-label', `${toggleBtn.textContent} message from ${m.name}`);
      toggleBtn.onclick = async () => {
        try {
          await adminSetContactMessageStatus(m.id, nextStatus);
          cachedInbox = await adminListContactMessages();
          renderInbox({ kind: 'toggle', id: m.id });
          setInboxStatus(`Marked message from ${m.name} as ${nextStatus}.`);
        } catch (err) {
          setInboxError(formatUiError(err, 'Could not update message status.'));
        }
      };

      if (pendingDeleteId === m.id) {
        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'dng';
        confirmBtn.textContent = 'Confirm delete';
        confirmBtn.setAttribute('aria-label', `Confirm delete message from ${m.name}`);
        confirmBtn.onclick = async () => {
          try {
            pendingDeleteId = null;
            await adminDeleteContactMessage(m.id);
            cachedInbox = await adminListContactMessages();
            setInboxStatus(`Deleted message from ${m.name}.`);
            renderInbox({ kind: 'status' });
          } catch (err) {
            setInboxError(formatUiError(err, 'Could not delete message.'));
          }
        };

        const cancelDelBtn = document.createElement('button');
        cancelDelBtn.type = 'button';
        cancelDelBtn.className = 'sec';
        cancelDelBtn.textContent = 'Cancel';
        cancelDelBtn.onclick = () => {
          pendingDeleteId = null;
          renderInbox({ kind: 'delete', id: m.id });
        };

        actions.append(toggleBtn, confirmBtn, cancelDelBtn);
        li.append(heading, meta, body, actions);
        ul.appendChild(li);

        if (focusTarget?.kind === 'confirm' && focusTarget.id === m.id) confirmBtn.focus();
        else if (focusTarget?.kind === 'toggle' && focusTarget.id === m.id) toggleBtn.focus();
      } else {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'dng';
        delBtn.textContent = 'Delete';
        delBtn.setAttribute('aria-label', `Delete message from ${m.name}`);
        delBtn.onclick = () => {
          pendingDeleteId = m.id;
          renderInbox({ kind: 'confirm', id: m.id });
        };
        actions.append(toggleBtn, delBtn);
        li.append(heading, meta, body, actions);
        ul.appendChild(li);

        if (focusTarget?.kind === 'delete' && focusTarget.id === m.id) delBtn.focus();
        else if (focusTarget?.kind === 'toggle' && focusTarget.id === m.id) toggleBtn.focus();
      }
    }

    if (focusTarget?.kind === 'status') {
      $('#adminInboxMsg').focus();
    }
  };

  const loadInbox = async () => {
    setInboxStatus('Loading contact messages…');
    try {
      cachedInbox = await adminListContactMessages();
      renderInbox();
      const unreadCount = cachedInbox.filter((m) => m.status === 'unread').length;
      setInboxStatus(`Loaded ${cachedInbox.length} message(s) (${unreadCount} unread).`);
    } catch (err) {
      setInboxError(formatUiError(err, 'Could not load contact messages.'));
    }
  };

  $('#adminLoadInbox').onclick = () => {
    void loadInbox();
  };

  $('#adminUnreadOnly').onclick = () => {
    unreadOnlyFilter = !unreadOnlyFilter;
    const btn = $('#adminUnreadOnly');
    btn.setAttribute('aria-pressed', String(unreadOnlyFilter));
    btn.textContent = unreadOnlyFilter ? 'Show all messages' : 'Show unread only';
    renderInbox();
  };

  const checkHealth = async () => {
    const statusEl = $('#adminSystemStatus');
    statusEl.textContent = 'Checking server status…';
    try {
      const res = await fetch('/api/health');
      if (res.status === 404) {
        statusEl.textContent = 'Speech server route was not found on this preview URL.';
        return;
      }
      if (!res.ok) {
        statusEl.textContent = `Server returned status code ${res.status}.`;
        return;
      }
      const data = (await res.json()) as {
        backendConfigured?: boolean;
        dailyLimit?: number;
        keySource?: string;
        maintenanceMode?: boolean;
      };
      statusEl.textContent = data.backendConfigured
        ? `Speech server active (Source: ${data.keySource || 'env'}). Daily allowance: ${(data.dailyLimit || 3000).toLocaleString()} chars · ${data.maintenanceMode ? 'Maintenance ON' : 'Live'}.`
        : 'Server is online, but the shared speech key is not configured yet.';
    } catch {
      statusEl.textContent = 'Could not check server status right now.';
    }
  };

  const renderReferralsTable = (rows: ReferralRecordDoc[]) => {
    const tbody = $('#adminRefBody');
    tbody.innerHTML = '';
    for (const r of rows) {
      const tr = document.createElement('tr');
      const tdUid = document.createElement('td');
      tdUid.textContent = r.uid;
      const tdRef = document.createElement('td');
      tdRef.textContent = r.referrerUid;
      const tdStatus = document.createElement('td');
      tdStatus.textContent = r.bonusGranted ? 'Bonus granted (+2,000)' : 'Pending approval';

      const tdAct = document.createElement('td');
      if (!r.bonusGranted) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sec';
        btn.textContent = 'Grant +2k bonus';
        btn.onclick = async () => {
          $('#adminRefErr').textContent = '';
          $('#adminRefMsg').textContent = `Granting referral bonus for ${r.referrerUid}…`;
          try {
            await adminApproveReferral(r, 2000);
            const refreshed = await adminListReferrals();
            renderReferralsTable(refreshed);
            const wallets = await adminListWallets();
            updateWalletOverview(wallets);
            renderWalletRows(wallets);
            $('#adminRefMsg').textContent = `Granted 2,000 credits to ${r.referrerUid}.`;
          } catch (err) {
            $('#adminRefErr').textContent = formatUiError(err, 'Could not grant referral bonus.');
          }
        };
        tdAct.appendChild(btn);
      } else {
        tdAct.textContent = 'Completed';
      }
      tr.append(tdUid, tdRef, tdStatus, tdAct);
      tbody.appendChild(tr);
    }
    $('#adminRefWrap').hidden = rows.length === 0;
    $('#adminRefMsg').textContent = rows.length ? `Showing ${rows.length} referral record(s).` : 'No referrals recorded yet.';
  };

  const loadReferrals = async () => {
    $('#adminRefErr').textContent = '';
    $('#adminRefMsg').textContent = 'Loading referrals…';
    try {
      const rows = await adminListReferrals();
      renderReferralsTable(rows);
    } catch (err) {
      $('#adminRefMsg').textContent = '';
      $('#adminRefErr').textContent = formatUiError(err, 'Could not load referrals.');
    }
  };

  $('#adminLoadReferrals').onclick = () => {
    void loadReferrals();
  };

  $('#adminCheckHealth').onclick = () => {
    void checkHealth();
  };

  const refreshAllBtn = $<HTMLButtonElement>('#adminRefreshAll');
  refreshAllBtn.onclick = async () => {
    refreshAllBtn.disabled = true;
    $('#adminOverviewMsg').textContent = 'Loading admin overview…';
    try {
      const [wallets, profiles, ledger, inbox, referrals] = await Promise.all([
        adminListWallets(),
        adminListUsers(),
        adminListRecentLedger(),
        adminListContactMessages(),
        adminListReferrals(),
      ]);
      updateWalletOverview(wallets);
      renderWalletRows(wallets);
      renderProfilesRows(profiles);
      cachedLedger = ledger;
      renderLedgerTable();
      cachedInbox = inbox;
      renderInbox();
      renderReferralsTable(referrals);
      await loadServerConfig();
      await checkHealth();
      $('#adminOverviewMsg').textContent =
        `All admin sections updated (${wallets.length} wallet(s), ${profiles.length} profile(s)).`;
    } catch (err) {
      $('#adminOverviewMsg').textContent = formatUiError(err, 'Some sections could not be loaded.');
    } finally {
      refreshAllBtn.disabled = false;
    }
  };
}

/* ---- Settings & Counts ---- */
function populateSelects() {
  const modelEl = $<HTMLSelectElement>('#model');
  modelEl.innerHTML = '';
  for (const m of MODELS) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    modelEl.appendChild(opt);
  }

  const voiceOpts = VOICES.map((v) => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    return opt;
  });
  const voiceEl = $<HTMLSelectElement>('#voice');
  const voiceBEl = $<HTMLSelectElement>('#voiceB');
  voiceEl.innerHTML = '';
  voiceBEl.innerHTML = '';
  voiceOpts.forEach((o) => {
    voiceEl.appendChild(o.cloneNode(true));
    voiceBEl.appendChild(o);
  });
}

function syncAdvancedSummary() {
  const summaryEl = document.getElementById('advancedSummary');
  if (!summaryEl) return;
  const fmtText = cfg.format === 'mp3' ? `MP3 ${cfg.mp3Kbps} kbps` : 'WAV 24 kHz';
  const modelShort = MODELS.find((m) => m.id === cfg.model)?.label.split('(')[0].trim() || cfg.model;
  summaryEl.textContent = `Audio format & advanced settings (${fmtText} · ${modelShort})`;
}

function syncOptionVisibility() {
  const isDialogue = cfg.mode === 'dialogue';
  $('#voiceBWrap').hidden = !isDialogue;
  $('#dialogueHint').hidden = !isDialogue;
  $('#sampleSingle').hidden = isDialogue;
  $('#sampleDialogue').hidden = !isDialogue;
  $('#voiceLabel').textContent = isDialogue ? 'Speaker A voice' : 'Voice';
  $('#mp3QualityWrap').hidden = cfg.format !== 'mp3';
  syncAdvancedSummary();
}

function syncByokUi() {
  $('#byokWrap').hidden = !byokEnabled;
  if (isByokActive()) {
    $('#byokSummary').textContent = 'Own Gemini API Key (Unlimited Mode active)';
  } else if (byokEnabled) {
    $('#byokSummary').textContent = 'Own Gemini API Key (enter key to activate Unlimited Mode)';
  } else {
    $('#byokSummary').textContent = 'Own Gemini API Key (optional Unlimited Mode)';
  }
  const notice = document.getElementById('backendNotice');
  if (notice && isByokActive()) {
    notice.hidden = true;
    notice.textContent = '';
  }
}

function updateCounts() {
  const text = $<HTMLTextAreaElement>('#text').value;
  const chunkSize = num('#chunk', 300, 3000, 1800);
  const stats = estimateStats(text, chunkSize, cfg.model);
  if (!stats.chars) {
    $('#count').textContent = 'Characters: 0';
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
  $('#count').textContent =
    `Characters: ${stats.chars.toLocaleString()} (${stats.words.toLocaleString()} words). ` +
    `About ${stats.estParts} parts, ~${estMins} min audio.${quotaMsg}`;
}

function syncStylePresetSelect(styleValue: string) {
  const sel = document.getElementById('stylePreset') as HTMLSelectElement | null;
  if (!sel) return;
  const trimmed = styleValue.trim();
  if (!trimmed) {
    sel.value = '';
    return;
  }
  const hasMatch = Array.from(sel.options).some((opt) => opt.value !== '__custom__' && opt.value === trimmed);
  sel.value = hasMatch ? trimmed : '__custom__';
}

function bindSettings() {
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

  const openPdfShortcut = document.getElementById('openPdfStudioShortcut');
  if (openPdfShortcut) {
    openPdfShortcut.onclick = () => navigateToPage('pdfStudio', true);
  }
  const openPodcastShortcut = document.getElementById('openPodcastStudioShortcut');
  if (openPodcastShortcut) {
    openPodcastShortcut.onclick = () => navigateToPage('podcastStudio', true);
  }

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
    currentTextOrigin = 'user';
    sampleReplaceArmed = false;
    updateCounts();
  });
  syncOptionVisibility();
  syncByokUi();
  updateCounts();
}

/* ---- Pronunciation Dictionary ---- */
function drawDict() {
  const ul = $('#dictList');
  ul.innerHTML = '';
  const activeCount = dictRules.filter((r) => r.enabled).length;
  $('#dictSummary').textContent = `Pronunciation dictionary (${activeCount} active rule${activeCount === 1 ? '' : 's'})`;

  if (!dictRules.length) {
    const li = document.createElement('li');
    li.textContent = 'No custom pronunciation rules yet.';
    ul.appendChild(li);
    return;
  }

  dictRules.forEach((rule, idx) => {
    const li = document.createElement('li');
    const info = document.createElement('span');
    info.textContent = `"${rule.find}" → "${rule.replace}"${rule.wholeWord ? ' (whole word)' : ''}`;

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
      $('#dictSummary').textContent = `Pronunciation dictionary (${countNow} active rule${countNow === 1 ? '' : 's'})`;
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
      $('#dictMsg').textContent = 'Rule removed.';
      const nextRemove = ul.querySelector<HTMLButtonElement>('button.sec');
      if (nextRemove) nextRemove.focus();
      else $('#dictFind').focus();
    };

    actions.appendChild(toggleLabel);
    actions.appendChild(del);
    li.appendChild(info);
    li.appendChild(actions);
    ul.appendChild(li);
  });
}

$('#addDict').onclick = () => {
  const findEl = $<HTMLInputElement>('#dictFind');
  const repEl = $<HTMLInputElement>('#dictReplace');
  const wholeEl = $<HTMLInputElement>('#dictWhole');
  const find = findEl.value.trim();
  const replace = repEl.value.trim();

  if (!find || !replace) {
    $('#dictMsg').textContent = 'Enter both the written word and how it should be spoken.';
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

    // Automatically fall back to next compatible Gemini TTS model on 404 model-not-found
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
  $<HTMLButtonElement>('#gen').disabled = busy;
  $<HTMLButtonElement>('#prev').disabled = busy;
  $<HTMLButtonElement>('#voiceDemo').disabled = busy;
  $<HTMLButtonElement>('#clear').disabled = busy;
  $<HTMLButtonElement>('#paste').disabled = busy;
  $<HTMLButtonElement>('#load').disabled = busy;
  $<HTMLButtonElement>('#sampleSingle').disabled = busy;
  $<HTMLButtonElement>('#sampleDialogue').disabled = busy;
  $<HTMLButtonElement>('#detectChaptersBtn').disabled = busy;
  $<HTMLButtonElement>('#loadChapterBtn').disabled = busy;
  $<HTMLButtonElement>('#loadAllChaptersBtn').disabled = busy;
  $<HTMLButtonElement>('#exportChaptersZipBtn').disabled = busy;
  $<HTMLButtonElement>('#genPodcastBtn').disabled = busy;
  $<HTMLButtonElement>('#translateBtn').disabled = busy;
  $<HTMLSelectElement>('#templateSelect').disabled = busy;
  $<HTMLButtonElement>('#applyTemplateBtn').disabled = busy;
  $<HTMLButtonElement>('#pdfAgentPickFileBtn').disabled = busy;
  $<HTMLButtonElement>('#pdfAgentRunBtn').disabled = busy;
  $<HTMLButtonElement>('#pdfAgentLoadOnlyBtn').disabled = busy;
  $<HTMLSelectElement>('#pdfAgentOutputStyle').disabled = busy;
  $<HTMLSelectElement>('#videoAspect').disabled = busy;
  $<HTMLButtonElement>('#dlVideoBtn').disabled = busy;
  $<HTMLButtonElement>('#cancelVideoBtn').hidden = !videoBusy;

  $<HTMLSelectElement>('#model').disabled = running;
  $<HTMLSelectElement>('#voice').disabled = running;
  $<HTMLSelectElement>('#voiceB').disabled = running;
  $<HTMLSelectElement>('#mode').disabled = running;
  $<HTMLInputElement>('#chunk').disabled = running;
  $<HTMLSelectElement>('#format').disabled = running;
  $<HTMLSelectElement>('#mp3Kbps').disabled = running;

  $('#cancel').hidden = !running;
  const canResume = Boolean(job && job.done < job.items.length);
  $('#resume').hidden = busy || !canResume;
  $('#prog').hidden = !running && !canResume;
}

function fail(m: string) {
  running = false;
  sayError(m + (job ? ` ${job.done} of ${job.items.length} parts are done. You can press Resume.` : ''));
  ui();
}

async function finishOutput(currentJob: GenerationJob) {
  const progEl = $<HTMLProgressElement>('#prog');
  let blob: Blob;

  if (currentJob.format === 'mp3') {
    say('Encoding MP3 audio… please wait.');
    progEl.value = 0;
    progEl.setAttribute('aria-valuetext', 'Encoding MP3 0 percent');
    blob = await encodeMp3Blob(currentJob.parts, currentJob.rate, currentJob.sil, currentJob.mp3Kbps, (pct) => {
      progEl.value = pct;
      progEl.setAttribute('aria-valuetext', `Encoding MP3 ${pct} percent`);
    });
  } else {
    blob = wavBlob(currentJob.parts, currentJob.rate, currentJob.sil);
  }

  const segments = buildSubtitleSegments(currentJob.items, currentJob.parts, currentJob.rate, currentJob.sil);
  const srtContent = formatSubtitles(segments, 'srt');
  const vttContent = formatSubtitles(segments, 'vtt');

  running = false;
  job = null;
  progEl.value = 0;
  progEl.setAttribute('aria-valuetext', '0 percent');
  progEl.hidden = true;

  if (audioUrl) URL.revokeObjectURL(audioUrl);
  if (srtUrl) URL.revokeObjectURL(srtUrl);
  if (vttUrl) URL.revokeObjectURL(vttUrl);
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = null;

  audioUrl = URL.createObjectURL(blob);
  srtUrl = URL.createObjectURL(new Blob([srtContent], { type: 'application/x-subrip;charset=utf-8' }));
  vttUrl = URL.createObjectURL(new Blob([vttContent], { type: 'text/vtt;charset=utf-8' }));

  const player = $<HTMLAudioElement>('#player');
  player.src = audioUrl;
  player.playbackRate = cfg.speed;

  const dl = $<HTMLAnchorElement>('#dl');
  lastBlob = blob;
  lastSubtitleSegments = segments;
  lastName = buildDownloadFilename(
    currentJob.format,
    $<HTMLInputElement>('#audioTitle').value,
    loadedDocTitle,
    $<HTMLTextAreaElement>('#text').value,
    cfg.mode,
    cfg.voice,
    cfg.voiceB
  );
  dl.href = audioUrl;
  dl.download = lastName;
  dl.textContent = currentJob.format === 'mp3' ? 'Download MP3 file' : 'Download WAV file';

  const baseStem = lastName.replace(/\.[^.]+$/, '');
  const dlSrt = $<HTMLAnchorElement>('#dlSrt');
  dlSrt.href = srtUrl;
  dlSrt.download = `${baseStem}.srt`;
  dlSrt.hidden = !segments.length;

  const dlVtt = $<HTMLAnchorElement>('#dlVtt');
  dlVtt.href = vttUrl;
  dlVtt.download = `${baseStem}.vtt`;
  dlVtt.hidden = !segments.length;

  const dlVideoBtn = $<HTMLButtonElement>('#dlVideoBtn');
  dlVideoBtn.hidden = !(blob && segments.length > 0);
  $('#videoStatus').textContent = '';

  const secs = Math.round(totalPcmDurationSeconds(currentJob.parts, currentJob.rate, currentJob.sil));
  const mb = (blob.size / 1048576).toFixed(2);
  $('#info').textContent = `File: ${lastName}, ${mb} MB (${currentJob.format.toUpperCase()}) · ${segments.length} synced subtitle cues`;
  $('#result').hidden = false;
  setupShare();

  say(`Finished. Your audio and synced subtitles are ready, about ${Math.floor(secs / 60)} minutes ${secs % 60} seconds.`);
  ui();
  player.focus();
}

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
    const titleInput = $<HTMLInputElement>('#audioTitle').value.trim();
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
    (!currentUser ? $('#authCard') : $('#authVerifyBox')).focus();
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
        const progEl = $<HTMLProgressElement>('#prog');
        progEl.value = pc;
        progEl.setAttribute('aria-valuetext', `${pc} percent (${currentJob.done} of ${currentJob.items.length} parts)`);
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
    if (resolvePageId() !== 'tool') {
      navigateToPage('tool', false);
    }
    say(msg);
    sayAuth(msg);
    $('#authCard').scrollIntoView({ block: 'nearest' });
    $('#authCard').focus();
    return false;
  }
  if (!currentUser.emailVerified) {
    const msg = 'Please verify your email address to unlock your 3,000 characters/day allowance.';
    if (resolvePageId() !== 'tool') {
      navigateToPage('tool', false);
    }
    say(msg);
    sayAuth(msg);
    $('#authVerifyBox').scrollIntoView({ block: 'nearest' });
    $('#authVerifyBox').focus();
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

$('#gen').onclick = () => {
  if (!requireSignedInUser()) return;
  const text = $<HTMLTextAreaElement>('#text').value.trim();
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
  $('#result').hidden = true;
  $<HTMLProgressElement>('#prog').value = 0;
  run();
};

$('#resume').onclick = () => {
  if (job) run();
};

$('#cancel').onclick = () => {
  if (ctl) ctl.abort();
};

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

$('#voiceDemo').onclick = async () => {
  if (!requireSignedInUser()) return;
  const demoLine = `Hello! You are testing the ${cfg.voice} voice in Voice Studio. Your own text box stays untouched.`;
  await playQuickAudioClip(demoLine, cfg.voice, `${cfg.voice} voice demo`);
};

$('#prev').onclick = async () => {
  if (!requireSignedInUser()) return;
  const raw = $<HTMLTextAreaElement>('#text').value.trim();
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

/* ---- Text Helpers, Document Import & Drag/Drop ---- */
function setText(t: string, origin: 'user' | 'sample' | 'doc' = 'user') {
  const el = $<HTMLTextAreaElement>('#text');
  el.value = t;
  updateCounts();
  currentTextOrigin = origin;
  sampleReplaceArmed = false;
}

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
  lastSubtitleSegments = [];
  renderChaptersBox();
  $<HTMLInputElement>('#audioTitle').value = '';
  const pdfInfoEl = document.getElementById('pdfStudioFileInfo');
  if (pdfInfoEl) {
    pdfInfoEl.textContent =
      'No file loaded yet. Choose a PDF, EPUB, DOCX, or TXT file below (processed locally in your browser).';
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
    const titleEl = $<HTMLInputElement>('#audioTitle');
    if (loadedDocTitle && titleEl.value.trim() === loadedDocTitle) {
      titleEl.value = '';
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

function insertSampleWithGuard(sampleText: string, okMsg: string) {
  const current = $<HTMLTextAreaElement>('#text').value.trim();
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
  $('#text').focus();
}

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

function renderChaptersBox() {
  const box = $('#chaptersBox');
  const sel = $<HTMLSelectElement>('#chapterSelect');
  const summary = $('#chaptersSummary');
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
  extracting = true;
  loadedFile = f;
  ui();
  say(`Reading ${f.name}…`);
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
      const isPdf = f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf';
      if (isPdf) {
        const msg = `${f.name} appears to be a scanned image PDF without selectable text. Use the AI PDF & Book Studio to extract & record pages with Gemini Vision.`;
        const agentStatus = document.getElementById('pdfAgentStatus');
        if (agentStatus) agentStatus.textContent = msg;
        const pdfInfoEl = document.getElementById('pdfStudioFileInfo');
        if (pdfInfoEl) pdfInfoEl.textContent = msg;
        say(msg);
      } else {
        say(`No readable text was found inside ${f.name}.`);
      }
      return;
    }

    fullLoadedDocText = res.text;
    detectedChapters = res.chaptersList || [];
    renderChaptersBox();

    const titleEl = $<HTMLInputElement>('#audioTitle');
    if (!titleEl.value.trim() || titleEl.value.trim() === prevDocTitle) {
      titleEl.value = loadedDocTitle;
    }
    setText(res.text, 'doc');
    const details: string[] = [res.formatLabel];
    if (res.pages) details.push(`${res.pages} pages`);
    if (res.chapters) details.push(`${res.chapters} chapters`);
    const cleanNote = res.removedLines ? ` Cleaned ${res.removedLines} header or page-number lines.` : '';
    say(`Loaded ${f.name} (${details.join(', ')}), ${[...res.text].length.toLocaleString()} characters.${cleanNote}`);
    const readyMsg = `Loaded: ${f.name} (${details.join(', ')}). Enter which chapter, topic, or page range to extract below.`;
    const agentStatus = document.getElementById('pdfAgentStatus');
    if (agentStatus) {
      agentStatus.textContent = readyMsg;
    }
    const pdfInfoEl = document.getElementById('pdfStudioFileInfo');
    if (pdfInfoEl) {
      pdfInfoEl.textContent = readyMsg;
    }
  } catch {
    say(`Could not read ${f.name}. Make sure it is a valid PDF, DOCX, EPUB, or text file.`);
  } finally {
    extracting = false;
    ui();
  }
}

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

/* ---- Share & Unload Protection ---- */
function setupShare() {
  let ok = false;
  if (!lastBlob) {
    $('#share').hidden = true;
    return;
  }
  const mime = lastName.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav';
  try {
    ok = !!(navigator.canShare && navigator.canShare({ files: [new File([lastBlob], lastName, { type: mime })] }));
  } catch {
    ok = false;
  }
  $('#share').hidden = !ok;
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

/* ---- In-Page Contact Form ---- */
function bindContactForm() {
  const form = $<HTMLFormElement>('#contactForm');
  const submitBtn = $<HTMLButtonElement>('#contactSubmit');
  const statusEl = $('#contactStatus');
  const errEl = $('#contactErr');

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
      const refId = await submitContactMessage({
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
      if (raw.includes('"error":')) {
        errEl.textContent = 'Message could not be saved right now. Please check all fields and try again.';
      } else {
        errEl.textContent = raw;
      }
      if (nameEl.value.trim().length < 2) {
        nameEl.setAttribute('aria-invalid', 'true');
        nameEl.focus();
      } else if (!emailEl.value.includes('@')) {
        emailEl.setAttribute('aria-invalid', 'true');
        emailEl.focus();
      } else if (messageEl.value.trim().length < 10) {
        messageEl.setAttribute('aria-invalid', 'true');
        messageEl.focus();
      }
    } finally {
      submitBtn.disabled = false;
    }
  });
}

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

/* ---- Chapters, Audiobook ZIP, Creator Studio, Public Demo & Referral UI ---- */
$('#detectChaptersBtn').onclick = async () => {
  const raw = $<HTMLTextAreaElement>('#text').value.trim();
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
  $<HTMLInputElement>('#audioTitle').value = `${baseTitle} - ${ch.title}`.slice(0, 80);
  say(`Loaded ${ch.title} (${[...ch.text].length.toLocaleString()} characters).`);
  $('#text').focus();
};

$('#loadAllChaptersBtn').onclick = () => {
  if (!fullLoadedDocText) return;
  setText(fullLoadedDocText, 'doc');
  if (loadedDocTitle) {
    $<HTMLInputElement>('#audioTitle').value = loadedDocTitle;
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
        cfg.format === 'mp3'
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
    const zipStem = cleanTitleSlug($<HTMLInputElement>('#audioTitle').value || loadedDocTitle) || 'voice-studio';
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
  $('#studioErr').textContent = '';
  $('#studioStatus').textContent = msg;
}
function setStudioErr(msg: string) {
  $('#studioStatus').textContent = '';
  $('#studioErr').textContent = msg;
}

$('#applyTemplateBtn').onclick = () => {
  const key = $<HTMLSelectElement>('#templateSelect').value;
  const tpl = CREATOR_TEMPLATES[key];
  if (!tpl) return;
  const current = $<HTMLTextAreaElement>('#text').value.trim();
  if (current && currentTextOrigin !== 'sample' && !sampleReplaceArmed) {
    sampleReplaceArmed = true;
    setStudioStatus('Your Speech Studio editor already has text. Press Load selected template again to replace it.');
    return;
  }
  cfg.mode = tpl.mode;
  cfg.style = tpl.style;
  $<HTMLSelectElement>('#mode').value = tpl.mode;
  $<HTMLInputElement>('#style').value = tpl.style;
  syncStylePresetSelect(tpl.style);
  syncOptionVisibility();
  store.set('vs.cfg', cfg);
  loadedDocTitle = '';
  $<HTMLInputElement>('#audioTitle').value = tpl.title;
  setText(tpl.text, 'sample');
  setStudioStatus(
    `Loaded "${tpl.title}" (${tpl.mode === 'dialogue' ? '2-speaker dialogue' : 'single voice'}). Open Speech Studio or generate audio below.`
  );
};

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
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `AI studio failed (${res.status}).`);
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
          ? `Write an engaging 8 to 10 turn podcast discussion between Host and Guest about:\n\n${payload.topic}`
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
  $('#pdfAgentErr').textContent = '';
  $('#pdfAgentStatus').textContent = msg;
}
function setPdfAgentErr(msg: string) {
  $('#pdfAgentStatus').textContent = '';
  $('#pdfAgentErr').textContent = msg;
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
  const userPrompt = $<HTMLInputElement>('#pdfAgentPrompt').value.trim();
  const outputMode = ($<HTMLSelectElement>('#pdfAgentOutputStyle').value || 'narrated') as PdfAgentOutputMode;
  const shouldRecord = !forceLoadOnly && $<HTMLInputElement>('#pdfAgentAutoRecord').checked;
  const editorText = $<HTMLTextAreaElement>('#text').value.trim();

  if (!loadedFile && !loadedPagesText.length && !detectedChapters.length && !editorText) {
    setPdfAgentErr('Load a PDF or document first (or paste notes in Step 2) before running the agent.');
    $('#pdfAgentPickFileBtn').focus();
    return;
  }
  if (!userPrompt) {
    setPdfAgentErr('Describe which chapter, topic, or pages you want to extract and record.');
    $('#pdfAgentPrompt').focus();
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
        throw new Error('Scanned image PDFs require Gemini Vision. Please sign in or enable your own Gemini API key in Step 1.');
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
            methodNote = `Gemini index (pages ${sliced.pagesUsed[0] || plan.startPage}–${sliced.pagesUsed[sliced.pagesUsed.length - 1] || plan.endPage})`;
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
                    'Convert the requested parts of the excerpt into an engaging 2-speaker Host & Guest study discussion. Every line MUST start with "Host: " or "Guest: ". Zero markdown or asterisks.',
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
      $<HTMLSelectElement>('#mode').value = 'dialogue';
      syncOptionVisibility();
      store.set('vs.cfg', cfg);
    }

    const cleanTitle = resolvedTitle.replace(/[\r\n]+/g, ' ').trim().slice(0, 80);
    if (cleanTitle) {
      $<HTMLInputElement>('#audioTitle').value = cleanTitle;
    }
    setText(extractedScript, 'doc');
    setPdfAgentStatus(
      `Ready: "${cleanTitle}" (${[...extractedScript].length.toLocaleString()} chars) via ${methodNote}.`
    );

    if (shouldRecord) {
      navigateToPage('tool', false);
      say(`Extracted "${cleanTitle}". Starting audio recording…`);
      $('#gen').click();
    } else {
      navigateToPage('tool', false);
      say(`Extracted "${cleanTitle}" into the Speech Studio editor.`);
      $('#text').focus();
    }
  } catch (err) {
    setPdfAgentErr(err instanceof Error ? err.message : 'PDF Recording Agent could not process this request.');
  } finally {
    studioBusy = false;
    ui();
  }
}

$('#pdfAgentPickFileBtn').onclick = () => $<HTMLInputElement>('#file').click();
$('#pdfAgentRunBtn').onclick = () => void runPdfRecordingAgent(false);
$('#pdfAgentLoadOnlyBtn').onclick = () => void runPdfRecordingAgent(true);

$('#genPodcastBtn').onclick = async () => {
  if (!isByokActive() && !requireSignedInUser()) return;
  const topicInput = $<HTMLInputElement>('#podcastTopic').value.trim();
  const editorText = $<HTMLTextAreaElement>('#text').value.trim();
  const topic = topicInput || editorText.slice(0, 5000);
  const length = $<HTMLSelectElement>('#podcastLen').value;

  if (topic.length < 3) {
    setStudioErr('Enter a podcast topic above, or paste notes in Speech Studio first.');
    $('#podcastTopic').focus();
    return;
  }

  studioBusy = true;
  ui();
  setStudioStatus('Generating 2-speaker podcast script…');
  try {
    const script = await runStudioAction({ action: 'podcast', topic, length });
    cfg.mode = 'dialogue';
    $<HTMLSelectElement>('#mode').value = 'dialogue';
    syncOptionVisibility();
    store.set('vs.cfg', cfg);
    setText(script, 'user');
    if (topicInput && !$<HTMLInputElement>('#audioTitle').value.trim()) {
      $<HTMLInputElement>('#audioTitle').value = `${topicInput.slice(0, 50)} Podcast`;
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

$('#translateBtn').onclick = async () => {
  if (!isByokActive() && !requireSignedInUser()) return;
  const currentText = $<HTMLTextAreaElement>('#text').value.trim();
  const targetLang = $<HTMLSelectElement>('#translateLang').value;
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

$('#sendStudioToSpeechBtn').onclick = () => {
  if (!$<HTMLTextAreaElement>('#text').value.trim()) {
    setStudioErr('Load a template, generate a podcast script, or enter text first.');
    return;
  }
  navigateToPage('tool', false);
  $('#text').focus();
};

$('#recordFromStudioBtn').onclick = () => {
  if (!$<HTMLTextAreaElement>('#text').value.trim()) {
    setStudioErr('Load a template, generate a podcast script, or enter text first.');
    return;
  }
  navigateToPage('tool', false);
  $('#gen').click();
};

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
bindSettings();
bindContactForm();
bindPwaAndShare();
bindReferralUi();
drawDict();
route(false);
ui();
void loadPublicSiteStatus();
