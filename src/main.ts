import { onAuthStateChanged, type User } from 'firebase/auth';
import type { Unsubscribe } from 'firebase/firestore';
import {
  ADMIN_UID,
  adminDeleteContactMessage,
  adminFindWallet,
  adminGrantCredits,
  adminListContactMessages,
  adminListRecentLedger,
  adminListUsers,
  adminListWallets,
  adminSetContactMessageStatus,
  auth,
  ensureUserAndWallet,
  resendVerificationEmail,
  sendResetEmail,
  signInEmail,
  signInWithGoogle,
  signOutUser,
  signUpEmail,
  submitContactMessage,
  subscribeLedger,
  subscribeWallet,
  verifyStrictAdmin,
  type ContactMessageDoc,
  type LedgerEntryDoc,
  type UserProfileDoc,
  type UserWalletDoc,
} from './firebase';
import {
  MODELS,
  VOICES,
  applyDictionary,
  buildBody,
  buildDialogueItems,
  chunks,
  classify,
  encodeMp3Blob,
  estimateStats,
  getModelFallbackOrder,
  safePreviewSlice,
  toPcm,
  totalPcmDurationSeconds,
  wavBlob,
} from './tts-core';
import type {
  AudioFormat,
  GenerationJob,
  GenerationMode,
  InlineAudioData,
  PronunciationRule,
  QuotaState,
  SpeechItem,
  VoiceConfig,
} from './types';

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
let ctl: AbortController | null = null;
let audioUrl: string | null = null;
let lastBlob: Blob | null = null;
let lastName = '';
let loadedDocTitle = '';
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

/* ---- Routing & Accessible Navigation Drawer ---- */
const SEO_HOME_TITLE = 'Voice Studio – Free PDF, EPUB & DOCX to Audio TTS Converter';
const SEO_HOME_DESC =
  'Convert PDF, EPUB, Word DOCX, and Urdu or English text into natural MP3 & WAV audio. Built for blind readers, students, and creators—3,000 free chars daily.';
const pages = ['tool', 'account', 'admin', 'guides', 'formats', 'faq', 'about', 'contact', 'privacy', 'terms'] as const;
type PageId = (typeof pages)[number];

function resolvePageId(): PageId {
  const pathSlug = location.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  if ((pages as readonly string[]).includes(pathSlug)) {
    return pathSlug as PageId;
  }
  const hashSlug = location.hash.slice(1).toLowerCase();
  if ((pages as readonly string[]).includes(hashSlug)) {
    return hashSlug as PageId;
  }
  return 'tool';
}

