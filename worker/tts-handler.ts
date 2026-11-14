import { createRemoteJWKSet, jwtVerify } from 'jose';
import firebaseConfig from '../firebase-applet-config.json';
import {
  commitFirestoreUsage,
  getFirestoreWallet,
  type ServiceAccountCreds,
  type WalletSnapshot,
} from './firestore-admin';

export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface WorkerEnv {
  GEMINI_API_KEY?: string;
  DAILY_FREE_CHAR_LIMIT?: string;
  GLOBAL_DAILY_FREE_CHARS?: string;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  USAGE_KV?: KVLike;
}

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

const ALLOWED_MODELS = new Set([
  'gemini-3.8-flash-tts',
  'gemini-3.8-flash-lite-tts',
  'gemini-3.1-flash-tts-preview',
]);

const ALLOWED_VOICES = new Set(
  'Zephyr Puck Charon Kore Fenrir Leda Orus Aoede Callirrhoe Autonoe Enceladus Iapetus Umbriel Algieba Despina Erinome Algenib Rasalgethi Laomedeia Achernar Alnilam Schedar Gacrux Pulcherrima Achird Zubenelgenubi Vindemiatrix Sadachbia Sadaltager Sulafat'.split(
    ' '
  )
);

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models';

const memoryStore = new Map<string, string>();
const fallbackKV: KVLike = {
  async get(key) {
    return memoryStore.get(key) ?? null;
  },
  async put(key, value) {
    memoryStore.set(key, value);
  },
};

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
  const generationConfig: Record<string, unknown> = { responseModalities: ['AUDIO'] };
  let parts: Record<string, unknown>[];

  if (newerModel(model)) {
    const p: Record<string, unknown> = { text };
    if (cleanStyle) p.speech_metadata = { style: cleanStyle };
    parts = [p];
    generationConfig.speechConfig = { voiceConfig: { voice } };
  } else {
    parts = [{ text: cleanStyle ? `Say ${cleanStyle}:\n${text}` : text }];
    generationConfig.speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } };
  }
  return { contents: [{ role: 'user', parts }], generationConfig };
}

interface VerifiedUser {
  uid: string;
  email: string;
}

async function verifyFirebaseUser(request: Request): Promise<VerifiedUser | Response> {
  const authHeader = request.headers.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return json({ error: 'Please sign in first to generate audio.' }, 401);
  }

  try {
    const projectId = firebaseConfig.projectId;
    const { payload } = await jwtVerify(match[1], FIREBASE_JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });

    const uid = typeof payload.sub === 'string' ? payload.sub : '';
    const email = typeof payload.email === 'string' ? payload.email : '';
    const emailVerified = payload.email_verified === true;

    if (!uid || !email) {
      return json({ error: 'Invalid account token.' }, 401);
    }
    if (!emailVerified) {
      return json({ error: 'Please verify your email address before generating audio.' }, 403);
    }
    return { uid, email };
  } catch {
    return json({ error: 'Your sign-in session expired. Please sign in again.' }, 401);
  }
}

