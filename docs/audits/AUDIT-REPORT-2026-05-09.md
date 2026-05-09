# OmniMind-MCP Final Validation Audit

**Auditor:** claude-auditor-v1  
**Date:** 2026-05-09  
**Scope:** OmniMind-MCP memory layer build — Phases 0–3 (as shipped; see §1 re: "Phases 0–6" scope mismatch)  
**Dev plan audited against:** `docs/MEMORY-LAYER-DEV-PLAN.md` (only plan that exists)  
**Verdict:** 🟡 PASS WITH CONDITIONS

---

## Executive Summary

Phases 0–3 of the OmniMind-MCP build shipped the 15-tool MCP server, hybrid embeddings, scope enforcement, audit logging, agent wiring, and admin UI. The structural work is correct. Three functional gaps were found that break claimed acceptance criteria: (1) `sourceWeight` ranking is dead code — no retrieval layer populates the field in results, so the ranker's trust multiplier never fires; (2) the dedup similarity threshold (0.85 cosine) is silently ignored by the backing API — real-world dedup is keyword-based only; (3) a ministry-domain write when Ollama is unavailable is NOT refused — the record is written to the DB in plaintext before the embedding step fails. Phase 4 (encryption, per-agent rate limiting, backup, digest) is explicitly queued and not yet executed, so ministry content is stored in plaintext. None of these constitute a production-emergency CRITICAL — but F-001 and F-002 mean two of the three most-promoted capabilities do not work as claimed.

---

## CRITICAL Findings

None.

---

## HIGH Findings

### F-001 — sourceWeight multiplier is dead code (HIGH)
- **Evidence:** `ranker.ts:59` — `const sw = (item as ScoredResultWithSourceWeight).sourceWeight ?? 1.0`. The `ScoredResultWithSourceWeight` interface extends `ScoredResult` with an optional `sourceWeight?: number`. None of the four retrieval functions that produce `ScoredResult` objects include this field: `structuredFilter` (lines 56–64), `semanticSearch` (lines 30–41), `fulltextSearch` (lines 51–57), `trigramSearch`. All return objects without `sourceWeight`. The default `?? 1.0` is always used. The condition `if (sw !== 1.0)` is therefore never true in production. A chatgpt agent (sourceWeight=0.6) ranks identically to a claude-code agent (sourceWeight=1.0) for identical content.
- **Plan reference:** Phase 1 §1.6 — "multiply final score by sourceWeight". Phase 1 Acceptance Criteria — "sourceWeight verified in ranker."
- **Gate claim:** The Phase 1 gate entry says "sourceWeight verified in ranker" ✅ but this was structural verification (code exists) not functional verification (it fires).
- **Test:** `tests/audit/D5-source-weight.test.ts` — the `FAILING (BUG)` test demonstrates that two results with identical scores rank equally regardless of sourceWeight when the field is absent.
- **Remediation:** Each retrieval function must SELECT `source_weight` from the DB and include it in the returned object. In `semanticSearch`, add `source_weight` to the SELECT clause and map it to `sourceWeight`. Same for FTS, trigram, and structured filter. Then extend `ScoredResult` type to include `sourceWeight?: number`. Test: insert two memories with different sourceWeights, same content, run retrieval, assert order.
- **Effort:** ~3h

---

### F-002 — Dedup threshold (0.85 cosine) is silently ignored (HIGH)
- **Evidence:** `fact-extractor.ts:88–96` — `hits = await client.searchMemories({ query: fact.text, tenantId: ctx.tenantId, userId, limit: 1, similarityThreshold: SIMILARITY_THRESHOLD })`. The `OmniMindClient.searchMemories` maps `similarityThreshold` to the `threshold` query param on `GET /memories`. The `memories.routes.ts:59–80` GET handler reads only `q, domain, tags, memoryClass, status, since, sortBy, sortOrder, limit, offset` — the `threshold` parameter is never read. The service calls `memoryService.searchMemories` which does `title/content contains query` (text keyword match). The `tenantId` query param is also ignored.
- **What this means:** Semantic dedup at 0.85 cosine similarity does not exist. Real dedup is: "does any existing memory title/content contain these exact words?" A rephrased duplicate ("Josh likes indigo" vs "Josh's preferred color is indigo") will NOT be caught and will create a duplicate memory entry.
- **Plan reference:** Phase 1 §1.4 — "For each fact: cosine similarity search against existing memories (threshold: 0.85)." This is described as "non-negotiable."
- **Gate claim:** "Fact extractor verified — duplicate writes produce 0 new memories" ✅ — but smoke test ran with identical text, not semantically-similar rephrasing.
- **Test:** `tests/audit/D4-fact-extractor.test.ts` — the `AUDIT NOTE` test documents the gap; the dedup tests pass only because mockClient is configured to return a match.
- **Remediation:** Two options: (A) Add a `POST /memories/search-similar` endpoint to OmniMind API that runs actual cosine similarity search with a threshold parameter. The fact extractor should call this endpoint, not `GET /memories`. (B) Add `threshold` and `tenantId` support to `GET /memories` and wire it through `context-assembler.service.ts` via the semantic search layer. Option A is cleaner and lower-risk.
- **Effort:** ~6h

