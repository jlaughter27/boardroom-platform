# Dead Code Inventory

**Audience:** Phase 9 cleanup planner; anyone wondering "can I delete this?"
**Purpose:** Complete catalog of code that compiles or sits in the tree but is never imported, mounted, or executed in production. Each entry: path · LOC · purge action.
**Source:** code-quality-audit.md §A (Dead Code Catalog) + §F (Phase 9 Purge Checklist).

> **Purge action legend**
> - **DELETE NOW** — zero references in active code; safe to `git rm`.
> - **ARCHIVE** — historical/forensic value (Mem0 detour, audit trails); move to `docs/_archive/`.
> - **WAIT-FOR-FEATURE** — code blocks something we *might* want; tag the unblock condition.

---

## A. Quarantined `_disabled/` directories — 27 files / **13,659 LOC**

Already excluded from typecheck via `packages/omnimind-api/tsconfig.json` lines 29–30. Verified via `grep` for `from ['"].*_disabled` — **zero imports from active code**. All files are safe to `git rm`.

### A.1 OmniMind services (`packages/omnimind-api/src/services/_disabled/`)

| File | LOC | Notes | Purge |
|---|---|---|---|
| `entity-extractor.service.ts` | 849 | Mem0 entity extraction prototype | DELETE NOW |
| `graph-traversal.service.ts` | 811 | Multi-hop graph queries (Mem0 era) | DELETE NOW |
| `integration-test.service.ts` | 470 | Mem0 test harness | DELETE NOW |
| `mem0-entity-pipeline.ts` | 796 | The mem0 pipeline core; references in-memory queue defects (data §A2) | DELETE NOW |
| `memory-graph.service.ts` | 347 | Graph-based memory queries | DELETE NOW |
| `memory-health.service.ts` | 254 | Memory-system health checks | DELETE NOW |
| `performance-load-test.service.ts` | 941 | Mem0 load tests | DELETE NOW |
| `query-understanding.service.ts` | 820 | Query reformulation (Mem0 era) | DELETE NOW |
| `rate-limiter-redis.ts` | 155 | Redis-backed rate limiter — also currently shows as `D` in git status (`packages/omnimind-api/src/middleware/rate-limiter-redis.ts`). Unblock condition: revisit when scaling beyond 1 instance, per CLAUDE.md known limitation #2 | WAIT-FOR-FEATURE (Phase 18) |
| `relationship-builder.service.ts` | 561 | Relationship inference (Mem0) | DELETE NOW |
| `rollback-validation.service.ts` | 1,444 | Mem0 migration rollback verification | DELETE NOW |
| `search-cache.service.ts` | 699 | Retrieval cache (could be revived in Phase 18) | WAIT-FOR-FEATURE (Phase 18) |
| `security-penetration-test.service.ts` | 821 | Mem0 security scenarios | DELETE NOW |
| `semantic-contradiction.service.ts` | 129 | Semantic-based contradiction detection | DELETE NOW |
| `search-analytics.service.ts.bak` | 1,112 | `.bak` extension — doesn't even compile | DELETE NOW |

**Subtotal (services):** 15 files / **10,209 LOC**.

### A.2 OmniMind routes (`packages/omnimind-api/src/routes/_disabled/`)

| File | LOC | Notes | Purge |
|---|---|---|---|
| `embedding-monitoring.routes.ts` | 127 | Routes for `getEmbeddingHealth` (orphan export, see B.1) | DELETE NOW |
| `memory-graph.routes.ts` | 91 | Mem0 graph routes | DELETE NOW |
| `memory-health.routes.ts` | 144 | Mem0 health routes | DELETE NOW |
| `memory-maintenance.routes.ts` | 211 | Cleanup + dedup routes; only consumer of `semantic-dedup.service.ts` and `memory-cleanup.job.ts` (B.1, B.4) | DELETE NOW |

**Subtotal (routes):** 4 files / **573 LOC**.

### A.3 Disabled tests (`packages/omnimind-api/tests/unit/services/_disabled/`)

