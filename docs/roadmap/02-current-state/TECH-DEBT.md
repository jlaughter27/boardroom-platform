# Tech Debt Register — Top 30 Items, Severity-Ranked

**Audience:** Phase 9 / Phase 17 planners; anyone scoping a refactor.
**Purpose:** A single severity-ranked register of the top 30 tech-debt items from the Wave 1 audits — duplication, type holes, doc drift, function-size violations, missing tests. Excludes pure dead code (see [`DEAD-CODE.md`](DEAD-CODE.md)) and exploitable bugs (see [`KNOWN-ISSUES.md`](KNOWN-ISSUES.md), [`LANDMINES.md`](LANDMINES.md)).
**Sources:** code-quality-audit.md §C (Tech Debt Register, top 30) + §D (Style/Consistency) + §E (Quick Wins); supporting items from data-integrity-audit.md and security-audit.md.

> **Severity scale**
> 1 = catastrophic · 2 = high · 3 = medium · 4 = low · 5 = cosmetic
>
> **Effort:** 5m / 30m / 1h / 2h / 1d / multi-day
> **Fix phase:** Phase 9 (Purge & Standardize) / Phase 14 (Migration history) / Phase 17 (Resilience) / opportunistic / gated

---

## A. Top 30 — severity-ranked

| ID | Sev | Item | LOC/scope | Fix phase | Effort |
|---|---|---|---|---|---|
| TD-001 | 2 | RLS architecture is half-built — `getPrismaClient(userId)` exported but **no route uses it**. All routes pass the global `prisma` (no RLS) to services. The 373-LOC ROW SECURITY policies migration is the only RLS enforcement (and may have failed at apply time). Per security-audit.md §A4 and code-quality-audit.md §C row 4 | 1 file delete + 17 routes audit | Phase 9 (delete) / Phase 14 (real RLS) | 4h |
| TD-002 | 2 | `CEOOrchestrator.dispatch` (lines 57-178, ~121 LOC) and `synthesize` (lines 181-291, ~110 LOC) both exceed CLAUDE.md's 50-LOC function ceiling. Built-in vs custom persona handling is duplicated across both | `packages/boardroom-ai/server/src/agents/orchestrator.ts` (331 LOC class) | Phase 9 | 3h — extract `runPersona(personaConfig, query, context)` helper; merge built-in + custom paths |
| TD-003 | 2 | Inline LLM prompt violates ADR-005 / CLAUDE.md rule 5: `QUALITY_EVALUATION_PROMPT` defined as a string constant inside the service | `packages/boardroom-ai/server/src/services/llm-quality-scorer.service.ts:19-44` | Phase 9 | 15m — move to `docs/prompts/quality-evaluation.system.md`, load via `loadPrompt` |
| TD-004 | 2 | Two services use try/catch fallback to **inline prompt strings** when prompt file load fails — silent prompt drift the moment a markdown file goes missing or has a typo | `gmail.service.ts:144`, `simulation.service.ts:54` | Phase 9 | 20m — fail loudly or remove fallback; rely on the cached pattern used by all other call sites |
| TD-005 | 2 | `package.json` test scripts reference paths now in `_disabled/` — fresh contributor hits "file not found" on day one. Per code-quality-audit.md §C row 3 | `packages/omnimind-api/package.json` lines 24-27 | Phase 9 | 5m — remove `test:integration`, `test:security`, `test:performance`, `test:rollback` |
| TD-006 | 2 | Six 2025-04-12 migrations created tables (`feature_flags`, audit_logs, performance_monitoring, mem0_hybrid_search) that no service writes to. Mem0 detour wreckage. Per code-quality-audit.md §C row 9 and data-integrity-audit.md §D1 | `prisma/migrations/20250412*` (~3,188 SQL LOC) | Phase 14 | 2h to verify row counts in prod + schedule drop migration |
| TD-007 | 2 | Doc drift, hard contradiction: `docs/CURRENT-STATE.md` says "Sprint 8 / Phase 0 in progress." Root `CLAUDE.md` says Phases 0–3 complete. ≥7 days stale. Per code-quality-audit.md §C row 18 | `docs/CURRENT-STATE.md` vs `CLAUDE.md` | Phase 9 | 30m — rewrite CURRENT-STATE.md from CLAUDE.md and actual state |
| TD-008 | 2 | Doc drift: `CLAUDE.md` says "26 models" then "32 models" then "34 models" in different sections | `CLAUDE.md` | Phase 9 | 15m — count once, write once |
| TD-009 | 2 | 11 active OmniMind services lack unit tests, including the **critical retrieval path** (`context-assembler.service.ts`, 160 LOC) and the **production-critical in-memory queue** (`embedding-queue.ts`, 196 LOC). Per code-quality-audit.md §B.1 | services across OmniMind | Gated, not batched | per service: 2-4h |
| TD-010 | 2 | 15/17 OmniMind route files have **no integration test**. Only `health` and `memories` are covered. Per code-quality-audit.md §B.2 | `packages/omnimind-api/tests/integration/` | Gated, not batched | per route: 2h |
| TD-011 | 2 | CEOOrchestrator class has **no test for the central dispatch + synthesis path**. Per code-quality-audit.md §B.3, §B.5 | `packages/boardroom-ai/server/src/agents/orchestrator.ts` | Phase 9 | 1d — test scaffolding + scenarios |
| TD-012 | 3 | 75 `any`/`as any`/`as unknown` occurrences in 25 files; 53 of them in active source (excluding `_disabled/` and tests). Per code-quality-audit.md §C row 21 | 25 files | Phase 9 + opportunistic | 6h — knock down file-by-file |
| TD-013 | 3 | `decision.service.ts` uses `any` casts to satisfy Prisma types at lines 11, 19, 56 | `packages/omnimind-api/src/services/decision.service.ts` | Phase 9 | 30m — use `Prisma.DecisionCreateInput` and assumption-specific types |
| TD-014 | 3 | `entity.service.ts` has 5 `any` usages | `packages/omnimind-api/src/services/entity.service.ts` | Phase 9 | 30m — type concretely |
| TD-015 | 3 | `db-audit.ts` has 9 `any`/`as any` instances (depending on TD-001 outcome — if file is deleted, this evaporates) | `packages/omnimind-api/src/lib/db-audit.ts` | Phase 9 | 1h or moot |
| TD-016 | 3 | `db.ts:46` — `attachRLSClient` middleware reads `req.headers['x-user-id']`. The header is consumer-trusted (BoardRoom is the only caller) but auth.middleware uses API key — mismatched trust model. Decide on a single user-identification strategy | `packages/omnimind-api/src/lib/db.ts:46` | Phase 9 | 1h |
| TD-017 | 3 | `db.ts:46` types are `(req: any, res: any, next: any)` | `packages/omnimind-api/src/lib/db.ts:46` | Phase 9 | 5m — use `RequestHandler` |
| TD-018 | 3 | `db.ts:61, 65` — Prisma event handlers cast as `'error' as any` and `(e: any)` | `packages/omnimind-api/src/lib/db.ts:61,65` | Phase 9 | 5m — use Prisma's typed event API |
| TD-019 | 3 | Inconsistent error responses across routes. Some routes inline `res.status(422).json({ error: 'validation_failed', details: ... })`; others use middleware. No central response builder. Per code-quality-audit.md §C row 14 and §D row 5 | 17 OmniMind routes + 10 BoardRoom routes | Phase 9 | 3h — introduce `ApiResponse` helper in shared, route handlers use `res.fail(422, ...)` |
| TD-020 | 3 | `requireUserId(req, res)` middleware not extracted — 200+ identical lines of `if (!userId) return 400` repeated across all routes (e.g., `memories.routes.ts` lines 14, 38, 47, 63, 76). Per code-quality-audit.md §C row 25 | every OmniMind route file | Phase 9 | 1h — extract middleware, remove duplication |
| TD-021 | 3 | `prompt-loader.ts` exists in **two places** with different implementations: `packages/omnimind-api/src/lib/prompt-loader.ts` (36 LOC) and `packages/boardroom-ai/server/src/lib/prompt-loader.ts`. Should be in `@boardroom/shared`. Per code-quality-audit.md §C row 22 | both packages | Phase 9 | 1h — move to shared; both servers import |
| TD-022 | 3 | `logger.ts` exists in **two places**: `packages/omnimind-api/src/lib/logger.ts` (81 LOC) and `packages/boardroom-ai/server/src/lib/logger.ts`. Per code-quality-audit.md §C row 23 | both packages | Phase 9 | 1h — move to shared |
| TD-023 | 3 | 35 `console.*` occurrences across 7 files, mostly in scripts. Audit and replace with logger. Per code-quality-audit.md §C row 24 | 7 files | Phase 9 | 30m |
| TD-024 | 3 | `eslint.config.js` was added to omnimind-api (untracked file — appears in git status as `??`) but no equivalent in boardroom-ai or shared. Per code-quality-audit.md §C row 26 | three packages | Phase 9 | 30m — standardize lint config across monorepo |
| TD-025 | 3 | `assembleContextForPersona` (~150 LOC) exceeds CLAUDE.md's 50-LOC function ceiling. Per code-quality-audit.md "Numbers At a Glance" | `packages/omnimind-api/src/services/context-assembler.service.ts` | Phase 9 | 2h — decompose into named helpers (loadCandidates, applyTagBoosts, packToBudget) |
| TD-026 | 3 | `runSimulation` is 62 LOC — over the 50-LOC ceiling | `packages/omnimind-api/src/services/simulation.service.ts` | opportunistic | 1h |
| TD-027 | 3 | `package.json` ships `openai@^6.33.0` for embeddings but `embedding.service.ts` may also call OpenAI via raw `fetch`. Verify SDK is actually used; if not, remove dep. Per code-quality-audit.md §C row 20 | `packages/omnimind-api/package.json` | Phase 9 | 10m |
| TD-028 | 4 | `getEmbeddingHealth` exported from `embedding-queue.ts:187` but only called by quarantined route. Per code-quality-audit.md §C row 28 | `packages/omnimind-api/src/services/embedding-queue.ts:187` | Phase 9 | 10m — delete export when archiving the route |
| TD-029 | 4 | `outcome-review.routes.ts` has 2 `any` casts; `cortex.routes.ts` has 1. Per code-quality-audit.md §C row 29 | two route files | Phase 9 | 30m |
| TD-030 | 4 | `_REFERENCE-old-personas.md` (62 LOC) sits next to active prompts and risks confusion. Per code-quality-audit.md §C row 30 | `docs/prompts/_REFERENCE-old-personas.md` | Phase 9 | 1m — move to `docs/_archive/` |

