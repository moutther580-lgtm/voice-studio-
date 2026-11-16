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
  };
}

async function readNodeRequestBody(req: NodeLikeReq): Promise<BodyInit | undefined> {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return undefined;

  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string' || req.body instanceof Uint8Array) {
      return req.body as BodyInit;
    }
    return JSON.stringify(req.body);
  }

  if (typeof req[Symbol.asyncIterator] === 'function') {
    const chunks: Uint8Array[] = [];
    const encoder = new TextEncoder();
    for await (const chunk of req as AsyncIterable<Uint8Array | string>) {
      chunks.push(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
    }
    if (!chunks.length) return undefined;
    const total = chunks.reduce((acc, c) => acc + c.byteLength, 0);
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
    const proto = typeof protoHeader === 'string' ? protoHeader.split(',')[0].trim() : 'https';
    const hostHeader = req.headers['x-forwarded-host'] || req.headers.host || 'voice-studio.local';
    const host = typeof hostHeader === 'string' ? hostHeader.split(',')[0].trim() : 'voice-studio.local';
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
    const message = err instanceof Error ? err.message : 'Unexpected server error';
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: `Speech server error: ${message}`, code: 'VERCEL_HANDLER_ERROR' }));
  }
}
