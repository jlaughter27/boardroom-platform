import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    dir: 'tests/integration',
    testTimeout: 30000,
    hookTimeout: 30000,
    environment: 'node',
    setupFiles: [],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
