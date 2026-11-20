import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { articleProxyPlugin } from './scripts/articleProxy.js';

export default defineConfig({
  // GitHub Pages serves the demo from /speed-reading/; locally it stays at /.
  base: process.env.PAGES_BASE ?? '/',
  plugins: [react(), tailwindcss(), articleProxyPlugin()],
  // Vite's default host is localhost, i.e. loopback only. Keep it that way:
  // the article proxy fetches URLs on request, so these servers must never be
  // started with --host or host: true.
  server: { port: 5173 }
});
