import { defineConfig } from 'vite';

// `base: './'` keeps the build portable: it runs from a sub-path, a Capacitor
// WebView (file://) or an Electron/Tauri shell without rewriting asset URLs.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  server: { port: 5181, strictPort: true },
});