function parseServiceAccount(raw?: string): ServiceAccountCreds | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccountCreds>;
    if (parsed.client_email && parsed.private_key) {
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

async function loadQuotaState(user: VerifiedUser, env: WorkerEnv) {
  const kv = env.USAGE_KV || fallbackKV;
  const today = utcDateKey();
  const defaultDailyLimit = parseIntEnv(env.DAILY_FREE_CHAR_LIMIT, 3000);
  const globalCap = parseIntEnv(env.GLOBAL_DAILY_FREE_CHARS, 100000);
  const globalUsed = parseIntEnv((await kv.get(`global:${today}`)) || '0', 0);

  const creds = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  let wallet: WalletSnapshot;

  if (creds) {
    wallet = await getFirestoreWallet(
      creds,
      firebaseConfig.projectId,
      firebaseConfig.firestoreDatabaseId,
      user.uid,
      user.email,
      today,
      defaultDailyLimit
    );
  } else {
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
    creds,
    today,
    globalUsed,
    globalCap,
    globalRemaining,
    wallet,
    remainingDaily,
  };
}

export async function handleApiRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/api/health') {
    return json({ ok: true, service: 'voice-studio-worker' });
  }

  if (url.pathname === '/api/quota' && request.method === 'GET') {
    const userOrErr = await verifyFirebaseUser(request);
    if (userOrErr instanceof Response) return userOrErr;

    try {
      const state = await loadQuotaState(userOrErr, env);
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
        backendConfigured: Boolean(env.GEMINI_API_KEY),
      });
    } catch {
      return json({ error: 'Could not load your quota right now.' }, 500);
    }
  }

  if (url.pathname === '/api/tts' && request.method === 'POST') {
    const userOrErr = await verifyFirebaseUser(request);
    if (userOrErr instanceof Response) return userOrErr;

    if (!env.GEMINI_API_KEY) {
      return json(
        {
          error:
            'Server speech engine is not configured yet. Set GEMINI_API_KEY in Cloudflare Worker Secrets (or environment variables).',
        },
        503
      );
    }

    let body: { model?: string; voice?: string; style?: string; text?: string };
    try {
      body = (await request.json()) as { model?: string; voice?: string; style?: string; text?: string };
    } catch {
      return json({ error: 'Invalid JSON body.' }, 400);
    }

    const model = String(body.model || '');
    const voice = String(body.voice || '');
    const style = String(body.style || '');
    const text = String(body.text || '').trim();

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

    let state: Awaited<ReturnType<typeof loadQuotaState>>;
    try {
      state = await loadQuotaState(userOrErr, env);
    } catch {
      return json({ error: 'Could not verify your account quota.' }, 500);
    }

    const freeFromDaily = Math.min(state.remainingDaily, charCount);
    const paidNeeded = charCount - freeFromDaily;

    if (freeFromDaily > state.globalRemaining && state.wallet.paidCredits < charCount) {
      return json(
        {
          error:
            'Daily community free capacity has been reached for today. Add Pro Credits or try again tomorrow.',
          code: 'GLOBAL_CAP_REACHED',
        },
        429
      );
    }

    if (paidNeeded > state.wallet.paidCredits) {
      return json(
        {
          error: `Daily free limit (${state.wallet.dailyLimit.toLocaleString()} characters/day) reached. Remaining today: ${state.remainingDaily.toLocaleString()} chars, Paid credits: ${state.wallet.paidCredits.toLocaleString()} chars.`,
          code: 'QUOTA_EXCEEDED',
          quota: {
            dailyLimit: state.wallet.dailyLimit,
            dailyUsedChars: state.wallet.dailyUsedChars,
            remainingDaily: state.remainingDaily,
            paidCredits: state.wallet.paidCredits,
          },
        },
        429
      );
    }

    let geminiRes: Response;
    try {
      geminiRes = await fetch(`${GEMINI_API}/${model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY,
        },
        body: JSON.stringify(buildGeminiBody(model, voice, style, text)),
      });
    } catch {
      return json({ error: 'Could not reach Google speech servers. Please try again.' }, 502);
    }

    const geminiText = await geminiRes.text();
    if (!geminiRes.ok) {
      let upstreamMsg = 'Speech generation failed upstream.';
      try {
        const parsed = JSON.parse(geminiText) as { error?: { message?: string } };
        if (parsed.error?.message) upstreamMsg = parsed.error.message;
      } catch {
        // Ignore
      }
      const statusOut = geminiRes.status === 429 ? 429 : geminiRes.status >= 500 ? 502 : 400;
      return json({ error: upstreamMsg, code: `UPSTREAM_${geminiRes.status}` }, statusOut);
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
      return json({ error: 'No audio returned from speech model. Please try adjusting text or style.' }, 502);
    }

    // Commit quota and accounting only after audio succeeded
    const updatedWallet: WalletSnapshot = {
      ...state.wallet,
      dailyUsedChars: state.wallet.dailyUsedChars + freeFromDaily,
      paidCredits: state.wallet.paidCredits - paidNeeded,
      totalCharsUsed: state.wallet.totalCharsUsed + charCount,
    };

    try {
      if (freeFromDaily > 0) {
        await state.kv.put(`global:${state.today}`, String(state.globalUsed + freeFromDaily), {
          expirationTtl: 60 * 60 * 48,
        });
      }
      if (state.creds) {
        await commitFirestoreUsage(
          state.creds,
          firebaseConfig.projectId,
          firebaseConfig.firestoreDatabaseId,
          updatedWallet,
          charCount,
          paidNeeded,
          model
        );
      } else {
        await state.kv.put(`user:${userOrErr.uid}:${state.today}`, String(updatedWallet.dailyUsedChars), {
          expirationTtl: 60 * 60 * 48,
        });
      }
    } catch {
      // Do not fail delivering already-generated audio if telemetry commit had a transient issue
    }

    return json({
      audio: inlineAudio,
      quota: {
        dailyLimit: updatedWallet.dailyLimit,
        dailyUsedChars: updatedWallet.dailyUsedChars,
        remainingDaily: Math.max(0, updatedWallet.dailyLimit - updatedWallet.dailyUsedChars),
        paidCredits: updatedWallet.paidCredits,
        totalCharsUsed: updatedWallet.totalCharsUsed,
        plan: updatedWallet.plan,
      },
    });
  }

  return json({ error: 'Not found' }, 404);
}
