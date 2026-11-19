import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const PRIVATE_HOST_RE = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[::1\]|0\.0\.0\.0)$/i;

function articleProxyMiddleware(req, res, next) {
  if (!req.url?.startsWith('/api/fetch-article')) { next(); return; }
  const params = new URL(req.url, 'http://127.0.0.1').searchParams;
  const target = params.get('url') || '';
  let parsed;
  try { parsed = new URL(target); } catch {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Invalid URL.' }));
    return;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || PRIVATE_HOST_RE.test(parsed.hostname)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Only public http/https article URLs are allowed.' }));
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  fetch(parsed.toString(), {
    signal: controller.signal,
    headers: { 'User-Agent': 'SpeedAI-Reader/1.0' }
  })
    .then(async (upstream) => {
      if (!upstream.ok) throw new Error(`Upstream returned ${upstream.status}`);
      const html = (await upstream.text()).slice(0, 2_000_000);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ html, url: parsed.toString() }));
    })
    .catch((err) => {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.name === 'AbortError' ? 'Request timed out.' : err.message }));
    })
    .finally(() => clearTimeout(timer));
}

function articleProxyPlugin() {
  return {
    name: 'article-proxy',
    configureServer(server) { server.middlewares.use(articleProxyMiddleware); },
    configurePreviewServer(server) { server.middlewares.use(articleProxyMiddleware); }
  };
}

export default defineConfig({
  // GitHub Pages serves the demo from /speed-reading/; locally it stays at /.
  base: process.env.PAGES_BASE ?? '/',
  plugins: [react(), tailwindcss(), articleProxyPlugin()],
  server: { port: 5173 }
});
