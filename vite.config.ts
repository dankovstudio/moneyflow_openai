import { defineConfig } from 'vite';

// The browser only calls relative /api/... URLs; Vite forwards them to the local backend.
const api = { '/api': { target: 'http://127.0.0.1:8787' } };

export default defineConfig({
  server: { port: 5173, strictPort: true, proxy: api },
  preview: { proxy: api },
});
