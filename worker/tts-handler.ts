import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  addFirestoreLiveUsedSeconds,
  creditReferralBonus,
  getFirestoreGlobalUsed,
  getFirestoreLiveUsedSeconds,
  getFirestoreServerConfig,
  getFirestoreWallet,
  recordFirestoreLedgerEntry,
  refundFirestoreQuota,
  reserveFirestoreQuota,
  saveFirestoreServerConfig,
  type ServerRuntimeConfig,
  type ServiceAccountCreds,
  type WalletSnapshot,
} from './firestore-admin.js';

export const DAILY_LIVE_FREE_SECONDS = 600;
const GLOBAL_DAILY_LIVE_SECONDS = 120_000;

const FIREBASE_PROJECT_ID = 'voice-studio-b6bb1';
const FIRESTORE_DATABASE_ID = 'ai-studio-voicestudio-54f73766-0cc2-4833-94d7-e7ac9b2c2e3f';
const PRIMARY_ADMIN_UID = 'T2t9j7YD2JaTsichCnZkFlzxr6w1';
const PRIMARY_ADMIN_EMAIL = 'moutther580@gmail.com';
const ADMIN_CONFIG_KV_KEY = 'admin:runtime_config';
const SAFE_UID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const VERCEL_ID_RE = /^[a-zA-Z0-9_.-]{1,100}$/;
const VERCEL_HOOK_RE = /^https:\/\/api\.vercel\.com\/v1\/integrations\/deploy\/[a-zA-Z0-9_/-]+$/;
const BASE64_RE = /^[A-Za-z0-9+/=\r\n]+$/;
const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_STUDIO_MODES = new Set(['verbatim', 'narrated', 'summary', 'podcast']);

export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface WorkerEnv {
  GEMINI_API_KEY?: string;
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  GEMINI_KEY?: string;
  DAILY_FREE_CHAR_LIMIT?: string;
  DAILY_LIVE_FREE_SECONDS?: string;
  GLOBAL_DAILY_FREE_CHARS?: string;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  VERCEL_API_TOKEN?: string;
  VERCEL_PROJECT_ID?: string;
  VERCEL_TEAM_ID?: string;
  VERCEL_DEPLOY_HOOK_URL?: string;
  USAGE_KV?: KVLike;
}

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

const ALLOWED_MODELS = new Set([
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-pro-preview-tts',
  'gemini-3.8-flash-tts',
  'gemini-3.8-flash-lite-tts',
  'gemini-3.1-flash-tts-preview',
]);

function getFallbackModels(preferred: string): string[] {
  const order = [
    preferred,
    'gemini-3.1-flash-tts-preview',
    'gemini-2.5-flash-preview-tts',
    'gemini-3.8-flash-lite-tts',
    'gemini-3.8-flash-tts',
    'gemini-2.5-pro-preview-tts',
  ];
  return [...new Set(order.filter((id) => ALLOWED_MODELS.has(id)))];
}

const ALLOWED_VOICES = new Set(
  'Zephyr Puck Charon Kore Fenrir Leda Orus Aoede Callirrhoe Autonoe Enceladus Iapetus Umbriel Algieba Despina Erinome Algenib Rasalgethi Laomedeia Achernar Alnilam Schedar Gacrux Pulcherrima Achird Zubenelgenubi Vindemiatrix Sadachbia Sadaltager Sulafat'.split(
    ' '
  )
);

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models';

const memoryStore = new Map<string, { value: string; expiresAt: number }>();
const MAX_MEMORY_ENTRIES = 5000;

const fallbackKV: KVLike = {
  async get(key) {
    const entry = memoryStore.get(key);
    if (!entry) return null;
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      memoryStore.delete(key);
      return null;
    }
    return entry.value;
  },
  async put(key, value, options) {
    if (memoryStore.size >= MAX_MEMORY_ENTRIES) {
      const now = Date.now();
      for (const [k, v] of memoryStore.entries()) {
        if (v.expiresAt > 0 && now > v.expiresAt) memoryStore.delete(k);
        if (memoryStore.size < MAX_MEMORY_ENTRIES * 0.8) break;
      }
      if (memoryStore.size >= MAX_MEMORY_ENTRIES) {
        const oldestKey = memoryStore.keys().next().value;
        if (oldestKey) memoryStore.delete(oldestKey);
      }
    }
    const ttlMs = options?.expirationTtl && options.expirationTtl > 0 ? options.expirationTtl * 1000 : 0;
    memoryStore.set(key, {
      value,
      expiresAt: ttlMs > 0 ? Date.now() + ttlMs : 0,
    });
  },
};

const activeUserRequests = new Map<string, number>();

function acquireUserConcurrencySlot(uid: string, maxConcurrent = 2): boolean {
  const cur = activeUserRequests.get(uid) || 0;
  if (cur >= maxConcurrent) return false;
  activeUserRequests.set(uid, cur + 1);
  return true;
}

function releaseUserConcurrencySlot(uid: string): void {
  const cur = activeUserRequests.get(uid) || 0;
  if (cur <= 1) activeUserRequests.delete(uid);
  else activeUserRequests.set(uid, cur - 1);
}

function getClientIp(request: Request): string {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim().slice(0, 64);
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim().slice(0, 64);
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim().slice(0, 64);
  return 'unknown';
}

async function checkRateLimit(
  kv: KVLike,
  scopeKey: string,
  maxRequests: number,
  windowSeconds: number
): Promise<boolean> {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `rl:${scopeKey}:${bucket}`;
  const current = parseIntEnv((await kv.get(key)) || '0', 0);
  if (current >= maxRequests) {
    return false;
  }
  await kv.put(key, String(current + 1), { expirationTtl: windowSeconds * 2 });
  return true;
}

async function readJsonBody<T extends Record<string, unknown>>(
  request: Request,
  maxBytes: number
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  const contentLenHeader = request.headers.get('content-length');
  if (contentLenHeader) {
    const declaredLen = Number.parseInt(contentLenHeader, 10);
    if (Number.isFinite(declaredLen) && declaredLen > maxBytes) {
      return { ok: false, response: json({ error: 'Request payload too large.' }, 413) };
    }
  }

  let raw = '';
  try {
    raw = await request.text();
  } catch {
    return { ok: false, response: json({ error: 'Could not read request body.' }, 400) };
  }

  const byteLen = new TextEncoder().encode(raw).byteLength;
  if (byteLen > maxBytes) {
    return { ok: false, response: json({ error: 'Request payload too large.' }, 413) };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, response: json({ error: 'JSON body must be an object.' }, 400) };
    }
    return { ok: true, data: parsed as T };
  } catch {
    return { ok: false, response: json({ error: 'Invalid JSON body.' }, 400) };
  }
}

function strField(val: unknown): string {
  return typeof val === 'string' ? val : '';
}

function utcDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function parseIntEnv(val: string | undefined, fallback: number): number {
  const n = Number.parseInt(val || '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function newerModel(model: string): boolean {
  const m = String(model).match(/gemini-(\d+)\.(\d+)/);
  return !!m && (+m[1] > 3 || (+m[1] === 3 && +m[2] >= 8));
}

function buildGeminiBody(model: string, voice: string, style: string, text: string) {
  const cleanStyle = (style || '').trim().slice(0, 200);
  const voiceConfig = { prebuiltVoiceConfig: { voiceName: voice } };
  const generationConfig: Record<string, unknown> = {
    responseModalities: ['AUDIO'],
    speechConfig: { voiceConfig },
  };
  let parts: Record<string, unknown>[];

  if (newerModel(model)) {
    const p: Record<string, unknown> = { text };
    if (cleanStyle) p.speechMetadata = { style: cleanStyle };
    parts = [p];
  } else {
    const formatted = cleanStyle
      ? `Audio Profile: Speak in this delivery style only (never read these directions aloud): ${cleanStyle}\n\n#### TRANSCRIPT\n${text}`
      : text;
    parts = [{ text: formatted }];
  }
  return { contents: [{ role: 'user', parts }], generationConfig };
}

export interface VerifiedUser {
  uid: string;
  email: string;
}

export async function verifyFirebaseTokenString(
  rawToken: string
): Promise<{ ok: true; user: VerifiedUser } | { ok: false; status: number; error: string }> {
  const token = String(rawToken || '').trim();
  if (!token) {
    return { ok: false, status: 401, error: 'Please sign in first to start Live Teacher.' };
  }
  try {
    const { payload } = await jwtVerify(token, FIREBASE_JWKS, {
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      audience: FIREBASE_PROJECT_ID,
    });

    const uid = typeof payload.sub === 'string' ? payload.sub : '';
    const email = typeof payload.email === 'string' ? payload.email : '';
    const emailVerified = payload.email_verified === true;

    if (!uid || !SAFE_UID_RE.test(uid) || !email) {
      return { ok: false, status: 401, error: 'Invalid account token.' };
    }
    if (!emailVerified) {
      return { ok: false, status: 403, error: 'Please verify your email address before starting Live Teacher.' };
    }
    return { ok: true, user: { uid, email } };
  } catch {
    return { ok: false, status: 401, error: 'Your sign-in session expired. Please sign in again.' };
  }
}

async function verifyFirebaseUser(request: Request): Promise<VerifiedUser | Response> {
  const authHeader = request.headers.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return json({ error: 'Please sign in first to generate audio.' }, 401);
  }
  const verified = await verifyFirebaseTokenString(match[1]);
  if (!verified.ok) {
    return json({ error: verified.error }, verified.status);
  }
  return verified.user;
}

