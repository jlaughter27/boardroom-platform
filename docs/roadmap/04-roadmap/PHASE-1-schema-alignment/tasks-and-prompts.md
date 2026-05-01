# Phase 1 — Tasks and Prompts

Eight atomic tasks in two tracks (A: migration foundation, B: schema alignment); ~28 hours over 1.5 weeks.

| # | Task | File paths touched | Success criterion | Time |
|---|---|---|---|---|
| 1.A1 | Remove `--accept-data-loss` from entrypoint | `packages/omnimind-api/docker-entrypoint.sh` | Flag gone; new `MIGRATE_PROTECTION` gate present | 2h |
| 1.A2 | Off-Railway pg_dump backup + restore drill | `scripts/backup-prod-postgres.sh` (new), `docs/runbooks/restore-from-backup.md` (new) | Test restore into throwaway DB succeeds | 4h |
| 1.A3 | Quarantine 6 orphan migrations | `packages/omnimind-api/prisma/migrations/_archived/` | 6 dirs moved; `_archived/README.md` explains why | 1h |
| 1.B1 | Add 5 new Prisma models + bi-temporal columns | `packages/omnimind-api/prisma/schema.prisma` | Models + columns present; `prisma generate` succeeds | 4h |
| 1.B2 | `memoryType` enum + heuristic backfill cron | `schema.prisma`, `packages/omnimind-api/src/jobs/memorytype-backfill.job.ts` (new) | Enum present; backfill marks rows | 3h |
| 1.B3 | Zod schemas + companion TS interfaces | `packages/shared/src/validation/`, `packages/shared/src/types/` | 4 schema files + 4 type files; index re-exports | 4h |
| 1.B4 | Predicate exclusion enum + runtime guard | `packages/omnimind-api/src/services/relationship.service.ts` | Excluded predicates throw; tests cover both paths | 2h |
| 1.V | Verify + re-baseline eval + commit | n/a | Tests + eval green; new baseline saved if intentional shift | 3h |

---

## Task 1.A1 — Remove `--accept-data-loss` from production entrypoint

**Prompt:**

> Open `packages/omnimind-api/docker-entrypoint.sh`. Find the line:
>
> ```sh
> prisma db push $SCHEMA --skip-generate --accept-data-loss 2>&1
> ```
>
> Replace with:
>
> ```sh
> if [ "$MIGRATE_PROTECTION" = "1" ]; then
>   echo "MIGRATE_PROTECTION=1: skipping db push (use prisma migrate deploy externally)"
> else
>   # Phase 1 transition: db push WITHOUT --accept-data-loss
>   # If a destructive change is detected, the boot will fail and we will know.
>   prisma db push $SCHEMA --skip-generate 2>&1 || {
>     echo "FATAL: prisma db push failed. A schema change may require manual intervention."
>     echo "If this is a known-safe destructive change, set MIGRATE_PROTECTION=1, run a manual migration, then unset."
>     exit 1
>   }
> fi
> ```
>
> Note: this still uses `db push` (the proper migration history baseline lives in Phase 14). The point of removing `--accept-data-loss` is that destructive changes now FAIL the boot instead of silently dropping data.
>
> Document this in `docs/FRAGILE-ZONES.md` under a new section "Schema migration safety": every destructive schema change (drop column, narrow type, drop table) requires (a) a documented manual migration plan, (b) `MIGRATE_PROTECTION=1` set in Railway env, (c) the manual SQL applied, (d) flag unset, (e) redeploy to confirm boot succeeds.
>
> Test locally first by intentionally removing a non-critical column from `schema.prisma`, running `docker compose up`, and confirming the entrypoint refuses to boot. Restore the schema before committing.

---

## Task 1.A2 — Off-Railway pg_dump backup + verified restore

**Prompt:**

