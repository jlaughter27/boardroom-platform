# Phase 2 — Testing and Rollback

## Verification per task

| Task | Verification |
|---|---|
| 2.1 write event | Create a memory; `psql -c "SELECT * FROM memory_write_events ORDER BY created_at DESC LIMIT 1"` shows a row with `consolidation_status = 'PENDING'` and a unique `replay_key` |
| 2.2 drain + sweep | Stop the worker, create 5 memories (all show PENDING), restart — within 30s all 5 are APPLIED. Force a row to `created_at = now() - interval '25 hours'`, run `npm run cron:memory-sweep`, confirm it transitions to APPLIED |
| 2.3 extractor | Memory with content "spoke with @alex about acme.com on Jan 15 2026" produces ≥4 ExtractedEntity rows: `(@alex, MENTION)`, `(Acme, ORG)`, `(acme.com, URL)`, `(2026-01-15, DATE)` |
| 2.4 consolidation | Three test memories: identical → NOOP; near-dup with 0.9 similarity → UPDATE; novel content → ADD; 0.7 boundary → PENDING_REVIEW |
| 2.5 supersession | After UPDATE: old row `status='SUPERSEDED'`, new row `status='CONFIRMED'` AND `supersedes=<oldId>`. Retrieval returns only the new row |
| 2.6 feature flag | Setting `MEM0_EXTRACTION_ENABLED=false` and restarting → no entity extraction happens (verify via log absence + zero new ExtractedEntity rows after a write); setting true and restarting → extraction runs |
| 2.7 precision sample | Integration test asserts ≥70% precision on UPDATE+NOOP across the 100-pair fixture. If <70%, the test fails (and Phase 5b LLM upgrade is pulled forward) |
| 2.8 eval runs | `npm run eval:retrieval` with flag OFF: within 3% of baseline. With flag ON: within 3% of baseline |

## Smoke test after deploy (flag OFF)

1. Both `/health` endpoints → 200
2. Create a new memory via BoardRoom UI. Confirm in Better Stack logs: a `MemoryWriteEvent` row was written.
3. Confirm zero new `ExtractedEntity` rows (flag is OFF).
4. Confirm existing retrieval still works — open the memory list, search for something, get expected results.
5. After 24h, no errors in logs related to memory-write-event, no stuck PENDING rows.

## Smoke test after flag flip ON (staging first)

1. Set `MEM0_EXTRACTION_ENABLED=true` in staging, restart.
2. Create 10 memories with varied content (people, dates, URLs, mentions).
3. Verify `ExtractedEntity` rows appear with correct types and canonical names.
4. Force a near-duplicate memory; verify supersession happens (old row SUPERSEDED, new row CONFIRMED).
5. Run `npm run eval:retrieval` against staging. Compare to baseline.
6. If green for 48h in staging, repeat in production with flag ON.

## Rollback per task

| Task | Rollback procedure | Time |
|---|---|---|
| 2.1 write event | `git revert`. Existing memory_write_events rows stay (orphaned but harmless). New writes no longer record events. | 5 min |
| 2.2 drain + sweep | `git revert`. Worker no longer reads from MemoryWriteEvent. Existing PENDING rows are stranded — manually mark FAILED if they pile up. | 10 min |
| 2.3 extractor | `git revert`. Worker no longer extracts entities. Existing ExtractedEntity rows soft-deleted via `deletedAt` if you want a clean slate (`UPDATE extracted_entities SET deleted_at = now() WHERE created_at >= '<timestamp>'`). | 10 min |
| 2.4 consolidation | `git revert`. Decision logic gone — worker falls back to "always ADD" behavior. Some genuine dups will start landing as duplicate rows; these can be rolled up later by re-running consolidation post-fix. | 10 min |
| 2.5 supersession | Run `scripts/rollback-mem0-supersession.sql` with the cutoff timestamp = phase deploy time. Old SUPERSEDED rows return to CONFIRMED, new copy-on-write rows go to DELETED. ~5 min for ≤1000 rows. | 5-15 min |
| 2.6 feature flag | Set `MEM0_EXTRACTION_ENABLED=false` in Railway env, restart. Immediate. **This is the safe rollback for the entire phase.** | 2 min |
| 2.7 tests | Test fixtures stay; flagging the precision test as `.skip()` if precision dips temporarily during tuning. Don't ship .skip permanently — find the underlying issue. | n/a |
| 2.8 eval | Eval results stay archived. Re-baseline only after intentional improvement is verified. | n/a |

## The "safe rollback" path for the entire phase

If anything goes wrong post-deploy:

1. Set `MEM0_EXTRACTION_ENABLED=false` in Railway. Restart. Phase 2 effectively disabled.
2. If supersessions have already shipped to prod and need undoing: run `scripts/rollback-mem0-supersession.sql` with cutoff = phase deploy time.
3. If the boot-time drain is causing slow cold starts: comment out the `drainPendingEvents()` call in `index.ts`, leave the rest. Stale events get caught by the nightly sweep.
4. Last resort: `git revert` the phase commit and redeploy. Schema additions stay (additive-only Phase 1) but all behavior reverts.

## Special concerns

### Eval baseline drift with flag ON

If the flag-ON eval shows even a small (1-2%) shift, that's worth investigating. Pattern extraction creates richer link metadata; retrieval may improve OR regress depending on whether the ranker uses it. Phase 6 is when ranker explicitly consumes entities — for now, the eval being stable proves "no harm done."

If improvement is large (>5%), that's surprising — investigate to make sure it's real and not the test set being too easy.

### Stuck PENDING rows

If `memory_write_events` accumulates >100 PENDING rows, something is wrong:

1. Check log drain for worker errors
2. Run `npm run cron:memory-sweep` manually
3. If still stuck, query a stuck row, examine its memory + extractedEntities — sometimes a malformed memory blocks the pattern extractor

### Trigram threshold tuning

The 0.85 / 0.65 thresholds are starting points. Tune via the 100-pair fixture:

- If too many UPDATEs land that should be ADDs → raise 0.85 to 0.90
- If too many NOOPs land that should be UPDATEs → lower 0.85 to 0.80
- If PENDING_REVIEW pile is huge → narrow the band (e.g., 0.65-0.85 → 0.70-0.85)

Document each tuning in `docs/architecture/memory-consolidation.md`.

## Don't ship unless

- All 8 verification items pass
- 100-pair precision test asserts ≥70% on UPDATE+NOOP
- Flag-OFF eval within 3% of baseline
- Flag-ON eval within 3% of baseline (staging first)
- Rollback SQL script tested against staging
- Worker stable for 24h with flag OFF in production before flipping to ON
