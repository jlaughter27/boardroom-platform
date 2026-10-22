# Current Phase

**Phase in flight:** 🎨 **Phase 7.5 — Visualization + Apple-grade UI foundation** (PR #22: viz upgrade + UI foundation Phases A/B/C/D, all merged on the branch). Phase 7 MCP front door is merged (PR #21) and awaits the Railway go-live checklist.
**Last update:** 2026-10-20 (Phase C merged onto PR #22)
**Updated by:** Claude (research → build → review session, branch `claude/amazing-mccarthy-grvem2`)

**Next phase (not yet started):** 30-day dogfooding window across clients. **Do not start until the "MCP live checklist" in `docs/03-operations/DEPLOYMENT-RUNBOOK.md` (mirrored in `docs/runbooks/omnimind-mcp.md` §0–§7) is done in order** — token minting needs tenant owners, which need the admin key; the MCP service refuses to start without the gateway key. **One command does the checklist** (2026-10-20): `pnpm go-live:mcp -- --project <id> --owner-email <e-mail> --yes` from a laptop, or GitHub → Actions → *MCP go-live* from a phone (runbook "One-command path").

---

## 🎨 Phase 7.5 — Visualization upgrade + Apple-grade UI foundation (2026-10-20)

**Done (PR open):** communities knowledge graph (Louvain + hulls + anchored labels + cluster force, minimap, legend-as-filter, focus glow, hover card, deduped spotlight hits, eased timeline), dashboard chart system (`components/viz/`, 11 SVG primitives, validated palettes, partial-week handling), cockpit row + memory pulse + what's moving + commitment horizon, calibration reliability diagram, diff-style change timeline, screenshot harness (`tools/visual-preview/`). Client tests 245 → 378. Details: `CHANGELOG.md` 2026-10-20.

**Done (merged into PR #22, `d3d48f2`):** UI foundation per `docs/research/APPLE-GRADE-UI-2026-10-20.md` — Phase A tokens (self-hosted Inter variable with optical sizing + tabular figures, ease-out motion tokens + Apple-parameter springs, layered hue-matched shadows + inset highlight + hairline, concentric radius helper, `.material` with reduced-transparency fallback, dark elevation ladder), Phase B primitives on Base UI (`@base-ui/react`: Dialog, Tooltip, Select, Tabs, Popover, Menu; Button press feedback + glass/capsule; Card elevation; Toast swipe; command palette material; Lucide icons), Phase D guardrails (`ui-standards` test, `UI-FOUNDATION.md`, ADR-015).

**Done (Phase C, merged into PR #22, `8af3c5c`):** React 19.3.1 + `<ViewTransition>` route transitions keyed by direction (forward slides in from the right, back reverses; verified mid-flight), header that turns to material once scrolled (IntersectionObserver sentinel), sidebar pill indicator + hairline tokens, `PageHeader` on every page, `Switch` / `Slider` / segmented `Tabs` / `Select size="sm"` / icon `Button` replacing the native controls in the configurator, Settings, Memory Explorer and graph controls, graph legend / minimap / hover card on `.material` (reference layering model), segmented `ModeSelector`, `Modal variant="sheet"` with drag-to-dismiss on phones + `SynthesisSheet`, `shoot-pages.mjs` harness with the contrast-on-glass gate and reduced-motion / reduced-transparency variants, two new `ui-standards` rules. Details: `CHANGELOG.md` 2026-10-20 (Phase C); reference: `UI-FOUNDATION.md` §3 / §6 / §7 / §8.

**E2E (2026-10-20, live local stack — Postgres+pgvector, OmniMind, BoardRoom prod build, MCP gateway):** `pnpm test:e2e` 55/55, new `pnpm e2e:live` journey 22/22 (UI register → graph → token mint → MCP write/search → cross-client visibility → revoke). Found and fixed on the branch: partial agent identity fell through unscoped (now `400 partial_agent_identity`), per-user read budget too low for the UI (`USER_READ_RATE_LIMIT_PER_MINUTE`, default 120), production CSP blocked the inline theme script (now `/theme-init.js`), two `<h1>` per page. Details: `CHANGELOG.md` 2026-10-20 e2e entry.

**Next:** merge PR #22 (Josh's call), Railway go-live for the MCP service (operator checklist), then the forms pass for the four remaining native selects (MCP token form, entity form, admin, decision-lab filter).

**Decisions taken (user approved the research 2026-10-20, recommendations adopted):** Base UI as the headless layer; React 19.3 bump for view transitions; Lucide as the single icon set; no Tailwind v4 migration; no displacement "liquid" lensing on content.

---

## ✅ Phase 7 — Universal memory MCP front door + searchable graph (2026-10-18/19)

Source: `docs/research/MCP-MEMORY-LANDSCAPE-2026-10-11.md` ("do now" items 1–11). Built by five parallel lanes against one contract, then four adversarial reviewers (reports under the session scratchpad; findings: 6 HIGH / 26 MEDIUM / ~37 LOW, all fixed with tests that fail on the old code). Final state: typecheck 5/5, **2,039 tests passing** (149 shared · 228 mcp · 1,133 omnimind · 284 server · 245 client) + 45 eval, client build green, frozen install clean, audit clean at high+ (`proxy-addr` pinned ≥2.0.8).

| # | Item | Status |
|---|---|---|
| 1 | Per-user identity on one MCP URL | ✅ `omt_` personal tokens (introspection), OAuth JWTs (jose, RFC 8707 audience, JWKS discovery, verified-email auto-link), legacy static bearer kept; sessions bound to principal + scope digest |
| 2 | Delegation on the API | ✅ gateway agent (`mcp:delegate`) + `x-mcp-principal`; scopes = principal ∩ gateway; delegated route **allow-list** (403 elsewhere); user isolation on `userId`/`x-user-id`; token routes BoardRoom-only |
| 3 | RFC 9728 PRM + 401/503 contract | ✅ `/.well-known/oauth-protected-resource[/mcp[/]]`, generic 401 body, per-IP failed-auth limiter (`OMNIMIND_MCP_TRUST_PROXY` on Railway), immediate revocation, userinfo fallback, no-redirect guarantee |
| 4 | ChatGPT-shaped `search`/`fetch` | ✅ 20 tools; provenance field; invalidated rows excluded unless `includeArchived` |
| 5 | Freshness contract | ✅ server `instructions`; `requiresUserInteraction` on destructive tools; no push (documented) |
| 6 | Settings → Connected AI tools | ✅ mint/revoke tokens (365-day default, `null` = never), one-time display, per-client snippets with OAuth-first branching |
| 7 | Searchable graph | ✅ ⌘K hybrid spotlight with `asOf`, select ≠ focus (no relayout on click), local-first depth 2, edge-type filter, focus history, timeline scrubber, Memory Explorer tags/asOf/archived, render tests + GraphPage test |
| 8 | Ops | ✅ `packages/omnimind-mcp/Dockerfile` + `railway.toml`, CI docker matrix, compose service, `.dockerignore`, 79-var `.env.example`, operator runbook, agent configs, FRAGILE-ZONES §8 |
| 9 | Write latency | ✅ `bench --n N --yes` (cleans up), `OMNIMIND_MCP_WRITE_EXTRACT=async` on a long-lived client |

**Operator checklist (in this order — see DEPLOYMENT-RUNBOOK "MCP live checklist"):** 0 `OMNIMIND_ADMIN_KEY` + `ADMIN_EMAILS` set → 1 gateway agent via keygen with `MCP_GATEWAY_CEILING_SCOPES` → 2 `PATCH /admin/tenants/:id {ownerUserId}` for each tenant → 3 deploy `omnimind-mcp` (repo-root context, `RAILWAY_DOCKERFILE_PATH`, `OMNIMIND_MCP_TOKEN_AUTH=true`, `OMNIMIND_MCP_AGENT_KEY`, `OMNIMIND_MCP_PUBLIC_URL`, `OMNIMIND_MCP_ALLOWED_HOSTS`, `OMNIMIND_MCP_TRUST_PROXY=true`) → 4 BoardRoom `OMNIMIND_MCP_PUBLIC_URL` (+ `APP_PUBLIC_URL`) → 5 OAuth issuer (runbook §9; required for ChatGPT and most Claude.ai orgs) → 6 mint a token in Settings → 7 install per client → 8 verify (PRM, 401, `tools/list` = 20, audit attribution, revoke immediate, bench) → 9 `OMNIMIND_REQUIRE_AGENT_KEY=true`.

**Blind spots closed 2026-10-19:** client dialog facts verified from primary docs (ChatGPT = OAuth or no-auth only; Claude.ai "Request headers" is a limited beta; Claude Code needs `--scope user`; Gemini `httpUrl`, VS Code `type: http` + `inputs`, Zed native `url`) and snippets/runbook now state them without hedging; revocation is immediate for data access (`PRINCIPAL_REVOKED`, `OMNIMIND_MCP_PRINCIPAL_CACHE_MS` 30 s); OAuth works with providers that omit e-mail claims (OIDC userinfo fallback, `OMNIMIND_MCP_OAUTH_USERINFO`) and identities can be linked manually (`POST /mcp/identities`); `/mcp`, `/mcp/` and `/` are served without redirects; `scripts/pre-deploy-check.sh` covers the third service and probes the live front door. **Still not verified in the sandbox:** the first real `docker (omnimind-mcp)` CI build (runs on the PR) and OAuth against a real provider (in-process RS256 issuer with userinfo only).

**Design calls made (revisit if wrong):** no push freshness (turn-time reads + `instructions`); OAuth auto-link is read-only and picks the oldest owned tenant; the gateway key is never sent on static sessions; SSE kept for `tools/call` responses (keep-alive during long writes); token default expiry 365 days; graph single click selects, double click / "Focus here" re-roots.

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
| 8 | MCP conformance | ✅ 18 annotated tools (20 since Phase 7: `search`, `fetch`), structured output, pagination, idempotency, resources, prompts |

**Operator checklist additions (on top of the Phase 5.7 list in `docs/03-operations/DEPLOYMENT-RUNBOOK.md`):**
1. Deploy `services/backup/` as a Railway cron service with the R2 vars; run the first restore drill and log it in `BACKUP-DRILLS.md`.
2. Optional but recommended: set `OTEL_EXPORTER_OTLP_ENDPOINT` (+ headers) on both services; pick one backend.
3. Switch `OMNIMIND_API_URL` to `http://omnimind-api.railway.internal:3333` after confirming OmniMind binds `::` on the new image.
4. ~~Add `OMNIMIND_MCP_USER_ID` to MCP agent configs so resources can read.~~ Superseded by Phase 7: hosted tokens bind the user; `OMNIMIND_MCP_USER_ID` is only for stdio/static mode.
5. First `retrieval-eval` CI run passed (2026-10-03: for-persona recall@10 0.520 / MRR 0.440 vs gates 0.5 / 0.35; weakest slice `update` at 0.27). Thresholds ratchet upward only, after three green runs on `main`.
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
- `docs/runbooks/omnimind-mcp.md` — (rewritten in Phase 7 as the operator path to live; rotation = SQL upsert or new agent name, see §1)
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
