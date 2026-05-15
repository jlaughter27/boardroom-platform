# Fix-Everything Plan — Post-Hermes Remediation

**Author:** Josh + Claude
**Date:** 2026-05-14
**Status:** Plan, ready to execute
**Source data:** Multi-agent review (code review + best practices + test coverage) + Hermes round-trip findings
**Owner:** Josh

---

## Mission

Fix the 8 integration bugs Hermes surfaced, adopt 3 high-leverage 2026 best practices, build a real end-to-end test harness, and run one final security audit — without breaking production. Solo-mode pragmatic, but no shortcuts on the seam fix (the cause of most bugs).

**Out of scope (defer to v2 / Phase 7+):**
- Bitemporal validity windows (Zep/Graphiti pattern — requires schema redesign)
- Postgres row-level security (worth doing, but multi-tenant gating)
- Letta-style core memory tier MCP tools
- pgcrypto for ministry domain (ministry is disabled)
- Multi-LLM provider routing
- Knowledge graph deepening

---

## Workstreams (6 — sequenced, gated)

```
WS-1  The seam       ──► WS-5  E2E harness ──► WS-6  Security ──► CLOSEOUT
WS-2  Embeddings     ──┘
WS-3  Recall quality ──┘
WS-4  Schema         ──┘
```

WS-1, 2, 3, 4 are independent and can run in parallel as separate PRs. **WS-5 (test harness) must merge BEFORE WS-6 (security)** so security has tests to validate against. CLOSEOUT after all PRs land.

---

## WS-1 — The Seam (CRITICAL, ~4 hrs)

**Root cause:** Agent context (`agentId`, `tenantId`, `sourceWeight`) doesn't propagate from MCP client → API middleware → service layer → DB. One middleware fix + one service-signature change addresses Bugs #1, #2, #3, #5, #7 simultaneously.

Branch: `feat/seam-agent-context`

### Tasks

**WS-1.1 — Add header-extraction middleware (30 min)**
- File: `packages/omnimind-api/src/middleware/agent-context.ts` (new)
- Extract `x-agent-id`, `x-tenant-id`, `x-source-weight` from request
- Attach to `req.agentContext: { agentId, tenantId, sourceWeight }`
- Default `tenantId` from API key lookup if header missing (use the `Agent` table)
- Default `sourceWeight` from `Agent.sourceWeight` if header missing
- Wire into `index.ts` after auth middleware

**WS-1.2 — Extend service signatures (1 hr)**
- File: `packages/omnimind-api/src/services/memory.service.ts`
- `createMemory(userId, input, agentContext, prisma)` — add 3rd param
- `updateMemory(userId, id, input, agentContext, prisma)` — add 4th param
- Inside, write `agentId`, `tenantId`, `sourceWeight` from context, override input
- Dedup path: include all three on the update call
- Same pattern for `searchMemories`, `getMemory`, and any read path

**WS-1.3 — Wire routes to pass context (45 min)**
- File: `packages/omnimind-api/src/routes/memories.routes.ts`
- Pass `req.agentContext` to every service call
- File: `packages/omnimind-api/src/routes/admin.routes.ts`
- Same — admin endpoints need tenant filtering

**WS-1.4 — Fix MCP client to send headers (15 min)**
- File: `packages/omnimind-mcp/src/lib/client.ts`
- Confirm `x-agent-id`, `x-tenant-id`, `x-source-weight` are sent on every request
- Code-review finding said client already sends these; verify

**WS-1.5 — Add retrieval-layer tenant filter (1 hr)**
- Files: `semantic-search.ts`, `fulltext-search.ts`, `trigram-search.ts`, `structured-filter.ts`
- Each gets a `tenantId` clause in the SQL WHERE
- Override only when `includeAllTenants: true` is explicitly passed (admin use)

### Success metrics (verifiable via SQL after fix)
- ✅ A new MCP-written memory has `agent_id != NULL`
- ✅ A new memory's `tenant_id` matches the agent's env-configured tenant
- ✅ A memory written by Hermes (sourceWeight 0.9) has `source_weight = 0.9`, not 0.85
- ✅ Cross-tenant read returns 0 results (write as `josh-business`, search as `josh-personal`)

### Tests required for merge
- `tests/audit/D8-agent-context-propagation.test.ts` (new) — field-value assertions on a real DB write
- `tests/audit/D9-cross-tenant-isolation.test.ts` (new) — write A, search B, expect empty
- Existing D3 + D5 must still pass

