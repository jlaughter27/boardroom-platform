# Phase 4 — Testing and Rollback

## Verification per task

| Task | Verification |
|---|---|
| 4.1 CTE | `psql -c "<CTE>"` against test fixture returns expected nodes; cycle test does not loop; bi-temporal filter omits expired links |
| 4.2 service | Unit tests for fixture (Goal → 2 Projects → 5 Tasks) return correct counts at hops=1 and hops=2; cross-user request rejected |
| 4.3 route | `curl /relationships/related/<id>?hops=2` returns 200 + envelope; `hops=3` returns 422; foreign userId returns 404 |
| 4.4 helper | Unit test covers all 4 temporal cases; existing services audited for adoption |
| 4.5 tests | All unit + integration tests pass; perf test asserts p95 <300ms over 50 calls |
| 4.6 eval | Multi-entity slice within 3% of baseline (no expected change since ranker doesn't read this yet) |

## Smoke test after deploy

1. `/health` on OmniMind → 200.
2. `curl https://omnimind-api-production.up.railway.app/relationships/related/<a-real-goal-id>?hops=2 -H "x-api-key: ..." -H "x-user-id: ..."` → JSON envelope with edges.
3. Verify response time in browser dev tools / curl `--write-out '%{time_total}'` < 300ms for typical user data.
4. Open Better Stack and search for any errors mentioning `entity_walk` or `recursive` — should be zero.
5. After 24 hours stable, declare success.

## Rollback per task

| Task | Rollback procedure | Time |
|---|---|---|
| 4.1-4.6 (entire phase) | `git revert <range>`. The `/relationships/related/:id` endpoint disappears; no caller code in BoardRoom uses it yet (Phase 6 will). No data impact. | 5 min |
| Endpoint causing perf issue | Add `RELATIONSHIPS_API_ENABLED=false` env flag and short-circuit the route to 503. Faster than git revert if you need to disable in prod immediately. | 2 min |
| CTE timing out | Reduce default `MAX_DEPTH` from 2 to 1. Most queries still work. Multi-hop walks become single-hop. | 5 min |

## Special concerns

### CTE p95 > 300ms

If the CTE is slow under load:

1. Profile: `EXPLAIN (ANALYZE, BUFFERS) WITH RECURSIVE entity_walk AS (...)` against a power-user fixture. Look for sequential scans on link tables.
2. Add indexes if missing: `CREATE INDEX IF NOT EXISTS goal_project_links_goal_id_idx ON goal_project_links (goal_id) WHERE valid_to IS NULL OR valid_to > now();`
3. If still slow after indexes, the user has too many entities — consider `LIMIT` on the recursive case (drop deepest first).
4. Last resort: cap depth to 1 and document the regression. Phase 16 (deep graph) becomes the trigger.

### Bi-temporal forgotten at a query site

Validator §1 names this as a top-3 risk. Mitigation steps to take during this phase:

1. The CTE bakes the filter in (task 4.1) — can't be forgotten there.
2. Any other service that touches link tables MUST use `temporalFilterPrisma` from task 4.4.
3. Code-review checklist: any PR with `goalProjectLink|projectPersonLink|projectTaskLink|decisionProjectLink|taskDependency|commitmentLink` in the diff must include either `temporalFilterPrisma` or a justification comment.

### Soft-deleted parent leakage

Link tables don't have `deletedAt`. Walking the graph CAN return edges where the target's parent entity is soft-deleted. The post-CTE `filterSoftDeletedTargets` (task 4.2) handles this. Tests cover it.

A future improvement: add `deletedAt` to link tables (mirror the parent's state). That's Phase 14 territory (migration history) — too disruptive to add here without proper migration discipline.

### CTE result size explosion

A goal linked to 50 projects × 50 tasks each = 2500 nodes. Hard `LIMIT $3` (default 200) prevents pathological responses. If a real user's graph genuinely needs >200 nodes returned, the UI should paginate by depth (show depth=1 first, lazy-load depth=2 on demand). That's a UI concern, not this phase.

## Don't ship unless

- All 6 verification items pass
- CTE p95 <300ms at 100 entities/user (perf test asserts this)
- Bi-temporal filter present in CTE and adopted in any other touch site
- Soft-deleted parent filter post-CTE confirmed in tests
- Cross-user request returns 404, not 200
- Eval multi-entity slice within 3% of baseline
