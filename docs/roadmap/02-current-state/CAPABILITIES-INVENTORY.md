# Capabilities Inventory — What OmniMind Does Today

**Audience:** Anyone planning a feature, refactor, or roadmap phase.
**Purpose:** A capability-by-capability snapshot of what works in production *today* (2026-04-18, branch `feature/folder-migration`), what exists in code but is never wired, and what's pure facade.
**Source:** Wave 1 audits (security, data-integrity, scalability, code-quality) plus the Stage 2 mem0 baseline audit. Findings cite source audits inline.

> **Convention used in this file**
> - **WORKS** — exercised by production code, exercised by tests, observably correct.
> - **WIRED-FRAGILE** — used in production but with a known landmine. See [`LANDMINES.md`](LANDMINES.md).
> - **EXISTS-UNUSED** — code is in the repo, would compile or run, but nothing imports / mounts / calls it. See [`DEAD-CODE.md`](DEAD-CODE.md).
> - **FACADE** — declared (in CLAUDE.md, in code, in schema) but practically a no-op.

---

## A. Storage layer

### A.1 Persistent entity store (PostgreSQL 16) — **WORKS**
- **What:** 32 Prisma models cover users, teams, sessions, memory, decisions, commitments, entities (Person/Goal/Project/Task), link tables, profiles, cortex outputs, custom personas, billing, OAuth tokens.
- **Where:** `packages/omnimind-api/prisma/schema.prisma`.
- **Notes:** All FK relations are `onDelete: Cascade`. Soft-delete (`deletedAt DateTime?`) is the convention on every entity table — but `User` is missing the column entirely (per data-integrity-audit.md §D4).

### A.2 pgvector embedding storage (1536-dim) — **WORKS**
- **What:** OpenAI `text-embedding-3-small` vectors stored as `Unsupported("vector(1536)")` on `MemoryEntry.embedding`. IVFFlat index `vector_cosine_ops` with `lists=100`.
- **Where:** `packages/omnimind-api/prisma/schema.prisma:200`, `prisma/migrations/20260407000000_add_embedding_column/migration.sql:8`.
- **Notes:** `lists=100` heuristic targets ~10k rows — fine today (per scalability-audit.md §A row 3) but ceiling is ~40k vectors before p95 climbs over 300ms.

### A.3 Full-text search (`tsvector`) — **WORKS** (with a ghost column)
- **What:** Inline `to_tsvector('english', content)` + `ts_rank` scoring at query time.
- **Where:** `packages/omnimind-api/src/retrieval/fulltext-search.ts`.
- **Notes:** Schema also declares `searchVector Unsupported("tsvector")?` on `MemoryEntry`, but no migration creates it as a generated column — it sits NULL forever (per data-integrity-audit.md §B7, §D2 and code-quality-audit.md §A.3). Either ship a `STORED` generated column or drop the field; the half-state is worse than either.

### A.4 Trigram fuzzy search (`pg_trgm`) — **WORKS**
- **What:** `pg_trgm.similarity()` with threshold 0.3.
- **Where:** `packages/omnimind-api/src/retrieval/trigram-search.ts`.

### A.5 Soft-delete model — **WIRED-FRAGILE**
- **What:** `deletedAt DateTime?` on memory, decisions, commitments, person, goal, project, task, room.
- **Where:** schema-wide; queries filter `WHERE deletedAt IS NULL`.
- **Cracks:** No `deletedAt` on `User`, no cascade-soft-delete service, no `deletedAt` on link tables (`MemoryEntityLink`, `GoalProjectLink`, etc.) → ghost edges (per data-integrity-audit.md §B3). Several cortex services skip the filter entirely (per data-integrity-audit.md §B4).

### A.6 Per-user isolation via `userId` filtering — **WORKS** (route-level discipline)
- **What:** Every query in 17 OmniMind route files includes `where: { userId, deletedAt: null }`.
- **Where:** `packages/omnimind-api/src/routes/*.ts`, `services/*.ts`.
- **Notes:** Holds today. This is the *only* user-isolation boundary in production (per security-audit.md §A4 and §D).