---

### F-003 — Ministry write succeeds when Ollama is unavailable (HIGH)
- **Evidence:** `memory.service.ts:34–61` — `createMemory` calls `prisma.memoryEntry.create(...)` (line 34) to persist the record, then calls `embedMemory(memory.id)` (line 59). Inside `embedMemory`, if `generateEmbeddingWithRetry` returns `null` for `domain=ministry` (when Ollama is down), the function logs `"Embedding generation permanently failed"` and returns early (line 119–122). The DB record already exists at this point. The log message in `embedding.service.ts:68` says "Write refused" but the write already happened.
- **What this means:** If Ollama is unavailable when a ministry memory is written, the content is stored in the DB in plaintext with no embedding. The write appears to succeed from the caller's perspective.
- **Plan reference:** Inviolable Rule 9 — "If Ollama is unavailable, refuse the write with a clear error." This rule applies to the embedding step but the service architecture writes first, embeds second.
- **Remediation:** In `memory.service.ts`, before calling `prisma.memoryEntry.create`, pre-check embedding availability for ministry writes: call `generateEmbeddingWithRetry(text, domain)` first; if result is `null` and `domain === 'ministry'`, return an error without writing. The memory record must not exist in the DB if the embedding cannot be generated.
- **Effort:** ~2h

---

## MEDIUM Findings

### F-004 — Forgetting curve not applied to semantic search layer (MEDIUM)
- **Evidence:** `semantic-search.ts:15–28` — the WHERE clause filters only on `user_id`, `embedding IS NOT NULL`, `deleted_at IS NULL`, `status != 'ARCHIVED'`. No `importance` or `lastAccessedAt` filter. A memory with `importance=0.1` accessed 5 years ago will appear in semantic search results if its embedding is similar to the query. The `structuredFilter` correctly applies the forgetting curve but the other three layers do not.
- **Plan reference:** Phase 1 §1.6 — "Default: exclude memories with importance < 0.4 AND lastAccessedAt < 90 days ago."
- **Remediation:** Add the forgetting curve WHERE clause to `semanticSearch`, `fulltextSearch`, and `trigramSearch`. The OR clause (`importance >= 0.4 OR lastAccessedAt >= cutoff`) is already computed in `structuredFilter` — extract it to a shared helper and apply to all four layers. Honor the `includeArchived` override.
- **Test:** `tests/audit/D6-forgetting-curve.test.ts` — the AUDIT NOTE test documents the gap.
- **Effort:** ~2h

---

### F-005 — `prisma db push` still used in production; migrations are documentation-only (MEDIUM)
- **Evidence:** `docker-entrypoint.sh:16` — `prisma db push $SCHEMA --skip-generate --accept-data-loss`. The migration files in `prisma/migrations/` use `IF NOT EXISTS` / `IF NOT EXISTS` idempotent SQL patterns not generated by `prisma migrate dev`. The comment in the entrypoint says "switch to migrate deploy once baseline migration exists." The actual migration history is tracked by `db push`, not by the `_prisma_migrations` table.
- **Plan reference:** Inviolable Rule 6 — "No prisma db push. Use prisma migrate dev for every schema change."
- **Impact:** Schema changes via `db push` risk `--accept-data-loss` silently dropping columns. No migration history auditable via `prisma migrate status`. Rollback is harder.
- **Remediation:** Establish a migration baseline: run `prisma migrate resolve --applied <migration-name>` for each existing SQL file to register them in `_prisma_migrations`. Switch entrypoint to `prisma migrate deploy`. Going forward use `prisma migrate dev` for new changes.
- **Effort:** ~3h (risky — test in staging first)

---

### F-006 — Tenant isolation not enforced for reads at the API level (MEDIUM)
- **Evidence:** `memories.routes.ts:59–80` — `GET /memories` filters only by `userId` (from `x-user-id` header). The `tenantId` query param sent by the MCP client (`client.ts:87–97`) is silently dropped. Any agent that knows a userId can search that user's memories regardless of the agent's own tenantId. A `josh-business` agent calling `memory_search` with `userId: "josh-personal-id"` would receive josh-personal memories.
- **Plan reference:** Dev plan §Tenants — "Cross-tenant reads are not possible from MCP tools. Each agent operates in exactly one tenant." Also `MEMORY-PROTOCOL.md` — "Cross-tenant reads are not supported."
- **Remediation:** Add `tenantId` filter to the memories search path. Either (A) add `tenantId` as a server-enforced filter on `GET /memories` when the parameter is present, or (B) in the MCP server, inject the agent's `tenantId` via header and enforce it server-side in the OmniMind API auth middleware.
- **Effort:** ~3h

