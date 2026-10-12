import { defineConfig } from 'vitest/config';

// Kept apart from vite.config.ts so tests don't load the extension build plugins.
export default defineConfig({
  // No .env files live in src, so the real .env at the root is never read by tests.
  envDir: 'src',
  test: {
    include: ['src/**/*.test.ts'],
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_KEY: 'test-key',
      VITE_DEV_MODE: 'false'
    }
  }
});