### Validation gate before merge
```bash
pnpm typecheck && pnpm test && pnpm build  # green
# Then run Hermes round-trip — should see all 4 original bugs resolved
node packages/omnimind-mcp/hermes-roundtrip.mjs
# Expected: memory written with correct agent_id, tenant_id, source_weight; search returns it
```

---

## WS-2 — Embedding Resilience (~3 hrs)

Fixes Bug #4 + adopts 3 best-practice patterns. Branch: `feat/embedding-outbox`

### Tasks

**WS-2.1 — Postgres outbox table (30 min)**
```prisma
model EmbeddingOutbox {
  id            String   @id @default(cuid())
  memoryId      String   @unique @map("memory_id")
  attempts      Int      @default(0)
  lastError     String?  @map("last_error")
  lastAttemptAt DateTime? @map("last_attempt_at")
  createdAt     DateTime @default(now())
  succeededAt   DateTime? @map("succeeded_at")

  @@index([succeededAt, lastAttemptAt])  // pending queue
}
```
Migration: `20260514_embedding_outbox`

**WS-2.2 — Update `createMemory` to use outbox (45 min)**
- File: `packages/omnimind-api/src/services/memory.service.ts`
- After persisting the memory row, INSERT a row into `EmbeddingOutbox`
- Spawn a fire-and-forget call to `embedMemory(id)` — if it succeeds, mark `succeededAt`; if it fails, increment `attempts`, store `lastError`
- The MCP caller is no longer blocked by embedding success

**WS-2.3 — Embedding retry cron (45 min)**
- File: `packages/omnimind-api/src/jobs/embedding-retry-scheduler.ts` (new)
- Every 2 min: query `EmbeddingOutbox WHERE succeededAt IS NULL AND attempts < 5`
- Retry each. Exponential backoff via `lastAttemptAt` check (skip if attempted in last `2^attempts` minutes)
- After 5 attempts, leave it (will appear in `/admin/embedding-failures`)

**WS-2.4 — Fact extractor: fail-loud (15 min)**
- File: `packages/omnimind-mcp/src/lib/fact-extractor.ts`
- When Haiku call fails (no API key, rate limit, timeout): **return error** instead of single-fact fallback
- MCP tool returns `{ error: 'FACT_EXTRACTOR_UNAVAILABLE', message: '...' }` to the agent
- Agent retries or surfaces to user

**WS-2.5 — Memory spans in audit (30 min)**
- File: `packages/omnimind-api/src/services/memory.service.ts` (in `searchMemories`)
- After retrieval, add to `McpAuditLog.outputJson`: `{ retrievedIds: [...], topScore: 0.87, scoreDistribution: [...] }`
- File: `packages/boardroom-ai/client/src/pages/AdminPage.tsx`
- Audit tab now shows top 5 retrieval results inline

### Success metrics
- ✅ A memory write where OpenAI embeddings is down: memory row exists, outbox row exists with `succeededAt=NULL`
- ✅ When OpenAI comes back up: outbox cron generates the embedding within 2 min
- ✅ A fact_extractor call without `ANTHROPIC_API_KEY` set: returns `FACT_EXTRACTOR_UNAVAILABLE`, no memory created
- ✅ `/admin/audit` rows for `memory_search` show `retrievedIds` and `topScore`

### Tests required
- `tests/audit/D10-embedding-outbox.test.ts` — simulate OpenAI 500, assert outbox row, run retry, assert success
- `tests/audit/D11-fact-extractor-fail-loud.test.ts` — mock Haiku failure, assert refusal not fallback
- Existing D4 must adapt (no more fallback path to assert)

---

## WS-3 — Recall Quality Wins (~2 hrs)

Three small changes, large recall gains. Branch: `feat/recall-quality`

### Tasks

**WS-3.1 — Exponential decay with recall reinforcement (1 hr)**
- File: `packages/omnimind-api/src/services/importance-decay.service.ts`
- Replace linear `importance -= 0.05` with:
  ```
  strength = importance * EXP(-λ * days_since_access) * (1 + recall_count * 0.2)
  λ = 0.16 * (1 - importance * 0.8)
  ```
- Add `recall_count` field to `MemoryEntry` (migration `20260514_recall_count`)
- Increment on every successful retrieval
- Source: YourMemory benchmark — 52% Recall@5 vs Mem0's 28% on LoCoMo

