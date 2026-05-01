# Phase 7a — Testing and Rollback

## Verification per task

| Task | Verification |
|---|---|
| 7a.1 columns | `psql -c "\d memory_entries"` shows `last_accessed_at` and `access_count` columns; partial index on `(user_id, access_count DESC)` exists |
| 7a.2 async update | Integration test: retrieve 5 memories; immediately query same IDs — `last_accessed_at` updated within 5s; retrieval response time unchanged from pre-7a |
| 7a.3 usage signal | Unit tests for `usageSignal` math; integration test with 2 memories (same semantic relevance, different access_count) → higher access_count ranks higher when flag on |
| 7a.4 exponential recency | Unit tests for `recencySignal` at 1d / 30d / 90d / 1y; replaced binary cliff verified absent in code |
| 7a.5 tests | All unit + integration green; access tracking failure path doesn't affect retrieval response |
| 7a.6 eval | `docs/eval-results/phase-7a.md` shows all 4 config rows with metrics; SHIP/TUNE/DEFER decision documented |

## Smoke test after deploy (flag OFF)

1. `/health` on OmniMind → 200.
2. Make a real retrieval call. Verify `last_accessed_at` IS updated (the async update should run regardless of the ranker flag — the flag only gates whether usage_signal feeds the score).
3. Better Stack: zero errors related to `trackMemoryAccess`.
4. Wait 24h. `accessCount` should grow on real memory traffic.

## Smoke test after flag flip ON (25% bucket)

1. Set `RANKER_USAGE_SIGNAL_ENABLED=true` in Railway, restart.
2. From a userId in bucket 1 of 4: search the BoardRoom UI for queries that hit older memories — they should rank slightly lower than fresh memories with similar relevance.
3. From a userId NOT in bucket 1: results unchanged from baseline.
4. Run the eval against production with `RANKER_USAGE_FORCE_ALL=true`. Confirm metrics match staging.
5. After 7 days stable: flip global on (remove A/B check or expand to all buckets).

## Rollback per task

| Task | Rollback procedure | Time |
|---|---|---|
| 7a.1 columns | `git revert` schema. Drop columns: `ALTER TABLE memory_entries DROP COLUMN last_accessed_at, DROP COLUMN access_count;` (set `MIGRATE_PROTECTION=1` first per Phase 1 discipline). Existing data lost; unrecoverable for old access timestamps. | 10 min |
| 7a.2 async update | `git revert`. `last_accessed_at` and `accessCount` stop updating. Old values stay in place. | 5 min |
| 7a.3 usage signal | `git revert`. Ranker stops reading from `accessCount`. No data impact. | 5 min |
| 7a.4 recency | `git revert` brings back the binary 7-day boost. No data impact. | 5 min |
| 7a.5 tests | n/a. | n/a |
| 7a.6 flag | `RANKER_USAGE_SIGNAL_ENABLED=false`, restart. **This is the safe rollback for the entire phase.** | 2 min |

## The "safe rollback" path

`RANKER_USAGE_SIGNAL_ENABLED=false` in Railway env, restart. Done. Ranker reverts to Phase 3 / Phase 6 behavior. `lastAccessedAt` updates continue silently in the background — they cause no harm and stop only if you also revert task 7a.2.

## Special concerns

### Hot-memory dominance

If usage_signal weight is too high, memories accessed 100+ times dominate every query result. Tuning:

- Start with `WEIGHT_USAGE = 0.05`
- If hot memories overwhelm relevance: lower to 0.02 or 0.01
- If usage signal feels invisible: raise to 0.10
- Monitor: query a fresh memory + a hot memory, verify the fresh one still ranks first when semantic relevance favors it

### Async update load

`trackMemoryAccess` does an `updateMany` on each retrieval call. At high QPS (which omnimind doesn't have today), this becomes write-heavy. Mitigation if needed:

- Batch updates: collect access events for 60s, then flush as a single SQL statement
- Or accept the load and add a partial index on `id` to make the update O(log n)

For today's scale (single instance, low QPS), no optimization needed.

### Recency decay constant tuning

If 30-day decay feels wrong (founder gut: "I want a year-old decision still ranked high if it's still relevant"):

1. Adjust `RANKER_RECENCY_DECAY_DAYS` in Railway env. Try 90.
2. Re-run eval. If temporal slice metrics improve, that's the new default.
3. Update `.env.example` and document in `docs/architecture/ranker.md`.

### `lastAccessedAt = null` on existing rows

The migration default is `now()`, but rows that existed before the column was added will be NULL until they're touched. Recency for those rows defaults to "never accessed" → very old `lastAccessedAt`. The recency signal computed from `createdAt` (not `lastAccessedAt`) so this is fine — but if a future Phase wants to use `lastAccessedAt` as the recency anchor instead, plan a backfill: `UPDATE memory_entries SET last_accessed_at = updated_at WHERE last_accessed_at IS NULL`.

## Don't ship unless

- All 6 verification items pass
- Eval shows ≥0% overall lift AND no slice regresses by >2%
- Async update verified non-blocking (retrieval p95 unchanged)
- A/B helper produces independent 25% cohort from Phase 6
- 7-day stable in production (25% cohort) before global rollout
- Decision documented in `docs/eval-results/phase-7a.md`
