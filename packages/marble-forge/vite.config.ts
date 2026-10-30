import { defineConfig } from 'vite';

// The Forge page: `npx vite --config packages/marble-forge/vite.config.ts` (dev) or `build`.
export default defineConfig({
  root: new URL('./forge', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  base: './',
  build: {
    outDir: '../dist-forge',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
});
