import { defineConfig } from 'vitest/config';

// Server-side vitest config. `@boardroom/shared` is resolved via the
// pnpm workspace symlink in node_modules — no alias needed, and the
// shared package must be built (`pnpm --filter @boardroom/shared run build`)
// before running these tests so dist/index.js exists.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // WS-7: bump from the 5s default. calculator-tool and tool-registry
    // import `mathjs` (a ~3.5s synchronous JIT compile on first use) and
    // can exceed 5s under parallel `turbo run test` CPU contention. The
    // tests themselves are fast — the cold mathjs initialization is the
    // tail. 15s gives a generous margin without masking real hangs.
    testTimeout: 15000,
    hookTimeout: 15000,
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