---

## B. Style and consistency findings (code-quality-audit.md §D)

These are not numbered above because they cluster under TD-001, TD-019, TD-021, TD-022. Re-summarized for visibility:

1. **Prisma client access is inconsistent.** `db.ts` exports four ways: `prisma` (legacy, no RLS, used everywhere), `getPrismaClient(userId)` (RLS-scoped, never called), `systemPrisma` (admin, never called), and `attachRLSClient` middleware (never registered). Pick one and delete the rest (TD-001, TD-016).
2. **Error handling pattern varies.** Routes use `try { ... } catch (err) { next(err) }` plus inline 4xx/422 responses. No `asyncHandler` wrapper, no consistent envelope. The `omnimind-client.ts` resilience layer has a much richer model (`CircuitBreaker`, retry-with-jitter, timeout). Standardize on one (TD-019).
3. **Logging is consistent within each package** but the logger lives in two places (TD-022).
4. **Prompt loading is inconsistent.** Most call sites use `loadPrompt(id)` / `loadSystemPrompt(id)`. Three call sites do `readFileSync(resolve(__dirname, '../../../../docs/prompts/...'))` with a string fallback (TD-003, TD-004).
5. **Validation responses vary** — some routes return `{ error, details: [{field, message}] }`; some use Express middleware; some use `safeParse` inline. Consolidate (TD-019).
6. **`as any` is used to bypass enum types** in services that touch Prisma enum fields. The Prisma enum types exist — type the input properly (TD-013, TD-014).
7. **`tsconfig.json` excludes `_disabled/`** (good). But the **scripts** in `package.json` still try to run them (TD-005).

