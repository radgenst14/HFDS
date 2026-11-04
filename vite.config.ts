import { defineConfig } from 'vite';

// Doc 15 Part A: relative asset paths so the build works under
// https://www.egr.msu.edu/cse435/<groupname>/prototype/ (static hosting only).
export default defineConfig({
  base: './',
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
});
