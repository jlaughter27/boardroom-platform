# services/_disabled

This directory holds service code that is intentionally excluded from the
TypeScript build (see `packages/omnimind-api/tsconfig.json`).

Files land here when:
- they contradict an architectural decision (ADR-009: no Redis), OR
- they were experimental and never wired up, OR
- they reference primitives that no longer exist in the codebase.

## Inventory

| File | Reason | Trigger to re-enable |
|---|---|---|
| `rate-limiter-redis.ts` | ADR-009 — no Redis | 2+ Railway instances |
| `memory-cleanup-scheduler.ts` | ADR-009 — depends on `lib/redlock`. F-215 in bug-audit 2026-05-15 moved this here from `src/jobs/`. | ADR-009 revisited (500+ users or jobs >30s) |
| `mem0-entity-pipeline.ts`, `entity-extractor.service.ts`, `memory-graph.service.ts`, `memory-health.service.ts`, `relationship-builder.service.ts`, `semantic-contradiction.service.ts`, `query-understanding.service.ts`, `graph-traversal.service.ts`, `search-cache.service.ts` | Phase-3 experimental layers; superseded by current pipeline | Phase 6+ memory layer expansion |
| `integration-test.service.ts`, `performance-load-test.service.ts`, `security-penetration-test.service.ts`, `rollback-validation.service.ts` | Test-harness layers; behavior is now covered by `tests/e2e/` | If `tests/e2e/` is rewritten |

If you re-enable one of these, remove its entry from `tsconfig.json`'s
`exclude` array and update this README.
