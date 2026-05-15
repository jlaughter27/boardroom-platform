import { defineConfig } from 'vitest/config';

/**
 * Vitest config for end-to-end tests under `tests/e2e/`.
 *
 * These tests bring up a real test Postgres + a real OmniMind API subprocess +
 * a real MCP stdio server, then assert on actual DB rows. They are the
 * regression gate for the 4 Hermes bugs (agent_id, tenant isolation,
 * sourceWeight, embedding outbox) and run separately from unit tests because
 * they need infrastructure that isn't free.
 *
 * Run locally:
 *   docker-compose -f docker-compose.test.yml up -d postgres-test
 *   pnpm test:e2e
 *
 * Each test file owns its own harness instance via setupHarness/teardownHarness,
 * so we run sequentially (single-threaded) — parallel test files would fight
 * over the same DB and the same API port.
 */
export default defineConfig({
  test: {
    dir: 'tests/e2e',
    // Only the 5 WS-5 regression tests + the phase-e tripwire (which is a
    // pure git check with no infra dependencies). The older `tests/e2e/flows/*`
    // tests target the full docker-compose stack including boardroom-ai —
    // they're left in place but not run here (the harness in this file boots
    // OmniMind only, not BoardRoom AI).
    include: ['E2E-*.test.ts', 'phase-e-stub-cleanup-due.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/harness/**', 'flows/**'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    environment: 'node',
    // Sequential: each suite owns its API subprocess + DB state. Parallel
    // would race on port 3399 and TRUNCATE timing.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    fileParallelism: false,
    reporters: ['default'],
  },
});
