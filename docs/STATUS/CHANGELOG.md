# Changelog

Append-only log of work shipped against this roadmap. Most recent at top.

Format: `## YYYY-MM-DD — Phase X — Action`

---

## 2026-05-09 — Phase 5 Solo Go-Live — Ministry disable + importance decay + dedup + /admin/duplicates

**Branch:** `claude/fix-memory-layer-production-qdmH8` | **Commits:** `0054de0`, `869f368` | **Status:** Pushed

### Repo cleanup
- `.env.deploy` removed from git tracking; explicit gitignore for deploy secrets
- No worktree branches or open PRs to clean (already done in prior session)

### Ministry domain disabled (D7)
- `memory.service.ts`: `createMemory` + `updateMemory` throw `HttpError(503, MINISTRY_DEFERRED)`
- `memory.tool.ts` (MCP): `memory_write` returns MINISTRY_DEFERRED before calling API
- `error-handler.ts`: `HttpError` class added (enables non-500 status codes from service layer)
- `claude-desktop.json`: `omnimind-ministry` server entry removed
- `tests/audit/D7-ministry-disabled.test.ts`: API + MCP layer assertions
- `CURRENT-PHASE.md`: deferral documented with Phase 6 re-enable criteria

### Importance decay (F.1)
- `importance-decay.service.ts`: `runImportanceDecay()` — -0.05/week, floor 0.0
- `importance-decay-scheduler.ts`: cron Sun 2am, IMPORTANCE_DECAY_SCHEDULE env override
- `index.ts`: wired into start/stop lifecycle
- `admin.routes.ts` (omnimind-api): `POST /admin/decay/run` for manual trigger

### Duplicate detection on write (F.2)
- `memory.service.ts`: `findNearDuplicate()` cosine check at 0.92 before every `createMemory`
- Near-duplicates auto-supersede (calls `updateMemory`) instead of creating new entries
- Dead ministry encryption block removed from `createMemory` (upstream guard makes it unreachable)

### /admin/duplicates UI (F.3)
- `admin.routes.ts` (omnimind-api): `GET /admin/duplicates` + `POST /admin/duplicates/merge`
- `admin.routes.ts` (boardroom-ai): proxy routes for duplicates + decay
- `omnimind-client.ts`: `getAdminDuplicates`, `mergeAdminDuplicates`, `triggerAdminDecay`
- `api.ts`: `DuplicatePair` interface + 3 new API functions
- `AdminPage.tsx`: 6th tab "Duplicates" — threshold selector, pair list, Keep A/B buttons

### Deferred items documented
- Ministry Phase 6+, digest charts, Railway private networking, Redis rate limiting, git history scrub

---

## 2026-05-09 — MCP Phase 3 — Session summarizer + admin API + admin UI

**Branch:** `claude/build-memory-layer-IftGo` | **Commit:** `1f58af9` | **Status:** Pushed

### What shipped

**Session Summarizer:**
- `packages/omnimind-api/src/services/session-summarizer.service.ts` — groups McpAuditLog entries into sessions (30-min gap = new session), calls Claude Haiku to write 2-4 sentence summaries, deduplicates via `findFirst` before writing, stores as SESSION_SUMMARY memories with synthetic `mcp:<tenantId>` userId
- `packages/omnimind-api/src/jobs/session-summarizer.ts` — `*/10 * * * *` cron wrapper, `startSessionSummarizer()` / `stopSessionSummarizer()` wired into index.ts

**Admin API (omnimind-api):**
- `packages/omnimind-api/src/routes/admin.routes.ts` — 6 endpoints: stats, agents, audit (paginated), memories (paginated + searchable), contradictions, summarize trigger

