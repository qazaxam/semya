import { defineConfig } from 'vite';

// base './' — сайт работает в любой папке GitHub Pages.
// Две страницы: радио Dalga (корень) и архив «Юрт» (/yurt/).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: { input: { index: 'index.html', yurt: 'yurt/index.html' } },
  },
  optimizeDeps: { exclude: ['@matrix-org/matrix-sdk-crypto-wasm'] },
});
