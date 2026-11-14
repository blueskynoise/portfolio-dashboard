import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Two entry points, built together:
 *
 *   gate.html   the access evaluation. Public.
 *   index.html  the portfolio. Served only to a request with a valid session.
 *
 * The manifest tells the API server which built files belong to the gate.
 * Everything else is protected (see apps/api/src/static.ts). Security
 * headers, including the Content-Security-Policy, are set by that server.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    manifest: true,
    // Kept apart from public/assets so build output and static assets never share a path.
    assetsDir: 'static',
    rollupOptions: { input: { app: 'index.html', gate: 'gate.html' } },
  },
  server: {
    port: 5173,
    // In development the Vite server fronts the API. Enforcement of the gate is the API server's job in production;
    // here the app simply redirects to the gate when it has no session.
    proxy: { '/api': 'http://localhost:8787', '/healthz': 'http://localhost:8787', '/readyz': 'http://localhost:8787' },
  },
});