> Build a one-shot scripted backup of production Postgres to Cloudflare R2 (or any S3-compatible bucket).
>
> **Step 1.** Provision an R2 bucket `omnimind-pg-backups`. Generate access key + secret key. Add to a separate password manager / 1Password vault. Do NOT commit credentials.
>
> **Step 2.** Create `scripts/backup-prod-postgres.sh`:
>
> ```bash
> #!/usr/bin/env bash
> set -euo pipefail
> : "${PROD_DATABASE_URL:?required}"
> : "${R2_ENDPOINT:?required}"
> : "${R2_ACCESS_KEY:?required}"
> : "${R2_SECRET_KEY:?required}"
> : "${R2_BUCKET:?required}"
>
> TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
> DUMP_FILE="omnimind-${TIMESTAMP}.dump"
>
> echo "Dumping prod Postgres to ${DUMP_FILE}..."
> pg_dump -Fc -Z9 "$PROD_DATABASE_URL" -f "/tmp/${DUMP_FILE}"
>
> echo "Encrypting..."
> age -r "$AGE_RECIPIENT" -o "/tmp/${DUMP_FILE}.age" "/tmp/${DUMP_FILE}"
> rm "/tmp/${DUMP_FILE}"
>
> echo "Uploading to R2..."
> AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY" \
>   AWS_SECRET_ACCESS_KEY="$R2_SECRET_KEY" \
>   aws s3 cp "/tmp/${DUMP_FILE}.age" "s3://${R2_BUCKET}/${DUMP_FILE}.age" \
>   --endpoint-url "$R2_ENDPOINT"
>
> echo "Done. Backup at s3://${R2_BUCKET}/${DUMP_FILE}.age"
> ```
>
> **Step 3.** Run it once locally with prod credentials. Confirm the dump appears in R2.
>
> **Step 4.** Verify restore: spin a throwaway local Postgres (`docker run --rm -p 5433:5432 -e POSTGRES_PASSWORD=test postgres:16`). Decrypt the dump and `pg_restore -d postgresql://postgres:test@localhost:5433/postgres /tmp/omnimind-XXX.dump`. Run `psql -c "SELECT count(*) FROM memory_entries"` against the restored DB. Confirm the row count matches prod.
>
> **Step 5.** Document in `docs/runbooks/restore-from-backup.md`:
>
> - How to download a backup from R2
> - How to decrypt with age
> - How to spin a throwaway Postgres for verification
> - How to actually restore into a fresh production-like environment
> - The `MIGRATE_PROTECTION=1` flag must be set before booting omnimind-api against a restored DB (otherwise the entrypoint may try to drop columns that the restored data depends on)
>
> **Step 6.** Schedule the script to run weekly via Railway's cron addon, OR (cheaper) run it manually before any phase that touches schema. Document the cadence in the runbook.

---

## Task 1.A3 — Quarantine the 6 orphan 2025-04 migrations

**Prompt:**

