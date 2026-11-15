import { handleApiRequest, type WorkerEnv } from '../worker/tts-handler';

declare const process: { env?: Record<string, string | undefined> } | undefined;

export function getVercelEnv(): WorkerEnv {
  const env = typeof process !== 'undefined' && process?.env ? process.env : {};
  return {
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    DAILY_FREE_CHAR_LIMIT: env.DAILY_FREE_CHAR_LIMIT || '3000',
    GLOBAL_DAILY_FREE_CHARS: env.GLOBAL_DAILY_FREE_CHARS || '100000',
    FIREBASE_SERVICE_ACCOUNT_JSON: env.FIREBASE_SERVICE_ACCOUNT_JSON,
  };
}

export async function forwardToHandler(request: Request): Promise<Response> {
  return handleApiRequest(request, getVercelEnv());
}