**WS-3.2 — Dedup threshold 0.85 → 0.80 (5 min)**
- File: `packages/omnimind-mcp/src/lib/fact-extractor.ts`
- Change `SIMILARITY_THRESHOLD = 0.85` to `0.80`
- File: `packages/omnimind-api/src/routes/memories.routes.ts` (`/memories/search-similar`)
- Lower default threshold to 0.80

**WS-3.3 — SourceWeight as tiebreaker not multiplier (45 min)**
- File: `packages/omnimind-api/src/retrieval/ranker.ts`
- Current: `final = (sem*0.6 + fts*0.3 + tri*0.1) * sourceWeight`
- New: rank primarily by raw score; sort within score buckets by sourceWeight
  ```typescript
  results.sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (Math.abs(scoreDiff) > 0.05) return scoreDiff;  // raw score wins if meaningful gap
    return b.sourceWeight - a.sourceWeight;             // tiebreaker
  });
  ```

### Success metrics
- ✅ A memory accessed 5 times has higher effective `strength` than one accessed 0 times, despite same `importance`
- ✅ A paraphrase of an existing fact (cosine 0.82) is deduped (was: created new)
- ✅ Two identical-content memories, one from `claude-code` (1.0) and one from `chatgpt` (0.6): both surface in top 10, code's wins ties

### Tests required
- `tests/audit/D12-exponential-decay.test.ts` — synthetic memories with varying access counts, assert ordering
- `tests/audit/D13-tiebreaker-ranking.test.ts` — same score, different weight, assert order
- Existing D4 dedup tests must still pass (with threshold 0.80)

---

## WS-4 — Schema Hardening (~1 hr)

Branch: `feat/schema-hardening`

### Tasks

**WS-4.1 — `agent_id` NOT NULL with backfill (30 min)**
- File: `packages/omnimind-api/prisma/schema.prisma`
- Currently `agentId String?` → change to `agentId String`
- Migration `20260514_agent_id_required.sql`:
  ```sql
  UPDATE memory_entries SET agent_id = 'unknown' WHERE agent_id IS NULL;
  ALTER TABLE memory_entries ALTER COLUMN agent_id SET NOT NULL;
  ```
- Pre-flight: ensure WS-1 has shipped first (otherwise new writes still nullify)

**WS-4.2 — Validate `sourceType` enum (15 min)**
- File: `packages/omnimind-api/src/services/memory.service.ts:89`
- Replace unsafe lookup with Zod enum:
  ```typescript
  const sourceType = SourceTypeSchema.parse(input.sourceType);
  ```
- Throw on invalid — no more silent fallback to MANUAL

### Success metrics
- ✅ `SELECT COUNT(*) FROM memory_entries WHERE agent_id IS NULL` returns 0 post-migration
- ✅ A request with `sourceType: 'INVALID'` returns 400 Bad Request, not silent acceptance

### Tests required
- `tests/audit/D14-schema-invariants.test.ts` — try to insert null `agentId`, expect rejection
- `tests/audit/D15-sourcetype-validation.test.ts` — invalid enum returns 400

---

## WS-5 — E2E Test Harness + 5 Critical Tests (~6-8 hrs)

**This is the highest-leverage workstream.** It builds the infrastructure that would have caught all 8 Hermes bugs automatically. Without this, the next round of integration bugs slips through the same way.

Branch: `feat/e2e-test-harness`

### Tasks

**WS-5.1 — Test harness scaffold (2 hrs)**
- New: `tests/e2e/harness/`
- `setup.ts` — spawn a test Postgres via docker-compose-test.yml; run migrations
- `agent-context-factory.ts` — create test agents with known scopes/tenants/weights
- `mcp-client.ts` — wrapper that spawns the MCP stdio server with given env
- `db-assertions.ts` — query the test DB directly, assert field values
- `teardown.ts` — drop test DB, kill MCP server

**WS-5.2 — The 5 critical tests (3-4 hrs)**

Each test uses the harness above. Each must FAIL on the current main, PASS after WS-1/2/3/4 merge.

1. **`E2E-1-agent-attribution.test.ts`** — Write via MCP, assert `memory_entries.agent_id = test-agent-name`
2. **`E2E-2-tenant-isolation.test.ts`** — Write as tenant A, search as tenant B, expect 0 results
3. **`E2E-3-sourceweight-propagation.test.ts`** — Register agent with sourceWeight=0.9, write, assert `memory_entries.source_weight = 0.9`
4. **`E2E-4-embedding-eventually-persists.test.ts`** — Write a memory, poll for `has_embedding=true` within 10s; assert outbox row resolved
5. **`E2E-5-cross-tenant-leak-attempts.test.ts`** — Try `tenantId` injection attacks (array, uppercase, whitespace), assert refusal

