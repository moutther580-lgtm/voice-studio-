import { defineConfig } from 'vite';

function createNodeWebReq(req, body) {
  const origin = `http://${req.headers.host || 'localhost:3000'}`;
  return new Request(origin + req.url, {
    method: req.method || 'GET',
    headers: Object.entries(req.headers).reduce((acc, [k, v]) => {
      if (typeof v === 'string') acc[k] = v;
      else if (Array.isArray(v)) acc[k] = v.join(', ');
      return acc;
    }, {}),
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
  });
}

function getLocalEnv() {
  return {
    GEMINI_API_KEY:
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GEMINI_KEY,
    GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    GEMINI_KEY: process.env.GEMINI_KEY,
    DAILY_FREE_CHAR_LIMIT: process.env.DAILY_FREE_CHAR_LIMIT || '3000',
    GLOBAL_DAILY_FREE_CHARS: process.env.GLOBAL_DAILY_FREE_CHARS || '100000',
    FIREBASE_SERVICE_ACCOUNT_JSON: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    VERCEL_API_TOKEN: process.env.VERCEL_API_TOKEN,
    VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,
    VERCEL_TEAM_ID: process.env.VERCEL_TEAM_ID,
    VERCEL_DEPLOY_HOOK_URL: process.env.VERCEL_DEPLOY_HOOK_URL,
  };
}

const MAX_LOCAL_BODY_BYTES = 5 * 1024 * 1024;

async function readReqBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buf.byteLength;
    if (total > MAX_LOCAL_BODY_BYTES) {
      const err = new Error('Payload too large');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(buf);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function localApiDevPlugin() {
  let cachedPreviewHandler = null;

  async function loadHandler(devServer) {
    if (devServer && typeof devServer.ssrLoadModule === 'function') {
      const mod = await devServer.ssrLoadModule('/worker/tts-handler.ts');
      return mod.handleApiRequest;
    }
    if (!cachedPreviewHandler) {
      const { build } = await import('esbuild');
      const result = await build({
        entryPoints: ['worker/tts-handler.ts'],
        bundle: true,
        format: 'esm',
        platform: 'node',
        write: false,
      });
      const code = result.outputFiles[0].text;
      const modUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
      const mod = await import(modUrl);
      cachedPreviewHandler = mod.handleApiRequest;
    }
    return cachedPreviewHandler;
  }

  function attachMiddleware(middlewares, devServer) {
    middlewares.use(async (req, res, next) => {
      if (!req.url || !req.url.startsWith('/api/')) {
        return next();
      }
      try {
        const handleApiRequest = await loadHandler(devServer);
        const body = await readReqBody(req);
        const webReq = createNodeWebReq(req, body);
        const webRes = await handleApiRequest(webReq, getLocalEnv());
        res.statusCode = webRes.status;
        webRes.headers.forEach((v, k) => res.setHeader(k, v));
        const buf = Buffer.from(await webRes.arrayBuffer());
        res.end(buf);
      } catch (err) {
        if (err && typeof err === 'object' && 'statusCode' in err && err.statusCode === 413) {
          res.statusCode = 413;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'Request payload is too large.', code: 'PAYLOAD_TOO_LARGE' }));
          return;
        }
        console.error('[local-api]', err);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            error: 'Local API handler error',
            code: 'LOCAL_API_ERROR',
          })
        );
      }
    });
  }

  return {
    name: 'local-api-dev',
    configureServer(server) {
      attachMiddleware(server.middlewares, server);
    },
    configurePreviewServer(server) {
      attachMiddleware(server.middlewares, null);
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [localApiDevPlugin()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          mp3: ['@breezystack/lamejs'],
        },
      },
    },
  },
  server: { host: '0.0.0.0', port: 3000, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 3000, allowedHosts: true },
});