### A.7 Database "RLS" (Postgres row-level security policies) — **FACADE**
- **What:** A 373-line migration creates RLS policies (`prisma/migrations/20250412010000_add_row_security_policies`).
- **Where:** Migration is in repo. `lib/db-audit.ts` exports `getPrismaClient(userId)` and `attachRLSClient` middleware that would set `app.user_id` per request.
- **Reality:** No route ever calls `getPrismaClient`. `attachRLSClient` is never mounted in `index.ts`. The `USER_SCOPED_MODELS` list references models that don't exist in the schema (`memoryChunk`, `cortexSession`, `embeddingJob`) and omits real ones (`decision`, `commitment`, `oAuthToken`, `userProfile`, `subscription`). The migration may also have failed at apply time (column-naming mismatch — refers to `userId` instead of `user_id`, per data-integrity-audit.md §D1). **Don't trust the RLS guarantee documented in CLAUDE.md** (per security-audit.md §A4 and code-quality-audit.md §C row 4).

---

## B. Validation pipeline (write path)

### B.1 Zod schema validation at route boundaries — **WORKS**
- **What:** All `POST/PATCH` on memories, decisions, people, projects, goals, custom-personas use Zod `safeParse` and return 422 on failure.
- **Where:** `packages/omnimind-api/src/routes/*.ts` + `packages/shared/src/validation/`.
- **Notes:** One known gap — `PATCH /user-profile` (per security-audit.md §A3) — has zero Zod schema and accepts arbitrary blob writes via `data as any`.

### B.2 Memory validation pipeline (synchronous) — **WORKS**
- **What:** Three-stage chain on every memory write: schema → temporal validity → per-user-per-domain budget.
- **Where:** `packages/omnimind-api/src/memory/validation/pipeline.ts`.
- **Budgets:** ministry 300, business 400, personal 200, ai-systems 300, default 250 (per stage2-audit §A).
- **Tests:** Schema-validator, temporal-validator, budget-enforcer all covered.

### B.3 Optimistic concurrency on `version` field — **FACADE**
- **What:** Every entity service does `version: { increment: 1 }` on update, with a comment saying "optimistic concurrency".
- **Reality:** The `where` clause never includes the expected version, so two concurrent PATCHes both succeed and the second silently overwrites the first. Affects `memory.service.ts:139`, `decision.service.ts:90`, `entity.service.ts:82` (per data-integrity-audit.md §B1). `commitment.service.ts:64` doesn't even increment version (per data-integrity-audit.md §A5). See [`LANDMINES.md`](LANDMINES.md).

---

## C. Retrieval engine (read path)

### C.1 Hybrid 4-signal retrieval — **WORKS**
- **What:** `Promise.all` of structured-filter, FTS, trigram, semantic, each capped at 20 hits. Layer failure is graceful (returns `[]`, others continue).
- **Where:** `packages/omnimind-api/src/retrieval/{structured-filter,fulltext-search,trigram-search,semantic-search}.ts`.
- **Coverage gap:** Only `fulltext-search` and `ranker` and `context-packager` have unit tests. `semantic-search`, `trigram-search`, `structured-filter` have none (per code-quality-audit.md §B.5).

### C.2 Ranker fusion (fixed weights) — **WORKS** (untuned)
- **Weights:** structured 0.3, FTS 0.25, trigram 0.2, semantic 0.25.
- **Boosts:** +0.1 if accessed within 7 days (binary, no decay), +0.1 if importance ≥ 0.8.
- **Where:** `packages/omnimind-api/src/retrieval/ranker.ts`.
- **Notes:** Per stage2-audit §C — *"Ranker weights are designed, not EV-tuned. No retrieval eval ever compared alternatives."*

### C.3 Persona-aware context packager — **WORKS**
- **What:** Per-persona tag boosts (+0.15) — optimist→success/opportunity/win; critic→risk/failure/blocker; etc. Cap 10 items / 2000 tokens (CEO: 15 / 3000). Selection respects both — items are excluded, not truncated.
- **Where:** `packages/omnimind-api/src/retrieval/context-packager.ts`.