---

## C. Quick Wins (each <1 hour, ordered by ROI — code-quality-audit.md §E)

These are the highest-leverage tech-debt items. Bundle them into Phase 9 first.

| Order | Item | Effort | LOC affected |
|---|---|---|---|
| 1 | Delete `_disabled/` dirs across all three packages | 20m | drops 13,657 LOC |
| 2 | Delete the 7 active-but-unused services (incremental-embedding, semantic-dedup, semantic-search-guard, memory-cleanup.job, memory-cleanup-scheduler, migration-manager, redlock) | 30m | drops 1,710 LOC |
| 3 | Remove broken `package.json` scripts for `test:integration`, `test:security`, `test:performance`, `test:rollback` (TD-005) | 5m | — |
| 4 | Move `QUALITY_EVALUATION_PROMPT` to `docs/prompts/quality-evaluation.system.md` (TD-003) | 15m | — |
| 5 | Remove silent inline-prompt fallbacks in `gmail.service.ts:144`, `simulation.service.ts:54` (TD-004) | 15m | — |
| 6 | Drop the `searchVector` column from `schema.prisma` and add a migration (KI-018) | 20m | — |
| 7 | Move root scratchpad markdown (12 files) to `docs/_archive/2026-04-pre-roadmap/` | 10m | — |
| 8 | Update `docs/CURRENT-STATE.md` to reflect Phases 0–3 complete (TD-007) | 30m | — |
| 9 | Extract `requireUserId(req, res, next)` middleware to remove 200+ duplicated lines (TD-020) | 45m | shrinks every route file |
| 10 | Remove or wire `attachRLSClient` — pick one. If wiring, register in `index.ts`; if deleting, drop boilerplate (TD-001) | 5m delete / 45m wire | — |