function parseServiceAccount(raw?: string): ServiceAccountCreds | null {
  if (!raw || !raw.trim()) return null;
  let candidate = raw.trim();
  if (candidate.startsWith("'") && candidate.endsWith("'")) {
    candidate = candidate.slice(1, -1);
  }
  try {
    let parsed = JSON.parse(candidate) as Partial<ServiceAccountCreds> | string;
    if (typeof parsed === 'string') {
      parsed = JSON.parse(parsed) as Partial<ServiceAccountCreds>;
    }
    if (parsed && typeof parsed === 'object' && parsed.client_email && parsed.private_key) {
      return {
        client_email: parsed.client_email,
        private_key: parsed.private_key,
        project_id: parsed.project_id,
      };
    }
  } catch {
    // Ignore malformed JSON
  }
  return null;
}

async function verifyPrimaryAdminUser(request: Request): Promise<VerifiedUser | Response> {
  const userOrErr = await verifyFirebaseUser(request);
  if (userOrErr instanceof Response) return userOrErr;
  if (
    userOrErr.uid !== PRIMARY_ADMIN_UID ||
    userOrErr.email.trim().toLowerCase() !== PRIMARY_ADMIN_EMAIL
  ) {
    return json({ error: 'Restricted to primary administrator.' }, 403);
  }
  return userOrErr;
}

