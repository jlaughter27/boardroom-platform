# Known Issues — Severity-Ranked Register

**Audience:** Roadmap planners, anyone scoping a phase, anyone triaging an incident.
**Purpose:** A single severity-ranked table of every issue surfaced by the Wave 1 audits + the existing baseline + CLAUDE.md known limitations. Every row links to a fix phase.
**Sources:** `security-audit.md`, `data-integrity-audit.md`, `scalability-audit.md`, `code-quality-audit.md`, `docs/research/mem0-memory-architectures/stage2-audit/current-memory-stack-audit.md`, root `CLAUDE.md` "Known Limitations".

> **Severity scale**
> 1 = catastrophic (data loss, account takeover, total outage)
> 2 = high (real-user impact today, recoverable with effort)
> 3 = medium (degrades trust, recoverable, painful)
> 4 = low (latent risk, not exploitable today)
> 5 = cosmetic
>
> **Phase column** points to a canonical roadmap phase (see `04-roadmap/ROADMAP-OVERVIEW.md` per-phase summary table for the full list). Audit-era references to "Phase 1.5" / "Phase 1.6" / "Phase 2.5" / "Phase 5 (Cortex Pro)" / "Pre-enterprise" have been remapped to the canonical phase numbers per the phase-number map at the bottom of `ROADMAP-OVERVIEW.md`.

---

## A. Severity 1 (catastrophic — fix before paying users scale)

| ID | Sev | Title | Where (file:line) | Fix phase | One-line summary |
|---|---|---|---|---|---|
| KI-001 | 1 | `prisma db push --accept-data-loss` on every container boot | `packages/omnimind-api/docker-entrypoint.sh:16` | Phase 15 | Schema drift silently drops columns/tables on every deploy (data-integrity-audit.md §A1). See [`LANDMINES.md`](LANDMINES.md) (L1). |
| KI-002 | 1 | In-process embedding queue loses jobs on restart | `packages/omnimind-api/src/services/embedding-queue.ts:19` | Phase 1 (durability layer) | Plain `EmbeddingJob[]` in module scope — Railway redeploy / OOM / crash → all queued embeddings lost; `embedding IS NULL` indistinguishable from "still pending" vs "permanently failed" (data-integrity-audit.md §A2, §B2). Was tagged "Phase 1.5"; absorbed into Phase 1's MemoryWriteEvent durability work + Postgres-backed queue (pg-boss). See L3. |
| KI-003 | 1 | No baseline migration exists — restore-from-backup is impossible | `packages/omnimind-api/prisma/migrations/` | Phase 15 | Only forward deltas in tree. After a hypothetical Railway DB loss + restore, `prisma migrate deploy` cannot know state — entrypoint papers over with `db push --accept-data-loss` (data-integrity-audit.md §C1). |
| KI-004 | 1 | OAuth callback hijack — anyone can attach Google tokens to any user | `packages/boardroom-ai/server/src/routes/calendar.routes.ts:21-29`, `integrations.routes.ts:31-40` | Phase 0.25 (task 0.25.1) | `state` parameter is unsigned `userId`. Attacker forges `?code=<theirs>&state=<victim_cuid>` → attacker's tokens written into victim's row → victim reads attacker's Gmail/Calendar inside the BoardRoom app (security-audit.md §A1). See L5. |

## B. Severity 2 (high — exploitable or load-bearing today)

