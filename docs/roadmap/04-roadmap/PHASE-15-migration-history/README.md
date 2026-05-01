# PHASE 15 — Migration History (defuse the `prisma db push` landmine)

**Time budget:** 1 week
**Sequence:** Pulled forward in spirit (the Phase 0 and Phase 1 work already addressed the most acute risks); this phase formalizes baseline + drift detection + the entrypoint switch.
**Owner:** dev
**Confidence:** HIGH (well-documented Prisma workflow; risk is operational not technical)

---

## What this is

Move from `prisma db push --accept-data-loss` (today's entrypoint) to **proper migration history with `prisma migrate deploy`** plus drift detection in CI. Every Phase 1-14 schema change has been pushed without a recorded migration; this phase backfills the history, switches the entrypoint, and adds CI guard rails so future drift is caught immediately.

Concretely:

- **Baseline migration via the documented Prisma workflow.** Generate `prisma/migrations/0_init/migration.sql` from the current schema (diff-from-empty, NOT diff-from-database to avoid encoding drift), hand-edit to inline `CREATE EXTENSION` and pgvector index DDL, then `prisma migrate resolve --applied 0_init` on every environment so the migration is recorded as already-applied without re-running the SQL.
- **Switch entrypoint.** `docker-entrypoint.sh` changes from `prisma db push --skip-generate --accept-data-loss` to `prisma migrate deploy`. The `--accept-data-loss` flag is REMOVED. A `prisma db push` is now a manual, gated operation requiring an explicit env flag.
- **Drift detection CI.** Nightly GitHub Action runs `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-url $PROD_DATABASE_URL --exit-code`. Exit 2 (drift detected) pages on-call.
- **Drift detection PR check.** Every PR with `schema.prisma` changes must include a corresponding migration file. CI fails otherwise.
- **Document expand-contract.** `docs/FRAGILE-ZONES.md` gets a new section on safe migration patterns (ADD COLUMN, RENAME COLUMN, DROP COLUMN, ALTER COLUMN TYPE) per the research doc.
- **Restore drill cadence.** Every quarter, restore the latest off-Railway `pg_dump` (set up in Phase 18) to a throwaway DB, run `prisma migrate status` and a smoke-test query suite. Quarterly drill becomes part of the release checklist.

---

## Why now

1. **Foundational risk reduction.** The current entrypoint is one careless `schema.prisma` edit away from total data loss. Every day on `db push --accept-data-loss` is a bet against engineer attention.
2. **Phase 16 cortex isolation needs schema discipline.** Two services sharing a database with no migration coordination is asking for breakage.
3. **External developers (post-Phase 13 SDK) deserve schema stability.** A SDK consumer hitting a column-renamed-without-migration scenario is a credibility hit.

## Prerequisites

- Phase 0 and Phase 1 complete (Phase 0 already removed `--accept-data-loss` per the Wave 1 audit's "stop the bleeding" recommendation; this phase formalizes the rest)
- A verified-good `pg_dump` of prod from <24h ago, restored to a staging DB (smoke-tested), as the rollback floor
- The 6 archived 2025-04 migration directories DELETED from `prisma/migrations/` (must happen before baselining; see Task 15.1)
- All currently-running schema changes paused for the duration of the cutover (~2 hours of focused work, planned during a low-traffic window)

## Exit criteria

- [ ] `prisma/migrations/0_init/migration.sql` exists and matches current schema (verified by `migrate diff --from-empty --to-url=$PROD_URL --exit-code` returning 0)
- [ ] `_prisma_migrations` table populated on prod, staging, and dev environments
- [ ] `docker-entrypoint.sh` runs `prisma migrate deploy`, NOT `prisma db push`
- [ ] `--accept-data-loss` flag removed from all entrypoints; any `db push` invocation requires explicit `ALLOW_DESTRUCTIVE=true` env
- [ ] Nightly GitHub Action runs drift detection; alerts on drift
- [ ] PR check requires migration file when `schema.prisma` changes
- [ ] `docs/FRAGILE-ZONES.md` updated with expand-contract patterns
- [ ] Quarterly restore drill documented in `docs/DEPLOYMENT-RUNBOOK.md`
- [ ] Manual restore drill executed once and the runbook validated against it
- [ ] All Phase 1-14 schema changes are reflected in the baseline; no drift exists

## Dependencies

- **Upstream:** Phase 0 (already removed the flag), Phase 18 (off-Railway `pg_dump` for the rollback floor — but this phase can ship before Phase 18 if a manual one-time `pg_dump` is taken)
- **Downstream blocks:** Phase 16 cortex isolation (two services need migration coordination); any future schema change benefits
- **Concurrency:** Sequential. Cannot run migrations or schema changes from any other phase during the cutover window.

## Blast radius

- **Highest-risk operational phase in the make-it-10 + scale block.** A botched baseline can leave prod and migration history out of sync, which means the next migration attempt either skips needed changes or tries to re-create existing tables.
- **Mitigations:** (1) clone prod to staging FIRST and execute the entire procedure on staging before touching prod; (2) `pg_dump` of prod within 1 hour of the cutover; (3) cutover during a planned low-traffic window with a 2-hour rollback budget.
- **Rollback:** Revert the entrypoint to `prisma db push` (without `--accept-data-loss`), `DELETE FROM _prisma_migrations` if migration table state is corrupted, restore from `pg_dump` if data is corrupted (very unlikely — baseline is metadata-only).

---

**Constraints reminder:** Respect ADR-001 (no frameworks), ADR-002 (Anthropic only), ADR-003 (pgvector only), ADR-009 (node-cron only). All prompts in `docs/prompts/*.system.md`. All LLM tool outputs Zod-validated. CLAUDE.md service-boundary rules apply.
