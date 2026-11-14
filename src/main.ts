import { onAuthStateChanged, type User } from 'firebase/auth';
import type { Unsubscribe } from 'firebase/firestore';
import { extractDocument } from './doc-extract';
import {
  adminGrantCredits,
  adminListWallets,
  auth,
  checkIsAdmin,
  ensureUserAndWallet,
  resendVerificationEmail,
  sendResetEmail,
  signInEmail,
  signInWithGoogle,
  signOutUser,
  signUpEmail,
  subscribeLedger,
  subscribeWallet,
  type LedgerEntryDoc,
  type UserWalletDoc,
} from './firebase';
import {
  MODELS,
  VOICES,
  applyDictionary,
  buildDialogueItems,
  chunks,
  encodeMp3Blob,
  estimateStats,
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

let dictRules: PronunciationRule[] = store.get<PronunciationRule[]>('vs.dict', []);
let job: GenerationJob | null = null;
let running = false;
let previewing = false;
let extracting = false;
let ctl: AbortController | null = null;
let audioUrl: string | null = null;
let lastBlob: Blob | null = null;
let lastName = '';

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

function makeFilename(ext: AudioFormat): string {
  const d = new Date();
  const z = (n: number) => String(n).padStart(2, '0');
  return `voice-studio-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}.${ext}`;
}

function say(msg: string) {
  $('#status').textContent = msg;
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
  if (msg.includes('auth/popup-closed-by-user')) return 'Google sign-in popup was closed.';
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

/* ---- Routing ---- */
const pages = ['tool', 'guides', 'about', 'contact', 'privacy', 'terms'];
function route(moveFocus: boolean) {
  const hash = location.hash.slice(1);
  const id = pages.includes(hash) ? hash : 'tool';
  pages.forEach((p) => {
    $('#' + p).hidden = p !== id;
  });
  document.querySelectorAll('.main-nav a').forEach((a) => {
    if (a.getAttribute('href') === '#' + id) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const section = $('#' + id);
  document.title = `${section.dataset.title || 'Voice Studio'} | Voice Studio`;
  if (moveFocus) {
    window.scrollTo(0, 0);
    $('#main').focus();
  }
}
window.addEventListener('hashchange', () => route(true));

/* ---- Account & Quota UI ---- */
function renderQuota(q: QuotaState) {
  activeQuota = q;
  $('#statDailyRemaining').textContent = `${q.remainingDaily.toLocaleString()} chars`;
  $('#statPaidCredits').textContent = `${q.paidCredits.toLocaleString()} chars`;
  $('#statTotalUsed').textContent = `${q.totalCharsUsed.toLocaleString()} chars`;
  const emailText = q.email || currentUser?.email || '';
  $('#userAccountMeta').textContent = emailText
    ? `${emailText} · ${q.dailyLimit.toLocaleString()} chars daily allowance`
    : `${q.dailyLimit.toLocaleString()} chars daily allowance`;

  const bar = $<HTMLProgressElement>('#dailyBar');
  bar.max = Math.max(1, q.dailyLimit);
  bar.value = Math.min(q.dailyLimit, q.dailyUsedChars);
  $('#dailyBarLabel').textContent =
    `Daily free allowance used: ${q.dailyUsedChars.toLocaleString()} of ${q.dailyLimit.toLocaleString()} characters`;

  const notice = $('#backendNotice');
  if (q.backendConfigured === false) {
    notice.hidden = false;
    notice.textContent =
      'Note: Server speech key (GEMINI_API_KEY) is not configured in environment variables yet.';
  } else {
    notice.hidden = true;
    notice.textContent = '';
  }

  updateCounts();
}

function renderWalletDoc(w: UserWalletDoc) {
  const today = new Date().toISOString().slice(0, 10);
  const usedToday = w.dailyDate === today ? w.dailyUsedChars : 0;
  const remainingDaily = Math.max(0, w.dailyLimit - usedToday);
  // Keep higher dailyUsedChars if KV tracked usage without Firestore Service Account
  const kvUsed = activeQuota ? activeQuota.dailyUsedChars : 0;
  const mergedUsed = Math.max(usedToday, kvUsed);
  const mergedRemaining = Math.max(0, w.dailyLimit - mergedUsed);

  renderQuota({
    uid: w.uid,
    email: w.email,
    dailyLimit: w.dailyLimit,
    dailyUsedChars: mergedUsed,
    remainingDaily: mergedRemaining || remainingDaily,
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
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/quota', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = (await res.json()) as QuotaState;
    renderQuota(data);
  } catch {
    // Ignore transient quota check failure
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
  const email = $<HTMLInputElement>('#authEmail').value.trim();
  const pass = $<HTMLInputElement>('#authPass').value;
  const name = $<HTMLInputElement>('#authName').value.trim();

  if (!email || !pass) {
    sayAuth('Enter your email and password.');
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

$('#headerAuthBtn').onclick = () => {
  if (currentUser) {
    void handleSignOut();
    return;
  }
  const onTool = location.hash === '#tool' || location.hash === '';
  if (!onTool) {
    location.hash = '#tool';
    setTimeout(() => $('#googleSignIn').focus(), 0);
  } else {
    $('#authCard').scrollIntoView({ block: 'nearest' });
    $('#googleSignIn').focus();
  }
};

async function handleAuthUser(user: User | null) {
  clearFirestoreListeners();
  currentUser = user;
  activeQuota = null;
  $('#adminCard').hidden = true;

  const headerUser = $('#headerUser');
  const headerAuthBtn = $('#headerAuthBtn');

  if (!user) {
    $('#authGate').hidden = false;
    $('#authVerifyBox').hidden = true;
    $('#converterWorkspace').hidden = true;
    headerUser.hidden = true;
    headerUser.textContent = '';
    headerAuthBtn.textContent = 'Sign in';
    updateCounts();
    return;
  }

  headerUser.hidden = false;
  headerUser.textContent = user.email || user.displayName || 'Account';
  headerAuthBtn.textContent = 'Sign out';

  if (!user.emailVerified) {
    $('#authGate').hidden = true;
    $('#authVerifyBox').hidden = false;
    $('#converterWorkspace').hidden = true;
    $('#verifyEmailText').textContent = user.email || 'your email';
    updateCounts();
    return;
  }

  $('#authGate').hidden = true;
  $('#authVerifyBox').hidden = true;
  $('#converterWorkspace').hidden = false;
  $('#userDisplay').textContent = user.displayName || user.email || 'Account';
  $('#userAccountMeta').textContent = user.email ? `${user.email} · 3,000 chars daily allowance` : '';

  try {
    await ensureUserAndWallet(user);
    walletUnsub = subscribeWallet(user.uid, (w) => {
      if (w) renderWalletDoc(w);
    });
    ledgerUnsub = subscribeLedger(user.uid, renderLedger);
  } catch {
    sayAuth('Could not sync Firestore wallet. Using server quota tracker.');
  }

  await fetchBackendQuota(user);

  const isAdmin = await checkIsAdmin(user);
  $('#adminCard').hidden = !isAdmin;
}

onAuthStateChanged(auth, (user) => {
  void handleAuthUser(user);
});

/* ---- Admin Panel ---- */
$('#adminLoadUsers').onclick = async () => {
  $('#adminMsg').textContent = 'Loading user wallets…';
  try {
    const wallets = await adminListWallets();
    const tbody = $('#adminUsersBody');
    tbody.innerHTML = '';
    for (const w of wallets) {
      const tr = document.createElement('tr');

      const tdEmail = document.createElement('td');
      tdEmail.textContent = w.email;
      const tdPlan = document.createElement('td');
      tdPlan.textContent = w.plan;
      const tdDaily = document.createElement('td');
      tdDaily.textContent = `${w.dailyUsedChars}/${w.dailyLimit}`;
      const tdPaid = document.createElement('td');
      tdPaid.textContent = w.paidCredits.toLocaleString();

      const tdAct = document.createElement('td');
      const selBtn = document.createElement('button');
      selBtn.type = 'button';
      selBtn.className = 'sec';
      selBtn.textContent = 'Select';
      selBtn.onclick = () => {
        $<HTMLInputElement>('#adminUid').value = w.uid;
        $<HTMLInputElement>('#adminDailyLimit').value = String(w.dailyLimit);
        $<HTMLSelectElement>('#adminPlan').value = w.plan;
        $('#adminMsg').textContent = `Selected ${w.email} (${w.uid}).`;
      };
      tdAct.appendChild(selBtn);

      tr.append(tdEmail, tdPlan, tdDaily, tdPaid, tdAct);
      tbody.appendChild(tr);
    }
    $('#adminTableWrap').hidden = false;
    $('#adminMsg').textContent = `Loaded ${wallets.length} user wallet(s).`;
  } catch (err) {
    $('#adminMsg').textContent = err instanceof Error ? err.message : 'Failed to load wallets.';
  }
};

$('#adminApply').onclick = async () => {
  const uid = $<HTMLInputElement>('#adminUid').value.trim();
  const addCredits = parseInt($<HTMLInputElement>('#adminAddCredits').value, 10) || 0;
  const dailyLimit = parseInt($<HTMLInputElement>('#adminDailyLimit').value, 10) || 3000;
  const plan = $<HTMLSelectElement>('#adminPlan').value === 'pro' ? 'pro' : 'free';
  const note = $<HTMLInputElement>('#adminNote').value;

  if (!uid) {
    $('#adminMsg').textContent = 'Select or paste a Target User UID first.';
    return;
  }
  $('#adminMsg').textContent = 'Updating wallet and writing ledger entry…';
  try {
    await adminGrantCredits(uid, addCredits, dailyLimit, plan, note);
    $('#adminMsg').textContent = `Updated ${uid} (${addCredits >= 0 ? '+' : ''}${addCredits.toLocaleString()} credits).`;
    if (uid === currentUser?.uid) {
      await fetchBackendQuota(currentUser);
    }
  } catch (err) {
    $('#adminMsg').textContent = err instanceof Error ? err.message : 'Update failed.';
  }
};

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

function syncOptionVisibility() {
  const isDialogue = cfg.mode === 'dialogue';
  $('#voiceBWrap').hidden = !isDialogue;
  $('#dialogueHint').hidden = !isDialogue;
  $('#sampleDialogue').hidden = !isDialogue;
  $('#voiceLabel').textContent = isDialogue ? 'Speaker A voice' : 'Voice';
  $('#mp3QualityWrap').hidden = cfg.format !== 'mp3';
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
  if (activeQuota) {
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

  const saveCfg = () => store.set('vs.cfg', cfg);

  $('#model').addEventListener('change', (e) => {
    cfg.model = (e.target as HTMLSelectElement).value;
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

  $('#text').addEventListener('input', updateCounts);
  syncOptionVisibility();
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
      drawDict();
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
    { find: 'JieShuo', replace: 'Jee Shwo', wholeWord: true, enabled: true },
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

async function callServerTts(
  model: string,
  voice: string,
  style: string,
  text: string,
  signal?: AbortSignal
): Promise<ServerTtsResult> {
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
  $<HTMLButtonElement>('#clear').disabled = busy;
  $<HTMLButtonElement>('#paste').disabled = busy;
  $<HTMLButtonElement>('#load').disabled = busy;
  $<HTMLButtonElement>('#sampleDialogue').disabled = busy;

  $<HTMLSelectElement>('#model').disabled = running;
  $<HTMLSelectElement>('#voice').disabled = running;
  $<HTMLSelectElement>('#voiceB').disabled = running;
  $<HTMLSelectElement>('#mode').disabled = running;
  $<HTMLInputElement>('#chunk').disabled = running;
  $<HTMLSelectElement>('#format').disabled = running;
  $<HTMLSelectElement>('#mp3Kbps').disabled = running;

  $('#cancel').hidden = !running;
  $('#resume').hidden = busy || !job || job.done >= job.items.length;
  $('#prog').hidden = !job;
}

function fail(m: string) {
  running = false;
  say(m + (job ? ` ${job.done} of ${job.items.length} parts are done. You can press Resume.` : ''));
  ui();
}

async function finishOutput(currentJob: GenerationJob) {
  const progEl = $<HTMLProgressElement>('#prog');
  let blob: Blob;

  if (currentJob.format === 'mp3') {
    say('Encoding MP3 audio… please wait.');
    progEl.value = 0;
    blob = await encodeMp3Blob(currentJob.parts, currentJob.rate, currentJob.sil, currentJob.mp3Kbps, (pct) => {
      progEl.value = pct;
    });
  } else {
    blob = wavBlob(currentJob.parts, currentJob.rate, currentJob.sil);
  }

  running = false;
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(blob);

  const player = $<HTMLAudioElement>('#player');
  player.src = audioUrl;
  player.playbackRate = cfg.speed;

  const dl = $<HTMLAnchorElement>('#dl');
  lastBlob = blob;
  lastName = makeFilename(currentJob.format);
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
        $<HTMLProgressElement>('#prog').value = pc;
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

$('#prev').onclick = async () => {
  if (!requireSignedInUser()) return;
  const raw = $<HTMLTextAreaElement>('#text').value.trim();
  if (!raw) {
    say('Type some text to preview first.');
    $('#text').focus();
    return;
  }

  const previewItems = prepareSpeechItems(safePreviewSlice(raw, 200), 200);
  const firstItem = previewItems[0];
  if (!firstItem) {
    say('There is nothing readable to preview.');
    return;
  }

  previewing = true;
  ui();
  say('Generating the preview…');

  const result = await callServerTts(cfg.model, firstItem.voice, cfg.style, firstItem.text);
  previewing = false;
  ui();

  if (result.kind !== 'ok') {
    say(`Preview failed: ${result.msg}`);
    return;
  }

  const o = toPcm(result.d);
  const u = URL.createObjectURL(wavBlob([o.pcm], o.rate, 0));
  const a = new Audio(u);
  a.playbackRate = cfg.speed;
  a.onended = () => URL.revokeObjectURL(u);
  a.onerror = () => URL.revokeObjectURL(u);
  a.play()
    .then(() => say('Playing the preview.'))
    .catch(() => say('The preview is ready, but your browser blocked playback.'));
};

/* ---- Text Helpers, Document Import & Drag/Drop ---- */
function setText(t: string) {
  const el = $<HTMLTextAreaElement>('#text');
  el.value = t;
  el.dispatchEvent(new Event('input'));
}

$('#clear').onclick = () => {
  setText('');
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
    setText(t);
    say(`Pasted ${[...t].length.toLocaleString()} characters.`);
  } catch {
    say('Your browser did not allow clipboard access. Paste with Ctrl+V instead.');
    $('#text').focus();
  }
};

$('#sampleDialogue').onclick = () => {
  setText(
    'Host: Welcome back to our study session. Today we are reviewing how long-form text-to-speech works.\n' +
      'Guest: Thanks for having me. Splitting text at natural sentence boundaries keeps the pacing smooth and easy to follow.\n' +
      'Host: Let us test two different Gemini voices in one audio file!'
  );
  say('Inserted a sample dialogue script. Edit it or press Generate audio.');
  $('#text').focus();
};

async function handleSelectedFile(f: File) {
  extracting = true;
  ui();
  say(`Reading ${f.name}…`);
  try {
    const res = await extractDocument(f, cfg.cleanDocs);
    if (!res.text.trim()) {
      say(`No readable text was found inside ${f.name}. If this is a scanned image PDF, OCR is needed first.`);
      return;
    }
    setText(res.text);
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

/* ---- Init ---- */
bindSettings();
drawDict();
route(false);
ui();