### C.4 Entity link traversal (flat, single-hop) — **WORKS**
- **What:** `MemoryEntityLink(memoryId, entityType, entityId, linkType)` plus join tables (`GoalProjectLink`, `ProjectPersonLink`, `ProjectTaskLink`, `DecisionProjectLink`, `TaskDependency`, `CommitmentLink`).
- **Reality:** No multi-hop traversal, no recursive CTE. `linkType` is a free-form string (no enum) so semantics drift.

### C.5 Retrieval result caching — **NOT IMPLEMENTED**
- Every query runs all 4 layers fresh, no memoization (per stage2-audit §B).

---

## D. Persona orchestration (BoardRoom AI)

### D.1 7-persona dispatch — **WORKS**
- **Personas:** Optimist, Critic, Alternate, Technician, Questionnaire, Doer, CEO (synthesizer, runs last with all outputs).
- **Where:** `packages/boardroom-ai/server/src/agents/orchestrator.ts` (331 LOC) — `CEOOrchestrator.dispatch` is 121 LOC, `synthesize` is 110 LOC (per code-quality-audit.md §C row 5 and "Numbers At a Glance").
- **No tests** for the central orchestrator class (per code-quality-audit.md §B.3).

### D.2 Custom ~200-line agent runtime — **WORKS** (ADR-001)
- **Where:** `packages/boardroom-ai/server/src/agents/agent.ts`.
- **Pattern:** Anthropic SDK `tool_use` content blocks → execute → `tool_result` → continue. Native, not MCP (ADR-008).

### D.3 Mode router (decide / stress-test / plan / brainstorm) — **WORKS**
- **Where:** `packages/boardroom-ai/server/src/personas/mode-router.ts`.
- **Tests:** Yes (per code-quality-audit.md §B.3).

### D.4 SSE streaming session store — **WIRED-FRAGILE**
- **What:** In-memory `Map<sessionId, session>` keyed in `sessions.routes.ts`.
- **Where:** `packages/boardroom-ai/server/src/routes/sessions.routes.ts:20-21`.
- **Cracks:** Unbounded — no TTL sweep, no persistence. RAM grows until the Railway instance OOMs (per security-audit.md §B5).

### D.5 Memory extractor + sufficiency scorer + commitment tracker — **WORKS**
- **Where:** `packages/boardroom-ai/server/src/agents/{memory-extractor,sufficiency,commitment-tracker}.ts`.
- **Tests:** memory-extractor and sufficiency covered; commitment-tracker not (per code-quality-audit.md §B.3).

### D.6 Persona prompts loaded from markdown — **WORKS** (ADR-005)
- **Where:** 18 `.system.md` files in `docs/prompts/` loaded via `prompt-loader.ts`.
- **Cracks:** Three call sites bypass the loader with inline string fallbacks: `gmail.service.ts:144`, `simulation.service.ts:54`, `llm-quality-scorer.service.ts:19-44` (per code-quality-audit.md §C rows 6–7). Violates CLAUDE.md rule 5.

---

## E. Cortex (background intelligence)

### E.1 Weekly memo (Sun 18:00) — **WIRED-FRAGILE**
- **Where:** `packages/omnimind-api/src/jobs/cortex-scheduler.ts` + `services/cortex-memo.service.ts`.
- **Output:** `WeeklyMemo` row per user — decisions, patterns, contradictions, thinkingQualityScore, recommendedFocus.
- **Cracks:** No `@@unique([userId, weekStart])` constraint (per data-integrity-audit.md §B5, §D6) — a Railway redeploy at 18:01 fires the cron twice. Source query forgets `deletedAt: null` (per data-integrity-audit.md §B4) so soft-deleted decisions inflate counts.

