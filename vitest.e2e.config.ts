import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    dir: 'tests/e2e',
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