function getPagePath(id: PageId): string {
  return id === 'tool' ? '/' : `/${id}`;
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

function getDrawerFocusable(): HTMLElement[] {
  const drawer = $('#navDrawer');
  return Array.from(
    drawer.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => !el.hidden && el.offsetParent !== null);
}

function openDrawer() {
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
  route(moveFocus);
}

window.addEventListener('popstate', () => route(true));
window.addEventListener('hashchange', () => route(true));

document.addEventListener('keydown', (e) => {
  const drawer = document.getElementById('navDrawer');
  if (!drawer || drawer.hidden) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    closeDrawer(true);
    return;
  }

  if (e.key === 'Tab') {
    const focusables = getDrawerFocusable();
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (!active || active === first || !drawer.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (!active || active === last || !drawer.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }
});

$('#openDrawerBtn').onclick = () => openDrawer();
$('#closeDrawerBtn').onclick = () => closeDrawer(true);
$('#drawerBackdrop').onclick = () => closeDrawer(true);

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

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sayAuth('Please enter a valid email address.');
    emailEl.focus();
    return;
  }
  if (pass.length < 6) {
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

async function handleAuthUser(user: User | null) {
  clearFirestoreListeners();
  currentUser = user;
  activeQuota = null;
  verifiedAdminSession = false;
  unmountAdminPanel();

  const headerUser = $('#headerUser');
  const headerAuthBtn = $('#headerAuthBtn');
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

  $('#authGate').hidden = true;
  $('#authVerifyBox').hidden = true;
  $('#converterWorkspace').hidden = false;
  $('#userDisplay').textContent = user.displayName || user.email || 'Account';
  $('#userAccountMeta').textContent = user.email ? `${user.email} · 3,000 chars daily allowance` : '';
  updateWorkspaceBalanceBar();

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
  } catch {
    sayAuth('Could not load account balance right now.');
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
          <h2>Overview</h2>
          <p class="account-meta">Summary of active user accounts, credit balances, daily usage, and unread messages.</p>
        </div>
        <div class="btn-group compact-actions">
          <button id="adminRefreshAll" type="button">Refresh All</button>
        </div>
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

    <div class="card" id="adminCard">
      <h2>Users &amp; Credits</h2>
      <p class="hint">Search for any user, view all registered accounts, update daily free limits, or add extra credits.</p>
      <div class="row">
        <div>
          <label for="adminSearchInput">Find user by Email or Account ID</label>
          <input id="adminSearchInput" type="text" placeholder="user@example.com or Account ID">
        </div>
      </div>
      <div class="btn-group">
        <button id="adminFindBtn" type="button" class="sec">Search user</button>
        <button id="adminLoadUsers" type="button" class="sec">Show all users</button>
        <button id="adminLoadProfiles" type="button" class="sec">Show user profiles</button>
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
              <th scope="col">Action</th>
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
      <h2>Server Status</h2>
      <p class="hint" id="adminSessionIdentity"></p>
      <p class="hint" id="adminSystemStatus" role="status" aria-live="polite">Press Check Server Status to verify that speech generation is ready.</p>
      <div class="btn-group">
        <button id="adminCheckHealth" type="button" class="sec">Check Server Status</button>
      </div>
    </div>
  `;

  let cachedLedger: LedgerEntryDoc[] = [];
  let cachedInbox: ContactMessageDoc[] = [];
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

  mount.querySelectorAll<HTMLButtonElement>('.admin-preset-credit').forEach((btn) => {
    btn.onclick = () => {
      const val = btn.dataset.credits || '0';
      $<HTMLInputElement>('#adminAddCredits').value = val;
      setAdminStatus(`Credit amount set to ${Number(val).toLocaleString()} characters.`);
    };
  });

  const updateWalletOverview = (wallets: Array<{ docId: string; wallet: UserWalletDoc }>) => {
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

      wrap.append(selBtn, quickGrantBtn, ledgerBtn);
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
      tdRole.textContent = u.role;

      const tdAct = document.createElement('td');
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
      tdAct.appendChild(selBtn);
      tr.append(tdName, tdEmail, tdUid, tdRole, tdAct);
      tbody.appendChild(tr);
    }
    $('#adminProfilesWrap').hidden = profiles.length === 0;
  };

  $('#adminFindBtn').onclick = async () => {
    const queryVal = $<HTMLInputElement>('#adminSearchInput').value.trim();
    if (!queryVal) {
      setAdminError('Enter an email address or account ID to search.');
      $('#adminSearchInput').focus();
      return;
    }
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
    }
  };

  $('#adminLoadUsers').onclick = async () => {
    setAdminStatus('Loading user accounts…');
    try {
      const wallets = await adminListWallets();
      updateWalletOverview(wallets);
      renderWalletRows(wallets);
      setAdminStatus(`Loaded ${wallets.length} user account(s).`);
    } catch (err) {
      setAdminError(formatUiError(err, 'Could not load user accounts.'));
    }
  };

  $('#adminLoadProfiles').onclick = async () => {
    setAdminStatus('Loading user profiles…');
    try {
      const profiles = await adminListUsers();
      renderProfilesRows(profiles);
      setAdminStatus(`Loaded ${profiles.length} user profile(s).`);
    } catch (err) {
      setAdminError(formatUiError(err, 'Could not load user profiles.'));
    }
  };

  $('#adminApply').onclick = async () => {
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
    }
  };

  $('#adminLoadLedger').onclick = () => {
    void loadLedger();
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
      const data = (await res.json()) as { backendConfigured?: boolean; dailyLimit?: number };
      statusEl.textContent = data.backendConfigured
        ? `Speech server is active and ready. Default daily free allowance: ${(data.dailyLimit || 3000).toLocaleString()} characters.`
        : 'Server is online, but the shared speech key is not configured on this host.';
    } catch {
      statusEl.textContent = 'Could not check server status right now.';
    }
  };

  $('#adminCheckHealth').onclick = () => {
    void checkHealth();
  };

  $('#adminRefreshAll').onclick = async () => {
    $('#adminOverviewMsg').textContent = 'Loading admin overview…';
    try {
      const [wallets, ledger, inbox] = await Promise.all([
        adminListWallets(),
        adminListRecentLedger(),
        adminListContactMessages(),
      ]);
      updateWalletOverview(wallets);
      renderWalletRows(wallets);
      cachedLedger = ledger;
      renderLedgerTable();
      cachedInbox = inbox;
      renderInbox();
      await checkHealth();
      $('#adminOverviewMsg').textContent = 'All admin sections updated.';
    } catch (err) {
      $('#adminOverviewMsg').textContent = formatUiError(err, 'Some sections could not be loaded.');
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

function bindSettings() {
  populateSelects();

  $<HTMLSelectElement>('#model').value = cfg.model;
  $<HTMLSelectElement>('#voice').value = cfg.voice;
  $<HTMLSelectElement>('#voiceB').value = cfg.voiceB;
  $<HTMLSelectElement>('#mode').value = cfg.mode;
  $<HTMLInputElement>('#style').value = cfg.style;
  $<HTMLInputElement>('#chunk').value = String(cfg.chunk);
  $<HTMLInputElement>('#pause').value = String(cfg.pause);
  $<HTMLInputElement>('#sil').value = String(cfg.sil);
  $<HTMLSelectElement>('#format').value = cfg.format;
  $<HTMLSelectElement>('#mp3Kbps').value = String(cfg.mp3Kbps);
  $<HTMLInputElement>('#cleanDocs').checked = cfg.cleanDocs;
  $<HTMLSelectElement>('#speed').value = String(cfg.speed);
  $<HTMLInputElement>('#byokEnabled').checked = byokEnabled;
  $<HTMLInputElement>('#byokKey').value = byokKey;

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
    saveCfg();
  });
  document.querySelectorAll<HTMLButtonElement>('.style-preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.style || '';
      cfg.style = val;
      $<HTMLInputElement>('#style').value = val;
      saveCfg();
      say(val ? `Speaking style set to: ${val}.` : 'Speaking style cleared.');
    });
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

  let data: {
    audio?: InlineAudioData;
    quota?: QuotaState;
    error?: string;
    code?: string;
  } = {};
  try {
    data = (await res.json()) as typeof data;
  } catch {
    // Fall through
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
    const serverMsg =
      data.error ||
      'The shared speech server hit an unexpected error (500). Turn on Own Gemini API Key (Unlimited Mode) in Step 1 or check your server environment variables.';
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
  const busy = running || previewing || extracting;
  $<HTMLButtonElement>('#gen').disabled = busy;
  $<HTMLButtonElement>('#prev').disabled = busy;
  $<HTMLButtonElement>('#voiceDemo').disabled = busy;
  $<HTMLButtonElement>('#clear').disabled = busy;
  $<HTMLButtonElement>('#paste').disabled = busy;
  $<HTMLButtonElement>('#load').disabled = busy;
  $<HTMLButtonElement>('#sampleSingle').disabled = busy;
  $<HTMLButtonElement>('#sampleDialogue').disabled = busy;

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

  running = false;
  job = null;
  progEl.value = 0;
  progEl.setAttribute('aria-valuetext', '0 percent');
  progEl.hidden = true;

  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(blob);

  const player = $<HTMLAudioElement>('#player');
  player.src = audioUrl;
  player.playbackRate = cfg.speed;

  const dl = $<HTMLAnchorElement>('#dl');
  lastBlob = blob;
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

  const secs = Math.round(totalPcmDurationSeconds(currentJob.parts, currentJob.rate, currentJob.sil));
  const mb = (blob.size / 1048576).toFixed(2);
  $('#info').textContent = `File: ${lastName}, ${mb} MB (${currentJob.format.toUpperCase()})`;
  $('#result').hidden = false;
  setupShare();

  say(`Finished. Your audio is ready, about ${Math.floor(secs / 60)} minutes ${secs % 60} seconds.`);
  ui();
  player.focus();
}

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
    say('Please sign in with Google or Email first.');
    $('#authCard').focus();
    return false;
  }
  if (!currentUser.emailVerified) {
    say('Please verify your email address to unlock your 3,000 characters/day allowance.');
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
  $<HTMLInputElement>('#audioTitle').value = '';
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

async function handleSelectedFile(f: File) {
  extracting = true;
  ui();
  say(`Reading ${f.name}…`);
  try {
    const { extractDocument } = await import('./doc-extract');
    const res = await extractDocument(f, cfg.cleanDocs);
    if (!res.text.trim()) {
      say(`No readable text was found inside ${f.name}. If this is a scanned image PDF, OCR is needed first.`);
      return;
    }
    const prevDocTitle = loadedDocTitle;
    loadedDocTitle = cleanDocBasename(f.name);
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
      statusEl.textContent = `Message sent! Your note has been delivered directly to the Voice Studio developer without leaving this page (Reference: ${refId}).`;
      statusEl.focus?.();
    } catch (err) {
      statusEl.textContent = '';
      const raw = err instanceof Error ? err.message : 'Could not send message right now.';
      if (raw.includes('"error":')) {
        errEl.textContent = 'Message could not be saved right now. Please check all fields and try again.';
      } else {
        errEl.textContent = raw;
      }
      if (nameEl.value.trim().length < 2) nameEl.focus();
      else if (!emailEl.value.includes('@')) emailEl.focus();
      else if (messageEl.value.trim().length < 10) messageEl.focus();
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
      'Try Voice Studio: free accessible PDF, EPUB & Word DOCX to MP3/WAV speech converter built for screen readers and bilingual notes.';
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

/* ---- Init ---- */
bindSettings();
bindContactForm();
bindPwaAndShare();
drawDict();
route(false);
ui();
