import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'scenarios/blog/admin',
  plugins: [react()],
  resolve: {
    alias: {
      '@kernel': fileURLToPath(new URL('./kernel', import.meta.url)),
      '@modules': fileURLToPath(new URL('./modules', import.meta.url)),
      '@scenarios': fileURLToPath(new URL('./scenarios', import.meta.url)),
    },
  },
  build: {
    outDir: '../../../dist/admin',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
