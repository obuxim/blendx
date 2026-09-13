/**
 * The page is served by Vite; /api goes to the addition API, which `bun server.ts` in
 * examples/addition serves on port 3000 (BLENDX_API points elsewhere, as the browser tests do).
 */
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = process.env.BLENDX_API ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  // One copy of each, whichever package imports it: hooks and the QueryClient share a context.
  resolve: { dedupe: ['react', 'react-dom', '@tanstack/react-query'] },
  server: {
    proxy: { '/api': { target: api, rewrite: (path) => path.replace(/^\/api/, '') } },
  },
});
