# Runbook — Running the E2E Test Harness

The E2E suite under `tests/e2e/` exercises the OmniMind seam end-to-end:
real Postgres, real API subprocess, real MCP stdio client. It exists to
catch the class of bugs Hermes surfaced (agent attribution, tenant
isolation, sourceWeight propagation, embedding outbox) which unit tests
with mocks cannot detect.

## Prerequisites

- Docker + docker-compose (the test Postgres runs in a container)
- Node 22+ (matches CI / Railway)
- `pnpm install` completed at repo root

## One-time setup

The test Postgres is defined in `docker-compose.test.yml` at the repo
root. Bring it up once and leave it running between test sessions:

```bash
docker-compose -f docker-compose.test.yml up -d postgres-test
```

The container exposes Postgres on `localhost:5433` with credentials
`test_user / test_password / boardroom_test`. The harness uses these by
default; override with `TEST_DATABASE_URL` if you need a different DB.

You don't need to bring up `omnimind-api-test` or `boardroom-ai-test` —
the harness spawns its own OmniMind API subprocess for isolation.

## Running the tests

From repo root:

```bash
pnpm test:e2e
```

This runs `vitest run --config vitest.e2e.config.ts`. The config:

- Runs sequentially (`fileParallelism: false`) — every file owns the
  Postgres + API stack for its lifetime, so parallel runs would clash on
  port 3399 and on the TRUNCATE in `beforeEach`.
- Uses `testTimeout: 30_000` and `hookTimeout: 60_000` because spawning
  the API subprocess + running `prisma db push` takes ~5-10 s on first run.

On first run the harness will:

1. TCP-probe the test Postgres at `localhost:5433`. Hard-fail with a
   one-liner if Docker isn't running.
2. Apply migrations via `prisma db push` (idempotent — safe to re-run).
3. Spawn the OmniMind API on `localhost:3399` (override via
   `TEST_OMNIMIND_PORT`).
4. Spawn one MCP stdio client per test case.

## Troubleshooting

### "Test Postgres not reachable"

Docker isn't running, or `postgres-test` was stopped. Bring it up:

```bash
docker-compose -f docker-compose.test.yml up -d postgres-test
```

If port 5433 is in use by a local Postgres, edit `docker-compose.test.yml`
to remap, then set `TEST_DATABASE_URL=postgresql://test_user:test_password@localhost:NEWPORT/boardroom_test`.

### "API failed to become healthy within 30s"

Usually means migrations failed or the test DB is missing extensions.
Reset it:

```bash
docker-compose -f docker-compose.test.yml down -v postgres-test
docker-compose -f docker-compose.test.yml up -d postgres-test
pnpm test:e2e
```

### Stale outbox / memory rows leaking between tests

The harness calls `resetDatabase()` in every `beforeEach`. If you skip a
test in dev and see stale rows, the truncate didn't run. Add a manual
clean:

```sql
TRUNCATE TABLE embedding_outbox, mcp_audit_logs, memory_entries, agents, users
RESTART IDENTITY CASCADE;
```

## What the tests cover

| Test                                              | Catches Hermes bug |
|---------------------------------------------------|-------------------:|
| E2E-1-agent-attribution.test.ts                   | Bug #1 (agent_id NULL) |
| E2E-2-tenant-isolation.test.ts                    | Bug #2 (cross-tenant leak) |
| E2E-3-sourceweight-propagation.test.ts            | Bug #3 (sourceWeight ignored) |
| E2E-4-embedding-eventually-persists.test.ts       | Bug #4 (embedding never persists) |
| E2E-5-cross-tenant-leak-attempts.test.ts          | Defense-in-depth: tenantId injection attacks |

See `docs/_meta/E2E-TEST-PATTERNS.md` for adding new tests.

## When to run

- **Locally:** every PR that touches `packages/omnimind-api/src/services/memory.service.ts`,
  `packages/omnimind-api/src/routes/memories.routes.ts`,
  `packages/omnimind-api/src/middleware/agent-context.ts`, or any file
  under `packages/omnimind-api/src/retrieval/`.
- **Before merging to main:** mandatory; this is the regression gate
  that would have caught the original Hermes bugs.
- **In CI (future):** not wired yet — requires CI Postgres. Add to
  Railway pre-deploy when the workflow exists.

## Cost

- Whole-suite runtime target: under 3 minutes on dev hardware
- Per-test target: under 30 seconds
- Postgres container idle cost: negligible (~50 MB RAM)