export function cleanApiKeyCandidate(raw?: string): string {
  const k = String(raw || '').trim().replace(/^['"]+|['"]+$/g, '').trim();
  if (!k || k === 'MY_GEMINI_API_KEY' || k.startsWith('YOUR_') || k.length < 20) {
    return '';
  }
  return k;
}

function resolveEnvGeminiKey(env: WorkerEnv): string {
  return cleanApiKeyCandidate(
    env.GEMINI_API_KEY ||
      env.GOOGLE_GENERATIVE_AI_API_KEY ||
      env.GOOGLE_API_KEY ||
      env.GEMINI_KEY ||
      ''
  );
}

function maskSecretKey(raw: string): string {
  const k = cleanApiKeyCandidate(raw);
  if (!k) return '';
  if (k.length <= 10) return '••••';
  return `${k.slice(0, 6)}••••••${k.slice(-4)}`;
}

let cachedRuntimeConfig: ServerRuntimeConfig | null = null;
let cachedRuntimeFetchedAt = 0;
const RUNTIME_CACHE_TTL_MS = 30_000;

interface EffectiveRuntimeState {
  runtime: ServerRuntimeConfig;
  effectiveApiKey: string;
  envApiKey: string;
  keySource: 'admin' | 'env' | 'none';
  serviceAccountConfigured: boolean;
  kvConfigured: boolean;
  vercelEnvConfigured: boolean;
}

async function loadEffectiveRuntime(env: WorkerEnv, forceRefresh = false): Promise<EffectiveRuntimeState> {
  const envDailyLimit = parseIntEnv(env.DAILY_FREE_CHAR_LIMIT, 3000);
  const envGlobalCap = parseIntEnv(env.GLOBAL_DAILY_FREE_CHARS, 100000);
  const envApiKey = resolveEnvGeminiKey(env);
  const creds = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const kvConfigured = Boolean(env.USAGE_KV);
  const vercelEnvConfigured = Boolean(env.VERCEL_API_TOKEN && env.VERCEL_PROJECT_ID);

  const defaultRuntime: ServerRuntimeConfig = {
    id: 'runtime',
    geminiApiKey: '',
    dailyFreeCharLimit: envDailyLimit,
    globalDailyFreeChars: envGlobalCap,
    maintenanceMode: false,
    siteNotice: '',
    allowPdfStudio: true,
    allowPodcastStudio: true,
    updatedBy: '',
  };

  let runtime = cachedRuntimeConfig;
  const expired = Date.now() - cachedRuntimeFetchedAt > RUNTIME_CACHE_TTL_MS;

  if (!runtime || expired || forceRefresh) {
    let loaded: ServerRuntimeConfig | null = null;
    if (env.USAGE_KV) {
      try {
        const kvRaw = await env.USAGE_KV.get(ADMIN_CONFIG_KV_KEY);
        if (kvRaw) loaded = JSON.parse(kvRaw) as ServerRuntimeConfig;
      } catch {
        // Ignore KV parse error
      }
    }
    if (!loaded && creds) {
      try {
        loaded = await getFirestoreServerConfig(creds, FIREBASE_PROJECT_ID, FIRESTORE_DATABASE_ID);
      } catch (err) {
        console.warn('[voice-studio] Firestore serverConfig fetch skipped:', err);
      }
    }
    if (loaded) {
      runtime = {
        ...defaultRuntime,
        ...loaded,
        geminiApiKey: cleanApiKeyCandidate(loaded.geminiApiKey),
      };
      cachedRuntimeConfig = runtime;
      cachedRuntimeFetchedAt = Date.now();
    } else if (!cachedRuntimeConfig) {
      runtime = defaultRuntime;
      cachedRuntimeConfig = runtime;
      cachedRuntimeFetchedAt = Date.now();
    }
  }

  const activeRuntime = runtime || defaultRuntime;
  const adminKey = cleanApiKeyCandidate(activeRuntime.geminiApiKey);
  const effectiveApiKey = adminKey || envApiKey;
  const keySource: 'admin' | 'env' | 'none' = adminKey ? 'admin' : envApiKey ? 'env' : 'none';

  return {
    runtime: activeRuntime,
    effectiveApiKey,
    envApiKey,
    keySource,
    serviceAccountConfigured: Boolean(creds),
    kvConfigured,
    vercelEnvConfigured,
  };
}

async function loadQuotaState(user: VerifiedUser, env: WorkerEnv, effectiveState?: EffectiveRuntimeState) {
  const eff = effectiveState || (await loadEffectiveRuntime(env));
  const kv = env.USAGE_KV || fallbackKV;
  const today = utcDateKey();
  const defaultDailyLimit = eff.runtime.dailyFreeCharLimit;
  const globalCap = eff.runtime.globalDailyFreeChars;
  let globalUsed = parseIntEnv((await kv.get(`global:${today}`)) || '0', 0);

  const creds = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  let wallet: WalletSnapshot | null = null;
  let firestoreActive = false;

  if (creds) {
    try {
      const [fsWallet, fsGlobal] = await Promise.all([
        getFirestoreWallet(
          creds,
          FIREBASE_PROJECT_ID,
          FIRESTORE_DATABASE_ID,
          user.uid,
          user.email,
          today,
          defaultDailyLimit
        ),
        getFirestoreGlobalUsed(creds, FIREBASE_PROJECT_ID, FIRESTORE_DATABASE_ID, today),
      ]);
      wallet = fsWallet;
      globalUsed = Math.max(globalUsed, fsGlobal);
      firestoreActive = true;
    } catch (err) {
      console.warn('[voice-studio] Firestore wallet lookup fell back to KV:', err);
    }
  }

  if (!wallet) {
    const userUsed = parseIntEnv((await kv.get(`user:${user.uid}:${today}`)) || '0', 0);
    wallet = {
      uid: user.uid,
      email: user.email,
      paidCredits: 0,
      dailyUsedChars: userUsed,
      dailyDate: today,
      dailyLimit: defaultDailyLimit,
      totalCharsUsed: userUsed,
      plan: 'free',
    };
  }

  const remainingDaily = Math.max(0, wallet.dailyLimit - wallet.dailyUsedChars);
  const globalRemaining = Math.max(0, globalCap - globalUsed);

  return {
    kv,
    creds: firestoreActive ? creds : null,
    today,
    globalUsed,
    globalCap,
    globalRemaining,
    wallet,
    remainingDaily,
  };
}

interface QuotaReservation {
  kv: KVLike;
  creds: ServiceAccountCreds | null;
  today: string;
  wallet: WalletSnapshot;
  charsRequested: number;
  freeFromDaily: number;
  paidNeeded: number;
  globalRemaining: number;
}

async function reserveQuotaAndCredits(
  user: VerifiedUser,
  env: WorkerEnv,
  eff: EffectiveRuntimeState,
  charsRequested: number
): Promise<{ ok: true; reservation: QuotaReservation } | { ok: false; response: Response }> {
  const kv = env.USAGE_KV || fallbackKV;
  const today = utcDateKey();
  const defaultDailyLimit = eff.runtime.dailyFreeCharLimit;
  const globalCap = eff.runtime.globalDailyFreeChars;
  const creds = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON);

  if (creds) {
    try {
      const fsRes = await reserveFirestoreQuota({
        creds,
        projectId: FIREBASE_PROJECT_ID,
        databaseId: FIRESTORE_DATABASE_ID,
        uid: user.uid,
        email: user.email,
        todayStr: today,
        defaultDailyLimit,
        globalCap,
        charsRequested,
      });

      if (!fsRes.ok) {
        if (fsRes.code === 'GLOBAL_CAP_REACHED') {
          return {
            ok: false,
            response: json(
              {
                error: 'Daily shared free capacity has been reached for today. Please try again tomorrow.',
                code: 'GLOBAL_CAP_REACHED',
              },
              429
            ),
          };
        }
        return {
          ok: false,
          response: json(
            {
              error: `Daily free limit (${fsRes.wallet.dailyLimit.toLocaleString()} characters/day) reached. Remaining today: ${fsRes.remainingDaily.toLocaleString()} chars, Available credits: ${fsRes.wallet.paidCredits.toLocaleString()} chars.`,
              code: 'QUOTA_EXCEEDED',
              quota: {
                dailyLimit: fsRes.wallet.dailyLimit,
                dailyUsedChars: fsRes.wallet.dailyUsedChars,
                remainingDaily: fsRes.remainingDaily,
                paidCredits: fsRes.wallet.paidCredits,
              },
            },
            429
          ),
        };
      }

      if (fsRes.freeFromDaily > 0) {
        const curGlobal = parseIntEnv((await kv.get(`global:${today}`)) || '0', 0);
        await kv.put(`global:${today}`, String(curGlobal + fsRes.freeFromDaily), {
          expirationTtl: 60 * 60 * 48,
        });
      }

      return {
        ok: true,
        reservation: {
          kv,
          creds,
          today,
          wallet: fsRes.wallet,
          charsRequested,
          freeFromDaily: fsRes.freeFromDaily,
          paidNeeded: fsRes.paidNeeded,
          globalRemaining: fsRes.globalRemaining,
        },
      };
    } catch (err) {
      console.error('[voice-studio] Firestore quota reservation error:', err);
      return {
        ok: false,
        response: json({ error: 'Could not verify your account quota right now.' }, 503),
      };
    }
  }

  // Fallback KV reservation when FIREBASE_SERVICE_ACCOUNT_JSON is not set
  const state = await loadQuotaState(user, env, eff);
  const freeFromDaily = Math.min(state.remainingDaily, charsRequested);
  const paidNeeded = charsRequested - freeFromDaily;

  if (freeFromDaily > state.globalRemaining && state.wallet.paidCredits < charsRequested) {
    return {
      ok: false,
      response: json(
        {
          error: 'Daily shared free capacity has been reached for today. Please try again tomorrow.',
          code: 'GLOBAL_CAP_REACHED',
        },
        429
      ),
    };
  }

  if (paidNeeded > state.wallet.paidCredits) {
    return {
      ok: false,
      response: json(
        {
          error: `Daily free limit (${state.wallet.dailyLimit.toLocaleString()} characters/day) reached. Remaining today: ${state.remainingDaily.toLocaleString()} chars, Available credits: ${state.wallet.paidCredits.toLocaleString()} chars.`,
          code: 'QUOTA_EXCEEDED',
          quota: {
            dailyLimit: state.wallet.dailyLimit,
            dailyUsedChars: state.wallet.dailyUsedChars,
            remainingDaily: state.remainingDaily,
            paidCredits: state.wallet.paidCredits,
          },
        },
        429
      ),
    };
  }

  const updatedWallet: WalletSnapshot = {
    ...state.wallet,
    dailyUsedChars: state.wallet.dailyUsedChars + freeFromDaily,
    paidCredits: state.wallet.paidCredits - paidNeeded,
    totalCharsUsed: state.wallet.totalCharsUsed + charsRequested,
  };

  if (freeFromDaily > 0) {
    await kv.put(`global:${today}`, String(state.globalUsed + freeFromDaily), {
      expirationTtl: 60 * 60 * 48,
    });
  }
  await kv.put(`user:${user.uid}:${today}`, String(updatedWallet.dailyUsedChars), {
    expirationTtl: 60 * 60 * 48,
  });

  return {
    ok: true,
    reservation: {
      kv,
      creds: null,
      today,
      wallet: updatedWallet,
      charsRequested,
      freeFromDaily,
      paidNeeded,
      globalRemaining: Math.max(0, state.globalRemaining - freeFromDaily),
    },
  };
}

async function refundQuotaAndCredits(res: QuotaReservation): Promise<void> {
  try {
    if (res.freeFromDaily > 0) {
      const curGlobal = parseIntEnv((await res.kv.get(`global:${res.today}`)) || '0', 0);
      await res.kv.put(`global:${res.today}`, String(Math.max(0, curGlobal - res.freeFromDaily)), {
        expirationTtl: 60 * 60 * 48,
      });
    }
    if (res.creds) {
      await refundFirestoreQuota({
        creds: res.creds,
        projectId: FIREBASE_PROJECT_ID,
        databaseId: FIRESTORE_DATABASE_ID,
        uid: res.wallet.uid,
        todayStr: res.today,
        charsRequested: res.charsRequested,
        freeFromDaily: res.freeFromDaily,
        paidNeeded: res.paidNeeded,
      });
    } else {
      const curUser = parseIntEnv((await res.kv.get(`user:${res.wallet.uid}:${res.today}`)) || '0', 0);
      await res.kv.put(
        `user:${res.wallet.uid}:${res.today}`,
        String(Math.max(0, curUser - res.freeFromDaily)),
        { expirationTtl: 60 * 60 * 48 }
      );
    }
  } catch (err) {
    console.warn('[voice-studio] Quota refund failed:', err);
  }
}

function buildQuotaResponse(wallet: WalletSnapshot, globalRemaining?: number) {
  return {
    dailyLimit: wallet.dailyLimit,
    dailyUsedChars: wallet.dailyUsedChars,
    remainingDaily: Math.max(0, wallet.dailyLimit - wallet.dailyUsedChars),
    paidCredits: wallet.paidCredits,
    totalCharsUsed: wallet.totalCharsUsed,
    plan: wallet.plan,
    ...(typeof globalRemaining === 'number' ? { globalRemaining } : {}),
  };
}

const TEXT_MODELS = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'] as const;

async function synthesizeTtsWithFallback(
  apiKey: string,
  preferredModel: string,
  voice: string,
  style: string,
  text: string
): Promise<
  | { ok: true; audio: { data: string; mimeType?: string }; usedModel: string }
  | { ok: false; status: number; code: string; message: string }
> {
  const candidates = getFallbackModels(preferredModel);
  let geminiRes: Response | null = null;
  let geminiText = '';
  let usedModel = preferredModel;

  for (const candidateModel of candidates) {
    usedModel = candidateModel;
    try {
      geminiRes = await fetch(`${GEMINI_API}/${candidateModel}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
          'User-Agent': 'aistudio-build',
        },
        body: JSON.stringify(buildGeminiBody(candidateModel, voice, style, text)),
      });
    } catch {
      return {
        ok: false,
        status: 502,
        code: 'UPSTREAM_NETWORK',
        message: 'Could not reach Google speech servers. Please try again.',
      };
    }

    geminiText = await geminiRes.text();
    if (geminiRes.ok || geminiRes.status !== 404) {
      break;
    }
  }

  if (!geminiRes || !geminiRes.ok) {
    const upstreamStatus = geminiRes?.status || 502;
    let upstreamMsg = 'Speech generation failed upstream.';
    if (upstreamStatus < 500) {
      try {
        const parsed = JSON.parse(geminiText) as { error?: { message?: string } };
        if (parsed.error?.message) upstreamMsg = parsed.error.message.slice(0, 200);
      } catch {
        // Ignore
      }
    }
    const statusOut =
      upstreamStatus === 429
        ? 429
        : upstreamStatus === 404
          ? 404
          : upstreamStatus >= 500
            ? 502
            : 400;
    const code = upstreamStatus === 404 ? 'UPSTREAM_MODEL_404' : `UPSTREAM_${upstreamStatus}`;
    return { ok: false, status: statusOut, code, message: upstreamMsg };
  }

  let inlineAudio: { data: string; mimeType?: string } | undefined;
  try {
    const parsed = JSON.parse(geminiText) as {
      candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data: string; mimeType?: string } }> } }>;
    };
    const parts = parsed.candidates?.[0]?.content?.parts || [];
    inlineAudio = parts.map((p) => p.inlineData).find((d) => d && d.data);
  } catch {
    inlineAudio = undefined;
  }

  if (!inlineAudio) {
    return {
      ok: false,
      status: 502,
      code: 'NO_AUDIO',
      message: 'No audio returned from speech model. Please try adjusting text or style.',
    };
  }

  return { ok: true, audio: inlineAudio, usedModel };
}

async function generateStudioText(
  apiKey: string,
  systemInstruction: string,
  prompt: string
): Promise<{ ok: true; text: string; usedModel: string } | { ok: false; status: number; message: string }> {
  let res: Response | null = null;
  let raw = '';
  let usedModel = TEXT_MODELS[0] as string;

  for (const model of TEXT_MODELS) {
    usedModel = model;
    try {
      res = await fetch(`${GEMINI_API}/${model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
          'User-Agent': 'aistudio-build',
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        }),
      });
    } catch {
      return { ok: false, status: 502, message: 'Could not reach Google Gemini servers.' };
    }
    raw = await res.text();
    if (res.ok || res.status !== 404) break;
  }

  if (!res || !res.ok) {
    const statusCode = res?.status || 502;
    let msg = `AI script generation failed (${statusCode}).`;
    if (statusCode < 500) {
      try {
        const parsed = JSON.parse(raw) as { error?: { message?: string } };
        if (parsed.error?.message) msg = parsed.error.message.slice(0, 200);
      } catch {
        // Ignore
      }
    }
    return { ok: false, status: statusCode === 429 ? 429 : 502, message: msg };
  }

  try {
    const parsed = JSON.parse(raw) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = (parsed.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || '')
      .join('')
      .trim();
    if (!text) return { ok: false, status: 502, message: 'AI model returned an empty response.' };
    return { ok: true, text, usedModel };
  } catch {
    return { ok: false, status: 502, message: 'Could not parse AI script response.' };
  }
}