---

### F-007 — Audit log input includes raw content; ministry writes will be logged in cleartext (MEDIUM)
- **Evidence:** `audit.ts:23–26` — `writeAuditLog(client, { ..., inputJson: input, ... })`. For `memory_write`, `input` includes the `content` field verbatim. If a ministry-domain memory is written, the content lands in `McpAuditLog.input_json` in plaintext, even after Phase 4 adds content-column encryption. The audit log table has no encryption plan.
- **Plan reference:** Phase 4 mentions ministry encryption but scopes it to the `encryptedContent` column only. The audit log gap is not addressed.
- **Remediation:** Before writing the audit log for ministry-domain calls, strip or hash the `content` field from `inputJson`. Or maintain two audit log records: a full one (internal, encrypted) and a redacted one (operational).
- **Effort:** ~2h

---

## LOW + INFO

### LOW

- **F-008** — `docs/runbooks/omnimind-mcp.md` and `docs/runbooks/backup-restore.md` do not exist. The CURRENT-PHASE.md calls for Phase 4 to add backup, but operational runbooks were not completed in Phase 3.
- **F-009** — `docs/POST-IMPLEMENTATION-REVIEW.md` is absent. The audit prompt lists it as source of truth item 6.
- **F-010** — `WeeklyDigest` Prisma model not in schema — explicitly Phase 4 scope, but the audit prompt assumes it exists.
- **F-011** — Per-agent rate limiting (1000 reads/hr, 200 writes/hr) not implemented — Phase 4 scope. Existing rate limiter is per-IP, not per-agent.
- **F-012** — `nightly pg_dump + monthly restore test` not configured — Phase 4 scope.

### INFO

- **I-001** — The audit prompt references "Phases 0–6" and two source-of-truth documents (`docs/MASTER-ORCHESTRATION-PROMPT.md`, `docs/MASTER-PROMPT-PHASE-4-COMPLETION.md`) that do not exist. The actual build only covers Phases 0–4, with Phase 4 not yet started. The audit prompt was written against an expected future state.
- **I-002** — Phase 4 (hardening) is entirely unexecuted: no AES-256-GCM encryption on `MemoryEntry.content`, no `encryptedContent` field, no `encryptionKeyId`/`encryptionAlgorithm` fields. Ministry content is stored in plaintext. This is a KNOWN PLANNED GAP, not a silent omission.
- **I-003** — `audit.ts` uses fire-and-forget (`logAudit().catch(...)`). Audit entries can be silently lost during OmniMind API outages with no local fallback or retry.
- **I-004** — All 43 tests are mock-based (no integration tests against a real DB). The smoke test (`smoke.ts`) does run against a live server, but its results are not reproducible in CI.
- **I-005** — `POST /mcp/agents` has no duplicate-name guard in the Prisma layer (there is a unique index, but the error handling turns the constraint violation into a 409, not a pre-check). Acceptable pattern.
- **I-006** — `ministry` is only mentioned in `embedding.service.ts`. There are no tests for the ministry routing path in `omnimind-api`. If the embedding.service is refactored, the routing could regress silently.
- **I-007** — No forbidden dependencies found: mem0, langchain, langgraph, crewai, letta, graphiti, zep are absent from all package.json files. ✅

---

## Dimension-by-Dimension Scorecard