**Total Quick Win time: ~3.5 hours.** Drops ~15,400 LOC, eliminates two architectural ambiguities (RLS access pattern, prompt-load pattern).

---

## D. Critical-path coverage status (code-quality-audit.md §B.5)

For Phase 9 / Phase 17 readiness check:

| Path | Tests exist? |
|---|---|
| Auth (JWT issue/verify) | Yes (BoardRoom + OmniMind) |
| Memory validation pipeline | Yes (`memory/budget-enforcer`, `schema-validator`, `temporal-validator`) |
| Memory create / search | Partial (memory.service yes, retrieval gaps) |
| Hybrid retrieval (FTS+trigram+semantic) | **PARTIAL** — only `fulltext-search.test.ts`, `ranker.test.ts`, `context-packager.test.ts`. **No tests** for `semantic-search.ts`, `trigram-search.ts`, `structured-filter.ts`, or the cross-entity search in `context-assembler` |
| Rate limiter | Yes |
| OmniMind client (resilience: timeout, retry, breaker) | Yes (`omnimind-client.test.ts`, `omnimind-seam.test.ts`) |
| CEOOrchestrator dispatch + synthesis | **NO** (TD-011) |

The gaps in semantic / trigram / structured-filter and CEOOrchestrator are the most consequential — if you ship any retrieval or persona refactor without addressing them first, you're flying blind.

---

## E. BoardRoom server coverage gaps (code-quality-audit.md §B.3)

| File | LOC | Gap |
|---|---|---|
| `services/extraction.service.ts` | 83 | no test |
| `services/gmail.service.ts` | 182 | no test (also TD-004) |
| `services/google-calendar.service.ts` | 120 | no test (also KI-024 / L9) |
| `services/llm-quality-scorer.service.ts` | 219 | no test (also TD-003) |
| `services/streaming-quality.service.ts` | 277 | no test |
| `services/transcription.service.ts` | 132 | no test |
| `services/commitment-tracker.ts` | 55 | no test |
| `agents/orchestrator.ts` | 331 | no test (TD-011) |
| `routes/onboarding-bootstrap.routes.ts` | 169 | no test |
| `routes/sessions.routes.ts` | 230 | no test (the SSE flow — also KI-028) |

These should be **gated**, not batched: any PR touching one of these files in the roadmap must add the missing test as a precondition (per code-quality-audit.md §G — "11 missing service unit tests should be gated rather than batched").

---

## F. Should the roadmap have a dedicated tech-debt phase?

Per code-quality-audit.md §G: **Yes — a single, scoped Phase 9 ("Purge & Standardize") is warranted, before any new feature work.**

