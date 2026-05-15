# Current Phase

**Phase in flight:** Launch-Prep — Wave 3 (partial)
**Active task (within current phase):** Re-run Wave 3 Tracks D, E, H (0.25.5/6), and J once usage quota resets. See `docs/_audits/2026-05-15-launch-prep/WAVE-3-DEV-PROMPT.md` for specs; partial work preserved on branches `worktree-agent-*` and `wave3-drift-recovery`.
**Last update:** 2026-05-15
**Updated by:** Claude (Wave 3 partial-completion merge session)

**Wave 1 (audits) + Wave 2 (full) + Wave 3 (partial: I, G, H × 2, J × 1, F × 3 inherited)** are all merged to `claude/review-project-status-VgaJ0`. See `CHANGELOG.md` entry for full detail.

Previous phase (MCP Phase 5 — Solo Go-Live) is complete: ministry deferred, importance decay, duplicate detection, /admin/duplicates UI all shipped 2026-05-09.

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

## Phase 5 — Solo Go-Live (in flight)

### Shipped this session
1. ✅ `security`: `.env.deploy` removed from git tree; explicit gitignore rules
2. ✅ `ministry disabled`: API throws `503 MINISTRY_DEFERRED`; MCP tool returns error without API call; agent configs cleaned up; test D7 added
3. ✅ `importance decay`: weekly cron (Sun 2am), drops importance 0.05/week for unaccessed memories, floor 0.0
4. ✅ `duplicate detection`: on write, cosine check at 0.92; auto-supersede existing memory
5. ✅ `/admin/duplicates`: endpoint + UI tab (pair list + merge button)

---

## Deferred (with rationale — re-evaluate at Phase 6)

- **Ministry domain** — API and MCP tool refuse with `503 MINISTRY_DEFERRED`.
  Re-enable when: (a) Ollama running on Railway or local-only writes confirmed,
  (b) ministry encryption tested end-to-end, (c) at least one non-Josh user
  has pastoral interactions worth memorializing.
- **Digest charts** — Not enough data yet. Revisit after 30 days of dogfooding (>30 memories).
- **Railway private networking** — Latency optimization, not a blocker. Public domain works.
- **Redis rate limiting** — Solo = always 1 Railway instance. Re-evaluate at 500+ users.
- **.env.deploy git history scrub** — Low priority given $5 spend cap. Use `git filter-repo` when rotating to a new repo or before open-sourcing.

---

## Next session prerequisites (Phase 6)

1. Josh installs agent configs from `docs/agent-configs/` into Claude Desktop, Claude Code, Cursor
2. Generate prod agent keys via `bash docs/agent-configs/keygen-commands.sh`
3. 30 days of dogfooding → observe via `/admin`, note what's missing
4. Then define Phase 6 scope based on real usage patterns