| Dim | Title | Score | Notes |
|-----|-------|-------|-------|
| D1 | Plan Compliance | PARTIAL | Phases 0–3 shipped correctly. Phase 4 explicitly deferred. Two source-of-truth docs referenced by audit prompt don't exist (audit prompt scope mismatch). |
| D2 | Schema Integrity | PARTIAL | `Tenant`, `Agent`, `McpAuditLog`, MCP fields on `MemoryEntry` all present. Missing: `encryptedContent`, `WeeklyDigest` (Phase 4). Migration governance violated — `db push` in production, migration files are documentation-only. |
| D3 | Tool Surface | PASS | All 15 tools registered, scope enforcement works, audit log wired. Tenant isolation gap on reads (F-006). |
| D4 | Fact Extractor + Dedup | PARTIAL | Extractor wired and fires on every write. Dedup mechanism uses keyword search, not 0.85 cosine similarity. Claimed non-negotiable acceptance criterion not met. |
| D5 | sourceWeight Ranking | FAIL | sourceWeight multiplier is dead code — field never populated by retrieval layers. No differentiation by agent trust in ranking. |
| D6 | Forgetting Curve | PARTIAL | Implemented correctly in structuredFilter. Not applied to semantic search, FTS, or trigram layers — stale memories bleed through. |
| D7 | Encryption + Ministry Privacy | PARTIAL | Ministry never sent to OpenAI ✅. Ollama routing correct ✅. Ministry write NOT refused when Ollama down ❌. No content encryption (Phase 4 deferred). Audit log will log ministry content in plaintext. |
| D8 | Audit Trail | PASS | Every tool call logged with agentId, tenantId, toolName, inputJson, durationMs. Fire-and-forget (silent loss risk on outage). No agentId validation. |
| D9 | Documentation Completeness | PARTIAL | MEMORY-PROTOCOL.md ✅, agent-configs ✅, ADR-014 ✅, CLAUDE.md updated ✅. Missing: runbooks, POST-IMPLEMENTATION-REVIEW.md. |
| D10 | Operational Readiness | PARTIAL | Health endpoints exist. Rate limiter is in-memory per-IP (not per-agent). No backup, no monitoring alerts, no WeeklyDigest — all Phase 4 gaps. No forbidden deps found. |

---

## Test Artifacts Produced

| File | Status | Notes |
|------|--------|-------|
| `tests/audit/D3-tool-surface.test.ts` | Requires `node_modules` to run | Verifies all 15 tools register; scope enforcement; audit log wired. |
| `tests/audit/D4-fact-extractor.test.ts` | Requires `node_modules` to run | Documents that threshold param is silently dropped; dedup is keyword-based. |
| `tests/audit/D5-source-weight.test.ts` | Requires `node_modules` to run | Demonstrates sourceWeight multiplier never fires when field is absent from results. |
| `tests/audit/D6-forgetting-curve.test.ts` | Requires `node_modules` to run | Verifies structuredFilter applies curve; documents semantic search does not. |

Note: `node_modules` is not installed in this environment (`turbo: not found`). Tests are written to the correct import paths and should pass once `pnpm install` is run. They represent the audit evidence, not a CI gate.

---

## Recommendation

**Conditional sign-off.** The system is safe to dogfood at current Phase 3 scope, with these conditions:

1. **Before any ministry-tenant writes in production:** Fix F-003 (ministry write not refused). One function in `memory.service.ts`. 2-hour fix. This is the one privacy-significant gap in the current shipped code.

2. **Before claiming "dedup works":** Fix F-002 (threshold ignored). The dedup path needs a real cosine similarity endpoint or the threshold-aware search wired properly. The claim that "duplicate writes produce 0 new memories" is only true for identical text, not rephrased duplicates.

3. **Before claiming "trust routing works":** Fix F-001 (sourceWeight dead code). All agents currently rank identically by trust. Fix is mechanical: add `sourceWeight` to the SELECT clause in all four retrieval functions.

4. **Phase 4 should start as planned** — encryption at rest, per-agent rate limiting, and backup are not optional for sustained ministry use.

Fix F-001, F-002, F-003 before marketing this to any agents outside the immediate dev environment. The rest can be addressed in Phase 4.

---

## Appendix — Methodology

**What I verified by reading code:** All source files in `packages/omnimind-mcp/src/`, `packages/omnimind-api/src/retrieval/`, `packages/omnimind-api/src/services/memory.service.ts`, `packages/omnimind-api/src/services/embedding.service.ts`, `packages/omnimind-api/src/routes/memories.routes.ts`, `packages/omnimind-api/prisma/schema.prisma`, migration SQL, `docker-entrypoint.sh`, all test files in `packages/omnimind-mcp/tests/`.

**What I could not verify (no live DB access):** The `_prisma_migrations` table state; actual ministry data in the DB; whether agents registered in production have the correct scopes; whether smoke tests actually passed against production or only local DB.

**What I could not verify (no running server):** Health endpoint responses; rate limiter behavior under load; session summarizer cron timing.

**Assumptions made:** The smoke test results in CHANGELOG.md (11 tiers passing) are accurate. The git log commit messages accurately reflect what shipped. The Phase 2 agent registrations were run against a local DB and would need to be re-run against production (`keygen-commands.sh`).

**Adversarial testing attempted:** Prompt injection test (4g) — the fact extractor embeds user content directly into the LLM prompt (`${FACT_EXTRACTION_PROMPT}\n\nInput: ${content}`), which is a prompt injection risk in production. The system prompt instructions and JSON-only output requirement provide some protection, but a determined adversarial input could attempt to escape the extraction format. This is LOW severity given the closed trust model (internal use only).
