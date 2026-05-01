# Phase 6 — Testing and Rollback

## Verification per task

| Task | Verification |
|---|---|
| 6.1 trigram match | Unit test: query "stripe pricing" + memory linked to entity `Stripe` (similarity ~0.7) returns boost 0.15; memory linked to entity `Strine` (similarity 0.4) returns no boost |
| 6.2 ranker integration | Unit test: same input set with boost ON vs OFF — boosted memory ranks higher when ON; same when OFF; works in both `weighted` and `rrf` modes |
| 6.3 A/B helper | Unit test: 1000 random userIds → ~250 in bucket 0 of 4 (within 5% slop); same userId always returns same bucket |
| 6.4 perf | Integration test asserts ranker p95 < 200ms with boost on (delta < 50ms vs boost off) |
| 6.5 eval | `docs/eval-results/phase-6.md` shows clear SHIP/TUNE/DEFER decision; if SHIP, multi-entity MRR ≥ +3% and single-hop MRR ≥ -2% |

## Smoke test after deploy (flag OFF)

1. `/health` on OmniMind → 200.
2. Search behavior in BoardRoom UI: identical to pre-Phase-6 (flag is off).
3. No errors in Better Stack related to `entity_boost` or `computeEntityBoosts`.
4. Wait 24h. Verify zero boost-applied logs.

## Smoke test after flag flip ON (25% bucket)

1. Set `RANKER_ENTITY_BOOST_ENABLED=true` in Railway, restart.
2. From a userId known to be in bucket 0 of 4, search the BoardRoom UI. Run a few multi-entity queries. Subjective check: results feel more "on point" for multi-entity queries.
3. From a userId known NOT to be in bucket 0, same queries — results unchanged from baseline.
4. Better Stack: `boost_applied:true` shows ~25% of retrieval calls.
5. Run eval against production (with `RANKER_BOOST_FORCE_ALL=true` to bypass A/B for measurement). Confirm metrics match the staging numbers.
6. After 7 days stable: flip from `bucketIndex: 0` to global on by removing the A/B check (or expanding the bucket count to 1).

## Rollback per task

| Task | Rollback procedure | Time |
|---|---|---|
| 6.1 trigram | `git revert` removes `entity-boost.ts`. Ranker falls back to no-boost behavior; existing entities unaffected. | 5 min |
| 6.2 ranker integration | `git revert`. Ranker returns to Phase 3 behavior. | 5 min |
| 6.3 A/B helper | `git revert`. The helper is reusable — losing it means the next A/B has to rebuild. Better to keep it even if Phase 6 reverts. | n/a |
| 6.4 tests | n/a. | n/a |
| 6.5 flag | Set `RANKER_ENTITY_BOOST_ENABLED=false` in Railway, restart. **This is the safe rollback for the entire phase.** | 2 min |

## The "safe rollback" path

`RANKER_ENTITY_BOOST_ENABLED=false` in Railway env, restart. Done. Ranker returns to Phase 3 behavior. No data impact.

## Special concerns

### Multi-entity lift below 3%

If eval shows the boost helps but not by 3%:

1. Try raising the boost from 0.15 to 0.20 (more aggressive).
2. Try lowering trigram threshold from 0.6 to 0.55 (more matches).
3. Try removing the per-memory cap (let multiple matches stack).
4. Re-run eval. If still <3%, document the marginal lift; ship anyway if there's no regression elsewhere — the boost is cheap.

### Single-hop regression > 2%

If single-hop MRR drops more than 2%, the boost is over-firing — adding spurious boosts to memories that match an entity by canonical name but aren't actually relevant.

1. Tighten trigram threshold (0.6 → 0.7).
2. Reduce boost amount (0.15 → 0.10).
3. Add an additional check: only boost if the entity's `confidence` is actually high (e.g., ≥0.8 instead of ≥0.7).
4. Re-run eval. If still regressing, DEFER the phase per validator's flip-trigger.

### Performance regression

If p95 latency rises by >50ms with boost on:

1. Profile the trigram query — `EXPLAIN ANALYZE` on a representative call.
2. Check that `extracted_entities.canonical_name` has a trigram GIN index. If not, add one.
3. Cap candidates passed to `computeEntityBoosts` to top-30 (already in the design — verify).
4. If still slow, the entity graph may be too large for the user — ship with stricter top-N cap (e.g., top-10).

### Both A/B cohorts behave identically

If logs show ~25% in bucket but eval results are indistinguishable across cohorts, the boost may be a no-op:

1. Check that `extracted_entities` actually has rows for the test users (Phase 5a needs to have run).
2. Check that `entity_relationships` has rows with `confidence ≥ 0.7` (Phase 5a's confidence threshold may be over-cautious).
3. Verify the trigram threshold isn't filtering out everything by setting it temporarily to 0.3 and re-running — if MRR jumps, the threshold was too strict.

## Don't ship unless

- All 5 verification items pass
- Eval shows multi-entity MRR ≥ +3% AND single-hop MRR ≥ -2%
- Performance test shows p95 delta < 50ms
- A/B helper produces 25% ± 5% bucket distribution on 1000 sample users
- Decision documented in `docs/eval-results/phase-6.md`
- 7-day stable in production (25% cohort) before global rollout
