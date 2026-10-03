# Current Phase

**Phase in flight:** ✅ **Phase 6 build — implemented and independently reviewed (pending deploy + operator checklist)**
**Last update:** 2026-10-02
**Updated by:** Claude (audit + remediation session, branch `claude/amazing-mccarthy-grvem2`)

**Next phase (not yet started):** Phase 6 — 30-day dogfooding window. **Do not start Phase 6 until the operator checklist in `docs/03-operations/DEPLOYMENT-RUNBOOK.md` ("Post-audit operator checklist") is done** — O-103 (decay) and M-102 (tag queries) would otherwise have made the dogfooding window measure bugs, not the architecture.

---

## ✅ Phase 6 build — all 8 research moves implemented (2026-10-02)

Source: `docs/research/IMPROVEMENT-RESEARCH-2026-10-02.md`. Built by six parallel lanes against `docs/contracts/PHASE-6-CONTRACTS.md`; 6 commits (`d12181d`…HEAD). Final state after the 2026-10-03 review (`docs/audits/REVIEW-2026-10-03.md`, 42 findings fixed): typecheck 5/5, **1,481 tests passing** (138 mcp · 135 shared · 261 server · 92 client · 810 omnimind · 45 eval), client build green, client↔server route seam check clean, frozen install clean, no high advisories.

| # | Move | Status |
|---|---|---|
| 1 | Prompt-cache core context + Sonnet 5.5 | ✅ cached system blocks, `MODEL_IDS`, Haiku guard, usage rows |
| 2 | Decision loop (forecast → review → calibration) | ✅ decide route + commit card, review recap, calibration panel |
| 3 | Labeled retrieval eval in CI | ✅ 114 gold queries, recall@k/MRR/nDCG, pgvector CI job |
| 4 | Debate protocol + disagreement ledger | ✅ rebuttals, ledger, dropped considerations, pre-mortem mode |
| 5 | Per-entity reflection (capsules) | ✅ nightly job + on-demand reflect, injected ≤3 |
| 6 | Private networking + backups + restore drill | ✅ `::` bind, docs, `services/backup/` (needs Railway deploy) |
| 7 | Knowledge graph extras | ✅ backlinks, unlinked mentions, link editors, duplicates |
| 8 | MCP conformance | ✅ 18 annotated tools, structured output, pagination, idempotency, resources, prompts |

**Operator checklist additions (on top of the Phase 5.7 list in `docs/03-operations/DEPLOYMENT-RUNBOOK.md`):**
1. Deploy `services/backup/` as a Railway cron service with the R2 vars; run the first restore drill and log it in `BACKUP-DRILLS.md`.
2. Optional but recommended: set `OTEL_EXPORTER_OTLP_ENDPOINT` (+ headers) on both services; pick one backend.
3. Switch `OMNIMIND_API_URL` to `http://omnimind-api.railway.internal:3333` after confirming OmniMind binds `::` on the new image.
4. Add `OMNIMIND_MCP_USER_ID` to MCP agent configs so resources can read.
5. Watch the first `retrieval-eval` CI run; thresholds ratchet upward only.
6. Enable branch protection on `verify`, `docker`, `retrieval-eval`.

**Design calls made (revisit if wrong):** memo-accepted memories use `sourceType AGENT_EXTRACTED` (enum has no CORTEX); reflection skips ministry memories; `GET /usage/llm/summary` is user-scoped unless `?all=1`; Haiku personas get no `output_config` (API rejects effort on Haiku 4.5); pre-mortem assumptions keep `{assumption, reviewAt, confidence}`; decide route is not LLM-rate-limited; `NODE_ENV=ci` in the eval job.

---

## ✅ Phase 5.7 — Audit remediation (2026-10-02)

Audit: `docs/audits/AUDIT-2026-10-02.md` (5 CRITICAL / 16 HIGH / 33 MEDIUM / 28 LOW). All code-addressable findings fixed in 9 commits on the branch; full suite green (896 tests, 10 skipped: 8 DB-gated integration, 2 MCP mock TODOs). CI workflow added.

**Still requires a human:** secret rotation (R-103), `OMNIMIND_ADMIN_KEY` / `ADMIN_EMAILS` / `tenants.owner_user_id` / MCP agent keys on Railway, Stripe webhook URL, and the optional git-history scrub. See the runbook checklist.

**Design calls made during remediation (revisit if wrong):**
- Onboarding (`/onboarding-bootstrap`) is NOT subscription-gated (precedes checkout); it is LLM-rate-limited.
- `cancelAtPeriodEnd` is derived (`canceledAt && status != CANCELED`), not a column.
- Upstream OmniMind 401 still surfaces as 502 from BoardRoom (it is the service key failing, not the user).
- `POST /mcp/agents` is admin-gated; keygen sends `x-admin-key`.
- `x-agent-key` verification is opt-in via `OMNIMIND_REQUIRE_AGENT_KEY`.

---

## (previous) Phase 5.5 — Post-Hermes Remediation — COMPLETE (2026-05-15)

Next-phase triggers noted then: ministry domain re-enable (Ollama + encryption), bitemporal validity windows, Letta-style core memory tier, multi-user (Postgres RLS).

---

## ✅ Phase 5.5 — Fix-Everything Plan executed

Six workstreams + one typecheck baseline cleanup, all merged via PRs #10–#15. See `CHANGELOG.md` for the full timeline. See `docs/FIX-EVERYTHING-PLAN.md` for the original plan and `docs/POST-IMPLEMENTATION-REVIEW.md` for the retrospective.

**Final Success Metrics (from FIX-EVERYTHING-PLAN.md):**
- ✅ `agent_id = 'hermes-test'` on MCP writes (was NULL)
- ✅ `tenant_id` matches MCP env (was schema-default `josh-personal`)
- ✅ `source_weight` matches agent registration (was static 0.85)
- ✅ Audit log captures correct attribution per tool call
- ✅ Outbox row created and persists when embedding fails (non-blocking write)
- 🟡 `has_embedding=true` within 30s — gated on Josh rotating expired `OPENAI_API_KEY` on Railway
- 🟡 Memory reappears in semantic `memory_search` — gated on above
- 🟡 Cross-tenant read returns 0 — tested via E2E-2; functionally verified, manual prod test pending

**4 of 7 fully verified in prod. 3 remaining are external-API-gated, not code-gated.**

---

## What shipped before Phase 5.5

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
