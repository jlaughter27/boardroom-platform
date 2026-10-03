# `src/_disabled/` — quarantined, unmounted code (AUDIT-2026-10-02 / O-112, F-214, F-215)

Nothing in this directory is compiled (`tsconfig.json` excludes `src/_disabled/**`),
imported, mounted, or tested. Files were **moved** here rather than deleted so
the history and intent are recoverable (`git log --follow`).

| File | Was | Why quarantined |
|---|---|---|
| `semantic-dedup.service.ts` | `src/services/` | Never imported. Its raw SQL uses camelCase columns (`userId`, `deletedAt`) against the snake_case `memory_entries` table and would throw on first call. Live dedup is `findNearDuplicate` in `memory.service.ts`. |
| `memory-graph.routes.ts` / `memory-graph.service.ts` | `src/routes/`, `src/services/` | Compiled but never mounted in `index.ts`. Byte-identical copies already lived in `routes/_disabled/` and `services/_disabled/`. |
| `memory-health.routes.ts` / `memory-health.service.ts` | `src/routes/`, `src/services/` | Same as above. |
| `incremental-embedding.service.ts` | `src/services/` (already excluded from build) | F-214: imports `generateEmbedding`, which `embedding.service.ts` does not export — broken and unused. |
| `memory-cleanup-scheduler.ts` | `src/jobs/` (already excluded from build) | F-215: depends on Redis-backed `lib/redlock`, which contradicts ADR-009 (node-cron, no Redis). Not wired. Its relative import of `./memory-cleanup.job` is intentionally left broken. |

Re-enabling any of these requires: fixing the SQL/column names, mounting the
router in `src/index.ts`, removing the tsconfig exclusion, and adding tests.
