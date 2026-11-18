import { handleApiRequest, type WorkerEnv } from '../worker/tts-handler.js';

export interface NodeLikeReq {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | string>;
}

export interface NodeLikeRes {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(chunk?: Uint8Array | string): void;
}

declare const process: { env?: Record<string, string | undefined> } | undefined;

export function getVercelEnv(): WorkerEnv {
  const env = typeof process !== 'undefined' && process?.env ? process.env : {};
  return {
    GEMINI_API_KEY:
      env.GEMINI_API_KEY ||
      env.GOOGLE_GENERATIVE_AI_API_KEY ||
      env.GOOGLE_API_KEY ||
      env.GEMINI_KEY,
    GOOGLE_GENERATIVE_AI_API_KEY: env.GOOGLE_GENERATIVE_AI_API_KEY,
    GOOGLE_API_KEY: env.GOOGLE_API_KEY,
    GEMINI_KEY: env.GEMINI_KEY,
    DAILY_FREE_CHAR_LIMIT: env.DAILY_FREE_CHAR_LIMIT || '3000',
    GLOBAL_DAILY_FREE_CHARS: env.GLOBAL_DAILY_FREE_CHARS || '100000',
    FIREBASE_SERVICE_ACCOUNT_JSON: env.FIREBASE_SERVICE_ACCOUNT_JSON,
    VERCEL_API_TOKEN: env.VERCEL_API_TOKEN,
    VERCEL_PROJECT_ID: env.VERCEL_PROJECT_ID,
    VERCEL_TEAM_ID: env.VERCEL_TEAM_ID,
    VERCEL_DEPLOY_HOOK_URL: env.VERCEL_DEPLOY_HOOK_URL,
  };
}

const MAX_BODY_BYTES = 5 * 1024 * 1024;

class PayloadTooLargeError extends Error {
  constructor() {
    super('Request payload exceeds maximum allowed size.');
    this.name = 'PayloadTooLargeError';
  }
}

async function readNodeRequestBody(req: NodeLikeReq): Promise<BodyInit | undefined> {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return undefined;

  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      const encoded = new TextEncoder().encode(req.body);
      if (encoded.byteLength > MAX_BODY_BYTES) throw new PayloadTooLargeError();
      return req.body as BodyInit;
    }
    if (req.body instanceof Uint8Array) {
      if (req.body.byteLength > MAX_BODY_BYTES) throw new PayloadTooLargeError();
      return req.body as BodyInit;
    }
    const serialized = JSON.stringify(req.body);
    if (new TextEncoder().encode(serialized).byteLength > MAX_BODY_BYTES) {
      throw new PayloadTooLargeError();
    }
    return serialized;
  }

  if (typeof req[Symbol.asyncIterator] === 'function') {
    const chunks: Uint8Array[] = [];
    const encoder = new TextEncoder();
    let total = 0;
    for await (const chunk of req as AsyncIterable<Uint8Array | string>) {
      const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
      total += bytes.byteLength;
      if (total > MAX_BODY_BYTES) {
        throw new PayloadTooLargeError();
      }
      chunks.push(bytes);
    }
    if (!chunks.length) return undefined;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out as unknown as BodyInit;
  }

  return undefined;
}

export async function handleVercelNode(req: NodeLikeReq, res: NodeLikeRes): Promise<void> {
  try {
    const protoHeader = req.headers['x-forwarded-proto'];
    const rawProto = typeof protoHeader === 'string' ? protoHeader.split(',')[0].trim().toLowerCase() : 'https';
    const proto = rawProto === 'http' || rawProto === 'https' ? rawProto : 'https';
    const hostHeader = req.headers['x-forwarded-host'] || req.headers.host || 'voice-studio.local';
    const rawHost = typeof hostHeader === 'string' ? hostHeader.split(',')[0].trim() : 'voice-studio.local';
    const host = /^[a-zA-Z0-9._:-]{1,255}$/.test(rawHost) ? rawHost : 'voice-studio.local';
    const reqUrl = new URL(req.url || '/', `${proto}://${host}`);

    const headers = new Headers();
    for (const [key, val] of Object.entries(req.headers)) {
      const lower = key.toLowerCase();
      if (lower.startsWith(':') || lower === 'content-length' || lower === 'transfer-encoding') continue;
      try {
        if (typeof val === 'string') headers.set(key, val);
        else if (Array.isArray(val)) headers.set(key, val.join(', '));
      } catch {
        // Ignore invalid non-standard header names
      }
    }

    const body = await readNodeRequestBody(req);
    const webReq = new Request(reqUrl.toString(), {
      method: req.method || 'GET',
      headers,
      body,
    });

    const webRes = await handleApiRequest(webReq, getVercelEnv());
    res.statusCode = webRes.status;
    webRes.headers.forEach((value, key) => res.setHeader(key, value));
    const outBuf = new Uint8Array(await webRes.arrayBuffer());
    res.end(outBuf);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      res.statusCode = 413;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: 'Request payload is too large.', code: 'PAYLOAD_TOO_LARGE' }));
      return;
    }
    console.error('[vercel-api]', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: 'Speech server error.', code: 'VERCEL_HANDLER_ERROR' }));
  }
}