async function generateStudioStructured(
  apiKey: string,
  systemInstruction: string,
  parts: Array<Record<string, unknown>>,
  responseSchema: Record<string, unknown>
): Promise<{ ok: true; json: Record<string, unknown>; usedModel: string } | { ok: false; status: number; message: string }> {
  let res: Response | null = null;
  let raw = '';
  let usedModel = TEXT_MODELS[0] as string;

  for (const model of TEXT_MODELS) {
    usedModel = model;
    try {
      res = await fetch(`${GEMINI_API}/${model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
          'User-Agent': 'aistudio-build',
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: 'user', parts }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema,
          },
        }),
      });
    } catch {
      return { ok: false, status: 502, message: 'Could not reach Google Gemini servers.' };
    }
    raw = await res.text();
    if (res.ok || res.status !== 404) break;
  }

  if (!res || !res.ok) {
    const statusCode = res?.status || 502;
    let msg = `AI document analysis failed (${statusCode}).`;
    if (statusCode < 500) {
      try {
        const parsed = JSON.parse(raw) as { error?: { message?: string } };
        if (parsed.error?.message) msg = parsed.error.message.slice(0, 200);
      } catch {
        // Ignore
      }
    }
    return { ok: false, status: statusCode === 429 ? 429 : 502, message: msg };
  }

  try {
    const parsed = JSON.parse(raw) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const jsonText = (parsed.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || '')
      .join('')
      .trim();
    if (!jsonText) return { ok: false, status: 502, message: 'AI agent returned an empty plan.' };
    return { ok: true, json: JSON.parse(jsonText) as Record<string, unknown>, usedModel };
  } catch {
    return { ok: false, status: 502, message: 'Could not parse AI document agent JSON.' };
  }
}

export async function handleApiRequest(request: Request, env: WorkerEnv): Promise<Response> {
  try {
    return await routeApiRequest(request, env);
  } catch (err) {
    console.error('[voice-studio] Unhandled API error:', err);
    return json(
      { error: 'Speech server encountered an unexpected error. Please try again.', code: 'WORKER_UNHANDLED' },
      500
    );
  }
}

async function routeApiRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url, 'https://voice-studio.local');
  const kv = env.USAGE_KV || fallbackKV;
  const clientIp = getClientIp(request);
  const eff = await loadEffectiveRuntime(env);
  const apiKey = eff.effectiveApiKey;

  if (url.pathname === '/api/health') {
    const allowed = await checkRateLimit(kv, `health:ip:${clientIp}`, 90, 60);
    if (!allowed) {
      return json({ error: 'Too many requests. Please wait a moment.' }, 429);
    }
    return json({
      ok: true,
      service: 'voice-studio-worker',
      backendConfigured: Boolean(apiKey),
      dailyLimit: eff.runtime.dailyFreeCharLimit,
      dailyLiveFreeSeconds: parseIntEnv(env.DAILY_LIVE_FREE_SECONDS, DAILY_LIVE_FREE_SECONDS),
      maintenanceMode: eff.runtime.maintenanceMode,
      siteNotice: eff.runtime.siteNotice,
      allowPdfStudio: eff.runtime.allowPdfStudio,
      allowPodcastStudio: eff.runtime.allowPodcastStudio,
    });
  }

  if (url.pathname === '/api/live-quota' && request.method === 'GET') {
    const userOrErr = await verifyFirebaseUser(request);
    if (userOrErr instanceof Response) return userOrErr;
    const allowed = await checkRateLimit(kv, `liveq:${userOrErr.uid}`, 40, 60);
    if (!allowed) {
      return json({ error: 'Too many quota checks. Please wait a moment.' }, 429);
    }
    const snap = await getLiveQuotaSnapshot(userOrErr.uid, env);
    return json({
      ...snap,
      backendConfigured: Boolean(apiKey),
      maintenanceMode: eff.runtime.maintenanceMode,
    });
  }

  if (url.pathname === '/api/admin-config') {
    const adminOrErr = await verifyPrimaryAdminUser(request);
    if (adminOrErr instanceof Response) return adminOrErr;

    const allowed = await checkRateLimit(kv, `admin:${adminOrErr.uid}`, 60, 60);
    if (!allowed) {
      return json({ error: 'Too many admin requests. Please slow down.' }, 429);
    }

    if (request.method === 'GET') {
      const fresh = await loadEffectiveRuntime(env, true);
      return json({
        ok: true,
        backendConfigured: Boolean(fresh.effectiveApiKey),
        keySource: fresh.keySource,
        adminKeyMasked: maskSecretKey(fresh.runtime.geminiApiKey),
        envKeyMasked: maskSecretKey(fresh.envApiKey),
        dailyFreeCharLimit: fresh.runtime.dailyFreeCharLimit,
        globalDailyFreeChars: fresh.runtime.globalDailyFreeChars,
        maintenanceMode: fresh.runtime.maintenanceMode,
        siteNotice: fresh.runtime.siteNotice,
        allowPdfStudio: fresh.runtime.allowPdfStudio,
        allowPodcastStudio: fresh.runtime.allowPodcastStudio,
        serviceAccountConfigured: fresh.serviceAccountConfigured,
        kvConfigured: fresh.kvConfigured,
        vercelEnvConfigured: fresh.vercelEnvConfigured,
        updatedBy: fresh.runtime.updatedBy,
        updatedAt: fresh.runtime.updatedAt || null,
      });
    }

    if (request.method === 'POST') {
      const parsedBody = await readJsonBody<{
        action?: unknown;
        geminiApiKey?: unknown;
        clearApiKey?: unknown;
        dailyFreeCharLimit?: unknown;
        globalDailyFreeChars?: unknown;
        maintenanceMode?: unknown;
        siteNotice?: unknown;
        allowPdfStudio?: unknown;
        allowPodcastStudio?: unknown;
        vercelToken?: unknown;
        vercelProject?: unknown;
        vercelTeamId?: unknown;
        deployHookUrl?: unknown;
        persistVercelConnection?: unknown;
        pushToVercel?: unknown;
      }>(request, 65_536);
      if (!parsedBody.ok) return parsedBody.response;
      const body = parsedBody.data;

      const executeVercelPush = async (opts: {
        token: string;
        project: string;
        teamId: string;
        deployHookUrl: string;
        persistConnection: boolean;
        keyToPush: string;
        dailyFreeCharLimit: number;
        globalDailyFreeChars: number;
      }): Promise<{
        ok: boolean;
        error?: string;
        status?: number;
        redeployTriggered: boolean;
        connectionSavedToVercel: boolean;
      }> => {
        if (!VERCEL_ID_RE.test(opts.project)) {
          return {
            ok: false,
            error: 'Invalid Vercel Project ID or name format.',
            status: 400,
            redeployTriggered: false,
            connectionSavedToVercel: false,
          };
        }
        if (opts.teamId && !VERCEL_ID_RE.test(opts.teamId)) {
          return {
            ok: false,
            error: 'Invalid Vercel Team ID format.',
            status: 400,
            redeployTriggered: false,
            connectionSavedToVercel: false,
          };
        }
        if (opts.deployHookUrl && !VERCEL_HOOK_RE.test(opts.deployHookUrl)) {
          return {
            ok: false,
            error: 'Deploy Hook URL must start with https://api.vercel.com/v1/integrations/deploy/.',
            status: 400,
            redeployTriggered: false,
            connectionSavedToVercel: false,
          };
        }

        const teamQuery = opts.teamId ? `&teamId=${encodeURIComponent(opts.teamId)}` : '';
        const endpoint = `https://api.vercel.com/v10/projects/${encodeURIComponent(opts.project)}/env?upsert=true${teamQuery}`;
        const varsToPush: Array<{ key: string; value: string; type: 'encrypted' | 'plain' }> = [
          { key: 'GEMINI_API_KEY', value: opts.keyToPush, type: 'encrypted' },
          { key: 'DAILY_FREE_CHAR_LIMIT', value: String(opts.dailyFreeCharLimit), type: 'plain' },
          { key: 'GLOBAL_DAILY_FREE_CHARS', value: String(opts.globalDailyFreeChars), type: 'plain' },
        ];

        let connectionSavedToVercel = false;
        if (opts.persistConnection && opts.token && opts.project) {
          varsToPush.push(
            { key: 'VERCEL_API_TOKEN', value: opts.token, type: 'encrypted' },
            { key: 'VERCEL_PROJECT_ID', value: opts.project, type: 'plain' }
          );
          if (opts.teamId) {
            varsToPush.push({ key: 'VERCEL_TEAM_ID', value: opts.teamId, type: 'plain' });
          }
          if (opts.deployHookUrl) {
            varsToPush.push({ key: 'VERCEL_DEPLOY_HOOK_URL', value: opts.deployHookUrl, type: 'encrypted' });
          }
          connectionSavedToVercel = true;
        }

        for (const item of varsToPush) {
          const vRes = await fetch(endpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${opts.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              key: item.key,
              value: item.value,
              type: item.type,
              target: ['production', 'preview'],
            }),
          });
          if (!vRes.ok) {
            const vRaw = await vRes.text();
            let vErr = `Vercel API error (${vRes.status}) setting ${item.key}.`;
            try {
              const p = JSON.parse(vRaw) as { error?: { message?: string } };
              if (p.error?.message) vErr = p.error.message.slice(0, 200);
            } catch {
              // Ignore
            }
            return {
              ok: false,
              error: vErr,
              status: vRes.status >= 400 && vRes.status < 500 ? vRes.status : 502,
              redeployTriggered: false,
              connectionSavedToVercel: false,
            };
          }
        }

        let redeployTriggered = false;
        if (opts.deployHookUrl && VERCEL_HOOK_RE.test(opts.deployHookUrl)) {
          try {
            const hookRes = await fetch(opts.deployHookUrl, { method: 'POST' });
            redeployTriggered = hookRes.ok;
          } catch {
            redeployTriggered = false;
          }
        }

        if (!redeployTriggered) {
          try {
            const listUrl = `https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(opts.project)}&target=production&limit=1${teamQuery}`;
            const listRes = await fetch(listUrl, {
              headers: { Authorization: `Bearer ${opts.token}` },
            });
            if (listRes.ok) {
              const listData = (await listRes.json()) as {
                deployments?: Array<{ uid?: string; name?: string }>;
              };
              const latest = listData.deployments?.[0];
              if (latest?.uid && latest?.name) {
                const redeployRes = await fetch(`https://api.vercel.com/v13/deployments?forceNew=1${teamQuery}`, {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${opts.token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    name: latest.name,
                    project: opts.project,
                    deploymentId: latest.uid,
                    target: 'production',
                  }),
                });
                redeployTriggered = redeployRes.ok;
              }
            }
          } catch {
            redeployTriggered = false;
          }
        }

        return { ok: true, redeployTriggered, connectionSavedToVercel };
      };

      const action = strField(body.action);

      if (action === 'test_key') {
        const current = await loadEffectiveRuntime(env, true);
        const testKey = cleanApiKeyCandidate(strField(body.geminiApiKey)) || current.effectiveApiKey;
        if (!testKey) {
          return json({ ok: false, error: 'No Gemini API key entered or active to test.' }, 400);
        }
        const started = Date.now();
        try {
          const checkRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
            headers: { 'x-goog-api-key': testKey },
          });
          const latencyMs = Date.now() - started;
          const rawCheck = await checkRes.text();
          if (checkRes.ok) {
            return json({
              ok: true,
              latencyMs,
              maskedKey: maskSecretKey(testKey),
              message: `Gemini API key verified (${checkRes.status} OK in ${latencyMs} ms).`,
            });
          }
          let errMsg = `Gemini rejected key (${checkRes.status}).`;
          try {
            const parsed = JSON.parse(rawCheck) as { error?: { message?: string } };
            if (parsed.error?.message) errMsg = parsed.error.message.slice(0, 200);
          } catch {
            // Ignore
          }
          return json({ ok: false, status: checkRes.status, error: errMsg }, 400);
        } catch {
          return json({ ok: false, error: 'Could not reach Google Gemini API.' }, 502);
        }
      }

      if (action === 'push_vercel_env') {
        const current = await loadEffectiveRuntime(env, true);
        const suppliedToken = strField(body.vercelToken).trim();
        const suppliedProject = strField(body.vercelProject).trim();
        const token = suppliedToken || String(env.VERCEL_API_TOKEN || '').trim();
        const project = suppliedToken
          ? suppliedProject || String(env.VERCEL_PROJECT_ID || '').trim()
          : String(env.VERCEL_PROJECT_ID || suppliedProject).trim();
        const teamId = strField(body.vercelTeamId).trim() || String(env.VERCEL_TEAM_ID || '').trim();
        const deployHookUrl = strField(body.deployHookUrl).trim() || String(env.VERCEL_DEPLOY_HOOK_URL || '').trim();
        const keyToPush = cleanApiKeyCandidate(strField(body.geminiApiKey)) || current.effectiveApiKey;
        const dailyFreeCharLimit = Math.max(
          0,
          Math.min(1_000_000, Number(body.dailyFreeCharLimit ?? current.runtime.dailyFreeCharLimit) || 3000)
        );
        const globalDailyFreeChars = Math.max(
          0,
          Math.min(100_000_000, Number(body.globalDailyFreeChars ?? current.runtime.globalDailyFreeChars) || 100000)
        );

        if (!token || !project) {
          return json(
            {
              error:
                'Enter your Vercel Project ID/name and Vercel Access Token once below (after saving once, you never need to enter them again).',
            },
            400
          );
        }
        if (!keyToPush) {
          return json({ error: 'Enter a valid Gemini API key above before pushing to Vercel.' }, 400);
        }

        const pushed = await executeVercelPush({
          token,
          project,
          teamId,
          deployHookUrl,
          persistConnection: body.persistVercelConnection !== false && Boolean(suppliedToken && suppliedProject),
          keyToPush,
          dailyFreeCharLimit,
          globalDailyFreeChars,
        });

        if (!pushed.ok) {
          return json({ error: pushed.error || 'Vercel env push failed.' }, pushed.status || 502);
        }

        const updatedLive: ServerRuntimeConfig = {
          ...current.runtime,
          geminiApiKey: keyToPush,
          dailyFreeCharLimit,
          globalDailyFreeChars,
          updatedBy: adminOrErr.email,
          updatedAt: new Date().toISOString(),
        };
        cachedRuntimeConfig = updatedLive;
        cachedRuntimeFetchedAt = Date.now();
        if (env.USAGE_KV) {
          await env.USAGE_KV.put(ADMIN_CONFIG_KV_KEY, JSON.stringify(updatedLive)).catch(() => {});
        }
        const creds = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (creds) {
          await saveFirestoreServerConfig(creds, FIREBASE_PROJECT_ID, FIRESTORE_DATABASE_ID, updatedLive).catch(
            () => {}
          );
        }

        return json({
          ok: true,
          redeployTriggered: pushed.redeployTriggered,
          vercelEnvConfigured: Boolean(env.VERCEL_API_TOKEN && env.VERCEL_PROJECT_ID) || pushed.connectionSavedToVercel,
          maskedKey: maskSecretKey(keyToPush),
          message: pushed.redeployTriggered
            ? `Pushed GEMINI_API_KEY & limits to Vercel (${project}) and started a live production redeploy automatically.`
            : `Pushed GEMINI_API_KEY & limits to Vercel (${project}). Live key is active now.`,
        });
      }

      if (action === 'save_config') {
        const current = await loadEffectiveRuntime(env, true);
        let nextKey = current.runtime.geminiApiKey;
        if (body.clearApiKey === true) {
          nextKey = '';
        } else if (typeof body.geminiApiKey === 'string' && body.geminiApiKey !== '__KEEP__') {
          const cleaned = cleanApiKeyCandidate(body.geminiApiKey);
          if (body.geminiApiKey.trim().length > 0 && !cleaned) {
            return json({ error: 'API key looks invalid or incomplete (must be a valid Gemini key).' }, 400);
          }
          if (cleaned) nextKey = cleaned;
        }

        const nextConfig: ServerRuntimeConfig = {
          id: 'runtime',
          geminiApiKey: nextKey,
          dailyFreeCharLimit: Math.max(
            0,
            Math.min(1_000_000, Number(body.dailyFreeCharLimit ?? current.runtime.dailyFreeCharLimit) || 3000)
          ),
          globalDailyFreeChars: Math.max(
            0,
            Math.min(100_000_000, Number(body.globalDailyFreeChars ?? current.runtime.globalDailyFreeChars) || 100000)
          ),
          maintenanceMode: Boolean(body.maintenanceMode ?? current.runtime.maintenanceMode),
          siteNotice: strField(body.siteNotice ?? current.runtime.siteNotice).trim().slice(0, 400),
          allowPdfStudio: body.allowPdfStudio !== undefined ? Boolean(body.allowPdfStudio) : current.runtime.allowPdfStudio,
          allowPodcastStudio:
            body.allowPodcastStudio !== undefined ? Boolean(body.allowPodcastStudio) : current.runtime.allowPodcastStudio,
          updatedBy: adminOrErr.email,
          updatedAt: new Date().toISOString(),
        };

        cachedRuntimeConfig = nextConfig;
        cachedRuntimeFetchedAt = Date.now();
        let persistedToKv = false;
        let persistedToFirestore = false;

        if (env.USAGE_KV) {
          try {
            await env.USAGE_KV.put(ADMIN_CONFIG_KV_KEY, JSON.stringify(nextConfig));
            persistedToKv = true;
          } catch {
            persistedToKv = false;
          }
        }
        const creds = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (creds) {
          try {
            await saveFirestoreServerConfig(creds, FIREBASE_PROJECT_ID, FIRESTORE_DATABASE_ID, nextConfig);
            persistedToFirestore = true;
          } catch {
            persistedToFirestore = false;
          }
        }

        let vercelPushed = false;
        let redeployTriggered = false;
        let vercelError = '';
        let connectionSavedToVercel = false;

        const suppliedToken = strField(body.vercelToken).trim();
        const suppliedProject = strField(body.vercelProject).trim();
        const vToken = suppliedToken || String(env.VERCEL_API_TOKEN || '').trim();
        const vProject = suppliedToken
          ? suppliedProject || String(env.VERCEL_PROJECT_ID || '').trim()
          : String(env.VERCEL_PROJECT_ID || suppliedProject).trim();
        const vTeam = strField(body.vercelTeamId).trim() || String(env.VERCEL_TEAM_ID || '').trim();
        const vHook = strField(body.deployHookUrl).trim() || String(env.VERCEL_DEPLOY_HOOK_URL || '').trim();
        const keyToPushToVercel = nextConfig.geminiApiKey || resolveEnvGeminiKey(env);

        if (body.pushToVercel !== false && !body.clearApiKey && vToken && vProject && keyToPushToVercel) {
          const pushRes = await executeVercelPush({
            token: vToken,
            project: vProject,
            teamId: vTeam,
            deployHookUrl: vHook,
            persistConnection: body.persistVercelConnection !== false && Boolean(suppliedToken && suppliedProject),
            keyToPush: keyToPushToVercel,
            dailyFreeCharLimit: nextConfig.dailyFreeCharLimit,
            globalDailyFreeChars: nextConfig.globalDailyFreeChars,
          });
          if (pushRes.ok) {
            vercelPushed = true;
            redeployTriggered = pushRes.redeployTriggered;
            connectionSavedToVercel = pushRes.connectionSavedToVercel;
          } else {
            vercelError = pushRes.error || 'Could not sync env vars to Vercel.';
          }
        }

        const after = await loadEffectiveRuntime(env, false);
        return json({
          ok: true,
          persistedToKv,
          persistedToFirestore,
          vercelPushed,
          redeployTriggered,
          vercelError,
          vercelEnvConfigured: after.vercelEnvConfigured || connectionSavedToVercel,
          backendConfigured: Boolean(after.effectiveApiKey),
          keySource: after.keySource,
          adminKeyMasked: maskSecretKey(nextConfig.geminiApiKey),
          envKeyMasked: maskSecretKey(after.envApiKey),
          dailyFreeCharLimit: nextConfig.dailyFreeCharLimit,
          globalDailyFreeChars: nextConfig.globalDailyFreeChars,
          maintenanceMode: nextConfig.maintenanceMode,
          siteNotice: nextConfig.siteNotice,
          allowPdfStudio: nextConfig.allowPdfStudio,
          allowPodcastStudio: nextConfig.allowPodcastStudio,
        });
      }

      return json({ error: 'Unsupported admin config action.' }, 400);
    }

    return json({ error: 'Method not allowed.' }, 405);
  }

  if (url.pathname === '/api/quota' && request.method === 'GET') {
    const userOrErr = await verifyFirebaseUser(request);
    if (userOrErr instanceof Response) return userOrErr;

    const allowed = await checkRateLimit(kv, `quota:u:${userOrErr.uid}`, 60, 60);
    if (!allowed) {
      return json({ error: 'Too many quota checks. Please wait a moment.' }, 429);
    }

    try {
      const state = await loadQuotaState(userOrErr, env, eff);
      return json({
        uid: userOrErr.uid,
        email: userOrErr.email,
        dailyLimit: state.wallet.dailyLimit,
        dailyUsedChars: state.wallet.dailyUsedChars,
        remainingDaily: state.remainingDaily,
        paidCredits: state.wallet.paidCredits,
        totalCharsUsed: state.wallet.totalCharsUsed,
        plan: state.wallet.plan,
        globalRemaining: state.globalRemaining,
        backendConfigured: Boolean(apiKey),
      });
    } catch {
      return json({ error: 'Could not load your quota right now.' }, 500);
    }
  }

  if (url.pathname === '/api/tts' && request.method === 'POST') {
    const userOrErr = await verifyFirebaseUser(request);
    if (userOrErr instanceof Response) return userOrErr;

    if (eff.runtime.maintenanceMode && userOrErr.uid !== PRIMARY_ADMIN_UID) {
      return json(
        {
          error:
            eff.runtime.siteNotice ||
            'Shared speech generation is temporarily paused for maintenance. Please try again shortly or use your own Gemini API key in Step 1.',
          code: 'MAINTENANCE_MODE',
        },
        503
      );
    }

    if (!apiKey) {
      return json(
        {
          error:
            'Shared server speech engine is not configured on this server yet. Turn on Own Gemini API Key (Unlimited Mode) in Step 1 or add GEMINI_API_KEY in hosting environment variables.',
          code: 'BACKEND_KEY_MISSING',
        },
        503
      );
    }

    const [userRateOk, ipRateOk] = await Promise.all([
      checkRateLimit(kv, `tts:u:${userOrErr.uid}`, 25, 60),
      checkRateLimit(kv, `tts:ip:${clientIp}`, 40, 60),
    ]);
    if (!userRateOk || !ipRateOk) {
      return json({ error: 'Too many speech requests. Please wait a few seconds and try again.' }, 429);
    }

    const parsedBody = await readJsonBody<{
      model?: unknown;
      voice?: unknown;
      style?: unknown;
      text?: unknown;
    }>(request, 65_536);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.data;

    const model = strField(body.model);
    const voice = strField(body.voice);
    const style = strField(body.style).slice(0, 200);
    const text = strField(body.text).trim();

    if (!ALLOWED_MODELS.has(model)) {
      return json({ error: 'Unsupported speech model selected.' }, 400);
    }
    if (!ALLOWED_VOICES.has(voice)) {
      return json({ error: 'Unsupported voice selected.' }, 400);
    }
    if (!text) {
      return json({ error: 'Text cannot be empty.' }, 400);
    }

    const charCount = [...text].length;
    if (charCount > 3200) {
      return json({ error: 'Single request chunk exceeds maximum 3,200 characters.' }, 400);
    }

    if (!acquireUserConcurrencySlot(userOrErr.uid, 2)) {
      return json({ error: 'Please wait for your current speech request to finish before sending another.' }, 429);
    }

    try {
      const reserved = await reserveQuotaAndCredits(userOrErr, env, eff, charCount);
      if (!reserved.ok) return reserved.response;

      const synth = await synthesizeTtsWithFallback(apiKey, model, voice, style, text);
      if (!synth.ok) {
        await refundQuotaAndCredits(reserved.reservation);
        return json({ error: synth.message, code: synth.code }, synth.status);
      }

      if (reserved.reservation.creds) {
        await recordFirestoreLedgerEntry({
          creds: reserved.reservation.creds,
          projectId: FIREBASE_PROJECT_ID,
          databaseId: FIRESTORE_DATABASE_ID,
          uid: userOrErr.uid,
          charsUsed: charCount,
          creditsDeducted: reserved.reservation.paidNeeded,
          model: synth.usedModel,
        }).catch((err) => console.warn('[voice-studio] Ledger record skipped:', err));
      }

      return json({
        audio: synth.audio,
        usedModel: synth.usedModel,
        quota: buildQuotaResponse(reserved.reservation.wallet),
      });
    } finally {
      releaseUserConcurrencySlot(userOrErr.uid);
    }
  }

  if (url.pathname === '/api/studio' && request.method === 'POST') {
    const userOrErr = await verifyFirebaseUser(request);
    if (userOrErr instanceof Response) return userOrErr;

    if (eff.runtime.maintenanceMode && userOrErr.uid !== PRIMARY_ADMIN_UID) {
      return json(
        {
          error:
            eff.runtime.siteNotice ||
            'Shared AI studio tools are temporarily paused for maintenance. Try again shortly or use your own Gemini API key.',
          code: 'MAINTENANCE_MODE',
        },
        503
      );
    }

    if (!apiKey) {
      return json(
        {
          error:
            'Shared AI script generator is not configured on this server. Turn on Own Gemini API Key (Unlimited Mode) in Step 1 to run directly from your browser.',
          code: 'BACKEND_KEY_MISSING',
        },
        503
      );
    }

    const [userRateOk, ipRateOk] = await Promise.all([
      checkRateLimit(kv, `studio:u:${userOrErr.uid}`, 12, 60),
      checkRateLimit(kv, `studio:ip:${clientIp}`, 20, 60),
    ]);
    if (!userRateOk || !ipRateOk) {
      return json({ error: 'Too many AI studio requests. Please wait a minute and try again.' }, 429);
    }

    const parsedBody = await readJsonBody<{
      action?: unknown;
      topic?: unknown;
      length?: unknown;
      text?: unknown;
      targetLang?: unknown;
      indexText?: unknown;
      totalPages?: unknown;
      userPrompt?: unknown;
      outputMode?: unknown;
      rawExcerpt?: unknown;
      sectionTitle?: unknown;
      pdfBase64?: unknown;
      pageImages?: unknown;
    }>(request, 4_600_000);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.data;
    const action = strField(body.action);

    if (
      userOrErr.uid !== PRIMARY_ADMIN_UID &&
      (action === 'podcast' || action === 'translate') &&
      !eff.runtime.allowPodcastStudio
    ) {
      return json(
        {
          error: 'Podcast & Translator studio is temporarily paused by the administrator.',
          code: 'FEATURE_DISABLED',
        },
        403
      );
    }

    if (
      userOrErr.uid !== PRIMARY_ADMIN_UID &&
      (action === 'pdf_plan' || action === 'pdf_prepare' || action === 'pdf_multimodal') &&
      !eff.runtime.allowPdfStudio
    ) {
      return json(
        {
          error: 'AI PDF & Book Chapter studio is temporarily paused by the administrator.',
          code: 'FEATURE_DISABLED',
        },
        403
      );
    }

    if (!acquireUserConcurrencySlot(userOrErr.uid, 2)) {
      return json({ error: 'Please wait for your current AI studio request to complete.' }, 429);
    }

    try {
      if (action === 'podcast') {
        const topic = strField(body.topic).trim().slice(0, 6000);
        if (topic.length < 3) {
          return json({ error: 'Enter a topic or paste source text to turn into a podcast script.' }, 400);
        }
        const chargeChars = Math.max(250, Math.min(2000, Math.ceil([...topic].length / 2)));
        const reserved = await reserveQuotaAndCredits(userOrErr, env, eff, chargeChars);
        if (!reserved.ok) return reserved.response;

        const isMedium = body.length === 'medium';
        const sys =
          'You write natural two-speaker conversational podcast scripts for text-to-speech playback. Output ONLY lines prefixed with "Host: " or "Guest: ". Never use markdown formatting, asterisks, stage directions, sound effects, or explanations. Write in the same language as the user topic (English, Urdu, or natural bilingual phrasing). Keep every sentence crisp and clear for speech.';
        const prompt = isMedium
          ? `Write a conversational 8 to 10 turn podcast discussion between Host and Guest about:\n\n${topic}`
          : `Write a crisp 5 to 6 turn podcast discussion between Host and Guest about:\n\n${topic}`;

        const out = await generateStudioText(apiKey, sys, prompt);
        if (!out.ok) {
          await refundQuotaAndCredits(reserved.reservation);
          return json({ error: out.message }, out.status);
        }

        if (reserved.reservation.creds) {
          await recordFirestoreLedgerEntry({
            creds: reserved.reservation.creds,
            projectId: FIREBASE_PROJECT_ID,
            databaseId: FIRESTORE_DATABASE_ID,
            uid: userOrErr.uid,
            charsUsed: chargeChars,
            creditsDeducted: reserved.reservation.paidNeeded,
            model: out.usedModel,
            note: `Podcast studio script (${chargeChars} quota chars)`,
          }).catch(() => {});
        }

        return json({
          ok: true,
          script: out.text,
          mode: 'dialogue',
          usedModel: out.usedModel,
          quota: buildQuotaResponse(reserved.reservation.wallet),
        });
      }

      if (action === 'translate') {
        const text = strField(body.text).trim().slice(0, 8000);
        const targetLang = strField(body.targetLang || 'Urdu').trim().slice(0, 40) || 'Urdu';
        if (!text) {
          return json({ error: 'Enter or load text first before translating.' }, 400);
        }
        const chargeChars = Math.max(100, Math.min(3000, Math.ceil([...text].length / 2)));
        const reserved = await reserveQuotaAndCredits(userOrErr, env, eff, chargeChars);
        if (!reserved.ok) return reserved.response;

        const sys =
          'You translate and adapt scripts for natural human speech synthesis. Preserve any speaker labels like "Host:", "Guest:", "A:", or "B:" verbatim at the start of lines if present. Return ONLY the translated spoken text—no notes, no markdown headings or bullet asterisks.';
        const prompt = `Translate and naturally adapt the following text into ${targetLang} so it reads smoothly aloud:\n\n${text}`;
        const out = await generateStudioText(apiKey, sys, prompt);
        if (!out.ok) {
          await refundQuotaAndCredits(reserved.reservation);
          return json({ error: out.message }, out.status);
        }

        if (reserved.reservation.creds) {
          await recordFirestoreLedgerEntry({
            creds: reserved.reservation.creds,
            projectId: FIREBASE_PROJECT_ID,
            databaseId: FIRESTORE_DATABASE_ID,
            uid: userOrErr.uid,
            charsUsed: chargeChars,
            creditsDeducted: reserved.reservation.paidNeeded,
            model: out.usedModel,
            note: `Speech translator (${targetLang}, ${chargeChars} quota chars)`,
          }).catch(() => {});
        }

        return json({
          ok: true,
          script: out.text,
          usedModel: out.usedModel,
          quota: buildQuotaResponse(reserved.reservation.wallet),
        });
      }

      if (action === 'pdf_plan') {
        const indexText = strField(body.indexText).trim().slice(0, 12000);
        const userPrompt = strField(body.userPrompt).trim().slice(0, 500);
        const totalPages = Math.max(1, Math.min(2000, Number(body.totalPages) || 1));
        if (!indexText || !userPrompt) {
          return json({ error: 'Document index and extraction instruction are required.' }, 400);
        }
        const chargeChars = 150;
        const reserved = await reserveQuotaAndCredits(userOrErr, env, eff, chargeChars);
        if (!reserved.ok) return reserved.response;

        const sys =
          'You are a precision document-indexing agent. Given PDF bookmarks and page previews plus a user request (which may be in English, Urdu, or Roman Urdu), identify the exact 1-based startPage and endPage range (and optional extraPages) to extract for audio recording. Keep spans focused (typically 1-25 pages) covering what the user asked for.';
        const prompt = `Total pages: ${totalPages}\nUser request: "${userPrompt}"\n\nDocument Index:\n${indexText}`;
        const schema = {
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
        const out = await generateStudioStructured(apiKey, sys, [{ text: prompt }], schema);
        if (!out.ok) {
          await refundQuotaAndCredits(reserved.reservation);
          return json({ error: out.message }, out.status);
        }

        if (reserved.reservation.creds) {
          await recordFirestoreLedgerEntry({
            creds: reserved.reservation.creds,
            projectId: FIREBASE_PROJECT_ID,
            databaseId: FIRESTORE_DATABASE_ID,
            uid: userOrErr.uid,
            charsUsed: chargeChars,
            creditsDeducted: reserved.reservation.paidNeeded,
            model: out.usedModel,
            note: `PDF bookmark planner (${chargeChars} quota chars)`,
          }).catch(() => {});
        }

        return json({
          ok: true,
          plan: out.json,
          usedModel: out.usedModel,
          quota: buildQuotaResponse(reserved.reservation.wallet),
        });
      }

      if (action === 'pdf_prepare') {
        const rawExcerpt = strField(body.rawExcerpt).trim().slice(0, 18000);
        const userPrompt = strField(body.userPrompt).trim().slice(0, 500);
        const rawMode = strField(body.outputMode || 'narrated');
        const outputMode = ALLOWED_STUDIO_MODES.has(rawMode) ? rawMode : 'narrated';
        if (!rawExcerpt || !userPrompt) {
          return json({ error: 'Document excerpt and user instruction are required.' }, 400);
        }
        const chargeChars = Math.max(200, Math.min(3000, Math.ceil([...rawExcerpt].length / 5)));
        const reserved = await reserveQuotaAndCredits(userOrErr, env, eff, chargeChars);
        if (!reserved.ok) return reserved.response;

        const modeInstructions: Record<string, string> = {
          verbatim:
            'Extract strictly the matching sections verbatim, removing only page numbers, broken citations like [12], URLs, and table formatting.',
          narrated:
            'Extract what the user asked for and format it as clean, natural spoken lecture prose ready for text-to-speech. Turn noisy tables/bullets into smooth spoken sentences and omit URLs/footnotes/citations. Match the language requested by the user (or keep document language if unspecified).',
          summary:
            'Create a thorough, high-clarity study summary covering every key definition, formula intuition, and takeaway requested by the user, written strictly for natural spoken listening with zero markdown symbols.',
          podcast:
            'Convert the requested parts of the excerpt into a focused 2-speaker Host & Guest study discussion. Every line MUST start with "Host: " or "Guest: ". Zero markdown or asterisks.',
        };
        const sys = `${modeInstructions[outputMode] || modeInstructions.narrated} Never use markdown formatting (*, #, backticks) or stage directions. Return ONLY the clean spoken script.`;
        const prompt = `User instruction: ${userPrompt}\n\nDocument Excerpt:\n${rawExcerpt}`;
        const out = await generateStudioText(apiKey, sys, prompt);
        if (!out.ok) {
          await refundQuotaAndCredits(reserved.reservation);
          return json({ error: out.message }, out.status);
        }

        if (reserved.reservation.creds) {
          await recordFirestoreLedgerEntry({
            creds: reserved.reservation.creds,
            projectId: FIREBASE_PROJECT_ID,
            databaseId: FIRESTORE_DATABASE_ID,
            uid: userOrErr.uid,
            charsUsed: chargeChars,
            creditsDeducted: reserved.reservation.paidNeeded,
            model: out.usedModel,
            note: `PDF script adaptation (${outputMode}, ${chargeChars} quota chars)`,
          }).catch(() => {});
        }

        return json({
          ok: true,
          script: out.text,
          usedModel: out.usedModel,
          quota: buildQuotaResponse(reserved.reservation.wallet),
        });
      }

      if (action === 'pdf_multimodal') {
        const userPrompt = strField(body.userPrompt).trim().slice(0, 500);
        const rawMode = strField(body.outputMode || 'narrated');
        const outputMode = ALLOWED_STUDIO_MODES.has(rawMode) ? rawMode : 'narrated';
        if (!userPrompt) {
          return json({ error: 'Provide an instruction explaining what to extract and record.' }, 400);
        }

        const parts: Array<Record<string, unknown>> = [];
        const pdfB64 = strField(body.pdfBase64).trim();
        let chargeChars = 800;

        if (pdfB64) {
          if (pdfB64.length > 3_800_000 || !BASE64_RE.test(pdfB64)) {
            return json({ error: 'PDF payload exceeds server proxy limit or is invalid base64.' }, 400);
          }
          parts.push({ inlineData: { mimeType: 'application/pdf', data: pdfB64 } });
          chargeChars = 1000;
        } else if (Array.isArray(body.pageImages) && body.pageImages.length > 0) {
          let totalImageBytes = 0;
          for (const rawImg of body.pageImages.slice(0, 6)) {
            if (!rawImg || typeof rawImg !== 'object') continue;
            const img = rawImg as { mimeType?: unknown; data?: unknown };
            const imgMime = strField(img.mimeType || 'image/jpeg').trim().toLowerCase();
            const imgData = strField(img.data).trim();
            if (!ALLOWED_IMAGE_MIMES.has(imgMime)) {
              return json({ error: 'Unsupported page image MIME type.' }, 400);
            }
            if (!imgData || imgData.length > 1_200_000 || !BASE64_RE.test(imgData)) {
              return json({ error: 'Invalid or oversized page image payload.' }, 400);
            }
            totalImageBytes += imgData.length;
            if (totalImageBytes > 4_000_000) {
              return json({ error: 'Combined page images exceed server proxy limit.' }, 400);
            }
            parts.push({ inlineData: { mimeType: imgMime, data: imgData } });
          }
          if (!parts.length) {
            return json({ error: 'No valid page images provided.' }, 400);
          }
          chargeChars = Math.max(400, parts.length * 250);
        } else {
          return json({ error: 'No scanned PDF or page images provided.' }, 400);
        }

        const reserved = await reserveQuotaAndCredits(userOrErr, env, eff, chargeChars);
        if (!reserved.ok) return reserved.response;

        const styleRule =
          outputMode === 'podcast'
            ? 'Format script as alternating lines starting strictly with "Host: " or "Guest: ".'
            : 'Write script as clean, fluent spoken prose with zero markdown, asterisks, citations, or page numbers.';
        parts.push({
          text: `User request: "${userPrompt}". Mode: ${outputMode}. ${styleRule} Extract accurately from the attached document pages and return JSON with sectionTitle and script.`,
        });

        const schema = {
          type: 'OBJECT',
          properties: {
            sectionTitle: { type: 'STRING' },
            script: { type: 'STRING' },
          },
          required: ['sectionTitle', 'script'],
        };
        const out = await generateStudioStructured(
          apiKey,
          'You convert scanned PDF documents into clean, accurate spoken audio scripts without markdown or visual page artifacts.',
          parts,
          schema
        );
        if (!out.ok) {
          await refundQuotaAndCredits(reserved.reservation);
          return json({ error: out.message }, out.status);
        }

        if (reserved.reservation.creds) {
          await recordFirestoreLedgerEntry({
            creds: reserved.reservation.creds,
            projectId: FIREBASE_PROJECT_ID,
            databaseId: FIRESTORE_DATABASE_ID,
            uid: userOrErr.uid,
            charsUsed: chargeChars,
            creditsDeducted: reserved.reservation.paidNeeded,
            model: out.usedModel,
            note: `PDF vision extract (${chargeChars} quota chars)`,
          }).catch(() => {});
        }

        return json({
          ok: true,
          sectionTitle: String(out.json.sectionTitle || 'Scanned PDF Extract'),
          script: String(out.json.script || ''),
          usedModel: out.usedModel,
          quota: buildQuotaResponse(reserved.reservation.wallet),
        });
      }

      return json({ error: 'Unsupported studio action.' }, 400);
    } finally {
      releaseUserConcurrencySlot(userOrErr.uid);
    }
  }

  if (url.pathname === '/api/referral' && request.method === 'POST') {
    const userOrErr = await verifyFirebaseUser(request);
    if (userOrErr instanceof Response) return userOrErr;

    const [userRateOk, ipRateOk] = await Promise.all([
      checkRateLimit(kv, `ref:u:${userOrErr.uid}`, 5, 60),
      checkRateLimit(kv, `ref:ip:${clientIp}`, 15, 60),
    ]);
    if (!userRateOk || !ipRateOk) {
      return json({ error: 'Too many referral requests. Please wait a minute.' }, 429);
    }

    const parsedBody = await readJsonBody<{ referrerUid?: unknown }>(request, 4096);
    if (!parsedBody.ok) return parsedBody.response;

    const referrerUid = strField(parsedBody.data.referrerUid).trim();
    if (!/^[a-zA-Z0-9_-]{6,128}$/.test(referrerUid) || referrerUid === userOrErr.uid) {
      return json({ error: 'Invalid referral code.' }, 400);
    }

    const creds = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (!creds) {
      return json({ ok: true, credited: false, pending: true });
    }

    try {
      const res = await creditReferralBonus(
        creds,
        FIREBASE_PROJECT_ID,
        FIRESTORE_DATABASE_ID,
        userOrErr.uid,
        referrerUid,
        2000,
        userOrErr.email
      );
      return json({ ok: true, ...res });
    } catch {
      return json({ ok: true, credited: false, pending: true });
    }
  }

  return json({ error: 'Not found' }, 404);
}