Reasoning:
- The `_disabled/` quarantine is real, sizable (13.6k LOC), and has been deferred for ≥7 days. Doing it opportunistically inside another feature would mix unrelated diffs and balloon PR review time.
- Several findings are **load-bearing**: the half-wired RLS architecture (TD-001) and inline prompts (TD-003, TD-004) bias every future change. Standardizing once amortizes across all subsequent phases.
- The `package.json` script references to deleted files (TD-005) will trip a fresh contributor on day one.

Does **not** justify a dedicated phase:
- The 75 `any` occurrences (TD-012) are low-leverage and can be fixed file-by-file as those files are touched for other reasons.
- The 11 missing service unit tests (TD-009) and 15 missing integration tests (TD-010) should be **gated** rather than batched.

**Recommendation:** Insert Phase 9 ("Purge `_disabled/` + standardize prompts/Prisma access") between current state and roadmap kickoff. Scope to the C Quick Wins (1–10) plus TD-001 through TD-008. Budget 1.5 days. Treat further debt as opportunistic.

---

## G. Numbers at a glance (code-quality-audit.md "Numbers At a Glance")

- **Active source LOC:** ~9,000 (omnimind-api `src/`) + ~3,200 (boardroom-ai `server/src/`) + ~3,300 (shared `src/`)
- **Quarantined LOC:** 13,657 (`_disabled/`)
- **De facto dead LOC in active tree:** 1,710
- **Total purgeable in Phase 9:** **15,367 LOC** (~46% of the omnimind-api tree)
- **Files >800 LOC in active tree:** **0** today. Largest: `omnimind-client.ts` 494, `migration-manager.ts` 460 [DEAD], `orchestrator.ts` 331, `incremental-embedding.service.ts` 311 [DEAD], `entities.routes.ts` 315, `streaming-quality.service.ts` 277, `memory-cleanup.job.ts` 272 [DEAD]. **After Phase 9, the largest active file is `omnimind-client.ts` at 494 LOC.**
- **Functions >50 LOC sampled:** `dispatch` 121 (TD-002), `synthesize` 110 (TD-002), `runSimulation` 62 (TD-026), `assembleContextForPersona` ~150 (TD-025). **Four offenders in active code.**
- **TODO/FIXME/HACK comments:** 2 total in active code (`boardroom-ai/server/src/index.ts:99`, `omnimind-api/src/routes/_disabled/embedding-monitoring.routes.ts:18`). Anomalously low — phase plans tracked outside code.
- **`@ts-ignore` / `@ts-expect-error`:** 2 (one in dead code; one in `client/src/components/memory/RelationshipGraph.tsx:53` for D3 zoom — legitimate)
- **Missing prompts in markdown:** 1 confirmed (`QUALITY_EVALUATION_PROMPT`); 2 with risky inline-fallback patterns (`gmail.service.ts`, `simulation.service.ts`)
- **System prompts in `docs/prompts/`:** 18 `.system.md` files — exceeds the 7+6+7=20 referenced in CLAUDE.md. Some cortex/onboarding prompts may be missing.

---

## H. Sequencing summary

| Bundle | Items | Effort | When |
|---|---|---|---|
| Phase 9 Quick Wins (drops 15,367 LOC, fixes RLS facade, prompt drift, doc drift) | C 1–10 + TD-001..TD-008, TD-011 | 1.5 days | Before any roadmap feature work |
| Phase 9 type-hardening | TD-013..TD-018, TD-020..TD-024, TD-027..TD-030 | 1 day | With Quick Wins |
| Gated tech-debt | TD-009, TD-010, TD-012 | per PR | Forever |
| Function-size cleanups | TD-002, TD-025, TD-026 | 5h | Phase 9 (TD-002, TD-025); opportunistic (TD-026) |

For the issues that are *exploitable bugs* (not just debt), see [`KNOWN-ISSUES.md`](KNOWN-ISSUES.md). For the *invisible-until-explosion* subset, see [`LANDMINES.md`](LANDMINES.md). For the dead-code purge checklist (the source of TD-005, TD-028, and the 15,367 LOC figure), see [`DEAD-CODE.md`](DEAD-CODE.md). For the production data-flow context that motivates the function-size and orchestrator items (TD-002, TD-011, TD-025), see [`ARCHITECTURE-MAP.md`](ARCHITECTURE-MAP.md).