**WS-5.3 — CI wiring (1 hr)**
- File: `vitest.e2e.config.ts`
- Add a separate vitest config that runs only `tests/e2e/`
- npm script: `pnpm test:e2e`
- Document in `docs/runbooks/test-e2e.md` how to run locally

**WS-5.4 — Documentation (30 min)**
- File: `docs/_meta/E2E-TEST-PATTERNS.md` (new)
- Explain why mocks failed, why real DB matters, how to add the next E2E test

### Success metrics
- ✅ `pnpm test:e2e` runs all 5 tests against a real test Postgres
- ✅ All 5 PASS post-WS-1-through-4 merge
- ✅ Each test takes <30s; full suite <3min
- ✅ Can run on Josh's laptop without Railway/prod credentials

### Validation
The point of WS-5: **if I reset to pre-WS-1 state, all 5 E2E tests must FAIL.** That's the regression gate. Run this validation explicitly as part of the WS-5 merge PR.

---

## WS-6 — Inline Security Audit + Fixes (~3-4 hrs)

Runs AFTER WS-5 so security tests have a harness. Branch: `feat/security-hardening`

### Tasks

**WS-6.1 — Verify 10 suspected security issues (1 hr — research only, no code)**
Inspect each. Create a `docs/audits/SECURITY-AUDIT-2026-05-14.md`:
1. API key timing-safe compare (`auth.ts` server-side) — confirm correct
2. Every MCP tool calls `requireScope` — list any that don't
3. `tenantId` SQL WHERE on every retrieval — WS-1 may have covered; verify
4. Ministry refusal robustness — test `'Ministry'`, `'ministry '`, `['ministry']`, JSON injection
5. Secrets in committed files — grep for `sk-`, `omk_`, full key patterns; check git history
6. Audit log integrity — transactional or fire-and-forget? what happens on failure?
7. Rate limiter falls back to IP — risk of agent collision on Josh's laptop
8. Encryption-at-rest IV uniqueness + auth-tag verify
9. Admin endpoints behind what auth?
10. Error message PII leakage

**WS-6.2 — Fix all CRITICAL + HIGH findings (2-3 hrs)**
- Estimate after WS-6.1. Capacity caveat: if HIGH count exceeds 5, escalate to Josh before fixing all.

**WS-6.3 — Add security tests (1 hr)**
- `tests/audit/D16-ministry-bypass-attempts.test.ts`
- `tests/audit/D17-scope-bypass-attempts.test.ts`
- `tests/audit/D18-admin-auth-required.test.ts`

### Success metrics
- ✅ `SECURITY-AUDIT-2026-05-14.md` exists with 10 findings rated
- ✅ Zero CRITICAL findings open at end of WS-6
- ✅ All HIGH findings either fixed or explicitly deferred with rationale
- ✅ 3 new security tests pass

---

## CLOSEOUT (~2 hrs)

Last step. Branch: `docs/closeout-post-hermes`

### Tasks
- Update `docs/STATUS/CURRENT-PHASE.md` — mark Phase 5.5 (post-Hermes remediation) complete
- Update `CHANGELOG.md` — entries for all 6 workstreams
- Update `docs/POST-IMPLEMENTATION-REVIEW.md` — what Hermes taught us, what's still deferred
- Append to `docs/DECISIONS.md` — ADRs for the 12 best-practice decisions (adopt + defer)
- Run final Hermes round-trip in prod — all 4 original bugs verified resolved
- Final `pnpm test:e2e` against prod — all 5 E2E tests green

### Final success metrics (whole project)

A memory written by Hermes against production right now should have:
- ✅ `agent_id = 'hermes-test'`
- ✅ `tenant_id = 'josh-business'`
- ✅ `source_weight = 0.9`
- ✅ `has_embedding = true` within 30s
- ✅ Reappears in `memory_search` results for its content
- ✅ `mcp_audit_logs` entry with full `inputJson`, `outputJson` including `retrievedIds`
- ✅ Cross-tenant read by an agent in `josh-personal` returns 0 of Hermes's writes

If all 7 are true, the build is effective.

---

## Sequence + Timeline

