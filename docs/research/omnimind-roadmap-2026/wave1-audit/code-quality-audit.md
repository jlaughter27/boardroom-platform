# OmniMind Roadmap — Wave 1 Code Quality & Tech Debt Audit

**Date:** 2026-04-18
**Scope:** Repository at `feature/folder-migration`. Focus: `packages/omnimind-api`, `packages/boardroom-ai`, `packages/shared`, root scratchpads, prisma migrations.
**Method:** Static inventory of files, imports, prompts, and tests. No runtime analysis.

---

## A. Dead Code Catalog

### A.1 Quarantined `_disabled/` directories — 25 files, ~13,657 LOC

Already excluded from typecheck via `packages/omnimind-api/tsconfig.json` (lines 29–30). All are **safe to delete**: zero imports from active code (verified via grep for `from ['"].*_disabled`).

| Path | LOC | Action |
|---|---|---|
| `packages/omnimind-api/src/services/_disabled/entity-extractor.service.ts` | 849 | Delete |
| `packages/omnimind-api/src/services/_disabled/graph-traversal.service.ts` | 811 | Delete |
| `packages/omnimind-api/src/services/_disabled/integration-test.service.ts` | 470 | Delete |
| `packages/omnimind-api/src/services/_disabled/mem0-entity-pipeline.ts` | 796 | Delete |
| `packages/omnimind-api/src/services/_disabled/memory-graph.service.ts` | 347 | Delete |
| `packages/omnimind-api/src/services/_disabled/memory-health.service.ts` | 254 | Delete |
| `packages/omnimind-api/src/services/_disabled/performance-load-test.service.ts` | 941 | Delete |
| `packages/omnimind-api/src/services/_disabled/query-understanding.service.ts` | 820 | Delete |
| `packages/omnimind-api/src/services/_disabled/rate-limiter-redis.ts` | 155 | Delete |
| `packages/omnimind-api/src/services/_disabled/relationship-builder.service.ts` | 561 | Delete |
| `packages/omnimind-api/src/services/_disabled/rollback-validation.service.ts` | 1,444 | Delete |
| `packages/omnimind-api/src/services/_disabled/search-cache.service.ts` | 699 | Delete |
| `packages/omnimind-api/src/services/_disabled/security-penetration-test.service.ts` | 821 | Delete |
| `packages/omnimind-api/src/services/_disabled/semantic-contradiction.service.ts` | 129 | Delete |
| `packages/omnimind-api/src/services/_disabled/search-analytics.service.ts.bak` | 1,112 | Delete (`.bak` extension means it doesn't even compile) |
| `packages/omnimind-api/src/routes/_disabled/embedding-monitoring.routes.ts` | 127 | Delete |
| `packages/omnimind-api/src/routes/_disabled/memory-graph.routes.ts` | 91 | Delete |
| `packages/omnimind-api/src/routes/_disabled/memory-health.routes.ts` | 144 | Delete |
| `packages/omnimind-api/src/routes/_disabled/memory-maintenance.routes.ts` | 211 | Delete |
| `packages/omnimind-api/tests/unit/services/_disabled/integration-test.service.test.ts` | 488 | Delete |
| `packages/omnimind-api/tests/unit/services/_disabled/performance-load-test.service.test.ts` | 289 | Delete |
| `packages/omnimind-api/tests/unit/services/_disabled/rollback-validation.service.test.ts` | 386 | Delete |
| `packages/omnimind-api/tests/unit/services/_disabled/security-penetration-test.service.test.ts` | 291 | Delete |
| `packages/shared/src/utils/_disabled/hash.ts` | 118 | Delete (replaced by `hashing.ts` 13 LOC) |
| `packages/shared/src/utils/_disabled/token.ts` | 240 | Delete (replaced by `token-counter.ts` 33 LOC) |
| `packages/shared/src/__tests__/_disabled/hash.test.ts` | 120 | Delete |
| `packages/shared/src/__tests__/_disabled/token.test.ts` | 62 | Delete |

**Subtotal: 27 files / 13,659 LOC purgeable.**

### A.2 Active source files that are *de facto* dead

These compile and ship in `dist/` but **no production code path imports them**:

| File | LOC | Status | Action |
|---|---|---|---|
| `packages/omnimind-api/src/services/incremental-embedding.service.ts` | 311 | `queueEmbeddingUpdate`, `generateContentHash`, `calculateContentSimilarity` exported but never called outside the file | Delete |
| `packages/omnimind-api/src/services/semantic-dedup.service.ts` | 263 | Only consumer is `_disabled/memory-maintenance.routes.ts` | Delete (or un-quarantine the route if dedup is wanted) |
| `packages/omnimind-api/src/retrieval/semantic-search-guard.ts` | 175 | Only consumer is `_disabled/embedding-monitoring.routes.ts` | Delete |
| `packages/omnimind-api/src/jobs/memory-cleanup.job.ts` | 272 | `runMemoryCleanup` only called by `_disabled/memory-maintenance.routes.ts` and `memory-cleanup-scheduler.ts` (also dead) | Delete |
| `packages/omnimind-api/src/jobs/memory-cleanup-scheduler.ts` | 163 | `startMemoryCleanupScheduler` exported but **never called** in `src/index.ts` (only `startCortexScheduler` is) | Delete |
| `packages/omnimind-api/src/lib/migration-manager.ts` | 460 | `MigrationManager` class never imported. Pure orphan. | Delete |
| `packages/omnimind-api/src/lib/redlock.ts` | 66 | Only consumer is the dead `memory-cleanup-scheduler.ts` | Delete (after #5) |

**Subtotal: 7 files / 1,710 LOC of "live" but unused code.**

### A.3 Schema dead column

`packages/omnimind-api/prisma/schema.prisma` line 202:

```
searchVector   Unsupported("tsvector")?   @map("search_vector")  // Generated column for full-text search
```

The repo's actual full-text search (`packages/omnimind-api/src/retrieval/fulltext-search.ts`) computes `to_tsvector('english', content)` inline via raw SQL. The `search_vector` column is referenced **only** in this Prisma model and in three migration files. It is unused in any service or route. **Action: drop column + migration; remove from schema.**

### A.4 Stale Prisma migrations (six 2025-04-12 files)

| Migration | LOC SQL | Status |
|---|---|---|
| `20250410_add_search_indexes` | 48 | Likely needed (trigram + FTS GIN indexes) — keep |
| `20250412010000_add_row_security_policies` | 373 | RLS policies. **Application code never uses `getPrismaClient(userId)` — RLS is enforced only at DB layer.** Keep schema-side, but document that it's the *only* RLS enforcement. |
| `20250412020000_add_foreign_key_constraints` | 400 | Likely needed — keep |
| `20250412030000_extend_audit_logging` | 546 | Audit tables — verify any service writes to them. None observed in active code. |
| `20250412040000_add_feature_flags` | 597 | `feature_flags` table — no service uses it. Pure orphan. |
| `20250412050000_add_performance_monitoring` | 911 | Performance monitoring tables. No service writes. |
| `20250412060000_add_mem0_hybrid_search` | 734 | Mem0 integration was abandoned (Phase 8 reversal). Tables may be orphan. |

The 2025-04-12 cluster appears to be the now-reverted **Mem0 integration prototype** (matches `_disabled/mem0-entity-pipeline.ts`). Six migrations created 6,498 lines of SQL for code that was deleted.

**Action:** Audit each table created by these migrations for runtime row counts. If empty in production, schedule a `DROP TABLE` migration. Until then, leave migrations in place (Prisma migration history must remain monotonic).

### A.5 Root-level scratchpad markdown

| File | Notes |
|---|---|
| `AUDIT_REPORT.md` | Stray scratchpad |
| `CLAUDE_ARCHITECT.md` | Stray scratchpad |
| `COMMITTEE_PLANNING.md` | Stray scratchpad |
| `SCRATCHPAD_AUDIT.md` | Self-identified scratchpad |
| `SEC-004_VERIFICATION.md` | Verification artifact |
| `migration_state.md` | Mem0 migration state |
| `migration_summary_report.md` | Mem0 migration report |
| `state_of_the_union_report.md` | One-off summary |
| `test_implementation_state.md` | Test scratchpad |
| `implementation_state.json` | Stray JSON |
| `migration_artifacts/` (4 dated `.txt` files) | git-status snapshots from 2026-04-14 |
| `packages/omnimind-api/mem0-test-deployment-simulation-report.md` | Mem0 artifact |
| `docs/MEM0_FINAL_DEV_ROADMAP.md`, `docs/MEM0_INTEGRATION_PLAN.md`, `docs/MEM0_RE_INTEGRATION_PLAN.md`, `docs/MEM0_RISK_MITIGATION_PLAN.md`, `docs/MEM0_USAGE_EXAMPLES.md` | Five Mem0 planning docs for an abandoned initiative |
| `docs/REALITY-BASELINE.md` | New, presumably wave1 baseline — **keep** |
| `docs/prompts/_REFERENCE-old-personas.md` | 62 LOC reference — keep or delete based on whether contributors reference it |

**Action:** Move everything in this list (except `REALITY-BASELINE.md`) into `docs/_archive/2026-04-pre-roadmap/`. Don't delete — they document the Mem0 detour and may be needed for forensic Q&A.

---

## B. Test Coverage Map

### B.1 OmniMind API — service-by-service

| Service file | LOC | Has unit test? | Notes |
|---|---|:---:|---|
| `auth.service.ts` | 112 | yes (`auth.service.test.ts`) | Critical path — covered |
| `commitment.service.ts` | 68 | no | Gap |
| `context-assembler.service.ts` | 160 | no | **Critical retrieval path — gap** |
| `cortex-contradictions.service.ts` | 126 | no | Gap |
| `cortex-memo.service.ts` | 103 | no | Gap |
| `cortex-patterns.service.ts` | 78 | no | Gap |
| `decision.service.ts` | 117 | no | Gap |
| `embedding.service.ts` | 128 | yes | Covered |
| `embedding-queue.ts` | 196 | no | **Production-critical (in-memory queue) — gap** |
| `entity.service.ts` | 96 | no | Gap (covers people/goals/projects/tasks) |
| `incremental-embedding.service.ts` | 311 | no | Dead (delete, no test needed) |
| `memory.service.ts` | 196 | yes | Covered |
| `outcome-review.service.ts` | 104 | no | Gap |
| `relationship.service.ts` | 41 | no | Gap |
| `semantic-dedup.service.ts` | 263 | no | Dead (delete) |
| `simulation.service.ts` | 70 | no | Gap |
| `user-profile.service.ts` | 47 | no | Gap |

**11 active services lack unit tests.** Critical retrieval (`context-assembler`) and the in-memory embedding queue have zero coverage.

### B.2 OmniMind routes — integration tests

| Route | Integration test? |
|---|:---:|
| `health.routes.ts` | yes (`integration/health.test.ts`) |
| `memories.routes.ts` | yes (`integration/memories.test.ts`) |
| All 15 other route files (auth, commitments, context, cortex, custom-personas, decisions, goals, oauth, outcome-review, people, projects, relationships, subscription, tasks, user-profile) | **no** |

**15/17 OmniMind route files have no integration test.** The lone covered routes (memories, health) are the ones touched in Phase 0.

### B.3 BoardRoom AI — server-side coverage

Tests in `packages/boardroom-ai/server/tests/unit/`: 21 files. Coverage of services/middleware is reasonable (`agent`, `auth`, `auth-middleware`, `auth-rate-limiter`, `calculator-tool`, `context-strategy`, `cost-tracker`, `document-read.tool`, `export`, `memory-extractor`, `mode-router`, `omnimind-client`, `prompt-cache`, `session-rate-limiter`, `streaming`, `stripe-service`, `subscription.middleware`, `sufficiency`, `tool-registry`, `validate`).

**Gaps in BoardRoom server:**
- `services/extraction.service.ts` (83 LOC) — no test
- `services/gmail.service.ts` (182 LOC) — no test
- `services/google-calendar.service.ts` (120 LOC) — no test
- `services/llm-quality-scorer.service.ts` (219 LOC) — no test
- `services/streaming-quality.service.ts` (277 LOC) — no test
- `services/transcription.service.ts` (132 LOC) — no test
- `services/commitment-tracker.ts` (55 LOC) — no test
- `agents/orchestrator.ts` (331 LOC) — **no test for the central CEOOrchestrator class**
- `routes/onboarding-bootstrap.routes.ts` (169 LOC) — no test
- `routes/sessions.routes.ts` (230 LOC) — no test (the SSE flow)

### B.4 What the 4 disabled service tests covered

Reviewing the LOC and filenames:
- `integration-test.service.test.ts` (488 LOC) — exercised the now-deleted Mem0 integration test harness
- `performance-load-test.service.test.ts` (289 LOC) — load tests for Mem0
- `rollback-validation.service.test.ts` (386 LOC) — Mem0 migration rollback verification
- `security-penetration-test.service.test.ts` (291 LOC) — security scenarios for the Mem0 hybrid search

All four targeted code already in `_disabled/`. Safe to delete with the source files.

### B.5 Critical-path coverage status

| Path | Tests exist? |
|---|---|
| Auth (JWT issue/verify) | Yes (BoardRoom + OmniMind) |
| Memory validation pipeline | Yes (`memory/budget-enforcer`, `schema-validator`, `temporal-validator`) |
| Memory create / search | Partial (memory.service yes, retrieval gaps) |
| Hybrid retrieval (FTS+trigram+semantic) | Only `fulltext-search.test.ts` and `ranker.test.ts` and `context-packager.test.ts`. **No tests for `semantic-search.ts`, `trigram-search.ts`, `structured-filter.ts`, or the cross-entity search in `context-assembler`.** |
| Rate limiter | Yes |
| OmniMind client (resilience: timeout, retry, breaker) | Yes (`omnimind-client.test.ts`, `omnimind-seam.test.ts`) |
| CEOOrchestrator dispatch + synthesis | **No** |

---

## C. Tech Debt Register (Top 30, severity-ranked)

| # | Severity | Item | Effort | Notes |
|---|---|---|---|---|
| 1 | High | Delete 25 `_disabled/` files (13,657 LOC) | 20 min | Already quarantined, just `git rm -r` |
| 2 | High | Delete 7 active-but-unimported files (1,710 LOC: incremental-embedding, semantic-dedup, semantic-search-guard, memory-cleanup.job, memory-cleanup-scheduler, migration-manager, redlock) | 30 min | Verify no test imports first |
| 3 | High | `package.json` scripts reference deleted paths: `test:integration`, `test:security`, `test:performance`, `test:rollback` all `tsx src/services/...` files now in `_disabled/` | 5 min | Remove from scripts block |
| 4 | High | RLS architecture is half-built — `getPrismaClient(userId)` is exported but **no route uses it**. All routes pass the global `prisma` (no RLS) to services. The 373-LOC ROW SECURITY policies migration is the only RLS enforcement. | 4 h | Either wire `attachRLSClient` middleware in `src/index.ts` and refactor every route to use `req.prisma`, or delete `getPrismaClient`/`attachRLSClient` and document DB-only RLS |
| 5 | High | CEOOrchestrator `dispatch` (lines 57–178, ~120 LOC) and `synthesize` (lines 181–291, ~110 LOC) both >50 LOC. Built-in vs custom persona handling duplicated. | 3 h | Extract `runPersona(personaConfig, query, context)` helper; merge built-in + custom paths |
| 6 | High | Inline LLM prompt in `packages/boardroom-ai/server/src/services/llm-quality-scorer.service.ts` lines 19–44 (`QUALITY_EVALUATION_PROMPT`). Violates CLAUDE.md rule 5. | 15 min | Move to `docs/prompts/quality-evaluation.system.md`, load via `loadPrompt` |
| 7 | High | Two services use try/catch fallback to **inline prompt strings** when prompt file load fails (`gmail.service.ts:144`, `simulation.service.ts:54`). Silent prompt drift. | 20 min | Either fail loudly or remove fallback and rely on `prompt-loader.ts`'s caching pattern (used by all other call sites) |
| 8 | High | OmniMind `incremental-embedding.service.ts:31–33` ships a hand-rolled "hash" that is just `content.slice(0, 100) + length`. Misnamed and broken. | n/a | Delete with #2 |
| 9 | High | Six 2025-04-12 migrations created tables (`feature_flags`, audit, performance_monitoring, mem0_hybrid_search) that no service writes to | 2 h | Verify row counts in prod, schedule drop migration |
| 10 | Medium | `embedding-queue.ts` is a single in-memory queue (line 19: `const queue: EmbeddingJob[] = []`) — survives only one process. Already documented as v1 limitation. | 8 h | Replace with DB-backed jobs table or BullMQ when multi-instance |
| 11 | Medium | `db.ts:46` — `attachRLSClient` middleware reads `req.headers['x-user-id']`. The header is consumer-trusted (BoardRoom is the only consumer) but auth.middleware uses API key — mismatched trust model | 1 h | Decide on a single user-identification strategy |
| 12 | Medium | `db.ts:46` types are `(req: any, res: any, next: any)` | 5 min | Replace with `RequestHandler` |
| 13 | Medium | `db.ts:61, 65` — Prisma event handlers cast as `'error' as any` and `(e: any)` | 5 min | Use Prisma's typed event API |
| 14 | Medium | Inconsistent error responses across routes. Some routes inline `res.status(422).json({ error: 'validation_failed', details: ... })` (`memories.routes.ts:18`); others use middleware. No central response builder. | 3 h | Introduce `ApiResponse` helper in shared, route handlers use `res.fail(422, ...)` |
| 15 | Medium | `decision.service.ts:11, 19, 56` uses `: any` casts to satisfy Prisma types | 30 min | Use `Prisma.DecisionCreateInput` and assumption-specific types |
| 16 | Medium | `entity.service.ts` has 5 `any` usages | 30 min | Type concretely |
| 17 | Medium | `db-audit.ts` has 9 `any`/`as any` instances | 1 h | Type concretely |
| 18 | Medium | `CURRENT-STATE.md` says "Sprint 8 / Phase 0 in progress." Root `CLAUDE.md` says Phases 0–3 complete. Hard contradiction — 7+ days stale. | 30 min | Rewrite CURRENT-STATE.md from CLAUDE.md and CURRENT actual state |
| 19 | Medium | `CLAUDE.md` says "26 models" then "32 models" then "34 models" in different sections (lines 132, then in Prisma section, then in Phase 0 description). Schema actually has — needs verification. | 15 min | Count once, write once |
| 20 | Medium | `package.json` ships `openai@^6.33.0` for embeddings. The OpenAI text-embedding-3-small endpoint is also called via raw `fetch` in `embedding.service.ts` — verify SDK is actually used | 10 min | If not used, remove dep |
| 21 | Medium | 75 `any`/`as any`/`as unknown` occurrences in 25 files, 53 of them in active source (excluding `_disabled/` and tests) | 6 h | Knock down file-by-file |
| 22 | Medium | `prompt-loader.ts` exists in **two places** with different implementations: `packages/omnimind-api/src/lib/prompt-loader.ts` (36 LOC) and `packages/boardroom-ai/server/src/lib/prompt-loader.ts`. Should be in `@boardroom/shared`. | 1 h | Move to shared; both servers import |
| 23 | Medium | `logger.ts` exists in **two places**: `packages/omnimind-api/src/lib/logger.ts` (81 LOC) and `packages/boardroom-ai/server/src/lib/logger.ts`. Same pattern. | 1 h | Move to shared |
| 24 | Medium | 35 `console.*` occurrences across 7 files, mostly in scripts. `packages/omnimind-api/src/index.ts:1` imports console — verify usage. | 30 min | Audit, replace with logger |
| 25 | Medium | `memories.routes.ts` lines 14, 38, 47, 63, 76 each repeat the same `if (!userId) return 400` snippet. 200+ identical lines across all routes. | 1 h | Extract `requireUserId(req, res)` middleware |
| 26 | Medium | `eslint.config.js` was added to omnimind-api (untracked) but no equivalent in boardroom-ai or shared | 30 min | Standardize lint config |
| 27 | Low | `db.ts:46` `attachRLSClient` middleware never registered in `app.use` chain | 5 min | Either register or delete (see #4) |
| 28 | Low | `getEmbeddingHealth` exported from `embedding-queue.ts:187` but only called by quarantined route | 10 min | Delete export |
| 29 | Low | `outcome-review.routes.ts` has 2 `any` casts; `cortex.routes.ts` has 1 | 30 min | Type concretely |
| 30 | Low | `_REFERENCE-old-personas.md` (62 LOC) sits next to active prompts and risks confusion | 1 min | Move to `docs/_archive/` |

---

## D. Style / Consistency Findings

1. **Prisma client access is inconsistent.** `db.ts` exports four ways: `prisma` (legacy, no RLS, used by every route), `getPrismaClient(userId)` (RLS-scoped, never called), `systemPrisma` (admin, never called), and `attachRLSClient` middleware (never registered). Pick one and delete the rest.
2. **Error handling pattern varies.** Routes mostly use `try { ... } catch (err) { next(err) }` plus inline 4xx/422 responses. There's no `asyncHandler` wrapper, no consistent envelope. The `omnimind-client.ts` has a separate, much richer model (`CircuitBreaker`, retry with jitter, timeout). Standardize on one.
3. **Logging is consistent within each package** (both packages have a tiny `logger.ts` wrapper around console). But the logger lives in two places.
4. **Prompt loading is inconsistent.** Most call sites use `loadPrompt(id)` / `loadSystemPrompt(id)` from `prompt-loader.ts`. Three call sites do `readFileSync(resolve(__dirname, '../../../../docs/prompts/...'))` with a string fallback (`gmail.service.ts:142`, `simulation.service.ts:49`, `llm-quality-scorer.service.ts:19`). Standardize on the loader.
5. **Validation responses vary.** Some routes return `{ error, details: [{field, message}] }`; some use Express middleware; some use `safeParse` inline. Consolidate.
6. **`as any` is used to bypass enum types** in services that touch Prisma enum fields (decision.service:14, entity.service:5x). The Prisma enum types exist — type the input properly.
7. **`tsconfig.json` excludes `_disabled/`** (good). But the **scripts** in package.json still try to run them (lines 24–27 of `omnimind-api/package.json`). Will fail at runtime.

---

## E. Quick Wins (each <1 hour, ordered by value)

1. **Delete `_disabled/` dirs across all three packages** — drops 13,657 LOC, eliminates contributor confusion. (20 min)
2. **Delete the 7 active-but-unused services** (incremental-embedding, semantic-dedup, semantic-search-guard, memory-cleanup.job, memory-cleanup-scheduler, migration-manager, redlock) — drops 1,710 LOC. (30 min)
3. **Remove broken `package.json` scripts** for `test:integration`, `test:security`, `test:performance`, `test:rollback`. (5 min)
4. **Move `QUALITY_EVALUATION_PROMPT` to `docs/prompts/quality-evaluation.system.md`.** (15 min)
5. **Remove the silent inline-prompt fallbacks** in `gmail.service.ts:144`, `simulation.service.ts:54` — fail loudly if the markdown file is missing. (15 min)
6. **Drop the `searchVector` column** from `schema.prisma` and add a migration. (20 min)
7. **Move root scratchpad markdown** (12 files) to `docs/_archive/2026-04-pre-roadmap/`. (10 min)
8. **Update `docs/CURRENT-STATE.md`** to reflect Phases 0–3 complete. (30 min)
9. **Extract `requireUserId(req, res, next)` middleware** to remove 200+ lines of duplication across routes. (45 min)
10. **Remove or wire `attachRLSClient`** — pick one. If wiring, register it once in `index.ts` and remove the boilerplate. (45 min if wiring; 5 min if deleting)

Total: ~3.5 hours of work, deletes ~15,400 LOC, eliminates two architectural ambiguities.

---

## F. Phase 9 Scope — Concrete `_disabled/` Purge Checklist

When the dedicated cleanup phase fires, the scope should be:

- [ ] `git rm -r packages/omnimind-api/src/services/_disabled/`
- [ ] `git rm -r packages/omnimind-api/src/routes/_disabled/`
- [ ] `git rm -r packages/omnimind-api/tests/unit/services/_disabled/`
- [ ] `git rm -r packages/shared/src/utils/_disabled/`
- [ ] `git rm -r packages/shared/src/__tests__/_disabled/`
- [ ] Remove the `src/services/_disabled/**` and `src/routes/_disabled/**` exclude lines from `packages/omnimind-api/tsconfig.json`
- [ ] Remove `test:integration`, `test:security`, `test:performance`, `test:rollback` scripts from `packages/omnimind-api/package.json`
- [ ] Delete `packages/omnimind-api/src/services/incremental-embedding.service.ts`
- [ ] Delete `packages/omnimind-api/src/services/semantic-dedup.service.ts`
- [ ] Delete `packages/omnimind-api/src/retrieval/semantic-search-guard.ts`
- [ ] Delete `packages/omnimind-api/src/jobs/memory-cleanup.job.ts`
- [ ] Delete `packages/omnimind-api/src/jobs/memory-cleanup-scheduler.ts`
- [ ] Delete `packages/omnimind-api/src/lib/migration-manager.ts`
- [ ] Delete `packages/omnimind-api/src/lib/redlock.ts`
- [ ] Drop `searchVector` from `prisma/schema.prisma`; add `20260418_drop_search_vector` migration
- [ ] Move root-level scratchpad MDs into `docs/_archive/2026-04-pre-roadmap/`
- [ ] Move 5 `MEM0_*.md` docs into `docs/_archive/`
- [ ] Move `migration_artifacts/` into `docs/_archive/`
- [ ] Verify in CI: `npm run typecheck && npm run test && npm run build` all pass
- [ ] Update `docs/CURRENT-STATE.md` to match reality
- [ ] Update `omnimind-api/CLAUDE.md` to remove the "Disabled / quarantined code" section

Estimated total time: **4 hours including verification**.

---

## G. Should the Roadmap Have a Dedicated "Tech Debt" Phase?

**Yes — a single, scoped Phase 9 ("Purge & Standardize") is warranted, *before* any new feature work.**

Reasoning:
- The `_disabled/` quarantine is real, sizable (13.6k LOC), and has been deferred for at least 7 days. Doing it opportunistically inside another feature would mix unrelated diffs and balloon PR review time.
- Several findings are **load-bearing**: the half-wired RLS architecture (D1) and inline prompts (D4) bias every future change. Standardizing once amortizes across all subsequent phases.
- The `package.json` script references to deleted files (#3 in Tech Debt) will trip a fresh contributor on day one.

What does **not** justify a dedicated phase:
- The 75 `any` occurrences (item 21) are low-leverage and can be fixed file-by-file as those files are touched for other reasons.
- The 11 missing service unit tests (Section B.1) should be **gated** rather than batched: any PR touching those services in the roadmap must add the missing test as a precondition.

Recommendation: insert Phase 9 ("Purge `_disabled/` + standardize prompts/Prisma access") between current state and roadmap kickoff. Scope it to Quick Wins #1–10 plus the Tech Debt items #1–9. Budget 1.5 days. Treat any further debt as opportunistic.

---

## Numbers At a Glance

- **Active source LOC:** ~9,000 (omnimind-api `src/`) + ~3,200 (boardroom-ai `server/src/`) + ~3,300 (shared `src/`)
- **Quarantined LOC:** 13,657 (just `_disabled/`)
- **De facto dead LOC in active tree:** 1,710
- **Total purgeable in Phase 9:** **15,367 LOC** (~46% of the omnimind-api tree)
- **Files >800 LOC in active tree:** **0** (largest active files: `omnimind-client.ts` 494, `migration-manager.ts` 460 [DEAD], `orchestrator.ts` 331, `incremental-embedding.service.ts` 311 [DEAD], `entities.routes.ts` 315, `streaming-quality.service.ts` 277, `memory-cleanup.job.ts` 272 [DEAD]). After Phase 9: largest is `omnimind-client.ts` 494.
- **Functions >50 LOC sampled:** `dispatch` 121, `synthesize` 110, `runSimulation` 62, `assembleContextForPersona` (~150). Four offenders in active code.
- **TODO/FIXME/HACK comments:** 2 total in active code (`boardroom-ai/server/src/index.ts:99`, `omnimind-api/src/routes/_disabled/embedding-monitoring.routes.ts:18`). Anomalously low — suggests prior cleanup or that "phase plans" are tracked outside code.
- **`@ts-ignore` / `@ts-expect-error`:** 2 (one in dead code, one in `client/src/components/memory/RelationshipGraph.tsx:53` for D3 zoom — legitimate)
- **Missing prompts in markdown:** 1 confirmed (`QUALITY_EVALUATION_PROMPT` in `llm-quality-scorer.service.ts`); 2 with risky inline-fallback patterns (`gmail.service.ts`, `simulation.service.ts`)
- **System prompts in `docs/prompts/`:** 18 `.system.md` files — exceeds the 7+6+7 (=20) referenced in CLAUDE.md. Some cortex/onboarding prompts may be missing.

---

**End of audit.**