| ID | Sev | Title | Where (file:line) | Fix phase | One-line summary |
|---|---|---|---|---|---|
| KI-005 | 2 | Stripe webhook is double-broken (raw body + auth wall) | `packages/boardroom-ai/server/src/routes/subscription.routes.ts:27-35`, `index.ts:49,87,90`, `services/stripe.service.ts:48` | Phase 0.25 (task 0.25.2) | Global `express.json()` clobbers raw body before signature verify; webhook router mounted *behind* auth wall → 401 to Stripe → endpoint disabled. No idempotency, no reconciliation cron — duplicates throw P2002 → Stripe sees 500 → loop (security-audit.md §A2, data-integrity-audit.md §A4). See L6. |
| KI-006 | 2 | Mass-assignment on `PATCH /user-profile` (no Zod) | `packages/omnimind-api/src/routes/user-profile.routes.ts:20-28` | Phase 0.25 (task 0.25.3) | Route has no schema; `data as any` lets any blob into `riskProfile`/`cognitivePatterns` (consumed by Cortex), or set `onboardingComplete: true` to skip flow (security-audit.md §A3). |
| KI-007 | 2 | `ENCRYPTION_KEY` optional outside `production` → OAuth tokens in plaintext | `packages/omnimind-api/src/lib/crypto.ts:5-15`, `lib/env.ts:9` | Phase 0.25 (task 0.25.5) | `getKey()` returns 32 zero-bytes when unset; `encrypt`/`decrypt` short-circuit to plaintext. `decrypt` silently returns input on failure (security-audit.md §A5). See L7. |
| KI-008 | 2 | RLS policy enforcement is a façade; `getPrismaClient/attachRLSClient` never wired | `packages/omnimind-api/src/lib/db-audit.ts`, `lib/db.ts:18-58` | Phase 0.25 (task 0.25.4 deletes facade) + Phase 18 (real RLS) | `USER_SCOPED_MODELS` lists models that don't exist (`memoryChunk`, `embeddingJob`) and omits real ones (`decision`, `oAuthToken`, `subscription`). Migration `20250412010000_add_row_security_policies` likely failed at apply time anyway (camelCase vs snake_case columns) (security-audit.md §A4, code-quality-audit.md §C row 4, data-integrity-audit.md §D1). See L2. |
| KI-009 | 2 | Subscription middleware fails-open on every error class (auth, network, parse) | `packages/boardroom-ai/server/src/middleware/subscription.middleware.ts:31-34` | Phase 18 | Bare catch lets 401, 422, 500, breaker-open all through unconditionally. Documented to fail-open on outages (ADR-010), but currently fails-open on rotated API key, parse errors, network DNS, etc. (security-audit.md §B3, data-integrity-audit.md §A3). See L10. |
| KI-010 | 2 | `MemoryEntry.version` increments are performative — last-write-wins | `packages/omnimind-api/src/services/memory.service.ts:139-168` | Phase 0.25 (task 0.25.6) | `version: { increment: 1 }` runs without an `If-Match`-style `where: { id, version: expected }` check. Same shape in `decision.service.ts:90`, `entity.service.ts:82` (data-integrity-audit.md §B1). See L4. |
| KI-011 | 2 | Embedding write path has no failure observability | `packages/omnimind-api/src/services/embedding.service.ts:57-79`, `:118` | Phase 1 (durability layer) | Permanent failure logs and returns void; `getEmbeddingStatus` returns `'pending'` for both "haven't started" and "failed forever" (data-integrity-audit.md §B2). Was tagged "Phase 1.5"; absorbed into Phase 1's pg-boss-style queue work. |
| KI-012 | 2 | Soft-delete is application-only and doesn't cascade | schema-wide; `MemoryEntityLink` (line 510-522), `GoalProjectLink`, `ProjectPersonLink`, `ProjectTaskLink`, `DecisionProjectLink`, `TaskDependency`, `CommitmentLink` | Phase 15 | No `deletedAt` on `User` (data §D4) or any link table. Soft-deleted parents still surface via direct link queries; dead-account data stays "live" (data-integrity-audit.md §B3). |
| KI-013 | 2 | No GDPR / user-export endpoint | `packages/omnimind-api/src/routes/` (absent) | Phase 18 (with RLS rollout) — full DSAR | Zero `export`/`gdpr`/`download` endpoints. Manual SQL only — CCPA/GDPR breach risk if any EU/CA user lands (data-integrity-audit.md §C2, security-audit.md §E). Originally tagged "Pre-enterprise"; promoted to Phase 18 because the data-export-gdpr feature spec is part of the make-it-10/scale path. |
| KI-014 | 2 | No documented backup / restore drill | `scripts/`, `docs/runbooks/` (absent) | Phase 0.5 | "Railway does it" — no scripted dump, no quarterly restore drill. Restoring into fresh Postgres + booting omnimind hits KI-001 immediately (data-integrity-audit.md §C3). |
| KI-015 | 2 | Six orphan 2025-04-12 migrations sit in tree, mostly broken | `packages/omnimind-api/prisma/migrations/` | Phase 15 | Mem0-era migrations (`20250410_add_search_indexes`, RLS policies, FK constraints, audit logging, feature flags, performance monitoring, mem0 hybrid search). Reference camelCase columns that don't exist; one has invalid Postgres syntax (inline `INDEX` inside `CREATE TABLE`). Inert today because `db push` ignores history; will fire and error the moment we switch to `migrate deploy` (data-integrity-audit.md §D1, code-quality-audit.md §A.4). |
| KI-016 | 2 | `WeeklyMemo` lacks `@@unique([userId, weekStart])` — duplicate memos on cron re-fire | `packages/omnimind-api/prisma/schema.prisma:649-667`, `jobs/cortex-scheduler.ts:15-30` | Phase 15 (constraint) + Phase 16 (worker isolation) | Sun 18:01 redeploy → cron fires on the new instance → second WeeklyMemo for the same week. No `@@unique` constraint and no idempotency check (data-integrity-audit.md §B5, §D6). See L8. |
| KI-017 | 2 | Anthropic Sonnet 4.6 ITPM is the first scalability ceiling | per scalability-audit.md §B | Phase 18 (per-key workload split) + Phase 19 (horizontal scale) | Tier 2 cap = 80k ITPM; one decide-mode session ≈ 21k input tokens × 7 personas. Four simultaneous decide sessions saturate. First to bend at ~500 users (scalability-audit.md §B). |
| KI-018 | 2 | `searchVector` column declared but never created | `packages/omnimind-api/prisma/schema.prisma:202` | Phase 9 | Schema declares `Unsupported("tsvector")?` as a "generated column" but the only FTS migration creates expression indexes instead. `db push` would add a plain NULL column with no generator (data-integrity-audit.md §B7, §D2, code-quality-audit.md §A.3). |
| KI-019 | 2 | Ranker weights are designed, not EV-tuned | `packages/omnimind-api/src/retrieval/ranker.ts` | Phase 5a + 5b (combined Cortex Pro work) | No retrieval eval ever compared alternatives. No MRR / NDCG / P@k / recall measurements (mem0 baseline §C, §F). |
| KI-020 | 2 | No CI/CD gate — manual typecheck/test before push | `.github/workflows/` (absent) | Phase 18 (operational hardening) | CLAUDE.md known limitation #1. Auto-deploy on push to main with no test gate means a single bad merge ships in seconds. |