| Day | Workstream | Hrs | Status gate |
|---|---|---|---|
| 1 | WS-1 (seam) | 4 | Hermes round-trip shows correct attribution |
| 1 | WS-3 (recall quality) | 2 | Tests pass |
| 2 | WS-2 (embeddings) | 3 | Outbox cron running |
| 2 | WS-4 (schema) | 1 | agent_id NOT NULL enforced |
| 3 | WS-5 (E2E harness) | 6-8 | 5 tests pass on main, fail on pre-WS-1 |
| 4 | WS-6 (security) | 3-4 | Zero CRITICAL findings |
| 4 | CLOSEOUT | 2 | All success metrics green |

**Total: ~22 hrs over 4 working days.** At Josh's typical pace (8–12 focused hrs/week), 2–3 calendar weeks.

---

## Self-Validation Gates (between every PR merge)

Before merging each WS PR, the agent doing the work MUST run and pass:

```bash
# 1. Build
pnpm typecheck
pnpm test
pnpm build

# 2. Run audit tests (NEW — must include the WS's specific D-tests)
pnpm test tests/audit/

# 3. Run E2E harness if WS-5+ has merged
pnpm test:e2e

# 4. Smoke prod (after Railway deploy)
curl https://omnimind-api-production.up.railway.app/health
node packages/omnimind-mcp/dist/index.js smoke

# 5. Hermes round-trip
cd packages/omnimind-mcp && node hermes-roundtrip.mjs
# Inspect output: assert correct agent_id, tenant_id, source_weight in DB
```

**If any of those fail: do not merge. Investigate. Don't override.**

---

## Refuse Protocol (carried forward + WS-specific)

Stop and ask Josh if:

1. Any prior inviolable rule from `MASTER-ORCHESTRATION-PROMPT.md` would be violated
2. WS-1 schema migration would touch rows where `agent_id` legitimately can't be backfilled (e.g., system-generated rows)
3. WS-2 outbox pattern conflicts with existing job scheduler
4. WS-3 changes the recall ranking in a way that empirically degrades retrieval quality (run a smoke retrieval suite first)
5. WS-5 E2E harness requires Docker setup that conflicts with Josh's existing dev stack
6. WS-6 security audit finds CRITICAL — stop, escalate, don't try to fix in flight
7. Any production data would need migration that can't be reversed within 5 minutes
8. ANY change touches `domain: 'ministry'` data (it's disabled — leave alone)

---

## Kill Switch (production)

Same triggers as the Solo Go-Live prompt:
- Production down due to your change → roll back via Railway "redeploy previous"
- Data corruption observed → halt, don't fix forward
- Audit log gaps (security tampering risk) → halt, escalate

---

## Per-WS Reporting (in the PR description, in this format)

```markdown
## WS-X Status Report

### Tasks completed
- ✅ WS-X.1 ...

### Tests added
- D8: agent-context-propagation — verifies fix for Bug #1
- ...

### Success metrics
- ✅ Hermes round-trip shows agent_id = hermes-test
- ✅ ...

### Self-validation
- pnpm typecheck: green
- pnpm test: 312/312 passing (added 6)
- pnpm build: green
- pnpm test:e2e: 5/5 (after WS-5)
- Hermes prod round-trip: all 4 original bugs resolved

### Anomalies
- (or "none")

### Deferred
- (anything explicitly not done with rationale)
```

---

## What's intentionally NOT in this plan

- **Bitemporal validity windows** — requires schema redesign + retrieval rewrite. Worth doing, but Phase 7+.
- **Postgres RLS** — adopt when multi-user. Server-side filtering (WS-1.5) is sufficient for solo.
- **Letta core memory tier** — Phase 7+ enhancement.
- **pgcrypto ministry encryption** — ministry is disabled. Defer.
- **Multi-LLM routing** — out of scope per ADR-002.
- **Knowledge graph deepening** — out of scope per ADR-004.

These are tracked in `docs/roadmap/04-roadmap/DEFERRED/` and `docs/_meta/CLAUDE-WORKFLOW.md`.

---

## Confirmation block (for an executing agent)

Before starting any workstream, the agent must reply with:

1. Path to this plan (`docs/FIX-EVERYTHING-PLAN.md`)
2. Which workstream they're starting (WS-1 through WS-6)
3. Branch name they'll use (`feat/<workstream-slug>`)
4. Success metrics for the chosen WS
5. The validation gate command they'll run before opening the PR

Then begin. Single PR per workstream. Single status report per PR.

---

*This plan supersedes any informal post-Hermes remediation notes. If any workstream fails validation, halt and ask Josh — don't merge a half-fix.*
