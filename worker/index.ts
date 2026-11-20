import { handleApiRequest, type WorkerEnv } from './tts-handler.js';

interface CloudflareEnv extends WorkerEnv {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

const KNOWN_PUBLIC_OR_APP_PATHS = new Set([
  '/',
  '/app',
  '/pdf-to-audio',
  '/urdu-tts',
  '/podcast-studio',
  '/video-subtitles',
  '/guides',
  '/guides/pdf-textbook-to-mp3-audio',
  '/guides/urdu-text-to-speech-mixed-english-terms',
  '/guides/blind-low-vision-students-audio-textbooks',
  '/guides/epub-chapter-by-chapter-audiobook',
  '/formats',
  '/faq',
  '/about',
  '/contact',
  '/privacy',
  '/terms',
  '/account',
  '/admin',
]);

export default {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, env);
    }

    const res = await env.ASSETS.fetch(request);
    if (res.status !== 404) {
      return res;
    }

    const cleanPath = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '').toLowerCase();
    const lastSeg = cleanPath.split('/').pop() || '';
    if (!lastSeg.includes('.') && !KNOWN_PUBLIC_OR_APP_PATHS.has(cleanPath)) {
      const notFoundReq = new Request(`${url.origin}/404.html`, { method: request.method, headers: request.headers });
      const nfRes = await env.ASSETS.fetch(notFoundReq);
      if (nfRes.ok) {
        const headers = new Headers(nfRes.headers);
        headers.set('Content-Type', 'text/html; charset=utf-8');
        return new Response(nfRes.body, { status: 404, headers });
      }
    }

    return res;
  },
};
