# Phase 1 — Schema Alignment + Bi-Temporal-Lite

**Time budget:** 1.5 weeks
**Confidence:** HIGH
**Owner:** Solo dev
**Blast radius:** Medium — schema migration, but additive (nullable columns, new tables); no data loss path if procedures followed

---

## What this phase is

Two parallel tracks landing in one shipping unit:

**Track A — Migration foundation hardening (data-integrity audit's "Phase 1 must do FIRST"):**

1. Stop the bleeding: change `docker-entrypoint.sh` to remove `--accept-data-loss` from `prisma db push`. A typo'd schema change can no longer destroy a column on the next Railway boot.
2. Off-Railway `pg_dump -Fc` of production to a verified S3-compatible bucket (Cloudflare R2). The rollback floor for everything else.
3. Quarantine the 6 orphan `2025-04-*` migrations into `prisma/migrations/_archived/`. They reference snake_case mismatches and abandoned mem0 tables; left in place they will fire on the eventual `migrate deploy` switch.

**Track B — Schema alignment for mem0 core (validator's plan §2 row 1):**

4. New Prisma models: `ExtractedEntity`, `EntityRelationship`, `EntityExtractionEvent`, `RelationshipEvidence`, `MemoryWriteEvent` (the durability layer required by Phase 2 per validator §4.2).
5. New nullable columns on six link tables (`GoalProjectLink`, `ProjectPersonLink`, `ProjectTaskLink`, `DecisionProjectLink`, `TaskDependency`, `CommitmentLink`): `validFrom`, `validTo`, `supersededBy` — the bi-temporal-lite scaffolding.
6. New `MemoryEntry.memoryType` enum (`SEMANTIC` / `EPISODIC` / `PROCEDURAL`), default `SEMANTIC`, with a heuristic backfill job. Per validator §4.3 the existing `MemoryClass` enum stays — different axis.
7. New Zod schemas in `packages/shared/src/validation/` (existing convention is `*.schema.ts`): `extracted-entity.schema.ts`, `entity-relationship.schema.ts`, `memory-consolidation.schema.ts`, `memory-write-event.schema.ts`. Companion TypeScript interfaces in `packages/shared/src/types/` (existing convention is `*.types.ts`).
8. Predicate exclusion list for `EntityRelationship` per validator §4.6 — runtime guard in `relationship.service.ts` rejects writes that would duplicate the typed link tables.

## Why now

Phase 2 cannot ship without `MemoryWriteEvent`. The validator §4.2 calls this out explicitly: doubling work classes onto the in-memory queue without persisted intent doubles the blast radius of restart-on-Railway. Track B exists to make that durability layer real.

Track A exists because every later phase touches the schema. Doing schema work on top of `prisma db push --accept-data-loss` means one careless edit destroys a column. The flag must be off before Phase 2 starts adding columns.

## Prereqs

- Phase 0 complete (clean baseline)
- Phase 0.25 complete (security/data fixes; otherwise we're hardening migration on a leaky base)
- Phase 0.5 complete (eval harness must produce a baseline BEFORE schema changes; the new `memoryType` enum could shift retrieval and we need to detect it)

## Exit criteria

| Criterion | How to verify |
|---|---|
| `--accept-data-loss` removed from entrypoint | `grep accept-data-loss packages/omnimind-api/docker-entrypoint.sh` returns empty |
| Off-Railway backup exists and verified | A test restore of the dump into a throwaway DB succeeds with `prisma migrate status`-equivalent |
| 6 orphan migrations quarantined | `ls packages/omnimind-api/prisma/migrations/_archived/` shows the 6 dirs |
| 5 new Prisma models added | `grep -c "^model " packages/omnimind-api/prisma/schema.prisma` increases by exactly 5 |
| Bi-temporal columns added to 6 link tables | All 6 have `validFrom`, `validTo`, `supersededBy` nullable columns |
| `memoryType` enum added with default | `MemoryEntry.memoryType` field exists with default `SEMANTIC` |
| Backfill job runs and tags rows | After backfill, `SELECT memoryType, count(*) FROM memory_entries GROUP BY memoryType` shows non-zero counts in EPISODIC and PROCEDURAL |
| Zod schemas + companion interfaces created | `ls packages/shared/src/validation/extracted-entity.schema.ts` etc.; `ls packages/shared/src/types/extracted-entity.types.ts` etc. |
| Predicate exclusion guard tested | Writing an excluded predicate to `EntityRelationship` throws |
| 708 existing tests still green | `npm run test` exit 0 |
| Eval baseline still passes | `npm run eval:retrieval` shows no regression > 3% |

## Dependencies

- **Upstream:** Phase 0, 0.25, 0.5
- **Downstream blocker:** Phase 2 needs `MemoryWriteEvent` table, `ExtractedEntity` table, all four Zod schemas, and the bi-temporal columns

## Time budget detail

| Track | Hours |
|---|---|
| A1 — Remove `--accept-data-loss`; add gating env var `MIGRATE_PROTECTION` | 2 |
| A2 — Off-Railway pg_dump scripted to R2; verified restore drill | 4 |
| A3 — Quarantine 6 orphan migrations + commit | 1 |
| B1 — Add 5 new Prisma models + bi-temporal columns | 4 |
| B2 — Add `memoryType` enum + heuristic backfill cron | 3 |
| B3 — Zod schemas + companion TS interfaces | 4 |
| B4 — Predicate exclusion enum + runtime guard in `relationship.service.ts` | 2 |
| Tests for new schemas + guards + backfill | 5 |
| Verify + deploy + smoke test + re-baseline eval | 3 |
| **Total** | **~28 hours / 1.5 weeks at solo cadence** |

## Risks accepted

- **Track A2 (off-Railway backup)** is a one-time scripted job. No schedule yet — that's Phase 13 territory. Acceptable because the hourly-WAL-restore use case is not a 0.5-week gain.
- **Bi-temporal columns are nullable.** Existing rows have `validFrom = null` (interpreted as "always valid"). Query-site code MUST filter `WHERE (validFrom IS NULL OR validFrom <= now()) AND (validTo IS NULL OR validTo > now())`. The validator §1 calls this out as a top-3 risk. Mitigation: build a helper `withTemporalFilter(query)` and require its use in any service that touches the 6 link tables.
- **`memoryType` backfill is heuristic.** Some rows will be miscategorized. Acceptable because the enum is ranker-only (Phase 7); wrong values = wrong rank weight, not data loss. A correction script can re-run anytime.
- **Quarantining orphan migrations is irreversible without git history.** Test the move on a branch first; verify `prisma migrate status` against staging shows no surprise. Document the quarantine in `prisma/migrations/_archived/README.md`.

## Cross-references

- Validator plan: `docs/research/mem0-memory-architectures/stage5-validation/final-recommendation.md` §2 row 1, §4.2-4.6
- Data-integrity audit Phase 1 prereqs: `docs/research/omnimind-roadmap-2026/wave1-audit/data-integrity-audit.md` §A1, §C1, §D1, §E1
- Data-architecture research: `docs/research/omnimind-roadmap-2026/wave1-research/03-data-architecture.md` §1 (baselining), §10 (drift detection)
- Landmines fixed: `02-current-state/LANDMINES.md` (LM-01 `--accept-data-loss`, LM-04 orphan migrations)
- Risk register: `06-risks-and-mitigations/RISK-REGISTER.md` (bi-temporal filter discipline)

---

**Constraints reminder:** Respect ADR-001 (no frameworks), ADR-002 (Anthropic only), ADR-003 (pgvector only), ADR-009 (node-cron only). All prompts in `docs/prompts/*.system.md`. All LLM tool outputs Zod-validated.