## C. Severity 3 (medium — degrades trust, fix before broad launch)

| ID | Sev | Title | Where (file:line) | Fix phase | One-line summary |
|---|---|---|---|---|---|
| KI-021 | 3 | `commitment.update` skips version increment | `packages/omnimind-api/src/services/commitment.service.ts:64` | Phase 0.25 (task 0.25.6 extends to commitments) | `prisma.commitment.update({ where: { id }, data: data as any })` — concurrent edits silently overwrite (data-integrity-audit.md §A5). |
| KI-022 | 3 | Cortex services skip the `deletedAt: null` filter | `cortex-memo.service.ts:19,22`, `cortex-patterns.service.ts:21` | Phase 9 | Soft-deleted decisions inflate "decisionsMade" in the weekly memo; trashed-but-OPEN commitments leak into LLM-summarized output (data-integrity-audit.md §B4). |
| KI-023 | 3 | Cortex jobs not idempotent across restarts | `jobs/cortex-scheduler.ts` + `services/cortex-{memo,patterns,contradictions}.service.ts` | Phase 15 (unique constraints) + Phase 16 (worker isolation) | No `withDistributedLock` (only `redlock.ts` in-process exists, and is unused). `ContradictionAlert` dedup uses substring `.contains(d.description.slice(0,30))` — fragile, not transactional (data-integrity-audit.md §B5). See L8. |
| KI-024 | 3 | OAuth refresh failure absorbed silently → integration "appears connected" forever | `packages/boardroom-ai/server/src/services/google-calendar.service.ts:92-95` | Phase 0.25 (foundation for L7/L9 fixes) + Phase 14 (observability surfaces it) | `catch (_err) { return [] }` masks invalid refresh token, network errors, rate limits. No `OAuthToken.lastError` column to record it (data-integrity-audit.md §B6). See L9. |
| KI-025 | 3 | `/auth/user/:id` allows arbitrary user lookup with only an API key | `packages/omnimind-api/src/routes/auth.routes.ts:67-82` | Phase 9 | Anyone with `OMNIMIND_API_KEY` can `GET /auth/user/<any_id>` → email, name, teamId. Stepping stone for cross-user reads (security-audit.md §B1). |
| KI-026 | 3 | `validateUserExists` middleware exists but is dead code | `packages/omnimind-api/src/middleware/user-validator.ts:13-83` | Phase 9 | CUID regex + DB existence check + partial-PII logging. Never imported anywhere. Each route does its own ad-hoc `if (!userId) return 400` (security-audit.md §B2). |
| KI-027 | 3 | Rate limiters reset on every Railway redeploy | `boardroom-ai/server/src/middleware/auth-rate-limiter.ts:8-16`, `omnimind-api/src/middleware/rate-limiter.ts:9-22` | Phase 18 | In-memory `Map<string, RateBucket>`. Auto-deploy on push → several free brute-force windows per active day. No per-account lockout — only per-IP (security-audit.md §B4, CLAUDE.md known limitation #2). |
| KI-028 | 3 | SSE session store is unbounded in-memory | `packages/boardroom-ai/server/src/routes/sessions.routes.ts:20-21,34-43` | Phase 18 | `sessions.set(id, session)` accumulates without TTL. RAM grows until OOM-restart (security-audit.md §B5). |
| KI-029 | 3 | Cortex `/cortex/contradictions/scan` is an open LLM-spend trigger | `packages/omnimind-api/src/routes/cortex.routes.ts:77-84` | Phase 18 (per-tenant cap enforces the bound) | POST with no body params calls Haiku in a fan-out loop (190 pair comparisons for N=20 projects). Same shape on `/patterns/scan`, `/memo/generate`, `/simulate`. Only the global 60/min rate limit (security-audit.md §C3). |
| KI-030 | 3 | `User` table lacks `deletedAt` despite soft-delete being the platform pattern | `packages/omnimind-api/prisma/schema.prisma:21-35` | Phase 15 | Cannot soft-delete a user. Hard delete cascades to ~28 tables — opposite of "Account closed, retain 30 days" GDPR posture (data-integrity-audit.md §D4). |
| KI-031 | 3 | RLS architecture half-built (CEOOrchestrator using global `prisma`, not `req.prisma`) | `packages/boardroom-ai/server/src/agents/orchestrator.ts`; OmniMind routes | Phase 9 | Either wire `attachRLSClient` middleware or delete the false-confidence exports (code-quality-audit.md §C row 4, security-audit.md §A4). |
| KI-032 | 3 | CEOOrchestrator `dispatch` 121 LOC, `synthesize` 110 LOC — exceed 50-LOC rule | `packages/boardroom-ai/server/src/agents/orchestrator.ts:57-178,181-291` | Phase 9 | Built-in vs custom persona handling duplicated. Extract `runPersona(personaConfig, query, context)` helper (code-quality-audit.md §C row 5). |
| KI-033 | 3 | Three call sites violate ADR-005 — inline LLM prompts | `boardroom-ai/server/src/services/llm-quality-scorer.service.ts:19-44`, `gmail.service.ts:144`, `simulation.service.ts:54` | Phase 9 | `llm-quality-scorer` defines `QUALITY_EVALUATION_PROMPT` inline. `gmail.service.ts` and `simulation.service.ts` have try/catch fallback to inline strings if the markdown load fails — silent prompt drift (code-quality-audit.md §C rows 6–7). |
| KI-034 | 3 | Subscription middleware single-instance circuit breaker | `packages/boardroom-ai/server/src/services/omnimind-client.ts:27-63` | Phase 19 (shared breaker for horizontal scale) | Per-process state. Multi-instance multiplies threshold by N (scalability-audit.md §0 row 12, security-audit.md §C5). |
| KI-035 | 3 | Doc drift: `CURRENT-STATE.md` says Sprint 8 / Phase 0; root `CLAUDE.md` says Phases 0–3 complete | `docs/CURRENT-STATE.md` vs `CLAUDE.md` | Phase 9 | Hard contradiction, 7+ days stale (code-quality-audit.md §C row 18). |
| KI-036 | 3 | Doc drift: `CLAUDE.md` says "26 models" then "32 models" then "34 models" | `CLAUDE.md` (multiple sections) | Phase 9 | Schema actual count needs verification. Count once, write once (code-quality-audit.md §C row 19). |

## D. Severity 4 (low — latent, not exploitable today)

| ID | Sev | Title | Where (file:line) | Fix phase | One-line summary |
|---|---|---|---|---|---|
| KI-037 | 4 | JWT has no `aud`/`iss`/`kid` — cross-env reuse, no rotation path | `packages/boardroom-ai/server/src/middleware/auth.ts:43-53` | Phase 18 | Single shared HS256 secret, no key rotation support; rotating immediately invalidates every active session (security-audit.md §C1). |
| KI-038 | 4 | Memory entity links endpoint trusts `entityId` without ownership check | `packages/omnimind-api/src/routes/memories.routes.ts:150-176` | Phase 9 | A user can link their memory to another user's goal (low — IDs are CUIDs, hard to guess) (security-audit.md §C2). |
| KI-039 | 4 | No content-length / payload-size guard | `boardroom-ai/server/src/index.ts:49`, `omnimind-api/src/index.ts:39` | Phase 9 | BoardRoom uses default 100kb (could surprise on long sessions); OmniMind 1mb (security-audit.md §C4). |
| KI-040 | 4 | `createMemory` no per-user-per-day quota at the route layer | `packages/omnimind-api/src/services/memory.service.ts:8-71` | Phase 18 (per-tenant fairness) | Validation pipeline enforces a budget but spam-create can drain OpenAI embedding spend (security-audit.md §C6). |
| KI-041 | 4 | CORS wide-open on OmniMind | `packages/omnimind-api/src/index.ts:38` | Phase 9 | `app.use(cors())` accepts all origins. API-key gate prevents browser exploitation today (security-audit.md §B6). |
| KI-042 | 4 | Logger leaks raw query/params in dev mode → password hashes if `NODE_ENV` misconfigured | `packages/omnimind-api/src/lib/db.ts:65-72`, `boardroom-ai/index.ts:122-127` | Phase 9 | Prisma `log: ['query','error','warn']` includes `params` (security-audit.md §B7). |
| KI-043 | 4 | `MemoryEntry.supersededBy` declared, never written or read | `packages/omnimind-api/prisma/schema.prisma:198` | Phase 15 | Searched usages = zero. Either implement supersession semantics or drop the column (data-integrity-audit.md §D3). |
| KI-044 | 4 | `Decision` lacks `@@unique([userId, sessionId])` | `packages/omnimind-api/prisma/schema.prisma` | Phase 15 | Two concurrent decision-create calls from the same `DecisionSession` will produce duplicates (data-integrity-audit.md §D5). |
| KI-045 | 4 | Per-user partial indexes inconsistently declared | `packages/omnimind-api/prisma/schema.prisma` | Phase 19 (perf path for horizontal scale) | Big-table per-user queries walk the full index regardless of `deletedAt`. The orphan FK migration tried to add them; it may not have applied (data-integrity-audit.md §D7). |
| KI-046 | 4 | No restore-from-soft-delete UI / endpoint | `packages/omnimind-api/src/routes/` (absent) | Phase 15 | Recovery requires direct SQL. Data is intact but not user-recoverable (data-integrity-audit.md §C4). |
| KI-047 | 4 | No retrieval result caching — every query runs all 4 layers fresh | `packages/omnimind-api/src/retrieval/` | Phase 19 (perf for horizontal scale) | Stage 2 baseline §B. Latency floor where ranker rebuilds from scratch each call. |
| KI-048 | 4 | Recency boost is binary (7-day window), no exponential decay | `packages/omnimind-api/src/retrieval/ranker.ts` | Phase 7a | Stage 2 baseline §B. (Phase 7a explicitly ships exp-decay recency.) |
| KI-049 | 4 | `MemoryEntityLink.linkType` is free-form string, no enum | schema-wide | Phase 15 | Inconsistent relation semantics across memories (stage 2 baseline §B). |
| KI-050 | 4 | Single Railway instance per service, no horizontal scaling | infra | Phase 19 | CLAUDE.md known limitation #7. |
| KI-051 | 4 | Public domain for service-to-service calls (Railway private networking pending) | `OMNIMIND_API_URL` env | DEFERRED/ | CLAUDE.md known limitation #3. |
| KI-052 | 4 | No monitoring/alerting beyond health checks | infra | Phase 14 | Correlation IDs propagated since 2026-04-15 — log aggregation can join. CLAUDE.md known limitation #6. |
| KI-053 | 4 | No password reset flow | `packages/boardroom-ai/server/src/routes/auth.routes.ts` (absent endpoint) | Phase 9 | Per PROJECT-CONTEXT.md "Functionality" — missing. |

## E. Severity 4–5 (cosmetic / known-known scaling ceilings)

| ID | Sev | Title | Where (file:line) | Fix phase | One-line summary |
|---|---|---|---|---|---|
| KI-054 | 4 | Default Prisma connection limit (10) is unset on `DATABASE_URL` | `packages/omnimind-api/src/lib/db.ts` | Phase 0.25 (Quick Win) | Append `?connection_limit=25&pool_timeout=15` for 2.5× headroom (scalability-audit.md §D row 1). |
| KI-055 | 4 | Embedding generation is sequential `for` loop | `packages/omnimind-api/src/services/incremental-embedding.service.ts:159-189` | Phase 9 (delete the dead service) — replaced by Phase 1 durability work | Replace with `Promise.all` + `p-limit(5)`; cuts 4s → 800ms (scalability-audit.md §D row 2). Currently moot — incremental-embedding.service.ts is dead code (DEAD-CODE.md). |
| KI-056 | 4 | OpenAI embeddings called one-at-a-time | `packages/omnimind-api/src/services/embedding.service.ts` | Phase 1 (with durability layer) | `embeddings.create({ input: [...] })` accepts up to 2048 strings/call (scalability-audit.md §D row 3). |
| KI-057 | 4 | No `p-limit` around Anthropic client | `packages/boardroom-ai/server/src/agents/agent.ts` | Phase 0.25 (Quick Win) | Sonnet at 20, Haiku at 50 prevents 429 bursts (scalability-audit.md §D row 4). |
| KI-058 | 4 | No per-user token budget meter | (absent) | Phase 0.25 (initial cap) + Phase 18 (full enforcement) | One unbounded user can run up $1500/mo in Anthropic spend on freemium (scalability-audit.md §A row 10, §D row 5). |
| KI-059 | 4 | IVFFlat probes left at default 1 | `packages/omnimind-api/src/retrieval/semantic-search.ts` | Phase 3 (HNSW supersedes) | `SET ivfflat.probes = 10` → ~3× recall for 2× CPU per query, postpones HNSW migration ~6 months (scalability-audit.md §D row 7). |
| KI-060 | 4 | IVFFlat `lists=100` heuristic targets ~10k vectors; ceiling ~40k | `prisma/migrations/20260407000000_add_embedding_column/migration.sql:8` | Phase 3 (HNSW migration) | Reindex `lists = ceil(sqrt(rows))` at 10k; switch to HNSW at ~200k (scalability-audit.md §A row 3). |
| KI-061 | 4 | `package.json` has broken test script paths (refer to deleted `_disabled/` files) | `packages/omnimind-api/package.json` (lines 24-27) | Phase 9 | `test:integration`, `test:security`, `test:performance`, `test:rollback` all `tsx` files in `_disabled/` (code-quality-audit.md §C row 3). |
| KI-062 | 4 | 75 `any`/`as any`/`as unknown` casts across 25 active files | various | Phase 9 + opportunistic | 53 in active source. File-by-file knockdown (code-quality-audit.md §C row 21). |
| KI-063 | 4 | `prompt-loader.ts` and `logger.ts` exist in two places (boardroom + omnimind) | both packages | Phase 9 | Should live in `@boardroom/shared` (code-quality-audit.md §C rows 22–23). |
| KI-064 | 4 | 11 OmniMind services lack unit tests | various | Gated, not batched | Critical: `context-assembler.service.ts` (160 LOC), `embedding-queue.ts` (196 LOC). PRs touching these must add tests (code-quality-audit.md §B.1). |
| KI-065 | 4 | 15/17 OmniMind route files lack integration tests | `packages/omnimind-api/tests/integration/` | Gated, not batched | Only `health` and `memories` covered (code-quality-audit.md §B.2). |
| KI-066 | 4 | CEOOrchestrator class has no test | `packages/boardroom-ai/server/src/agents/orchestrator.ts` | Phase 9 | Central dispatch + synthesis path (code-quality-audit.md §B.3, §B.5). |
| KI-067 | 4 | No entity extraction on memory write | (absent) | Phase 5a (LLM augmentation) | All entity links manual or LLM-proposed-then-validated (mem0 baseline §B). |
| KI-068 | 4 | No multi-hop graph traversal — flat link tables only (ADR-004) | schema | Phase 4 (graph traversal via recursive CTE) | Re-evaluating in this roadmap — recursive CTE on existing tables is the pragmatic answer (mem0 baseline §B, PROJECT-CONTEXT.md). |
| KI-069 | 4 | No query expansion / reformulation / synonyms / HyDE | retrieval | DEFERRED (DEF-005, HyDE) | Mem0 baseline §B. |
| KI-070 | 4 | No outcome → memory-scoring feedback loop (`DecisionOutcome` exists but unused) | `packages/omnimind-api/src/services/outcome-review.service.ts` | DEFERRED (Phase 7b) | Mem0 baseline §B. |
| KI-071 | 4 | Deadline fields not queried by cortex (no proactive due-date alerts) | cortex services | post-Phase 16 (advanced cortex spec) | Mem0 baseline §B. |
| KI-072 | 4 | `MemoryEntityLink.linkType` has no enum | schema | Phase 15 | Inconsistent relation semantics (mem0 baseline §B). |

---

## F. Compliance gaps (deferred until first enterprise conversation)

These are pre-PMF — do not chase SOC 2 yet. Logged so future Claude sessions don't re-discover them. All from security-audit.md §E.

| ID | Sev | Title | Fix phase |
|---|---|---|---|
| KI-073 | 3 | No audit log of access to user data (SOC 2 CC7.2) | DEFERRED (trigger: first SOC 2 conversation) |
| KI-074 | 3 | No data deletion flow / hard-delete (GDPR Art. 17) — also see KI-013, KI-030 | Phase 18 (with RLS rollout) |
| KI-075 | 4 | Encryption key derivation is direct hex import; no KDF, no key versioning (SOC 2 CC6.1) | DEFERRED/ |
| KI-076 | 4 | No data residency control (single Railway region) | DEFERRED/ until EU customer |
| KI-077 | 4 | PII in JWT body (email) — complicates GDPR data-export accounting | Phase 18 |
| KI-078 | 3 | No DSAR endpoint (GDPR Art. 15) — see KI-013 | Phase 18 (with RLS rollout) |
| KI-079 | 4 | No SSO / no MFA | DEFERRED/ until 10+ enterprise asks |

---

## G. Summary by severity

| Severity | Count | Canonical fix-phase distribution |
|---|---|---|
| 1 | 4 | Phase 0.25 (1), Phase 1 durability (1), Phase 15 (2) |
| 2 | 16 | Phase 0.25 (5), Phase 0.5 (1), Phase 1 durability (1), Phase 5a/5b (1), Phase 9 (3), Phase 15 (3), Phase 18 (2) |
| 3 | 16 | Phase 0.25 (1), Phase 9 (5), Phase 14 (1), Phase 15 (3), Phase 16 (1), Phase 18 (4), Phase 19 (1) |
| 4–5 | 36+ | Phase 0.25 (3), Phase 1 (1), Phase 3 (2), Phase 7a (1), Phase 9 (12), Phase 14 (1), Phase 15 (5), Phase 18 (5), Phase 19 (2), Phase 4 (1), Phase 5a (1), DEFERRED/ (3) |

**Top-3 ROI fixes (concentrated in Phase 0.25 + Phase 18):** per-user token budget (KI-058 — initial cap in Phase 0.25, full enforcement in Phase 18), PgBouncer + connection_limit (KI-054 — Phase 0.25 quick win; PgBouncer in Phase 19), Cortex → dedicated worker service (KI-017, KI-023 — Phase 16). See scalability-audit.md "Bottom-line ranking".

**Hard sequencing:** Phase 15 (migration history) is the defuse for L1 — pull-forward candidate to right after Phase 0.25. Phase 16 (cortex isolation) is a prereq for Phase 19 (horizontal scale). Multi-user rooms (KI-008's "Phase 4 Collaboration" reference) is hard-blocked on real Postgres RLS — that's now Phase 18, not Phase 4 (which here is "graph traversal"). Multi-user rooms itself lives in `04-roadmap/DEFERRED/multi-user-rooms.md` (DEF-015).

For the *hidden-risk* subset (the issues that look fine until they don't), see [`LANDMINES.md`](LANDMINES.md). For the unused-code component of the cleanup phases, see [`DEAD-CODE.md`](DEAD-CODE.md). For the architectural debt list, see [`TECH-DEBT.md`](TECH-DEBT.md).