> The `packages/omnimind-api/prisma/migrations/` directory contains six 2025-04-* migration directories that reference snake_case mismatches and abandoned mem0 tables. They are inert today (production uses `db push`) but will fire on the eventual `migrate deploy` switch.
>
> Audit list (per data-integrity audit §D1):
>
> - `20250410_add_search_indexes`
> - `20250412010000_add_row_security_policies`
> - `20250412020000_add_foreign_key_constraints`
> - `20250412030000_extend_audit_logging`
> - `20250412040000_add_feature_flags`
> - `20250412050000_add_performance_monitoring`
> - `20250412060000_add_mem0_hybrid_search`
>
> **Step 1.** Verify against production: `psql $PROD_DATABASE_URL -c "SELECT migration_name FROM _prisma_migrations ORDER BY started_at"`. If `_prisma_migrations` is empty (which is the case under `db push`), then none of these have been applied via Prisma's tracking. Their effects (some indexes, some tables) may exist in prod from manual application.
>
> **Step 2.** Create `packages/omnimind-api/prisma/migrations/_archived/` directory. `git mv` all 7 migration directories into it (the 6 orphans plus `20250410_add_search_indexes`).
>
> **Step 3.** Write `_archived/README.md`:
>
> ```md
> # Archived Migrations
>
> These migrations were created during the 2025-04 mem0 prototype effort that was reverted.
> They are quarantined here because:
>
> 1. They reference snake_case column names that don't match current Prisma field generation.
> 2. The 20250412060000 migration's CREATE TABLE syntax is invalid on Postgres 16.
> 3. The 20250412040000 / 050000 migrations create tables (`feature_flags`, `performance_monitoring_*`) that no service writes to.
>
> Some side-effects of these migrations DO exist in production (e.g., GIN trigram indexes on memory_entries from 20250410). Phase 14 will properly baseline the actual production state.
>
> Until Phase 14, the entrypoint uses `prisma db push` which ignores the migrations directory entirely. Do NOT move these back without first updating Phase 14's baseline plan.
> ```
>
> **Step 4.** Run `npm run typecheck && npm run test` to confirm nothing in the codebase imports from the migrations dir (it shouldn't, but verify).
>
> Commit. The orphans are now visibly archived without losing git history.

---

## Task 1.B1 — Add 5 new Prisma models + bi-temporal columns

**Prompt:**

> Open `packages/omnimind-api/prisma/schema.prisma`. Add the following 5 new models. Place them in a clearly-marked "// Phase 1 mem0 schema additions" section near the bottom of the file.
>
> ```prisma
> enum EntityType {
>   PERSON
>   ORG
>   URL
>   DATE
>   MENTION
>   TOPIC
> }
>
> enum RelationshipPredicate {
>   MENTIONS
>   REFERENCES
>   DISCUSSES
>   CONCERNS
>   SUCCEEDS
>   PRECEDES
>   RELATES_TO
>   CONTRADICTS
>   SUPPORTS
>   CLARIFIES
> }
>
> enum RelationshipConfidence {
>   ACTIVE
>   PENDING_REVIEW
>   REJECTED
> }
>
> enum MemoryWriteAction {
>   ADD
>   UPDATE
>   DELETE
>   NOOP
> }
>
> enum ConsolidationStatus {
>   PENDING
>   PROCESSING
>   APPLIED
>   FAILED
> }
>
> model ExtractedEntity {
>   id            String     @id @default(cuid())
>   userId        String     @map("user_id")
>   entityType    EntityType @map("entity_type")
>   canonicalName String     @map("canonical_name")
>   surfaceForms  String[]   @map("surface_forms")
>   confidence    Float      @default(1.0)
>   extractedAt   DateTime   @default(now()) @map("extracted_at")
>   updatedAt     DateTime   @updatedAt @map("updated_at")
>   deletedAt     DateTime?  @map("deleted_at")
>
>   @@index([userId, entityType])
>   @@index([userId, canonicalName])
>   @@map("extracted_entities")
> }
>
> model EntityRelationship {
>   id           String                 @id @default(cuid())
>   userId       String                 @map("user_id")
>   sourceId     String                 @map("source_id")
>   targetId     String                 @map("target_id")
>   predicate    RelationshipPredicate
>   confidence   Float                  @default(1.0)
>   status       RelationshipConfidence @default(ACTIVE)
>   evidenceCount Int                   @default(0) @map("evidence_count")
>   createdAt    DateTime               @default(now()) @map("created_at")
>   updatedAt    DateTime               @updatedAt @map("updated_at")
>   deletedAt    DateTime?              @map("deleted_at")
>
>   @@index([userId, sourceId])
>   @@index([userId, targetId])
>   @@index([userId, predicate])
>   @@unique([userId, sourceId, targetId, predicate])
>   @@map("entity_relationships")
> }
>
> model EntityExtractionEvent {
>   id          String   @id @default(cuid())
>   userId      String   @map("user_id")
>   memoryId    String   @map("memory_id")
>   extractor   String   // "pattern" | "llm:haiku-4.5" | etc.
>   entityCount Int      @default(0) @map("entity_count")
>   durationMs  Int      @map("duration_ms")
>   createdAt   DateTime @default(now()) @map("created_at")
>
>   @@index([userId, createdAt])
>   @@index([memoryId])
>   @@map("entity_extraction_events")
> }
>
> model RelationshipEvidence {
>   id              String   @id @default(cuid())
>   relationshipId  String   @map("relationship_id")
>   memoryId        String   @map("memory_id")
>   excerpt         String   @db.Text
>   createdAt       DateTime @default(now()) @map("created_at")
>
>   @@index([relationshipId])
>   @@index([memoryId])
>   @@map("relationship_evidence")
> }
>
> model MemoryWriteEvent {
>   id                  String              @id @default(cuid())
>   userId              String              @map("user_id")
>   memoryId            String              @map("memory_id")
>   memoryVersion       Int                 @map("memory_version")
>   action              MemoryWriteAction
>   consolidationStatus ConsolidationStatus @default(PENDING) @map("consolidation_status")
>   replayKey           String              @unique @map("replay_key")  // ${memoryId}:${version}:${action}
>   payload             Json?
>   error               String?             @db.Text
>   attempts            Int                 @default(0)
>   createdAt           DateTime            @default(now()) @map("created_at")
>   updatedAt           DateTime            @updatedAt @map("updated_at")
>
>   @@index([userId, consolidationStatus])
>   @@index([memoryId])
>   @@map("memory_write_events")
> }
> ```
>
> Now add bi-temporal columns to the 6 link tables. For each of `GoalProjectLink`, `ProjectPersonLink`, `ProjectTaskLink`, `DecisionProjectLink`, `TaskDependency`, `CommitmentLink`, add:
>
> ```prisma
> validFrom    DateTime?  @map("valid_from")
> validTo      DateTime?  @map("valid_to")
> supersededBy String?    @map("superseded_by")
>
> @@index([validFrom, validTo])
> ```
>
> Run `npx prisma generate` and `npx prisma format` from `packages/omnimind-api/`. Run `npm run typecheck` from the repo root. Fix any type errors that surface (the new models are new — no existing code refers to them yet).
>
> Test the schema deploys correctly: in local dev, `docker compose up` and confirm the entrypoint succeeds (no `--accept-data-loss` to mask issues). `psql -c "\d extracted_entities"` confirms the table is created.

---

## Task 1.B2 — `memoryType` enum + heuristic backfill cron

**Prompt:**

> Add to `schema.prisma`:
>
> ```prisma
> enum MemoryType {
>   SEMANTIC
>   EPISODIC
>   PROCEDURAL
> }
>
> // ... in MemoryEntry model:
> memoryType MemoryType @default(SEMANTIC) @map("memory_type")
> ```
>
> Note: this is a separate axis from the existing `MemoryClass` enum (`WORKING / EPISODIC / SEMANTIC / DECISION`). Both stay. `memoryType` answers "what kind of fact is this?"; `MemoryClass` answers "what's its lifecycle?"
>
> Create `packages/omnimind-api/src/jobs/memorytype-backfill.job.ts`. The job:
>
> 1. Selects rows where `memoryType IS NULL` (post-migration, all existing rows will default to `SEMANTIC` — but new rows from any source might still be unset; treat the job as idempotent).
> 2. Heuristic rules (in order):
>    - If `sourceType = 'BOARDROOM_SESSION'` → `EPISODIC`
>    - If linked from `UserProfile` or `ContextCapsule` → `PROCEDURAL`
>    - Else → `SEMANTIC`
> 3. Updates rows in batches of 500 to avoid long locks.
> 4. Logs counts by category.
>
> Wire as a one-shot script (NOT a recurring cron) — runs once after Phase 1 deploys to backfill existing rows. Add `npm run backfill:memory-type` to `packages/omnimind-api/package.json`.
>
> Document the heuristic in `docs/architecture/memory-types.md` (new file): what each type means, how to add a new heuristic, when to re-run the backfill.

---

## Task 1.B3 — Zod schemas + companion TypeScript interfaces

**Prompt:**

> Per CLAUDE.md rule 10, every Prisma model needs a companion Zod schema and TS interface in `@boardroom/shared`.
>
> Create the following files in `packages/shared/src/validation/` (the existing convention is `*.schema.ts`):
>
> - `extracted-entity.schema.ts` — `ExtractedEntitySchema`, `EntityTypeEnum`, `CreateExtractedEntitySchema`, `UpdateExtractedEntitySchema`
> - `entity-relationship.schema.ts` — `EntityRelationshipSchema`, `RelationshipPredicateEnum`, `RelationshipConfidenceEnum`, `CreateEntityRelationshipSchema`
> - `memory-consolidation.schema.ts` — `MemoryConsolidationActionSchema` with shape `{ action: 'ADD'|'UPDATE'|'DELETE'|'NOOP', targetMemoryId?: string, reason: string, confidence: number }`. This is the LLM tool-output schema for Phase 5b.
> - `memory-write-event.schema.ts` — `MemoryWriteEventSchema`, `ConsolidationStatusEnum`
>
> Create companion TS interfaces in `packages/shared/src/types/` (the existing convention is `*.types.ts`):
>
> - `extracted-entity.types.ts` — `interface ExtractedEntity { ... }`
> - `entity-relationship.types.ts` — `interface EntityRelationship { ... }`
> - `memory-consolidation.types.ts` — `interface MemoryConsolidationAction { ... }`
> - `memory-write-event.types.ts` — `interface MemoryWriteEvent { ... }`
>
> Add re-exports to `packages/shared/src/index.ts`.
>
> Critical: schemas and interfaces must stay structurally identical (CLAUDE.md rule 10). Use `z.infer<typeof XxxSchema>` to generate types from the Zod schema and re-export — when in doubt, infer rather than hand-write. Field-by-field check against `prisma/schema.prisma`.
>
> Add unit tests: a representative input passes the schema; missing required fields fail; extra fields fail (`.strict()` everywhere).

---

## Task 1.B4 — Predicate exclusion enum + runtime guard

**Prompt:**

> Per validator §4.6, `EntityRelationship` must NOT duplicate the typed link tables. Add a runtime guard to `packages/omnimind-api/src/services/relationship.service.ts`.
>
> **Step 1.** In `packages/shared/src/constants/relationship-config.ts` (new file):
>
> ```ts
> export const EXCLUDED_RELATIONSHIP_PREDICATES = [
>   'task-depends-on-task',
>   'goal-has-project',
>   'project-belongs-to-goal',
>   'project-has-task',
>   'task-belongs-to-project',
>   'project-involves-person',
>   'person-works-on-project',
>   'decision-affects-project',
>   'project-affected-by-decision',
>   'commitment-blocks',
> ] as const;
>
> export type ExcludedPredicate = typeof EXCLUDED_RELATIONSHIP_PREDICATES[number];
>
> export function isExcludedPredicate(predicate: string): boolean {
>   return EXCLUDED_RELATIONSHIP_PREDICATES.includes(predicate as ExcludedPredicate);
> }
> ```
>
> **Step 2.** In `relationship.service.ts`, the create / upsert function MUST check:
>
> ```ts
> import { isExcludedPredicate } from '@boardroom/shared';
>
> export async function createRelationship(input: CreateEntityRelationshipInput) {
>   if (isExcludedPredicate(input.predicate)) {
>     logger.warn({ predicate: input.predicate }, 'Rejected EntityRelationship write for predicate covered by typed link table');
>     throw new Error(`predicate_excluded: ${input.predicate}`);
>   }
>   // ... proceed with create
> }
> ```
>
> **Step 3.** Add unit tests in `packages/omnimind-api/tests/unit/services/relationship.service.test.ts`:
>
> - Allowed predicate (`mentions`, `relates-to`) → succeeds
> - Excluded predicate (`task-depends-on-task`) → throws with message containing `predicate_excluded`
>
> Document the exclusion list in `docs/architecture/entity-graph.md` (new file): why typed link tables are canonical, what `EntityRelationship` is for (free-form / inferred), how to add a new predicate.

---

## Task 1.V — Verify, re-baseline eval, commit

**Prompt:**

> 1. Run `npm run typecheck` and `npm run test` from repo root. All green.
> 2. Run `npm run eval:retrieval` (Phase 0.5 harness). Save output. Compare to `eval/baselines/2026-04.json`. The new schema should not change retrieval — if metrics differ by >3%, investigate before snapshotting.
> 3. If metrics are stable: commit everything in one commit. If metrics shifted intentionally (e.g., the `memoryType` backfill changed retrieval mix in an expected way): save a new `eval/baselines/2026-05-post-phase-1.json` and update `scripts/pre-deploy-check.sh` to point at it.
> 4. Run `npm run backfill:memory-type` against staging FIRST to verify the heuristic produces sensible counts. Then prod.
> 5. Deploy. Smoke test: hit `/health` on both services. Open BoardRoom UI, run a few queries — no regression in user-facing behavior.
>
> Commit message:
>
> ```
> feat(phase-1): schema alignment + bi-temporal-lite + migration safety
>
> Track A — Migration foundation:
> - Remove --accept-data-loss from docker-entrypoint.sh; add MIGRATE_PROTECTION gate
> - scripts/backup-prod-postgres.sh with verified R2 + age encryption + restore drill
> - Quarantine 6 orphan 2025-04 migrations into prisma/migrations/_archived/
>
> Track B — Schema for mem0 core:
> - 5 new models: ExtractedEntity, EntityRelationship, EntityExtractionEvent,
>   RelationshipEvidence, MemoryWriteEvent
> - Bi-temporal-lite columns on 6 link tables (validFrom, validTo, supersededBy)
> - MemoryType enum (SEMANTIC | EPISODIC | PROCEDURAL) + heuristic backfill
> - Zod schemas + companion interfaces in @boardroom/shared
> - Predicate exclusion guard in relationship.service.ts
>
> Tests + eval baseline still green.
> ```