export interface LiveQuotaSnapshot {
  uid: string;
  date: string;
  usedSeconds: number;
  limitSeconds: number;
  remainingSeconds: number;
  globalUsedSeconds: number;
  globalCapSeconds: number;
}

export interface LiveWorkerEnv extends WorkerEnv {
  DAILY_LIVE_FREE_SECONDS?: string;
}

export async function resolveLiveBackendState(env: LiveWorkerEnv) {
  const eff = await loadEffectiveRuntime(env);
  return {
    effectiveApiKey: eff.effectiveApiKey,
    maintenanceMode: eff.runtime.maintenanceMode,
    limitSeconds: parseIntEnv(env.DAILY_LIVE_FREE_SECONDS, DAILY_LIVE_FREE_SECONDS),
  };
}

export async function getLiveQuotaSnapshot(uid: string, env: LiveWorkerEnv): Promise<LiveQuotaSnapshot> {
  const kv = env.USAGE_KV || fallbackKV;
  const today = utcDateKey();
  const limitSeconds = parseIntEnv(env.DAILY_LIVE_FREE_SECONDS, DAILY_LIVE_FREE_SECONDS);
  let usedSeconds = parseIntEnv((await kv.get(`live:u:${uid}:${today}`)) || '0', 0);
  const globalUsedSeconds = parseIntEnv((await kv.get(`live:g:${today}`)) || '0', 0);
  const creds = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (creds) {
    try {
      const fsUsed = await getFirestoreLiveUsedSeconds(
        creds,
        FIREBASE_PROJECT_ID,
        FIRESTORE_DATABASE_ID,
        uid,
        today
      );
      usedSeconds = Math.max(usedSeconds, fsUsed);
    } catch (err) {
      console.warn('[voice-studio] Live quota Firestore check fell back to KV:', err);
    }
  }
  const remainingSeconds = Math.max(0, limitSeconds - usedSeconds);
  return {
    uid,
    date: today,
    usedSeconds,
    limitSeconds,
    remainingSeconds,
    globalUsedSeconds,
    globalCapSeconds: GLOBAL_DAILY_LIVE_SECONDS,
  };
}

