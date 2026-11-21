import fs from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'vite';
import {
  ROUTES,
  ROUTE_BY_PATH,
  SITE_ORIGIN,
  normalizePathname,
  renderRouteHtml,
} from './shared/routes-data.mjs';

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

  async function attachWs(server) {
    if (!server?.httpServer) return;
    try {
      let mod;
      if (typeof server.ssrLoadModule === 'function') {
        mod = await server.ssrLoadModule('/server/live-teacher-ws.ts');
      } else {
        const { build } = await import('esbuild');
        const result = await build({
          entryPoints: ['server/live-teacher-ws.ts'],
          bundle: true,
          format: 'esm',
          platform: 'node',
          packages: 'external',
          write: false,
        });
        const code = result.outputFiles[0].text;
        const modUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
        mod = await import(modUrl);
      }
      if (typeof mod?.attachLiveTeacherWebSocket === 'function') {
        mod.attachLiveTeacherWebSocket(server.httpServer, getLocalEnv);
      }
    } catch (err) {
      console.error('[local-ws-init]', err);
    }
  }

  return {
    name: 'local-api-dev',
    configureServer(server) {
      attachMiddleware(server.middlewares, server);
      void attachWs(server);
    },
    configurePreviewServer(server) {
      attachMiddleware(server.middlewares, null);
      void attachWs(server);
    },
  };
}

function isHtmlPageRequest(req) {
  if (!req.url) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const pathname = req.url.split('?')[0];
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/src/') ||
    pathname.startsWith('/shared/') ||
    pathname.startsWith('/assets/') ||
    pathname.startsWith('/@') ||
    pathname.startsWith('/node_modules/')
  ) {
    return false;
  }
  const base = path.posix.basename(pathname);
  if (base.includes('.') && !pathname.endsWith('.html')) {
    return false;
  }
  return true;
}

function multiRoutePrerenderPlugin() {
  let outDir = 'dist';

  return {
    name: 'multi-route-prerender',
    configResolved(config) {
      outDir = config.build?.outDir || 'dist';
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!isHtmlPageRequest(req)) return next();
        const rawPath = (req.url || '/').split('?')[0];
        const cleanPath = normalizePathname(rawPath);
        const route = ROUTE_BY_PATH.get(cleanPath);
        const notFoundRoute = ROUTE_BY_PATH.get('/404');
        const targetRoute = route || notFoundRoute;
        if (!targetRoute) return next();

        try {
          const templatePath = path.resolve(process.cwd(), 'index.html');
          const rawTemplate = await fs.readFile(templatePath, 'utf-8');
          const hostHeader = req.headers.host || 'localhost:3000';
          const origin = hostHeader.includes('localhost') || hostHeader.includes('127.0.0.1') ? SITE_ORIGIN : `https://${hostHeader}`;
          const hydrated = renderRouteHtml(rawTemplate, targetRoute, origin);
          const transformed = await server.transformIndexHtml(req.url || '/', hydrated);
          res.statusCode = route ? 200 : 404;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(transformed);
        } catch (err) {
          next(err);
        }
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!isHtmlPageRequest(req)) return next();
        const rawPath = (req.url || '/').split('?')[0];
        const cleanPath = normalizePathname(rawPath);
        const route = ROUTE_BY_PATH.get(cleanPath);
        const targetFile = route
          ? cleanPath === '/'
            ? path.resolve(process.cwd(), outDir, 'index.html')
            : path.resolve(process.cwd(), outDir, cleanPath.slice(1), 'index.html')
          : path.resolve(process.cwd(), outDir, '404.html');

        try {
          const html = await fs.readFile(targetFile, 'utf-8');
          res.statusCode = route ? 200 : 404;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(html);
        } catch {
          next();
        }
      });
    },
    async closeBundle() {
      const distRoot = path.resolve(process.cwd(), outDir);
      const templateFile = path.join(distRoot, 'index.html');
      let builtTemplate = '';
      try {
        builtTemplate = await fs.readFile(templateFile, 'utf-8');
      } catch {
        return;
      }

      for (const route of ROUTES) {
        const html = renderRouteHtml(builtTemplate, route, SITE_ORIGIN);
        let destFile;
        if (route.path === '/') {
          destFile = templateFile;
        } else if (route.path === '/404') {
          destFile = path.join(distRoot, '404.html');
        } else {
          const subDir = path.join(distRoot, route.path.slice(1));
          await fs.mkdir(subDir, { recursive: true });
          destFile = path.join(subDir, 'index.html');
        }
        await fs.writeFile(destFile, html, 'utf-8');
      }
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [localApiDevPlugin(), multiRoutePrerenderPlugin()],
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
