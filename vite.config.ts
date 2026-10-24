import { defineConfig } from 'vitest/config';

// `base: './'` keeps the build portable: it runs from a sub-path, a Capacitor
// WebView (file://) or an Electron shell without rewriting asset URLs.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  server: {
    port: 5181,
    strictPort: true,
    // `npm run dev:server` in another terminal provides the lobby.
    proxy: { '/lobby': { target: 'ws://localhost:8787', ws: true } },
  },
  test: { exclude: ['**/node_modules/**', '**/dist/**', 'android/**', 'ios/**'] },
});
