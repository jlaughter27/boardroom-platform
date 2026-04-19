# Phase 1 — Testing and Rollback

## Verification per task

| Task | Verification |
|---|---|
| 1.A1 entrypoint | `grep accept-data-loss packages/omnimind-api/docker-entrypoint.sh` empty; intentional destructive change locally → boot fails with the new fatal log |
| 1.A2 backup | `aws s3 ls s3://omnimind-pg-backups/ --endpoint-url $R2_ENDPOINT` shows the dump; restore drill into throwaway Postgres returns matching row counts; runbook at `docs/runbooks/restore-from-backup.md` exists |
| 1.A3 quarantine | `ls packages/omnimind-api/prisma/migrations/_archived/` shows 7 dirs; `ls packages/omnimind-api/prisma/migrations/` shows none of the 2025-04-* dirs at top level |
| 1.B1 new models | `grep -c "^model " packages/omnimind-api/prisma/schema.prisma` increased by 5; `psql -c "\dt extracted_entities entity_relationships entity_extraction_events relationship_evidence memory_write_events"` shows all 5 tables; bi-temporal columns visible on all 6 link tables via `\d goal_project_links` etc. |
| 1.B2 memoryType | `psql -c "SELECT memory_type, count(*) FROM memory_entries GROUP BY memory_type"` shows non-zero in EPISODIC and PROCEDURAL after backfill runs |
| 1.B3 Zod + types | `ls packages/shared/src/validation/{extracted-entity,entity-relationship,memory-consolidation,memory-write-event}.schema.ts` all exist; `ls packages/shared/src/types/{extracted-entity,entity-relationship,memory-consolidation,memory-write-event}.types.ts` all exist; `npm run typecheck` from `@boardroom/shared` green; unit tests on each schema cover happy + missing-required + extra-key cases |
| 1.B4 predicate guard | Test asserts `createRelationship({ predicate: 'task-depends-on-task' })` throws `predicate_excluded`; allowed predicate (`mentions`) succeeds |
| 1.V verify | `npm run typecheck && npm run test` exit 0; `npm run eval:retrieval` within 3% of baseline (or new baseline saved); both Railway services healthy after deploy |

## Smoke test after deploy

1. `/health` on both services → 200.
2. Create a memory via the BoardRoom UI. Verify in psql that the row has `memory_type = 'SEMANTIC'` (or `EPISODIC` if from a session source).
3. Verify `MemoryWriteEvent` table has zero rows (no Phase 2 work yet — table is just there waiting).
4. Verify the bi-temporal columns are nullable and existing link rows have NULL values (no breakage of existing query paths).
5. Run a few retrieval queries via UI — no perceivable change in behavior.
6. Trigger the backfill cron once (`npm run backfill:memory-type` in Railway shell). Confirm log output shows row counts updated.

## Rollback per task

| Task | Rollback procedure | Time |
|---|---|---|
| 1.A1 entrypoint | `git revert <commit>`. The `--accept-data-loss` flag returns. Justification: only revert if the new fatal-on-destructive-change behavior is blocking a critical hotfix deploy. Set `MIGRATE_PROTECTION=1` instead and run the manual migration. | 5 min |
| 1.A2 backup script | Script is one-shot, no production state to roll back. Just delete the file or leave it dormant. | 1 min |
| 1.A3 quarantine | `git mv` files back from `_archived/` to top-level migrations dir. They're inert under `db push` either way. Don't rollback unless someone explicitly needs them. | 5 min |
| 1.B1 new models | `prisma db push` against the original schema (without the 5 new models) drops the new tables. Existing data unaffected (no other table FKs into the new ones). The bi-temporal column drops require `MIGRATE_PROTECTION=1` toggle + manual SQL: `ALTER TABLE goal_project_links DROP COLUMN valid_from, ...`. ~15 min total. | 15 min |
| 1.B2 memoryType | `ALTER TABLE memory_entries DROP COLUMN memory_type;` plus `git revert` of the schema change. Backfill effects vanish with the column. | 10 min |
| 1.B3 Zod + types | `git revert`. Zero deployment impact (shared package, no runtime side effects until consumed). | 2 min |
| 1.B4 guard | `git revert` removes the throw. `EntityRelationship` accepts excluded predicates again — wrong but not destructive. | 2 min |

## What "destructive change" means in 1.A1

After 1.A1 ships, the entrypoint refuses to boot if a schema change implies dropping data. This includes:

- `DROP COLUMN` (any field removed from `schema.prisma`)
- `DROP TABLE` (any model removed)
- Type narrowing (e.g., `String` → `Int` → Prisma will drop + recreate)

When that happens, the play is:

1. Set `MIGRATE_PROTECTION=1` in Railway env.
2. Redeploy — entrypoint skips `db push`.
3. Open a Railway shell, run the manual migration SQL by hand (with backup taken first via 1.A2 script).
4. Verify the schema matches via `npx prisma db pull` (read prod schema into a local file; diff against `schema.prisma`).
5. Unset `MIGRATE_PROTECTION`.
6. Redeploy — entrypoint runs `db push`, sees no diff, succeeds.

This is a deliberate friction layer. The previous behavior (silent destructive drop) was the landmine.

## Special concerns

### Eval baseline drift after `memoryType` backfill

The `memoryType` enum is currently passive (no ranker uses it until Phase 7). So the backfill SHOULD NOT change retrieval metrics. If it does, that's a signal that some code path is reading the column unexpectedly — investigate before snapshotting a new baseline.

### Bi-temporal filter discipline

The validator §1 names this as a top-3 risk. Today, no service queries the link tables with a temporal filter — the bi-temporal columns are scaffolding for Phase 2 and beyond. Future PRs that touch link table queries MUST filter `WHERE (valid_from IS NULL OR valid_from <= now()) AND (valid_to IS NULL OR valid_to > now())` or use the upcoming `withTemporalFilter()` helper. Until that helper exists (Phase 2), document the convention in `docs/architecture/entity-graph.md`.

## Don't ship unless

- All 9 verification items above pass
- Off-Railway backup taken AND verified-restorable BEFORE Phase 1 deploys
- Backfill tested on staging before production
- Eval harness shows no regression > 3% (or new baseline justified and saved)
- Rollback procedure for 1.A1 understood by Joshua personally (this is the highest-risk change; can't be delegated)
