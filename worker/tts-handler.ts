import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  commitFirestoreUsage,
  creditReferralBonus,
  getFirestoreWallet,
  type ServiceAccountCreds,
  type WalletSnapshot,
} from './firestore-admin.js';

const FIREBASE_PROJECT_ID = 'voice-studio-b6bb1';
const FIRESTORE_DATABASE_ID = 'ai-studio-voicestudio-54f73766-0cc2-4833-94d7-e7ac9b2c2e3f';

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
  GLOBAL_DAILY_FREE_CHARS?: string;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
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
    const { payload } = await jwtVerify(match[1], FIREBASE_JWKS, {
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      audience: FIREBASE_PROJECT_ID,
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

async function loadQuotaState(user: VerifiedUser, env: WorkerEnv) {
  const kv = env.USAGE_KV || fallbackKV;
  const today = utcDateKey();
  const defaultDailyLimit = parseIntEnv(env.DAILY_FREE_CHAR_LIMIT, 3000);
  const globalCap = parseIntEnv(env.GLOBAL_DAILY_FREE_CHARS, 100000);
  const globalUsed = parseIntEnv((await kv.get(`global:${today}`)) || '0', 0);

  const creds = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  let wallet: WalletSnapshot | null = null;
  let firestoreActive = false;

  if (creds) {
    try {
      wallet = await getFirestoreWallet(
        creds,
        FIREBASE_PROJECT_ID,
        FIRESTORE_DATABASE_ID,
        user.uid,
        user.email,
        today,
        defaultDailyLimit
      );
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

function resolveGeminiKey(env: WorkerEnv): string {
  const raw =
    env.GEMINI_API_KEY ||
    env.GOOGLE_GENERATIVE_AI_API_KEY ||
    env.GOOGLE_API_KEY ||
    env.GEMINI_KEY ||
    '';
  const k = raw.trim().replace(/^['"]+|['"]+$/g, '').trim();
  if (!k || k === 'MY_GEMINI_API_KEY' || k.startsWith('YOUR_') || k.length < 20) {
    return '';
  }
  return k;
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
    let upstreamMsg = 'Speech generation failed upstream.';
    try {
      const parsed = JSON.parse(geminiText) as { error?: { message?: string } };
      if (parsed.error?.message) upstreamMsg = parsed.error.message;
    } catch {
      // Ignore
    }
    const upstreamStatus = geminiRes?.status || 502;
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
    let msg = `AI script generation failed (${res?.status || 502}).`;
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string } };
      if (parsed.error?.message) msg = parsed.error.message;
    } catch {
      // Ignore
    }
    return { ok: false, status: res?.status === 429 ? 429 : 502, message: msg };
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
    let msg = `AI document analysis failed (${res?.status || 502}).`;
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string } };
      if (parsed.error?.message) msg = parsed.error.message;
    } catch {
      // Ignore
    }
    return { ok: false, status: res?.status === 429 ? 429 : 502, message: msg };
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
    const message = err instanceof Error ? err.message : 'Unexpected speech worker error.';
    return json({ error: `Speech server error: ${message}`, code: 'WORKER_UNHANDLED' }, 500);
  }
}

