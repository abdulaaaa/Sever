import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [svelte(), crx({ manifest })],
  build: {
    rollupOptions: {
      input: {
        popup: 'src/pages/popup/index.html',
        options: 'src/pages/options/index.html',
        blocked: 'src/pages/blocked/index.html',
        analytics: 'src/pages/analytics/index.html'
      }
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173
    }
  }
});
