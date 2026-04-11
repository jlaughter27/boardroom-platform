import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 10000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/tests/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/vitest.config.*',
        '**/vite.config.*',
      ],
    },
  },
  resolve: {
    alias: {
      // Fix for node-cron ESM module resolution
      'node-cron': resolve(__dirname, 'node_modules/.pnpm/node-cron@4.2.1/node_modules/node-cron/dist/esm/node-cron.js'),
    },
  },
});