async function routeApiRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url, 'https://voice-studio.local');
  const apiKey = resolveGeminiKey(env);

  if (url.pathname === '/api/health') {
    return json({
      ok: true,
      service: 'voice-studio-worker',
      backendConfigured: Boolean(apiKey),
      dailyLimit: parseIntEnv(env.DAILY_FREE_CHAR_LIMIT, 3000),
    });
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
        backendConfigured: Boolean(apiKey),
      });
    } catch {
      return json({ error: 'Could not load your quota right now.' }, 500);
    }
  }

  if (url.pathname === '/api/tts' && request.method === 'POST') {
    const userOrErr = await verifyFirebaseUser(request);
    if (userOrErr instanceof Response) return userOrErr;

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
            'Daily shared free capacity has been reached for today. Please try again tomorrow.',
          code: 'GLOBAL_CAP_REACHED',
        },
        429
      );
    }

    if (paidNeeded > state.wallet.paidCredits) {
      return json(
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
      );
    }

    const synth = await synthesizeTtsWithFallback(apiKey, model, voice, style, text);
    if (!synth.ok) {
      return json({ error: synth.message, code: synth.code }, synth.status);
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
          FIREBASE_PROJECT_ID,
          FIRESTORE_DATABASE_ID,
          updatedWallet,
          charCount,
          paidNeeded,
          synth.usedModel
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
      audio: synth.audio,
      usedModel: synth.usedModel,
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

  if (url.pathname === '/api/studio' && request.method === 'POST') {
    const userOrErr = await verifyFirebaseUser(request);
    if (userOrErr instanceof Response) return userOrErr;

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

    let body: {
      action?: string;
      topic?: string;
      length?: string;
      text?: string;
      targetLang?: string;
      indexText?: string;
      totalPages?: number;
      userPrompt?: string;
      outputMode?: string;
      rawExcerpt?: string;
      sectionTitle?: string;
      pdfBase64?: string;
      pageImages?: Array<{ mimeType?: string; data?: string }>;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: 'Invalid JSON body.' }, 400);
    }

    if (body.action === 'podcast') {
      const topic = String(body.topic || '').trim().slice(0, 6000);
      if (topic.length < 3) {
        return json({ error: 'Enter a topic or paste source text to turn into a podcast script.' }, 400);
      }
      const isMedium = body.length === 'medium';
      const sys =
        'You write natural two-speaker conversational podcast scripts for text-to-speech playback. Output ONLY lines prefixed with "Host: " or "Guest: ". Never use markdown formatting, asterisks, stage directions, sound effects, or explanations. Write in the same language as the user topic (English, Urdu, or natural bilingual phrasing). Keep every sentence crisp and clear for speech.';
      const prompt = isMedium
        ? `Write an engaging 8 to 10 turn podcast discussion between Host and Guest about:\n\n${topic}`
        : `Write a crisp 5 to 6 turn podcast discussion between Host and Guest about:\n\n${topic}`;

      const out = await generateStudioText(apiKey, sys, prompt);
      if (!out.ok) return json({ error: out.message }, out.status);
      return json({ ok: true, script: out.text, mode: 'dialogue', usedModel: out.usedModel });
    }

    if (body.action === 'translate') {
      const text = String(body.text || '').trim().slice(0, 8000);
      const targetLang = String(body.targetLang || 'Urdu').trim().slice(0, 40);
      if (!text) {
        return json({ error: 'Enter or load text first before translating.' }, 400);
      }
      const sys =
        'You translate and adapt scripts for natural human speech synthesis. Preserve any speaker labels like "Host:", "Guest:", "A:", or "B:" verbatim at the start of lines if present. Return ONLY the translated spoken text—no notes, no markdown headings or bullet asterisks.';
      const prompt = `Translate and naturally adapt the following text into ${targetLang} so it reads smoothly aloud:\n\n${text}`;
      const out = await generateStudioText(apiKey, sys, prompt);
      if (!out.ok) return json({ error: out.message }, out.status);
      return json({ ok: true, script: out.text, usedModel: out.usedModel });
    }

    if (body.action === 'pdf_plan') {
      const indexText = String(body.indexText || '').trim().slice(0, 12000);
      const userPrompt = String(body.userPrompt || '').trim().slice(0, 500);
      const totalPages = Math.max(1, Math.min(2000, Number(body.totalPages) || 1));
      if (!indexText || !userPrompt) {
        return json({ error: 'Document index and extraction instruction are required.' }, 400);
      }
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
      if (!out.ok) return json({ error: out.message }, out.status);
      return json({ ok: true, plan: out.json, usedModel: out.usedModel });
    }

    if (body.action === 'pdf_prepare') {
      const rawExcerpt = String(body.rawExcerpt || '').trim().slice(0, 18000);
      const userPrompt = String(body.userPrompt || '').trim().slice(0, 500);
      const outputMode = String(body.outputMode || 'narrated');
      if (!rawExcerpt || !userPrompt) {
        return json({ error: 'Document excerpt and user instruction are required.' }, 400);
      }
      const modeInstructions: Record<string, string> = {
        verbatim:
          'Extract strictly the matching sections verbatim, removing only page numbers, broken citations like [12], URLs, and table formatting.',
        narrated:
          'Extract what the user asked for and format it as clean, natural spoken lecture prose ready for text-to-speech. Turn noisy tables/bullets into smooth spoken sentences and omit URLs/footnotes/citations. Match the language requested by the user (or keep document language if unspecified).',
        summary:
          'Create a thorough, high-clarity study summary covering every key definition, formula intuition, and takeaway requested by the user, written strictly for natural spoken listening with zero markdown symbols.',
        podcast:
          'Convert the requested parts of the excerpt into an engaging 2-speaker Host & Guest study discussion. Every line MUST start with "Host: " or "Guest: ". Zero markdown or asterisks.',
      };
      const sys = `${modeInstructions[outputMode] || modeInstructions.narrated} Never use markdown formatting (*, #, backticks) or stage directions. Return ONLY the clean spoken script.`;
      const prompt = `User instruction: ${userPrompt}\n\nDocument Excerpt:\n${rawExcerpt}`;
      const out = await generateStudioText(apiKey, sys, prompt);
      if (!out.ok) return json({ error: out.message }, out.status);
      return json({ ok: true, script: out.text, usedModel: out.usedModel });
    }

    if (body.action === 'pdf_multimodal') {
      const userPrompt = String(body.userPrompt || '').trim().slice(0, 500);
      const outputMode = String(body.outputMode || 'narrated');
      if (!userPrompt) {
        return json({ error: 'Provide an instruction explaining what to extract and record.' }, 400);
      }

      const parts: Array<Record<string, unknown>> = [];
      const pdfB64 = typeof body.pdfBase64 === 'string' ? body.pdfBase64.trim() : '';
      if (pdfB64) {
        if (pdfB64.length > 4_000_000) {
          return json({ error: 'PDF payload exceeds server proxy limit. Enable BYOK or specify page numbers.' }, 400);
        }
        parts.push({ inlineData: { mimeType: 'application/pdf', data: pdfB64 } });
      } else if (Array.isArray(body.pageImages) && body.pageImages.length > 0) {
        for (const img of body.pageImages.slice(0, 6)) {
          if (img?.data) {
            parts.push({ inlineData: { mimeType: img.mimeType || 'image/jpeg', data: String(img.data) } });
          }
        }
      } else {
        return json({ error: 'No scanned PDF or page images provided.' }, 400);
      }

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
      if (!out.ok) return json({ error: out.message }, out.status);
      return json({
        ok: true,
        sectionTitle: String(out.json.sectionTitle || 'Scanned PDF Extract'),
        script: String(out.json.script || ''),
        usedModel: out.usedModel,
      });
    }

    return json({ error: 'Unsupported studio action.' }, 400);
  }

  if (url.pathname === '/api/referral' && request.method === 'POST') {
    const userOrErr = await verifyFirebaseUser(request);
    if (userOrErr instanceof Response) return userOrErr;

    let body: { referrerUid?: string };
    try {
      body = (await request.json()) as { referrerUid?: string };
    } catch {
      return json({ error: 'Invalid JSON body.' }, 400);
    }

    const referrerUid = String(body.referrerUid || '').trim();
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
        2000
      );
      return json({ ok: true, ...res });
    } catch {
      return json({ ok: true, credited: false, pending: true });
    }
  }

  return json({ error: 'Not found' }, 404);
}