**Admin proxy + UI (boardroom-ai):**
- `packages/boardroom-ai/server/src/routes/admin.routes.ts` — thin proxy to OmniMind /admin/* (no x-user-id needed)
- `omnimind-client.ts` — 6 new admin methods added
- `packages/boardroom-ai/client/src/pages/AdminPage.tsx` — 5-tab admin dashboard (Overview, Memories, Audit Log, Agents, Contradictions)
- `App.tsx` + `Sidebar.tsx` — /admin route registered, nav item added to secondaryNav

### Test status
- omnimind-api: 18 suites fail (pre-existing missing tests/setup.ts — not caused by this session); 199 tests pass
- boardroom-ai server: 145 tests pass (21 suites)
- boardroom-ai client: 5 suites fail (pre-existing missing @testing-library/jest-dom/vitest)
- omnimind-mcp: 43 tests pass (cached)
- Typecheck: 5/5 packages green

---

## 2026-05-09 — MCP Phase 2 — Agents wired, smoke tests passed, keys generated

**Branch:** `claude/build-memory-layer-IftGo` | **Status:** Pushed

### What shipped
- `docs/MEMORY-PROTOCOL.md` — agent protocol: write vs search rules, domain routing, fact quality, session start/end checklist
- `docs/agent-configs/` — 6 configs (claude-desktop, claude-code, cursor, chatgpt-desktop, keygen-commands.sh, SMOKE-TESTS.md)
- `.claude/CLAUDE.md` — Memory Layer section: architecture, 15-tool reference, dogfooding rules, ministry domain rule
- Fixed `keygen.ts`: replaced private bracket access with `registerAgent()` public method
- Fixed `client.ts`: userId moved to `x-user-id` header (not body); added `registerAgent()` method
- Fixed `smoke.ts`: env inheritance for spawned server; all 15 tools verified by name
- Fixed `shared/memory.types.ts` + `memory-config.ts`: added MCP_AGENT + SESSION_SUMMARY enum values (were in DB schema but missing from TypeScript types, causing 422 on writes)

### Smoke test results (live local DB)
- Tier 1: `smoke OK — 15 tools registered` ✅
- T1: memory write (MCP_AGENT source) ✅
- T2: memory update ✅
- T3: memory search ✅
- T4: audit log write ✅
- T5: audit log GET verified ✅
- T6: SCOPE_DENIED for cursor-josh on memory:write ✅
- T7: memory:read allowed for cursor-josh ✅
- T8: wildcard scope (`*`) grants all for boardroom-ai ✅
- T9: prefix wildcard `memory:*` grants memory:write and memory:read ✅
- T10: HTTP Unauthorized without key ✅
- T11: HTTP auth passes, StreamableHTTP handshake proceeds ✅

### 6 agents registered (local DB — re-run keygen-commands.sh against production)
- `claude-desktop-josh` / josh-personal / memory:read,write,context:write,preference:write,person:write / 0.85
- `claude-code-josh` / josh-business / memory:read,write,decision:write,task:write,project:write,commitment:write,code:write / 1.0
- `cursor-josh` / josh-business / memory:read / 0.7
- `chatgpt-desktop-josh` / josh-personal / memory:read / 0.6
- `boardroom-ai` / josh-business / * / 1.0
- `cortex-summarizer` / josh-business / memory:write / 0.8

### Next session
Wait 1 week for real agent usage. Then Phase 3: Admin Viewer + Session Summarizer.
If tool descriptions need tuning based on real usage, do that first.

---

## 2026-05-09 — MCP Phase 1 — Core tools, fact extractor, hybrid embeddings

**Branch:** `claude/build-memory-layer-IftGo` | **Status:** Pushed, ready for PR

### What shipped
- New `packages/omnimind-mcp` package (15 MCP tools, stdio + HTTP transports, keygen CLI, smoke test)
- 15 tools: `memory_write`, `memory_search`, `memory_supersede`, `decision_log`, `task_upsert/status/list/complete/block`, `project_status/summary`, `person_get`, `commitment_log/list`, `status_get`
- Fact extractor (`lib/fact-extractor.ts`): Claude Haiku extracts atomic facts, cosine-dedup at 0.85 threshold, graceful fallback on LLM failure, empty input → empty array
- Hybrid embeddings: Ollama `bge-base-en-v1.5` for `domain=ministry` (768-dim padded to 1536), OpenAI for all other domains. Ministry path NEVER falls back to OpenAI — write refused if Ollama unavailable
- Forgetting curve in `structured-filter.ts`: default search excludes `importance < 0.4 AND lastAccessedAt < 90d`
- `sourceWeight` multiplier wired into `ranker.ts`
- Prisma schema: `Tenant`, `Agent`, `McpAuditLog` models; `MemoryEntry` extended; `MCP_AGENT` + `SESSION_SUMMARY` enum values; migration SQL at `prisma/migrations/20260509000000_mcp_phase_1/`
- MCP audit routes: `POST/GET /mcp/audit`, `POST/GET /mcp/agents`
- Scope enforcement: `requireScope()` with exact, `*`, and `prefix:*` wildcard support
- 43 vitest tests across 7 test files (all passing)
- ADR-014 added: hybrid embedding routing rationale

### Gate results
- `pnpm typecheck` — ✅ 5/5 packages green
- `pnpm test` — ✅ 43/43 tests pass
- `pnpm build` — ✅ 4/4 packages build clean
- Fixed 4 pre-existing Zod v3→v4 errors in `shared/validation-helpers.ts`
- Fixed `@types/node` missing from `omnimind-api` devDependencies
- Excluded dead code (`incremental-embedding.service.ts`, `memory-cleanup-scheduler.ts`) from typecheck

### Next session
Phase 2: Wire agents — keygen for all 6 agents, `docs/MEMORY-PROTOCOL.md`, Claude Desktop config, smoke test checklist, `.claude/CLAUDE.md` memory layer section.

---

## 2026-05-09 — Phase 0, 0.25 — Foundation + Security Fixes

The Wave 4 final validator reconciled the 18-agent pipeline output. No code changes; documentation-only fixes.

**Phase numbering — canonical scheme adopted (Builder 2b's filesystem layout):**
- Phase 12 = webhooks-event-bus (was variously SDK, hardening)
- Phase 13 = sdk (was observability)
- Phase 14 = observability-suite (was migration history)
- Phase 15 = migration-history (was cortex isolation; pull-forward candidate)
- Phase 16 = cortex-isolation (was knowledge-graph deep)
- Phases 17 (persona marketplace), 18 (resilience + multitenant fairness), 19 (horizontal API scale) added to all top-level docs (ROADMAP-OVERVIEW, MASTER-INDEX, EXECUTIVE-SUMMARY, COST-MODEL, SUCCESS-METRICS, PHASE-PROGRESS-TRACKER, PHASE-COMPLETION-CRITERIA)
- Phantom sub-decimal phases (1.5, 1.6, 2.5, 5/Cortex Pro, "Pre-enterprise") remapped per `04-roadmap/ROADMAP-OVERVIEW.md` "phase-number map" section (Phase 1 durability layer / Phase 0.25 / DEFERRED with named triggers)
- 8 empty stub phase folders deleted by the parent (PHASE-12-sdk, PHASE-13-observability, PHASE-14-migration-history, PHASE-15-cortex-isolation, PHASE-16-knowledge-graph-deep, PHASE-7b-outcome-feedback, PHASE-8-reranker, PHASE-DEFERRED). Canonical phase folder list documented in ROADMAP-OVERVIEW.

**Cross-reference fixes:**
- LANDMINE ID format harmonized to L1..L10 (was a mix of L*, LANDMINE-A1, LANDMINE-D1, LANDMINE-stripe-*, LM-03). Cross-reference table added to top of `06-risks-and-mitigations/RISK-REGISTER.md` mapping Landmine ↔ KI ↔ Risk ID.
- `KNOWN-ISSUES.md` "Fix phase" column rewritten for all 79 KI entries to use canonical phase numbers.
- `LANDMINES.md` "Roadmap home" lines on all 10 landmines rewritten to canonical phases.
- `RISK-REGISTER.md` Section 6 rewritten as canonical risk-by-phase quick map.
- `MASTER-INDEX.md` rewritten to remove ~10 broken links (SOPHISTICATION-RUBRIC, SCALE-CEILING, KNOWN-LIMITATIONS, SCALABILITY-RISKS, EVAL-RISKS, SESSION-KICKOFF-TEMPLATE, SUBAGENT-PATTERNS, REPORTING-BACK, markdown-export, EXTERNAL-LINKS) — now points at the actual files (CAPABILITIES-INVENTORY, RISK-REGISTER §3, AGENT-DISPATCH-PATTERNS, HANDOFF-TEMPLATE, markdown-export-import, external-docs).

**Executor-feasibility fixes:**
- `STATUS/CURRENT-PHASE.md` rewritten: now mentions Phase 0.25 explicitly, adds "Active task (within current phase)" pointer line, surfaces the canonical phase queue.
- `STATUS/PHASE-PROGRESS-TRACKER.md` rewritten: extended through Phase 19, added explicit task IDs per phase (e.g., 0.25.1..0.25.6) so cold-start sessions know which task to resume.
- `STATUS/PHASE-COMPLETION-CRITERIA.md` extended through Phase 19.
- File-path drift fixed in `04-roadmap/PHASE-0.25-critical-fixes/tasks-and-prompts.md` (`user-profile.ts` → `user-profile.schema.ts`, `memory.ts` → `memory.types.ts`); same convention propagated to Phase 1 + Phase 4 + Phase 17 (`extracted-entity.schema.ts`, `relationship-query.schema.ts`, `persona-manifest.schema.ts`, etc.).
- Added security-incident task type (I) to `07-claude-instructions/CLAUDE-WORKFLOW.md` task-type table; added matching pitfall #13 to `07-claude-instructions/COMMON-PITFALLS.md` covering acute-mode triage flow and per-scenario first-actions.

**Time budget reconciliation:**
- Phase 10 (MCP server) revised: 2w → 4-6w per research validation
- Phase 11 (markdown export) revised: 1w → 3-4w per research validation
- Phase 13 (SDK) revised: 1.5w → 3-4w per research validation
- EXECUTIVE-SUMMARY headline calendar revised: p50 24w → ~30w; p90 30w → ~37w
- COST-MODEL per-phase impact table updated for canonical numbering and new phases (12 webhooks, 17 marketplace, 19 horizontal scale)

**Persona-marketplace contradiction resolved:**
- Phase 17 confirmed as PLANNED (real phase folder retained)
- `DEFERRED/persona-marketplace.md` (DEF-014) reframed as alternative-deferral spec with conditions for descope; row in `DEFERRED/README.md` now points at PHASE-17 as canonical home.

**ADR copies (item K) — TODO acknowledged:**
- `08-references/adrs/` README updated to reflect that the 13 ADRs in `docs/DECISIONS.md` have not been split into one-file-per-ADR copies. Flagged a real inconsistency between `01-foundations/ADR-INDEX.md` (ADR-005/006/010/012 headlines) and `docs/DECISIONS.md` (different headlines for those numbers) — left BOTH intact and surfaced for user decision rather than silently rewriting either.

**Files created:** 1 (`docs/_archive/research-wave-3-reviews/wave4-validator-summary.md` — archived in Phase D 2026-05-01; original path was `docs/research/omnimind-roadmap-2026/wave3-review/wave4-validator-summary.md`)
**Files modified:** ~25 across all roadmap subdirectories
**Files deleted:** 0 (parent already removed the 8 empty stub folders)

Next session: Phase 0 (foundation cleanup) is unblocked and ready to execute. Phase 0.25 follows.

---

## 2026-04-18 — Roadmap scaffold — Initial creation

- Created `docs/roadmap/` directory tree (10 top-level dirs, 21 phase folders)
- Wrote entry-point docs: `README.md`, `PROJECT-CONTEXT.md`, `07-claude-instructions/CLAUDE-WORKFLOW.md`, `07-claude-instructions/CONTEXT-LOAD-ORDER.md`
- Wrote initial STATUS docs: `CURRENT-PHASE.md`, `BLOCKERS.md`, `CHANGELOG.md` (this file), `DECISIONS-LOG.md`
- Built by 18-agent pipeline: 4 researchers + 4 auditors + 6 builders + 3 reviewers + 1 final validator
- Subsequent agent waves filled `01-foundations/` through `08-references/`

Next session: pick up Phase 0 from `04-roadmap/PHASE-0-foundation/`.
