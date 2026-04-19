# PHASE 15 — Tasks & Prompts

---

## Task 15.1 — Pre-flight: snapshot prod, clone to staging, delete archived migrations

**Scope:** No code. Manual ops with explicit confirmations. The next 4 tasks all run against staging first; only Task 15.6 touches prod.

**Prompt:**
> Run these steps in order, with explicit confirmation between each: (1) `pg_dump -Fc $PROD_DATABASE_URL > prod-pre-baseline-{TIMESTAMP}.dump` and verify the dump's size matches expectations. (2) Restore the dump to a fresh staging DB: `pg_restore -d $STAGING_DATABASE_URL prod-pre-baseline-{TIMESTAMP}.dump`. (3) Run `prisma db pull --schema=staging-pulled.prisma` against the staging DB and diff against `prisma/schema.prisma` — they should match exactly; flag any difference (this would indicate untracked drift already exists in prod). (4) DELETE the 6 archived 2025-04 migration directories from `prisma/migrations/` (list them by name first, then delete after confirmation). (5) Commit the deletion with message "chore: remove archived 2025-04 migration attempts ahead of Phase 15 baselining". Report back to me with the dump filename and any drift findings before we proceed.

**Verification:** Dump file exists; staging matches prod; 6 directories removed.

---

## Task 15.2 — Generate baseline migration

**Scope:** Generate `prisma/migrations/0_init/migration.sql` from the current schema (diff-from-empty), hand-edit to add pgvector + pg_trgm + IVFFlat/HNSW DDL.