### E.2 Pattern detection (Mon 03:00) — **WIRED-FRAGILE**
- **Output:** `ThinkingPattern` rows (BIAS / STRENGTH / BEHAVIORAL_CYCLE / DECISION_STYLE).
- **Cracks:** Uses substring upsert (safer than memo's create) but two simultaneous runs can both miss `findFirst` and both `create`. No `deletedAt` filter on the source decision query (per data-integrity-audit.md §B4).

### E.3 Contradiction scan (Mon 04:00 / Tue 21:00) — **WIRED-FRAGILE**
- **Output:** `ContradictionAlert` (entityA/entityB JSON, severity, status).
- **Cracks:** Substring dedup `.contains(d.description.slice(0, 30))` — fragile, not transactional (per data-integrity-audit.md §B5). Fan-out is N×(N-1)/2 over projects with no per-user-per-day cap (per security-audit.md §C3) — open spend trigger.

### E.4 Simulation service — **WORKS**
- **Where:** `services/simulation.service.ts`. Manual trigger via `/cortex/simulate`.
- **Notes:** Same uncapped manual-trigger spend risk as contradiction scan.

### E.5 Outcome review nudges — **EXISTS** (under-exercised)
- **Where:** `services/outcome-review.service.ts`. `DecisionOutcome` model exists in schema. No feedback loop into memory scoring (per stage2-audit §B).

### E.6 In-process cron locks (`redlock.ts`) — **EXISTS-UNUSED**
- **Where:** `packages/omnimind-api/src/lib/redlock.ts` (66 LOC).
- **Reality:** Only consumer is the dead `memory-cleanup-scheduler.ts` (per code-quality-audit.md §A.2). Cortex jobs do not use it. Single-process locks anyway — useless once you have N Railway instances.

---

## F. Embedding pipeline

### F.1 In-process embedding queue — **WIRED-FRAGILE**
- **What:** Plain `EmbeddingJob[]` in module-scope, priorities high/normal/low, max 3 retries, ~100ms processing interval.
- **Where:** `packages/omnimind-api/src/services/embedding-queue.ts:19`.
- **Cracks:** Process restart, OOM, crash → all queued jobs lost. Failed jobs disappear after 3 attempts with only a log line; no DB column is updated, so `embedding IS NULL` is indistinguishable from "still pending" vs "permanently failed" (per data-integrity-audit.md §A2, §B2). See [`LANDMINES.md`](LANDMINES.md).

### F.2 OpenAI embedding generation — **WORKS** (ADR-011)
- **Where:** `services/embedding.service.ts`.
- **Notes:** Sequential `for` loop in incremental flow — bursts of 200 chunks take ~80s. Could be `Promise.all` + `p-limit(5)` for ~5× headroom (per scalability-audit.md §D row 2).

### F.3 Incremental embedding updates — **EXISTS-UNUSED**
- **Where:** `services/incremental-embedding.service.ts` (311 LOC) — exports `queueEmbeddingUpdate`, `generateContentHash`, `calculateContentSimilarity` but nothing outside the file calls them. `generateContentHash` is `content.slice(0, 100) + length` — misnamed and broken (per code-quality-audit.md §A.2 and §C row 8).

### F.4 Semantic dedup — **EXISTS-UNUSED**
- **Where:** `services/semantic-dedup.service.ts` (263 LOC). Only consumer is the quarantined `_disabled/memory-maintenance.routes.ts`.

---

## G. Auth and identity

### G.1 BoardRoom JWT (httpOnly cookie) — **WORKS**
- **Cookie:** `boardroom_token`, 7-day expiry, bcrypt 12 rounds, Secure (prod), SameSite=Lax.
- **Where:** `packages/boardroom-ai/server/src/middleware/auth.ts` + `routes/auth.routes.ts`.
- **Cracks:** No `aud`/`iss` claims, no key rotation support, no `kid` header (per security-audit.md §C1). Email is in JWT body (PII).

### G.2 OmniMind API key (timing-safe compare) — **WORKS**
- **Where:** `packages/omnimind-api/src/middleware/auth.ts`.

### G.3 Per-user identity validation — **FACADE**
- **What:** `validateUserExists` middleware exists in `packages/omnimind-api/src/middleware/user-validator.ts` — CUID regex, DB existence check, partial-PII logging.
- **Reality:** Never imported, never mounted. Every route does its own ad-hoc `if (!userId) return 400` check (per security-audit.md §B2). 200+ identical lines across all routes (per code-quality-audit.md §C row 25).

### G.4 Rate limiting (in-memory) — **WIRED-FRAGILE**
- **Login:** 5 / 15 min / IP. **Register:** 3 / hour. **Per-user query:** 20 / min. **Per-user write:** 30 / min.
- **Where:** `boardroom-ai/server/src/middleware/{auth-rate-limiter,session-rate-limiter}.ts` + `omnimind-api/src/middleware/rate-limiter.ts`.
- **Cracks:** Resets on every Railway redeploy (auto-deploy on push to main). No per-account lockout, only per-IP (per security-audit.md §B4). Multi-instance multiplies the advertised limit by N (per scalability-audit.md §E row 1).

---

## H. Billing

### H.1 Stripe checkout + portal — **WORKS** (likely)
- **Where:** `packages/boardroom-ai/server/src/services/stripe.service.ts` + `routes/subscription.routes.ts`.

### H.2 Stripe webhook → subscription state — **DOUBLE-BROKEN**
- **What:** `stripe.webhooks.constructEvent` requires raw bytes; `app.use(express.json())` parses to object first → every webhook 400s (per security-audit.md §A2). The webhook router is also mounted *behind* the auth wall, so Stripe's no-cookie request gets 401 before reaching the handler.
- **Compounding:** No idempotency table, no event-id dedup, no reconciliation cron (per data-integrity-audit.md §A4). Webhook duplicates throw P2002 from Prisma — escapes uncaught → Stripe sees 500 → endpoint disabled.
- **User-visible failure:** Subscriptions never transition `TRIALING → ACTIVE`. Paying users could lose access; non-payers stay on free trial forever. See [`LANDMINES.md`](LANDMINES.md).

### H.3 Subscription middleware — **FAILS-OPEN**
- **What:** `try { ... } catch { next() }` — ADR-010 says billing errors don't block users.
- **Reality:** Bare catch swallows 401, 422, 500, network errors uniformly (per security-audit.md §B3 and data-integrity-audit.md §A3). API key rotation → all paid features unlocked. Circuit breaker open → entire user base on Pro for the cooldown.

---

## I. Integrations (Phase 3 — partially live)

### I.1 Google Calendar OAuth + read — **BROKEN AT THE BOUNDARY**
- **Where:** `boardroom-ai/server/src/routes/calendar.routes.ts` + `services/google-calendar.service.ts`.
- **Cracks:** OAuth `state` parameter is set to the user's CUID (unsigned, not nonce-bound) — attacker can hand-craft `?code=<theirs>&state=<victim_cuid>` and write attacker tokens into victim's row (per security-audit.md §A1). Google's redirect path is currently mismatched (`/calendar/callback/callback` vs `/calendar/callback`) so the route is either 401-ing in prod or someone hot-patched it. OAuth refresh failures are silently absorbed — `[]` returned, integration "appears connected" forever (per data-integrity-audit.md §B6).

### I.2 Gmail OAuth + extraction — same as I.1
- **Where:** `boardroom-ai/server/src/routes/integrations.routes.ts` + `services/gmail.service.ts` (182 LOC, no test).

### I.3 OAuth token encryption (AES-256-GCM) — **WORKS** (in production, *if env is right*)
- **Where:** `packages/omnimind-api/src/lib/crypto.ts`.
- **Cracks:** `ENCRYPTION_KEY` only required when `NODE_ENV === 'production'`. Any other value (typo, "staging", "preview") → `getKey()` returns `Buffer.alloc(32, 0)` and `encrypt`/`decrypt` short-circuit to plaintext (per security-audit.md §A5). Decryption failures silently return the input string — a forged token passes through invisibly.

### I.4 Custom personas — **WORKS**
- **Where:** `packages/omnimind-api/src/routes/custom-personas.routes.ts` + `CustomPersona` model.

---

## J. Resilience layer (BoardRoom → OmniMind seam)

### J.1 Timeout + retry-with-jitter + circuit breaker — **WORKS**
- **Where:** `packages/boardroom-ai/server/src/services/omnimind-client.ts`.
- **Config (env-driven):** `OMNIMIND_TIMEOUT_MS=10000`, `OMNIMIND_RETRY_MAX=3`, `OMNIMIND_BREAKER_THRESHOLD=5`, `OMNIMIND_BREAKER_COOLDOWN_MS=15000`. 4xx never retries and never trips the breaker. Only idempotent methods retry.
- **Tests:** Yes — `omnimind-client.test.ts` and `omnimind-seam.test.ts`.
- **Cracks:** Per-process state; multi-instance multiplies threshold by N (per scalability-audit.md §0 row 12).

### J.2 Correlation IDs across the seam — **WORKS** (since 2026-04-15, per CLAUDE.md)
- `x-request-id` propagated end-to-end so log aggregation can join.

---

## K. Operational tooling and observability

### K.1 Health endpoints — **WORKS**
- `/health` on both services, public.

### K.2 Logging — **PARTIAL**
- Tiny `logger.ts` wrapper in each package (duplicated, per code-quality-audit.md §C row 23).
- Prisma dev log includes `query` + `params` — leaks password hashes if `NODE_ENV` is misconfigured on staging (per security-audit.md §B7).
- Global error handler returns `err.message` to the client when `NODE_ENV !== 'production'` — raw stack traces leak on env typo.

### K.3 Audit log — **MISSING**
- No `audit_log` table, no access-event writes. Soft block for SOC 2 CC7.2 (per security-audit.md §E).

### K.4 GDPR DSAR / user-export — **MISSING**
- No `GET /me/export` (per security-audit.md §E and data-integrity-audit.md §C2). Manual SQL only.

### K.5 Hard-delete / right-to-erasure — **MISSING**
- All deletes are soft. No 30-day purge job, no `User.deletedAt` column anyway (per data-integrity-audit.md §D4).

### K.6 Backup + restore runbook — **MISSING**
- "Railway does it" — no `scripts/backup-*.sh`, no `BACKUP-RUNBOOK.md`, no documented RPO/RTO, no drill (per data-integrity-audit.md §C3).

---

## L. Roadmap mapping (where each capability is touched next)

| Capability cluster | First roadmap phase that hardens it |
|---|---|
| RLS facade (A.7), per-user identity validation (G.3) | Phase 0.25 task 0.25.4 (delete facade) + Phase 18 (real RLS) |
| `prisma db push` → baseline migration (A.1) | Phase 15 (DEC-004) |
| Embedding queue durability (F.1, F.3) | Phase 1 durability layer (was tagged "Phase 1.5"; see [`KNOWN-ISSUES.md`](KNOWN-ISSUES.md) KI-002/011) |
| Stripe webhook fix + idempotency (H.2, H.3) | Phase 0.25 task 0.25.2 (was tagged "Phase 2.5 / Phase 17") |
| OAuth state signing + token encryption (I.1–I.3) | Phase 0.25 tasks 0.25.1 + 0.25.5 (was tagged "Phase 2.5") |
| Optimistic concurrency on `version` (B.3) | Phase 0.25 task 0.25.6 (was tagged "Phase 1.6") |
| Cortex idempotency + spend caps (E.1–E.4) | Phase 16 (cortex isolation) + Phase 18 (per-tenant caps) |
| Rate limiter + queue → Postgres (G.4, F.1) | Phase 18 (rate limiter) + Phase 1 (durable queue) |
| Audit log + DSAR + hard-delete (K.3–K.5) | Phase 18 (with RLS rollout) for DSAR/hard-delete; SOC 2 audit log DEFERRED until first SOC 2 conversation |
| Backup drill (K.6) | Phase 0.5 (added) |
| Dead code purge (E.6, F.3, F.4 + 13.6k LOC `_disabled/`) | Phase 9 |

See [`TECH-DEBT.md`](TECH-DEBT.md), [`DEAD-CODE.md`](DEAD-CODE.md), [`LANDMINES.md`](LANDMINES.md), [`KNOWN-ISSUES.md`](KNOWN-ISSUES.md), [`ARCHITECTURE-MAP.md`](ARCHITECTURE-MAP.md) for the deeper cuts.