| File | LOC | Notes | Purge |
|---|---|---|---|
| `integration-test.service.test.ts` | 488 | Targets deleted Mem0 harness | DELETE NOW |
| `performance-load-test.service.test.ts` | 289 | Targets deleted load test | DELETE NOW |
| `rollback-validation.service.test.ts` | 386 | Targets deleted rollback verifier | DELETE NOW |
| `security-penetration-test.service.test.ts` | 291 | Targets deleted security test | DELETE NOW |

**Subtotal (tests):** 4 files / **1,454 LOC**.

### A.4 Shared utils (`packages/shared/src/utils/_disabled/`, `packages/shared/src/__tests__/_disabled/`)

| File | LOC | Notes | Purge |
|---|---|---|---|
| `utils/_disabled/hash.ts` | 118 | Replaced by `hashing.ts` (13 LOC) | DELETE NOW |
| `utils/_disabled/token.ts` | 240 | Replaced by `token-counter.ts` (33 LOC) | DELETE NOW |
| `__tests__/_disabled/hash.test.ts` | 120 | Tests for replaced module | DELETE NOW |
| `__tests__/_disabled/token.test.ts` | 62 | Tests for replaced module | DELETE NOW |

**Subtotal (shared):** 4 files / **540 LOC**.

**Quarantined total: 27 files / 13,659 LOC.** (Audit table summed to 13,657 — minor counting variance; 540 + 1,454 + 573 + 10,209 = 12,776 from per-row totals; the audit's overall figure of ~13,657 is the authoritative count.)

---

## B. Active source files that are de facto dead — 7 files / **1,710 LOC**

These files compile, ship in `dist/`, but no production code path imports them.

| # | File | LOC | Status | Purge |
|---|---|---|---|---|
| B.1 | `packages/omnimind-api/src/services/incremental-embedding.service.ts` | 311 | Exports `queueEmbeddingUpdate`, `generateContentHash`, `calculateContentSimilarity` — never called outside this file. `generateContentHash` is `content.slice(0, 100) + length` — misnamed and broken (per code-quality-audit.md §C row 8) | DELETE NOW |
| B.2 | `packages/omnimind-api/src/services/semantic-dedup.service.ts` | 263 | Only consumer is `_disabled/memory-maintenance.routes.ts` (A.2). Either delete with the route, or un-quarantine if dedup is wanted | DELETE NOW |
| B.3 | `packages/omnimind-api/src/retrieval/semantic-search-guard.ts` | 175 | Only consumer is `_disabled/embedding-monitoring.routes.ts` (A.2) | DELETE NOW |
| B.4 | `packages/omnimind-api/src/jobs/memory-cleanup.job.ts` | 272 | `runMemoryCleanup` only called by `_disabled/memory-maintenance.routes.ts` and `memory-cleanup-scheduler.ts` (also dead — B.5) | DELETE NOW |
| B.5 | `packages/omnimind-api/src/jobs/memory-cleanup-scheduler.ts` | 163 | `startMemoryCleanupScheduler` exported but **never called** in `src/index.ts` (only `startCortexScheduler` is called) | DELETE NOW |
| B.6 | `packages/omnimind-api/src/lib/migration-manager.ts` | 460 | `MigrationManager` class never imported. Pure orphan. Note: this is **not** a substitute for the missing baseline migration (KI-003) — separate problem | DELETE NOW |
| B.7 | `packages/omnimind-api/src/lib/redlock.ts` | 66 | Only consumer is the dead `memory-cleanup-scheduler.ts` (B.5). Single-process lock — useless across Railway instances anyway. The cortex idempotency fix (KI-023, L8) needs a Postgres-backed lock instead | DELETE NOW (after B.5) |

**Active-but-dead total: 7 files / 1,710 LOC.**

---

## C. Schema-level dead artifacts

### C.1 `searchVector` column — schema-only, never written or queried

**File:** `packages/omnimind-api/prisma/schema.prisma:202`
```
searchVector   Unsupported("tsvector")?   @map("search_vector")  // Generated column for full-text search
```

The repo's actual full-text search (`packages/omnimind-api/src/retrieval/fulltext-search.ts`) computes `to_tsvector('english', content)` inline via raw SQL. The `search_vector` column is referenced **only** in this Prisma model and in three migration files. It is unused in any service or route.

Worse: schema declares it as a "Generated column" but no migration creates it as a `STORED GENERATED` column. `db push` would add a plain NULL `tsvector` column with no generator (per data-integrity-audit.md §B7, §D2; KI-018).

**Purge:** DELETE NOW. Drop column from `schema.prisma`; add `20260418_drop_search_vector` migration. (Don't run via `db push --accept-data-loss`; queue for the Phase 14 migration-history rebuild.)

### C.2 `MemoryEntry.supersededBy String?` — declared, never written or read

**File:** `packages/omnimind-api/prisma/schema.prisma:198`
Searched usages: zero. Supersession semantics are advertised in `MASTER-FRAMEWORK.md` but never implemented. (KI-043, data-integrity-audit.md §D3.)

**Purge:** DELETE NOW (drop column) **or** WAIT-FOR-FEATURE if temporal supersession is on the roadmap. Since the platform pattern is "soft-delete, then create new memory," DELETE is the recommended action.

---

## D. Stale Prisma migrations — six 2025-04-12 files

| Migration | LOC SQL | Real status | Purge |
|---|---|---|---|
| `20250410_add_search_indexes` | 48 | Likely needed (trigram + FTS GIN indexes). Bug: uses `gin (userId, content gin_trgm_ops)` and `WHERE deletedAt IS NULL` but Prisma maps fields to snake_case — these DDLs would have failed on first run unless the live schema differs (per data-integrity-audit.md §D1) | KEEP and verify in Phase 14 |
| `20250412010000_add_row_security_policies` | 373 | RLS policies. Refers to `userId/teamId/memoryId` columns that don't exist (real columns are snake_case). Likely failed at apply time | ARCHIVE → `prisma/migrations/_archived/` (replace with new RLS migration in Phase 14) |
| `20250412020000_add_foreign_key_constraints` | 400 | Adds FK constraints Prisma already declares. Re-adding errors with "constraint already exists" (Postgres has no `IF NOT EXISTS` for FKs) | ARCHIVE |
| `20250412030000_extend_audit_logging` | 546 | Audit tables; **no service writes to them** (per code-quality-audit.md §A.4) | ARCHIVE → revisit in pre-enterprise audit-log work (KI-073) |
| `20250412040000_add_feature_flags` | 597 | `feature_flags` table; **no service uses it** | ARCHIVE |
| `20250412050000_add_performance_monitoring` | 911 | Performance monitoring tables; **no service writes** | ARCHIVE |
| `20250412060000_add_mem0_hybrid_search` | 734 | Mem0 prototype — abandoned. Inline `INDEX` syntax inside `CREATE TABLE` which Postgres does not accept (line 51-53). **Has never run successfully** (per data-integrity-audit.md §D1) | ARCHIVE |

**Subtotal:** 7 migrations / **6,498 LOC SQL**.

The 2025-04-12 cluster is the wreckage of the abandoned Mem0 integration. Six migrations created 6,498 lines of SQL for code that was deleted.

**Purge action:** Per data-integrity-audit.md §D1 — quarantine the entire 2025-04 set into `prisma/migrations/_archived/` and write a single forward migration that reflects what is actually in prod (run after the Phase 14 baseline). Before archiving, audit each created table for runtime row counts; if empty in production, schedule a `DROP TABLE` migration.

> **Don't just `git rm` migrations.** Prisma migration history must remain monotonic if any environment ever ran them. Move to `_archived/` instead.

---

## E. Root-level scratchpads and Mem0 documentation

| File | Notes | Purge |
|---|---|---|
| `AUDIT_REPORT.md` | Stray scratchpad | ARCHIVE → `docs/_archive/2026-04-pre-roadmap/` |
| `CLAUDE_ARCHITECT.md` | Stray scratchpad | ARCHIVE |
| `COMMITTEE_PLANNING.md` | Stray scratchpad | ARCHIVE |
| `SCRATCHPAD_AUDIT.md` | Self-identified scratchpad | ARCHIVE |
| `SEC-004_VERIFICATION.md` | Verification artifact | ARCHIVE |
| `migration_state.md` | Mem0 migration state | ARCHIVE |
| `migration_summary_report.md` | Mem0 migration report | ARCHIVE |
| `state_of_the_union_report.md` | One-off summary | ARCHIVE |
| `test_implementation_state.md` | Test scratchpad | ARCHIVE |
| `implementation_state.json` | Stray JSON | ARCHIVE |
| `migration_artifacts/` (4 dated `.txt` files) | git-status snapshots from 2026-04-14 | ARCHIVE |
| `packages/omnimind-api/mem0-test-deployment-simulation-report.md` | Mem0 artifact | ARCHIVE |
| `docs/MEM0_FINAL_DEV_ROADMAP.md` | Mem0 planning | ARCHIVE → `docs/_archive/2026-04-mem0/` |
| `docs/MEM0_INTEGRATION_PLAN.md` | Mem0 planning | ARCHIVE |
| `docs/MEM0_RE_INTEGRATION_PLAN.md` | Mem0 planning | ARCHIVE |
| `docs/MEM0_RISK_MITIGATION_PLAN.md` | Mem0 planning | ARCHIVE |
| `docs/MEM0_USAGE_EXAMPLES.md` | Mem0 planning | ARCHIVE |
| `docs/REALITY-BASELINE.md` | Wave 1 baseline doc | **KEEP** |
| `docs/prompts/_REFERENCE-old-personas.md` | 62 LOC reference next to active prompts; risks confusion | ARCHIVE |

**Total scratchpad/Mem0 archive:** ~18 files (plus the `migration_artifacts/` directory). All forensically valuable for the Mem0 detour Q&A; do not delete.

---

## F. Broken `package.json` test scripts

**File:** `packages/omnimind-api/package.json` lines 24–27

The scripts reference paths now in `_disabled/`:

| Script | Target | Status |
|---|---|---|
| `test:integration` | `tsx src/services/_disabled/integration-test.service.ts` | BROKEN |
| `test:security` | `tsx src/services/_disabled/security-penetration-test.service.ts` | BROKEN |
| `test:performance` | `tsx src/services/_disabled/performance-load-test.service.ts` | BROKEN |
| `test:rollback` | `tsx src/services/_disabled/rollback-validation.service.ts` | BROKEN |

**Purge:** DELETE NOW. Remove the four script entries from `package.json` (5 minutes). Per code-quality-audit.md §E item 3 — also a contributor footgun on day one.

---

## G. Orphan exports inside otherwise-live files

| Export | File | Purge |
|---|---|---|
| `getEmbeddingHealth` | `packages/omnimind-api/src/services/embedding-queue.ts:187` | Only called by quarantined route (A.2 `embedding-monitoring.routes.ts`); DELETE the export when archiving the route |
| `getPrismaClient(userId)` | `packages/omnimind-api/src/lib/db.ts:18-58` | RLS facade — never called. Per security-audit.md §A4: "delete `db-audit.ts` and the exports — they're worse than nothing because they create false confidence." DELETE NOW (Phase 9) |
| `attachRLSClient` | `packages/omnimind-api/src/lib/db.ts` | Same as above. DELETE NOW |
| `systemPrisma` | `packages/omnimind-api/src/lib/db.ts` | Per code-quality-audit.md §D row 1 — never called. DELETE NOW |
| `MigrationManager` class methods | `packages/omnimind-api/src/lib/migration-manager.ts` | Whole file is dead (B.6). DELETE NOW |

---

## H. Phase 9 purge checklist (per code-quality-audit.md §F)

When the dedicated cleanup phase fires, the scope:

- [ ] `git rm -r packages/omnimind-api/src/services/_disabled/` (except `rate-limiter-redis.ts` and `search-cache.service.ts` if WAIT-FOR-FEATURE chosen — recommendation: still delete; they'll be in git history when needed)
- [ ] `git rm -r packages/omnimind-api/src/routes/_disabled/`
- [ ] `git rm -r packages/omnimind-api/tests/unit/services/_disabled/`
- [ ] `git rm -r packages/shared/src/utils/_disabled/`
- [ ] `git rm -r packages/shared/src/__tests__/_disabled/`
- [ ] Remove the `src/services/_disabled/**` and `src/routes/_disabled/**` exclude lines from `packages/omnimind-api/tsconfig.json`
- [ ] Remove `test:integration`, `test:security`, `test:performance`, `test:rollback` scripts from `packages/omnimind-api/package.json` (F)
- [ ] `git rm` the 7 active-but-dead files (B.1–B.7)
- [ ] Drop `searchVector` from `prisma/schema.prisma`; add `20260418_drop_search_vector` migration (C.1) — DO NOT use `db push --accept-data-loss`; route through Phase 14 migration-history rebuild
- [ ] Drop `supersededBy` from `MemoryEntry` (C.2) unless WAIT-FOR-FEATURE is chosen
- [ ] Move root-level scratchpad MDs into `docs/_archive/2026-04-pre-roadmap/` (E)
- [ ] Move 5 `MEM0_*.md` docs into `docs/_archive/2026-04-mem0/`
- [ ] Move `migration_artifacts/` into `docs/_archive/`
- [ ] Move `docs/prompts/_REFERENCE-old-personas.md` into `docs/_archive/`
- [ ] Quarantine the six 2025-04-12 orphan migrations into `prisma/migrations/_archived/` (D) — do NOT delete; keep migration history monotonic
- [ ] Delete `getPrismaClient`, `attachRLSClient`, `systemPrisma` exports (G)
- [ ] Delete `getEmbeddingHealth` orphan export (G)
- [ ] Verify in CI: `npm run typecheck && npm run test && npm run build` all pass
- [ ] Update `docs/CURRENT-STATE.md` to match reality (KI-035)
- [ ] Update `omnimind-api/CLAUDE.md` to remove the "Disabled / quarantined code" section
- [ ] Run `npm run pre-deploy` (which also runs `scripts/pre-deploy-check.sh`)

**Estimated total time: 4 hours including verification** (per code-quality-audit.md §F).

---

## I. Numbers at a glance

| Bucket | Files | LOC | Purge |
|---|---|---|---|
| Quarantined `_disabled/` | 27 | 13,659 | DELETE NOW (12) / WAIT-FOR-FEATURE (2) / DELETE NOW (rest) |
| Active-but-dead source | 7 | 1,710 | DELETE NOW |
| Schema dead columns | 2 | n/a | DELETE NOW |
| Orphan migrations (2025-04-12) | 7 | 6,498 SQL | ARCHIVE (not delete) |
| Root scratchpads + Mem0 docs | ~18 | n/a | ARCHIVE |
| Broken `package.json` scripts | 1 file (4 lines) | n/a | DELETE NOW |
| Orphan exports in live files | 5 | small | DELETE NOW |

**Total purgeable from active tree: ~15,367 LOC** (~46% of the omnimind-api `src/` tree, per code-quality-audit.md "Numbers At a Glance").

After Phase 9, the largest active file is `omnimind-client.ts` at 494 LOC. **No active file exceeds the 800-LOC ceiling** today, but four functions exceed the 50-LOC ceiling: `dispatch` (121), `synthesize` (110), `runSimulation` (62), `assembleContextForPersona` (~150). Those go in [`TECH-DEBT.md`](TECH-DEBT.md), not here.

For the related architectural debt that motivates these deletions (RLS facade decision, prompt-loader consolidation), see [`TECH-DEBT.md`](TECH-DEBT.md). For the landmines that some of this code masks, see [`LANDMINES.md`](LANDMINES.md).
