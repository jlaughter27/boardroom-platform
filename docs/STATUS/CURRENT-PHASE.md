# Current Phase

**Phase in flight:** MCP Phase 4 — Hardening (encryption, rate limiting, digest, backup) — IN PROGRESS
**Active task (within current phase):** All 4 hardening deliverables shipped; docs complete
**Last update:** 2026-05-09
**Updated by:** Claude (audit remediation + Phase 4 execution session)

---

## What shipped in Phase 4 (this session)

**Audit remediation (7 findings, all fixed — commit d7f03b3):**
- F-001: sourceWeight propagated through all retrieval SQL layers
- F-002: POST /memories/search-similar endpoint; fact-extractor wired to cosine threshold
- F-003: Ministry write refused if Ollama unavailable (pre-check before DB write)
- F-004: Forgetting curve applied to semantic, FTS, and trigram search layers
- F-005: docker-entrypoint switched from `db push --accept-data-loss` to `migrate deploy`
- F-006: tenantId enforced on GET /memories reads
- F-007: Ministry content redacted to `[REDACTED:ministry]` in McpAuditLog

**Phase 4 Hardening:**

*Encryption at rest for ministry memories:*
- `prisma/schema.prisma` — added `encryptedContent Bytes?`, `encryptionKeyId String?`, `encryptionAlgorithm String?` to MemoryEntry
- `services/memory.service.ts` — encrypts content via AES-256-GCM on write for `domain='ministry'`; decrypts on read (getMemory, searchMemories, updateMemory)
- `lib/crypto.ts` — existing implementation reused; dev passthrough if `ENCRYPTION_KEY` unset

*Per-agent rate limiting:*
- `middleware/agent-rate-limiter.ts` — new middleware keyed by `x-agent-id`, hourly windows: 1000 reads / 200 writes / 100 decisions
- `index.ts` — registered after `rateLimiter`
- Configurable via `AGENT_RATE_READ`, `AGENT_RATE_WRITE`, `AGENT_RATE_DECISION` env vars

*Weekly digest (Friday 6pm):*
- `services/weekly-digest.service.ts` — builds stats (memories/decisions/tasks/domains) + highlights, saves to DB, sends email if SMTP configured
- `jobs/weekly-digest-scheduler.ts` — cron job `0 18 * * 5`, wired into server startup/shutdown
- `prisma/schema.prisma` — added `WeeklyDigest` model
- Schedule configurable via `DIGEST_SCHEDULE` env var

*Nightly backup:*
- `scripts/backup.sh` — production-grade pg_dump with optional openssl encryption, optional S3 upload, 7-file local rotation
- `docker-entrypoint.sh` — baseline resolve for new migration `20260509000001_mcp_phase_4`

*Docs:*
- `docs/runbooks/omnimind-mcp.md` — agent key rotation, audit log review, ministry troubleshooting, rate limits
- `docs/runbooks/backup-restore.md` — backup config, restore procedure, restore test evidence
- `docs/POST-IMPLEMENTATION-REVIEW.md` — builder retrospective on Phases 0–4

---

## What shipped in Phase 3

**Session Summarizer (omnimind-api):**
- `services/session-summarizer.service.ts` — groups McpAuditLog entries into sessions by 30-min gap, calls Claude Haiku to summarize each, writes SESSION_SUMMARY memories with synthetic userId `mcp:<tenantId>`
- `jobs/session-summarizer.ts` — cron job every 10 minutes, wired into server startup/shutdown

**Admin API (omnimind-api):**
- `GET /admin/stats` — aggregate counts: memories, agents, tenants, audit, session summaries, lastActivity
- `GET /admin/agents` — all registered agents with scopes + lastSeenAt
- `GET /admin/audit` — paginated McpAuditLog with agentId/tenantId/toolName filters
- `GET /admin/memories` — paginated memories with agentId/tenantId/domain/sourceType/q search
- `GET /admin/contradictions` — unresolved ContradictionAlert records
- `POST /admin/summarize` — manual trigger for session summarizer

**Admin UI (boardroom-ai):**
- `server/routes/admin.routes.ts` — proxy to OmniMind /admin/* endpoints
- `client/pages/AdminPage.tsx` — 5-tab UI: Overview, Memories, Audit Log, Agents, Contradictions

---

## Next actions (Phase 5 — Observability + Scaling)

1. Importance decay job — weekly cron, drop importance 0.05/week for unaccessed memories
2. Duplicate detection pipeline — on write, cosine check; auto-supersede if >0.92
3. `GET /admin/duplicates` endpoint + UI tab
4. Add digest charts to AdminPage (weekly trend sparklines)
5. Railway private networking for service-to-service calls (eliminate public internet round-trip)
6. Redis-backed rate limiting (when >1 Railway instance)
