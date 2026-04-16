import { defineConfig } from 'vitest/config';

// Server-side vitest config. `@boardroom/shared` is resolved via the
// pnpm workspace symlink in node_modules — no alias needed, and the
// shared package must be built (`pnpm --filter @boardroom/shared run build`)
// before running these tests so dist/index.js exists.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['server/tests/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/client/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/tests/**',
        '**/__mocks__/**',
        '**/*.config.*',
        '**/*.d.ts',
      ],
    },
  },
});
