import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * A strict Content-Security-Policy, injected only into production builds
 * (the dev server needs inline scripts for hot reload).
 *
 * The site makes no third-party requests at all: fonts are self-hosted,
 * there is no analytics, and `connect-src 'none'` means the page cannot
 * phone anywhere even if it wanted to.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  // Set BASE_PATH=/portfolio-dashboard/ when serving from a sub-path.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), cspPlugin()],
  build: { target: 'es2022', sourcemap: false },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
