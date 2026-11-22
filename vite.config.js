import { defineConfig } from 'vite';

// base './' — сайт работает в любой папке GitHub Pages, имя репозитория не важно.
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  optimizeDeps: { exclude: ['@matrix-org/matrix-sdk-crypto-wasm'] },
});
