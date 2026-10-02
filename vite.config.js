import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // GitHub Pages serves the demo from /speed-reading/; locally it stays at /.
  base: process.env.PAGES_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  server: { port: 5173 }
});
