# OmniMind-MCP Post-Implementation Review

**Date:** 2026-05-09  
**Scope:** Phases 0–3 (shipped) + Phase 4 (current)  
**Reviewer:** Builder (Claude Code)

---

## What Was Built

### Phase 1 — Core MCP Server

15 tools across memory, decision, task, project, person, commitment, and status domains. Stdio + HTTP transports. Scope enforcement via `requireScope()`. Per-call audit logging to `mcp_audit_logs`.

**Shipped well:**
- Tool surface is exactly what was spec'd — no scope creep
- `withAudit()` wrapper pattern means every tool is audited with zero boilerplate
- `requireScope()` is simple, testable, and enforced at the tool boundary (not in routes)

**Would do differently:**
- Scopes were strings from the start — no enum, no compile-time enforcement. Added friction later when auditing.
- `AgentContext` grew organically; a proper type from day 1 would have avoided the sourceWeight propagation gap

### Phase 2 — Hybrid Retrieval

Structured filter → FTS → trigram → semantic → rank → context-packager. `sourceWeight` multiplier in ranker.

**Shipped well:**
- The pipeline pattern (each layer returns `ScoredResult[]`, packager caps at 10) held up perfectly
- `archiveCutoffDate()` abstraction was the right call

**What broke (caught by audit):**
- `sourceWeight` was populated in `structured-filter.ts` but zeroed in semantic/FTS/trigram SQL — ranker multiplier never fired. Fixed in F-001.
- Forgetting curve existed only in structured-filter, missing from other layers. Fixed in F-004.
- Cosine dedup in fact-extractor was calling GET /memories with `similarityThreshold` which was silently dropped. Fixed in F-002.

**Root cause of all three:** retrieval layers were built independently without integration tests that exercised the full pipeline end-to-end.

### Phase 3 — Tenant Isolation, Audit, MCP Transport

Tenant model, Agent model, McpAuditLog. Three tenant configs (josh-personal, josh-business, tgfc-ministry).

**Shipped well:**
- Ministry Ollama routing was correct from day 1 (`generateEmbeddingWithRetry` domain param)
- Three-tenant design is clean and non-negotiable

**What broke (caught by audit):**
- Ministry writes were NOT refused when Ollama was down — the service logged a warning but completed the write. Fixed in F-003.
- Ministry content was appearing in `mcp_audit_logs.input_json` in cleartext. Fixed in F-007.
- GET /memories was ignoring `tenantId` query param. Fixed in F-006.
- `docker-entrypoint.sh` was using `prisma db push --accept-data-loss` in production, which is destructive. Fixed in F-005.

**Root cause:** ministry domain was treated as a routing concern (embeddings) but not a data-protection concern (writes, audit logs, tenant isolation). These were three independent gaps with the same root cause.

---

## Audit Results Summary

**Audit date:** 2026-05-09  
**Verdict:** 🟡 PASS WITH CONDITIONS  
**Findings:** 3 HIGH, 4 MEDIUM, 0 LOW before fix pass  
**Post-fix verdict:** All 7 findings remediated in one commit (d7f03b3)

| Finding | Severity | Fix |
|---------|----------|-----|
| F-001 sourceWeight dead code | HIGH | Propagated field through all retrieval SQL |
| F-002 cosine dedup broken | HIGH | New POST /memories/search-similar endpoint |
| F-003 ministry write not refused | HIGH | Pre-check Ollama before DB write |
| F-004 forgetting curve incomplete | MEDIUM | Added to semantic/FTS/trigram layers |
| F-005 db push in production | MEDIUM | Switched to migrate deploy |
| F-006 tenantId not enforced | MEDIUM | Added WHERE filter |
| F-007 ministry cleartext in audit | MEDIUM | redactForAudit() helper |

---

## Phase 4 Hardening Rationale

Phase 4 adds four capabilities that were out of scope for Phase 3 but necessary before the system handles sensitive production data:

1. **Encryption at rest for ministry** — ministry content was protected in transit and at the embedding layer, but the `content` column was plaintext in the DB. AES-256-GCM via existing `crypto.ts` fills this gap.

2. **Per-agent rate limiting** — the existing rate limiter was keyed by `userId` (HTTP user), not `agentId` (MCP agent). An agent could bypass it entirely. New `agentRateLimiter` middleware keys by `x-agent-id`.

3. **Weekly digest** — operational visibility gap. No mechanism existed to surface "what did the agent write this week?" to the user. Friday 6pm digest fills this.

4. **Nightly backup** — the existing `scripts/backup.sh` was a stub (4 lines, gpg keyed by env var). Replaced with production-grade script: plain pg_dump, optional openssl encryption, optional S3 upload, 7-file rotation, validated restore procedure.

---

## What the Audit Process Caught That Code Review Missed

1. **Silent parameter drops.** `searchMemories()` accepted `similarityThreshold` in the type, but the SQL builder never used it. The parameter silently vanished. An integration test that asserted "a near-duplicate should not create a second memory" would have caught this.

2. **Fail-open ministry guard.** The check was in `embedding.service.ts` as a log warning, not in `memory.service.ts` as a write gate. The write completed anyway. Defense-in-depth: put the guard where the write happens.

3. **`prisma db push` in entrypoint.** This was visible in the file — the audit forced a careful re-read of the entrypoint that casual review had skimmed.

---

## Recommendations for Future Phases

1. **Integration test the full retrieval pipeline** — not just individual layers. A test that writes 3 memories and asserts the ranked results have correct sourceWeight multipliers would have caught F-001 immediately.

2. **Treat domain-sensitive fields as a cross-cutting concern.** When a new field like `domain: 'ministry'` is introduced, a checklist should exist: write guard, read redaction, audit redaction, encryption. F-003, F-004, F-007 were all ministry cross-cutting misses.

3. **Use `migrate deploy` from day 1.** `db push` has no history and `--accept-data-loss` is disqualifying in production.

4. **Audit early, not late.** The 7 findings were all discoverable from reading the source. An audit at the end of Phase 1 would have caught most of them before Phase 2 and 3 built on top.
