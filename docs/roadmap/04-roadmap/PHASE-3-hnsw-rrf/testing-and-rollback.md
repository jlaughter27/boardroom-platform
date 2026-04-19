# Phase 3 — Testing and Rollback

## Verification per task

| Task | Verification |
|---|---|
| 3.1 HNSW | `\d memory_entries` shows `memory_entry_embedding_hnsw_idx` and no IVFFlat. `EXPLAIN ANALYZE` shows HNSW Index Scan. Top-10 recall ≥95% match against pre-migration baseline. |
| 3.2 RRF flag | Setting `RANKER_MODE=rrf` and restarting → ranker returns RRF-ordered results. Setting back to `weighted` → original behavior. |
| 3.3 winner doc | `docs/eval-results/phase-3.md` exists with overall + per-slice tables; clear "Decision" line states the chosen default; default in code matches. |
| 3.4 rollback | `scripts/rollback-hnsw-to-ivfflat.sql` ran successfully on staging; query plans returned to IVFFlat; restored HNSW afterward. |
| 3.5 tests | `npm run test -w packages/omnimind-api -- ranker` green; integration test for both modes passes. |
| 3.6 latency | `docs/eval-results/phase-3.md` "Latency comparison" section shows p95 reduction; eval harness within 3% of baseline. |

## Smoke test after HNSW deploys

1. `/health` on OmniMind → 200.
2. From a real user account, search for memory in BoardRoom UI. Results return in noticeably less time (< 200ms feels snappy where 500ms felt sluggish).
3. Run `npm run eval:retrieval` against production. Compare to baseline.
4. Open Better Stack and look for any errors mentioning `index` or `vector` — there should be zero.
5. After 24 hours stable, declare HNSW success.

## Smoke test after RRF flag flip (to whichever wins)

1. Set `RANKER_MODE=<winner>` in Railway env. Restart.
2. Search for memory in UI. Compare results subjectively to previous mode.
3. Run eval one more time in production to capture the post-flip baseline.
4. After 48 hours stable, ship the chosen default in code (no need to rely on env var indefinitely).

## Rollback per task

| Task | Rollback procedure | Time |
|---|---|---|
| 3.1 HNSW | Run `scripts/rollback-hnsw-to-ivfflat.sql` against production. ~5 min for 100k vectors. Query plans return to IVFFlat. No data loss. | 5-10 min |
| 3.2 RRF flag | Set `RANKER_MODE=weighted` in Railway env, restart. ~2 min. | 2 min |
| 3.3 docs | n/a — doc-only. Update if winner needs to change post-deploy. | n/a |
| 3.4 rollback script | n/a — the script IS the rollback. | n/a |
| 3.5 tests | `git revert` if a test starts mis-asserting. Don't ship a broken test. | 5 min |
| 3.6 measurement | n/a — doc-only. | n/a |

## Special concerns

### HNSW build failures

If `CREATE INDEX CONCURRENTLY ... USING hnsw` fails with "could not extend file" or "out of memory":

- Cause: `maintenance_work_mem` too low. Set to 4GB in the same session.
- Cause: Disk full. Check Railway dashboard.
- Cause: Long-running transaction blocking. `SELECT * FROM pg_stat_activity WHERE state = 'active'` to find blockers.

If the build fails partway, drop the partial index (`DROP INDEX CONCURRENTLY IF EXISTS memory_entry_embedding_hnsw_idx`) before retrying. The IVFFlat is still serving queries — no rush.

### HNSW recall regression

If post-migration recall drops noticeably (top-10 overlap < 95% with IVFFlat baseline):

1. Raise `hnsw.ef_search` from default 40 to 100 (~2x latency tradeoff): `ALTER DATABASE omnimind SET hnsw.ef_search = 100`.
2. Re-run the recall comparison. If still bad, check `m` and `ef_construction` — may need to rebuild with higher values (e.g., `m=24, ef_construction=100`).
3. If unfixable, run the rollback to IVFFlat. HNSW is not always strictly better — eval is the arbiter.

### RRF wins on multi-entity but loses on single-hop

This is plausible — RRF rewards consistent presence across retrievers; multi-entity queries hit multiple retrievers. Single-hop queries often have one obvious retriever winning by a wide margin, where weighted wins.

If this pattern appears, document it in `docs/eval-results/phase-3.md`. Consider per-query-class routing in a future phase, but DO NOT add it now — adds complexity. Pick one default and ship.

### Eval harness drift across runs

HNSW changes timing characteristics, not result ordering (modulo recall regression). If MRR changes by >3% post-HNSW, it's a recall regression — investigate as above.

## Don't ship unless

- pgvector ≥ 0.5.0 confirmed
- Backup taken within last 24h
- Rollback script tested on staging
- HNSW build succeeded; query plans confirmed
- Recall ≥95% match against pre-migration top-10
- Eval harness within 3% of baseline
- p95 latency improvement documented
- RRF flag-off behavior identical to pre-Phase-3
- 24h stability before declaring HNSW success