**Prompt:**
> Generate the baseline migration: `mkdir -p prisma/migrations/0_init && npx prisma migrate diff --from-empty --to-schema-datasource prisma/schema.prisma --script > prisma/migrations/0_init/migration.sql`. Then hand-edit `migration.sql` to: (1) add `CREATE EXTENSION IF NOT EXISTS vector;` and `CREATE EXTENSION IF NOT EXISTS pg_trgm;` at the top, (2) replace any Prisma-emitted placeholder for the embedding column with the correct `vector(1536)` type if Prisma's emitter didn't handle it, (3) add the IVFFlat or HNSW index DDL (read the current production index from `staging-pulled.prisma` or directly from `\d+ "MemoryEntry"` against staging — it MUST match what's actually in prod), (4) add any pg_trgm GIN indexes that exist in prod but aren't represented in `schema.prisma`. Do NOT use `\i` includes — Prisma's runner doesn't support them. Inline everything. After hand-editing, sanity check by re-running `migrate diff --from-empty --to-url=$STAGING_DATABASE_URL --exit-code` — exit 0 means the SQL produces an exact match with staging (which is a clone of prod). If non-zero, iterate on the SQL until it does.

**Verification:** `migrate diff --from-empty --to-url=$STAGING_DATABASE_URL --exit-code` returns 0.

---

## Task 15.3 — Apply baseline to staging via `migrate resolve --applied`

**Scope:** Mark the baseline as applied on staging WITHOUT running the SQL (the schema is already there because we restored from a prod dump).

**Prompt:**
> Against staging: `DATABASE_URL=$STAGING_DATABASE_URL npx prisma migrate resolve --applied 0_init`. This inserts a row into `_prisma_migrations` saying the migration has run, but does NOT execute the SQL. Then run `DATABASE_URL=$STAGING_DATABASE_URL npx prisma migrate status` and verify it reports "Database schema is up to date." Then create a tiny dummy migration to verify the system works end-to-end: `npx prisma migrate dev --name dummy_test_phase_15 --create-only` (creates an empty migration), edit it to add a no-op SQL comment, then `DATABASE_URL=$STAGING_DATABASE_URL npx prisma migrate deploy`. Verify it applies. Then revert the dummy migration (delete the directory and `DELETE FROM _prisma_migrations WHERE migration_name = 'dummy_test_phase_15'`).

**Verification:** `migrate status` reports clean; dummy migration applies and reverts cleanly.

---

## Task 15.4 — Switch entrypoint on staging

**Scope:** Change `docker-entrypoint.sh` to `prisma migrate deploy`. Deploy to staging. Verify the service comes up cleanly across multiple deploys.

**Prompt:**
> Edit `packages/omnimind-api/docker-entrypoint.sh` to replace the `prisma db push --skip-generate --accept-data-loss` line with `npx prisma migrate deploy --schema=prisma/schema.prisma`. Add a guard: if env `ALLOW_DESTRUCTIVE=true`, do NOT run `migrate deploy` — instead run `prisma db push --skip-generate --accept-data-loss` (preserves the escape hatch for emergencies, but only when explicitly enabled). Deploy to staging Railway service. Verify: service comes up cleanly, `migrate status` reports clean, deploy a small no-op change, redeploy, verify the entrypoint runs `migrate deploy` again with no-op result.

**Verification:** Staging deploy passes; logs show `migrate deploy` running, not `db push`.

---

## Task 15.5 — Drift detection CI

**Scope:** Two CI checks. (a) Nightly drift detection against prod. (b) PR check requiring migration file when `schema.prisma` changes.

**Prompt:**
> In `.github/workflows/`: create `nightly-drift-detection.yml` running daily at 03:00 UTC. Step: `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-url $PROD_DATABASE_URL --exit-code`. Use a read-only Postgres role (provision in Task 15.1). On exit code 2 (drift detected), post to a Slack webhook URL from secret `DRIFT_ALERT_SLACK_WEBHOOK` with the diff output attached. In `.github/workflows/`: create `pr-migration-check.yml` running on pull_request when `prisma/schema.prisma` is modified. Steps: detect changes to `schema.prisma`, fail unless a corresponding migration directory was added under `prisma/migrations/`. Provide an override label `migration-skip-ok` for emergency PRs (e.g., comment-only edits to schema.prisma).

**Verification:** Trigger drift manually (apply a schema change to staging without a migration), observe the nightly job alert; create a PR modifying schema.prisma without a migration, observe CI failure.

---

## Task 15.6 — Cutover to prod

**Scope:** Apply baseline on prod and switch the prod entrypoint. Planned during low-traffic window.

**Prompt:**
> Cutover procedure (announce to me before each step, get my OK): (1) Take a fresh `pg_dump` of prod immediately before cutover. (2) Confirm the baseline migration in `prisma/migrations/0_init/` matches prod by running `migrate diff --from-empty --to-url=$PROD_DATABASE_URL --exit-code` from a workstation with prod credentials — exit 0 required. (3) `DATABASE_URL=$PROD_DATABASE_URL npx prisma migrate resolve --applied 0_init`. (4) Verify `migrate status` against prod is clean. (5) Deploy the new entrypoint to prod. (6) Verify the next deploy logs show `migrate deploy` running, not `db push`. (7) Smoke-test: hit `/health`, run a memory write, run a retrieval. (8) Update `STATUS/CURRENT-PHASE.md` to mark Phase 15 done. If ANY step fails, halt and consult the rollback procedure.

**Verification:** Prod is on `migrate deploy`; smoke tests pass.

---

## Task 15.7 — Document expand-contract patterns

**Scope:** Add a new section to `docs/FRAGILE-ZONES.md`.

**Prompt:**
> Add a new section to `docs/FRAGILE-ZONES.md` titled "Schema Migration Safety Patterns" covering: (1) ADD COLUMN with default value (Postgres 11+ instant; for function-call defaults split into 3 deploys per the research doc), (2) RENAME COLUMN as expand-contract (5 steps from research doc §2), (3) DROP COLUMN as 2-phase, (4) ALTER COLUMN TYPE warnings. Include the complete SQL for the trigger-based dual-write pattern. Add a "When to use which" decision tree. Reference `docs/research/omnimind-roadmap-2026/wave1-research/03-data-architecture.md` §2.

**Verification:** Doc reviewed; a junior dev can follow the RENAME COLUMN flow without further questions.

---

## Task 15.8 — Quarterly restore drill runbook

**Scope:** Documentation + the first execution.

**Prompt:**
> In `docs/DEPLOYMENT-RUNBOOK.md`: add a "Quarterly restore drill" section. Steps: (1) fetch the most recent off-Railway `pg_dump` (Phase 18 will set this up; for now, take a fresh one), (2) provision a throwaway Railway Postgres or use a local Docker postgres, (3) `pg_restore` the dump, (4) point a temporary OmniMind instance at it, (5) run `prisma migrate status` and `npm run test` against it, (6) smoke-test critical flows (memory write, retrieval, persona invocation), (7) tear down. Then EXECUTE the drill once, document the actual time taken, fix any runbook errors found.

**Verification:** Runbook validated by execution; total drill time documented.