export async function incrementLiveUsedSeconds(
  uid: string,
  env: LiveWorkerEnv,
  deltaSeconds: number
): Promise<LiveQuotaSnapshot> {
  const kv = env.USAGE_KV || fallbackKV;
  const today = utcDateKey();
  const cleanDelta = Math.max(1, Math.min(120, Math.floor(deltaSeconds)));
  const limitSeconds = parseIntEnv(env.DAILY_LIVE_FREE_SECONDS, DAILY_LIVE_FREE_SECONDS);

  const curUser = parseIntEnv((await kv.get(`live:u:${uid}:${today}`)) || '0', 0);
  const nextUserKv = curUser + cleanDelta;
  await kv.put(`live:u:${uid}:${today}`, String(nextUserKv), { expirationTtl: 172_800 });

  const curGlobal = parseIntEnv((await kv.get(`live:g:${today}`)) || '0', 0);
  const nextGlobal = curGlobal + cleanDelta;
  await kv.put(`live:g:${today}`, String(nextGlobal), { expirationTtl: 172_800 });

  let usedSeconds = nextUserKv;
  const creds = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (creds) {
    try {
      const fsUsed = await addFirestoreLiveUsedSeconds(
        creds,
        FIREBASE_PROJECT_ID,
        FIRESTORE_DATABASE_ID,
        uid,
        today,
        cleanDelta
      );
      usedSeconds = Math.max(usedSeconds, fsUsed);
    } catch (err) {
      console.warn('[voice-studio] Live quota Firestore write fell back to KV:', err);
    }
  }

  return {
    uid,
    date: today,
    usedSeconds,
    limitSeconds,
    remainingSeconds: Math.max(0, limitSeconds - usedSeconds),
    globalUsedSeconds: nextGlobal,
    globalCapSeconds: GLOBAL_DAILY_LIVE_SECONDS,
  };
}

