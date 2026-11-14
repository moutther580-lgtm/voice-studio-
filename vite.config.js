import { defineConfig } from 'vite';

function localApiDevPlugin() {
  return {
    name: 'local-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) {
          return next();
        }
        try {
          const mod = await server.ssrLoadModule('/worker/tts-handler.ts');
          const chunks = [];
          for await (const chunk of req) {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
          }
          const body = chunks.length ? Buffer.concat(chunks) : undefined;
          const origin = `http://${req.headers.host || 'localhost:3000'}`;
          const webReq = new Request(origin + req.url, {
            method: req.method || 'GET',
            headers: Object.entries(req.headers).reduce((acc, [k, v]) => {
              if (typeof v === 'string') acc[k] = v;
              else if (Array.isArray(v)) acc[k] = v.join(', ');
              return acc;
            }, {}),
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
          });
          const webRes = await mod.handleApiRequest(webReq, {
            GEMINI_API_KEY: process.env.GEMINI_API_KEY,
            DAILY_FREE_CHAR_LIMIT: process.env.DAILY_FREE_CHAR_LIMIT || '3000',
            GLOBAL_DAILY_FREE_CHARS: process.env.GLOBAL_DAILY_FREE_CHARS || '100000',
            FIREBASE_SERVICE_ACCOUNT_JSON: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
          });
          res.statusCode = webRes.status;
          webRes.headers.forEach((v, k) => res.setHeader(k, v));
          const buf = Buffer.from(await webRes.arrayBuffer());
          res.end(buf);
        } catch (err) {
          console.error('[local-api-dev]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Local API handler error' }));
        }
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [localApiDevPlugin()],
  build: { target: 'es2022' },
  server: { host: '0.0.0.0', port: 3000, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 3000, allowedHosts: true },
});
