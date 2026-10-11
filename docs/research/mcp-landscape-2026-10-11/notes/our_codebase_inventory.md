# Inventory of what the BoardRoom/OmniMind monorepo already provides for (1) a shared memory over MCP and (2) knowledge-graph visualization + search

Scope: read-only inspection of `/home/user/boardroom-platform` on 2026-10-11 (git HEAD after the Phase 6 build of 2026-10-02 / review of 2026-10-03). All "Source" links are repository-relative file paths (line numbers where useful). "Implemented and tested" means a Vitest file exercises the code path; "implemented, untested" means no test references it; "documented but not present" means a doc claims it and the code does not.

Baseline test state claimed by the project: "typecheck 5/5, **1,481 tests passing** (138 mcp · 135 shared · 261 server · 92 client · 810 omnimind · 45 eval)" — [docs/STATUS/CURRENT-PHASE.md](docs/STATUS/CURRENT-PHASE.md) (line ~10). I did not re-run the suite.

---

## Key Question 1 — MCP server (`packages/omnimind-mcp`): tools, resources, prompts, transports, auth, idempotency, structured output, annotations, pagination, notifications, ChatGPT-shaped `search`/`fetch`, rate limits, audit, error taxonomy

### Takeaway
A spec-2025-11-25-conformant MCP server exists with exactly 18 annotated tools (all with Zod `outputSchema` + `structuredContent`), 4 narrow `omnimind://` resource templates, 3 prompts, stdio and a stateful Streamable-HTTP transport (session TTL 30 min, cap 100), cursor pagination, idempotency keys with an MCP-side replay cache, audit logging with ministry redaction, and a typed error vocabulary. It has **no OAuth** (static bearer per server process + per-agent `omk_` keys resolved from env), **no resource subscriptions or any `notifications/*`**, **no tools named `search`/`fetch`**, and **no rate limiting inside the MCP process** (limits live in the OmniMind API).

### Cited Findings

**Tool inventory (18, implemented and tested)**
- Registration order and count: `memory_write, memory_search, memory_supersede, decision_log, task_upsert, task_status, task_list, task_complete, task_block, project_status, project_summary, person_get, commitment_log, commitment_list, status_get, memory_reflect, memory_consolidate, graph_neighborhood`; `export const TOOL_COUNT = 18;` — [packages/omnimind-mcp/src/server.ts](packages/omnimind-mcp/src/server.ts) lines 18–42.
- Each tool registers with `title`, `description`, `inputSchema` (Zod), `outputSchema` (Zod), `annotations`, and the handler returns `{ content:[text JSON], structuredContent: result }` — [server.ts](packages/omnimind-mcp/src/server.ts) lines 71–100.
- Test: "registers exactly 18 tools, each with title, annotations and outputSchema"; "annotation matrix: 9 read-only tools, destructive only for memory_supersede + memory_consolidate"; "write tools advertise idempotencyKey (≤100) in their input schema"; "a successful call returns text + structuredContent that passes the output schema" — [packages/omnimind-mcp/tests/server-registry.test.ts](packages/omnimind-mcp/tests/server-registry.test.ts) lines 58–115.
- MCP SDK version: `"@modelcontextprotocol/sdk": "^1.31.0"`; server name/version `omnimind-mcp` / `0.2.0` — [packages/omnimind-mcp/package.json](packages/omnimind-mcp/package.json); [server.ts](packages/omnimind-mcp/src/server.ts) line 63–66.

**Annotations**
- Four presets, `openWorldHint` always `false`: `READ_ONLY_ANNOTATIONS`, `ADDITIVE_WRITE_ANNOTATIONS`, `IDEMPOTENT_WRITE_ANNOTATIONS`, `DESTRUCTIVE_WRITE_ANNOTATIONS` with comment "MCP spec 2025-11-25 tool annotations. All four are HINTS for clients; the server still enforces scopes." — [packages/omnimind-mcp/src/types.ts](packages/omnimind-mcp/src/types.ts) lines 3–35.
- Doc table of per-tool scope / readOnly / destructive / idempotent / pagination — [docs/MEMORY-PROTOCOL.md](docs/MEMORY-PROTOCOL.md) lines 163–186.

**`memory_search` input shape (the only search tool)**
- `query` (min 1), `userId`, `domain?`, `tags?` (ALL must match), `status?` enum `DRAFT|CONFIRMED|SUPERSEDED|ARCHIVED|REJECTED`, `limit` 1..20 default 5, `includeArchived` default false, `asOf` ISO datetime, `cursor` — [packages/omnimind-mcp/src/tools/memory.tool.ts](packages/omnimind-mcp/src/tools/memory.tool.ts) lines 85–97. Description: "Hybrid search over the shared memory store (semantic + full-text + trigram, recency-weighted). Paginated… (max 20 per page)" — line 251.
- There are **no tools named `search` or `fetch`**; the tool list above is exhaustive — [server.ts](packages/omnimind-mcp/src/server.ts) lines 18–40.

**`graph_neighborhood` tool**
- `nodeId` must match `^(goal|project|task|person|decision|commitment|memory):[^\s]+$`, `hops` 1|2 (default 1), `userId`; BFS over `GET /graph/backlinks/:nodeId`; `GRAPH_NODE_CAP = 60`; returns `{ root, hops, nodes, edges, truncated }` — [packages/omnimind-mcp/src/tools/graph.tool.ts](packages/omnimind-mcp/src/tools/graph.tool.ts) lines 11–72. Tested in [tests/graph.tool.test.ts](packages/omnimind-mcp/tests/graph.tool.test.ts).

**`memory_consolidate` / `memory_supersede` / `memory_reflect`**
- Consolidate: "Find near-duplicate memories (cosine ≥ 0.92) among the most recent ones… Default dryRun=true only proposes; dryRun=false supersedes each archiveId with its keepId (reversible via version history, never deleted)"; scan limit max 50 — [memory.tool.ts](packages/omnimind-mcp/src/tools/memory.tool.ts) lines 111–115, 374–376, 444–455.
- Reflect: `{ entityType: goal|project|person, entityId, userId }` → `POST /context/reflect` — lines 105–109 and [docs/contracts/PHASE-6-CONTRACTS.md](docs/contracts/PHASE-6-CONTRACTS.md) "MCP (owner: D)".

**Resources (4 templates; implemented and tested)**
- `omnimind://{tenant}/status`, `/goal/{id}`, `/person/{id}`, `/graph/{nodeId}`; MIME `application/json`; only `status` is enumerable via `list`; the other three register `list: undefined` — [packages/omnimind-mcp/src/resources.ts](packages/omnimind-mcp/src/resources.ts) lines 25–31, 63–137.
- Tenant in URI must equal the bound tenant (`TenantMismatchError`, code `TENANT_MISMATCH`); when `OMNIMIND_MCP_USER_ID` unset, returns `{ error: 'NO_USER_BOUND' }` — lines 33–58.
- Tests: "lists 4 templates + the bound tenant status resource", "refuses any other tenant in the URI", "returns NO_USER_BOUND when OMNIMIND_MCP_USER_ID is not set", resource reads audited (R-M-06) — [tests/server-registry.test.ts](packages/omnimind-mcp/tests/server-registry.test.ts) lines 129–198.
- Design intent: "The whole graph is never a single resource and tools are not mirrored 1:1." — [resources.ts](packages/omnimind-mcp/src/resources.ts) lines 10–13.

**Prompts (3; implemented and tested)**
- `session_start(domain?)`, `decision_review(decisionTitle)`, `session_end()` encoding the CLAUDE.md dogfooding rules — [packages/omnimind-mcp/src/prompts.ts](packages/omnimind-mcp/src/prompts.ts) lines 10, 60–89; test line 198 of server-registry.test.ts.

**Transports**
- stdio: `StdioServerTransport`, one process per agent — [packages/omnimind-mcp/src/transports/stdio.ts](packages/omnimind-mcp/src/transports/stdio.ts).
- HTTP: "Streamable HTTP transport — stateful sessions (M-101), fail-closed auth (F-203), body cap / crash isolation / DNS-rebinding protection (M-105), and a real GET /health"; one `StreamableHTTPServerTransport + McpServer` pair per `mcp-session-id`; `DEFAULT_PORT = 3334`, `MAX_BODY_BYTES = 1 MiB`, `MAX_SESSIONS = 100`, `DEFAULT_SESSION_IDLE_MS = 30 min`, sweeper every 60 s; at cap, a new `initialize` evicts least-recently-seen — [packages/omnimind-mcp/src/transports/http.ts](packages/omnimind-mcp/src/transports/http.ts) lines 1–27, 184–196, 282–289.
- HTTP mode refuses to start without `OMNIMIND_MCP_API_KEY` ("Refusing to start an unauthenticated MCP endpoint") — lines 73–86.
- `enableDnsRebindingProtection: true` with `allowedHosts` default loopback only; env `OMNIMIND_MCP_ALLOWED_HOSTS` — lines 88–90, 204–207, 397–404.
- 17 HTTP transport tests incl. "initialize → initialized → tools/list over HTTP returns all 18 tools (with annotations + outputSchema)", "supports concurrent independent sessions, and DELETE ends a session", idle sweep/eviction — [tests/http.transport.test.ts](packages/omnimind-mcp/tests/http.transport.test.ts) lines 72–296.
- Runbook: "one MCP session per `initialize` (response carries `mcp-session-id`; clients must echo it), `GET` opens the SSE stream, `DELETE` ends the session, request bodies capped at 1 MiB (413)" — [docs/runbooks/omnimind-mcp.md](docs/runbooks/omnimind-mcp.md) line 34.

**Auth model (no OAuth)**
- Inbound (HTTP only): a single static key compared constant-time (sha256 + `timingSafeEqual`) from `Authorization: Bearer …` or `x-mcp-api-key`; failure → `401` + `WWW-Authenticate: Bearer realm="omnimind-mcp"` — [http.ts](packages/omnimind-mcp/src/transports/http.ts) lines 92–110, 242–246.
- Agent identity is NOT derived from the bearer; it comes from env: `OMNIMIND_MCP_AGENT_NAME`, `OMNIMIND_MCP_TENANT_ID`, `OMNIMIND_MCP_SCOPES` (default `memory:read`), `OMNIMIND_MCP_SOURCE_WEIGHT` (0..2), optional `OMNIMIND_MCP_USER_ID` — [packages/omnimind-mcp/src/lib/auth.ts](packages/omnimind-mcp/src/lib/auth.ts) lines 34–70. Consequence: all clients of one HTTP server share one agent identity/tenant/scope set.
- Outbound to OmniMind: every request carries `x-agent-id`, `x-tenant-id`, `x-source-weight` — [server.ts](packages/omnimind-mcp/src/server.ts) lines 54–62 — plus `x-agent-key` (`omk_` + 64 hex) minted by keygen and stored sha256-hashed in table `agents` — [packages/omnimind-mcp/src/keygen.ts](packages/omnimind-mcp/src/keygen.ts) lines 45–70; `POST /mcp/agents` is admin-gated (`requireAdminKey`) — [packages/omnimind-api/src/routes/mcp.routes.ts](packages/omnimind-api/src/routes/mcp.routes.ts) line 142.
- Scope check in-process: `requireScope` honours `*` and `<prefix>:*` wildcards, throws `ScopeDeniedError` — [packages/omnimind-mcp/src/lib/namespace.ts](packages/omnimind-mcp/src/lib/namespace.ts).
- Scope table documented; "Scope violations return `SCOPE_DENIED` — not an error to retry" — [docs/MEMORY-PROTOCOL.md](docs/MEMORY-PROTOCOL.md) lines 201–212.
- Grep for `oauth|OAuth|PKCE|authorization server|dynamic client` across `packages/omnimind-mcp/src`, `docs/MEMORY-PROTOCOL.md`, `docs/runbooks/omnimind-mcp.md` returned **zero hits** (the only `oauth.routes.ts` in omnimind-api stores Google OAuth tokens: imports `encrypt, decrypt`, `SaveOAuthTokenBodySchema`) — [packages/omnimind-api/src/routes/oauth.routes.ts](packages/omnimind-api/src/routes/oauth.routes.ts) lines 1–6.

**Idempotency (two layers; tested)**
- `memory_write`, `task_upsert`, `decision_log`, `commitment_log` accept `idempotencyKey` (≤100 chars) forwarded as `Idempotency-Key`; "the same (agent, key) within 24 h replays the original result (`Idempotent-Replayed: true`)" — [docs/MEMORY-PROTOCOL.md](docs/MEMORY-PROTOCOL.md) lines 188–195.
- MCP-side replay cache: in-memory LRU, `REPLAY_CACHE_MAX_ENTRIES = 500`, `REPLAY_CACHE_TTL_MS = 24 h`, keyed `(agentId, userId, idempotencyKey)`, so a retried `memory_write` does not re-run Haiku fact extraction — [packages/omnimind-mcp/src/lib/replay-cache.ts](packages/omnimind-mcp/src/lib/replay-cache.ts) lines 1–13, 63–66.

**Pagination**
- Opaque base64url cursor of `{offset}`, `MAX_PAGE_SIZE = 20`; foreign cursors rejected with `VALIDATION_ERROR` — [packages/omnimind-mcp/src/lib/cursor.ts](packages/omnimind-mcp/src/lib/cursor.ts); tested in [tests/cursor.test.ts](packages/omnimind-mcp/tests/cursor.test.ts). Applies to `memory_search`, `task_list`, `commitment_list` — [docs/MEMORY-PROTOCOL.md](docs/MEMORY-PROTOCOL.md) line 199.

**Notifications / subscriptions**
- `grep -rniE "subscribe|listChanged|list_changed|notification|oauth|ratelimit|sendResourceUpdated|sendToolListChanged" packages/omnimind-mcp/src/` returns only an unrelated comment in `fact-extractor.ts` — i.e., **no `resources/subscribe`, no `notifications/resources/updated`, no `*/list_changed` emission** anywhere in the MCP package (grep performed 2026-10-11; see [packages/omnimind-mcp/src/lib/fact-extractor.ts](packages/omnimind-mcp/src/lib/fact-extractor.ts) line 8 for the sole hit).

**Rate limits**
- None in the MCP process. Per-agent hourly limits are enforced in OmniMind API: `AGENT_RATE_READ` 1000, `AGENT_RATE_WRITE` 200, `AGENT_RATE_DECISION` 100, `AGENT_RATE_AUDIT` 5000, window 1 h, in-memory buckets, non-agent traffic gets `NON_AGENT_MULTIPLIER` (default 5); 429 `agent_rate_limited` — [packages/omnimind-api/src/middleware/agent-rate-limiter.ts](packages/omnimind-api/src/middleware/agent-rate-limiter.ts) lines 4–12, 59, 98–101; tested [tests/unit/middleware/agent-rate-limiter.test.ts](packages/omnimind-api/tests/unit/middleware/agent-rate-limiter.test.ts).

**Audit logging (tested)**
- Every tool call wrapped in `withAudit` → fire-and-forget `POST /mcp/audit`; inputs for ministry-domain calls redacted to `[REDACTED:ministry]`; outputs reduced to an allow-list of structural keys (ids/titles/counts) — [packages/omnimind-mcp/src/lib/audit.ts](packages/omnimind-mcp/src/lib/audit.ts) lines 5–36, 115–148; refusals audited via `auditRefusal` (F-212) lines 92–113. Table `McpAuditLog` with `@@index([tenantId, createdAt])` — [packages/omnimind-api/prisma/schema.prisma](packages/omnimind-api/prisma/schema.prisma) lines 818–830. Review queries in [docs/runbooks/omnimind-mcp.md](docs/runbooks/omnimind-mcp.md) lines 116–150.

**Error taxonomy**
- MCP tool-level (returned as `isError` JSON `{error, message}`): `SCOPE_DENIED`, `VALIDATION_ERROR` — [server.ts](packages/omnimind-mcp/src/server.ts) lines 44–49, 92–95; `memory_write` typed refusals `MINISTRY_DEFERRED` | `FACT_EXTRACTOR_UNAVAILABLE` with `ok:false` — [types.ts](packages/omnimind-mcp/src/types.ts) lines 67–82; resources: `TENANT_MISMATCH`, `NO_USER_BOUND` — [resources.ts](packages/omnimind-mcp/src/resources.ts).
- HTTP transport: 401 Unauthorized, 400 `-32700` parse error / `-32000` missing session, 404 `-32001` session not found, 413 Payload Too Large, 405, 403 (DNS-rebinding), 500 — [http.ts](packages/omnimind-mcp/src/transports/http.ts) lines 256–312.
- OmniMind side: `invalid_agent_key` 401, `insufficient_scope` 403, `agent_rate_limited` 429, `validation_failed` 422, `invalid_cursor` 400 — [agent-context.ts](packages/omnimind-api/src/middleware/agent-context.ts) line 156; [scope-enforcer.ts](packages/omnimind-api/src/middleware/scope-enforcer.ts) line 98; [docs/contracts/omnimind-api.contract.md](docs/contracts/omnimind-api.contract.md) line ~160.

**Client configs shipped**
- Claude Desktop, Claude Code, Cursor (stdio) and ChatGPT Desktop (HTTP, `"type": "http"`, Bearer header, read-only `memory:read`, sourceWeight 0.6) — [docs/agent-configs/](docs/agent-configs/) (`chatgpt-desktop.json`, `claude-desktop.json`, `claude-code.json`, `cursor.json`).
- Smoke-test tiers 1–7 incl. HTTP transport — [docs/agent-configs/SMOKE-TESTS.md](docs/agent-configs/SMOKE-TESTS.md).

**Doc drift found**
- `chatgpt-desktop.json` `_health_check` comment and SMOKE-TESTS Tier 6 say `/health` returns `{status, uptime, sessions, agent, tenant}`; the code and runbook return only `{status, uptime, sessions}` ("R-M-05 — unauthenticated, so it says nothing about who this server is") — [http.ts](packages/omnimind-mcp/src/transports/http.ts) lines 231–239 vs [docs/agent-configs/chatgpt-desktop.json](docs/agent-configs/chatgpt-desktop.json) last line and [SMOKE-TESTS.md](docs/agent-configs/SMOKE-TESTS.md) line 168.
- PHASE-6-CONTRACTS says idempotency "Scope = `agentContext.agentId` if present else `x-user-id`"; implementation uses `agent:<agentId>:user:<x-user-id>` for verified agents — [docs/contracts/PHASE-6-CONTRACTS.md](docs/contracts/PHASE-6-CONTRACTS.md) "Idempotency" vs [packages/omnimind-api/src/middleware/idempotency.ts](packages/omnimind-api/src/middleware/idempotency.ts) lines 6, 74.

### Inferences
- Because agent identity is bound per server process via env, "many AI platforms" means one MCP process (or one config) per agent×tenant; the HTTP transport cannot distinguish two ChatGPT users sharing a URL. Multi-user hosted MCP would require token→agent resolution that does not exist today.
- Lack of any `notifications/*` means clients cannot learn of memory changes made by another agent except by re-reading; the "shared" memory is shared by polling.
- The absence of tools literally named `search`/`fetch` matters only if a target client requires that naming; the codebase gives no evidence either way (left to the external-products researcher).

### Gaps
- Could not verify in-code whether `tools/list` advertises `listChanged: false` capability explicitly (SDK default); no code sets server capabilities.
- Whether the HTTP server has ever been exercised against a real ChatGPT Desktop client is not recorded; SMOKE-TESTS Tier 6 uses curl and the SDK client only.
- The `hermes-roundtrip.mjs` script at the package root was not inspected (not in `src/`, no test).

---

## Key Question 2 — OmniMind API capabilities behind the MCP (retrieval, temporal validity, supersedes/provenance, entities + links, jobs, tenancy, embeddings, idempotency, `GET /graph`, unlinked mentions, backlinks, people duplicates, `POST /memories/search`)

### Takeaway
OmniMind already implements a four-layer hybrid retrieval stack with bitemporal validity (`valid_at`/`invalid_at`, `asOf`), supersede-not-delete provenance (`superseded_by`, `consolidatedFrom`, `version`), a 7-node-type / 10-edge-type knowledge-graph projection with backlinks, unlinked mentions and trigram people-dedup, eight node-cron background jobs, per-agent tenancy via an `agents` table, three embedding providers (OpenAI, Ollama for ministry, deterministic mock), and a 24-h `Idempotency-Key` middleware. The graph endpoint is a bulk projection with no server-side pagination or depth parameter; the only server-side traversal is 1-hop backlinks (the MCP tool composes 2 hops client-side).

### Cited Findings

**Hybrid retrieval**
- Layers: `semantic-search.ts` (pgvector), `fulltext-search.ts` (tsvector), `trigram-search.ts` (pg_trgm), `structured-filter.ts`, plus `ranker.ts`, `forgetting-curve.ts`, `temporal-validity.ts`, `row-decrypt.ts`, `context-packager.ts` — [packages/omnimind-api/src/retrieval/](packages/omnimind-api/src/retrieval/) (directory listing).
- `hybridSearchMemories`: "Same stack as `assembleContextForPersona`: structured + FTS + trigram + semantic → rankAndDeduplicate → forgetting curve (inside the layers)"; `HYBRID_SEARCH_MAX_LIMIT = 50`; runs the four layers in `Promise.all` — [packages/omnimind-api/src/services/memory.service.ts](packages/omnimind-api/src/services/memory.service.ts) lines 704–819.
- `POST /memories/search` body `{ query ≤2000, limit 1–50 default 20, domain, tags (hasEvery), status, includeArchived, asOf, cursor }` → `{ items: Array<Memory & { score }>, nextCursor }`; "Tenant: from `req.agentContext` (MCP). A BoardRoom call (no agent context) searches all of the user's tenants" — [docs/contracts/omnimind-api.contract.md](docs/contracts/omnimind-api.contract.md) lines 132–162; route [packages/omnimind-api/src/routes/memories.routes.ts](packages/omnimind-api/src/routes/memories.routes.ts) lines 166–192.
- Forgetting curve archive cutoff `ARCHIVE_CUTOFF_DAYS = 90` — [retrieval/forgetting-curve.ts](packages/omnimind-api/src/retrieval/forgetting-curve.ts).
- Retrieval quality gate: CI `retrieval-eval` job, first run "for-persona recall@10 0.520 vs gate 0.5, MRR 0.440 vs 0.35; `/memories/search` recall@10 0.535, MRR 0.549; the `update` slice is the weakest (recall@10 0.27)" — [.claude/CLAUDE.md](.claude/CLAUDE.md) "Known Limitations" item 11.

**Temporal validity**
- "with `asOf`: `valid_at <= asOf AND (invalid_at IS NULL OR invalid_at > asOf)`; without: `(invalid_at IS NULL OR invalid_at > now())`" shared by all four layers — [packages/omnimind-api/src/retrieval/temporal-validity.ts](packages/omnimind-api/src/retrieval/temporal-validity.ts) lines 3–16.
- Schema: `MemoryEntry.validAt @default(now())`, `invalidAt?`, `supersededBy?`, `version Int @default(1)`, `tenantId @default("josh-personal")`, `sourceWeight` — [packages/omnimind-api/prisma/schema.prisma](packages/omnimind-api/prisma/schema.prisma) lines 202–221.

**Supersedes / consolidation / provenance**
- `PATCH /memories/:id` with `supersedes: <id>` "sets the old row `invalidAt = now(), supersededBy = newId` (no mutation of old content) and appends old id to new row's `consolidatedFrom`" — [docs/contracts/PHASE-6-CONTRACTS.md](docs/contracts/PHASE-6-CONTRACTS.md) "Temporal validity"; route line 12–16 of memories.routes.ts.
- `POST /memories/search-similar` (threshold default 0.80, limit ≤20) used by `memory_consolidate` at 0.92 — [memories.routes.ts](packages/omnimind-api/src/routes/memories.routes.ts) lines 72–93.
- Research rationale adopted: "invalidate, don't delete" with bi-temporal edges (Zep/Graphiti pattern) — [docs/research/IMPROVEMENT-RESEARCH-2026-10-02.md](docs/research/IMPROVEMENT-RESEARCH-2026-10-02.md) lines 30, 37.

**Entities and link tables**
- Entities: Person, Goal, Project, Task, Decision (+DecisionAssumption), Commitment; links: `MemoryEntityLink, GoalProjectLink, ProjectPersonLink, ProjectTaskLink, DecisionProjectLink, TaskDependency, CommitmentLink` — [.claude/CLAUDE.md](.claude/CLAUDE.md) "Database (Prisma)" table; schema lines 537, 612.
- Link writer routes (Phase 6): `POST/DELETE /projects/:id/people/:personId {role?}`, `/projects/:id/decisions/:decisionId`, `/tasks/:id/depends-on/:otherTaskId` — [PHASE-6-CONTRACTS.md](docs/contracts/PHASE-6-CONTRACTS.md) "Links / graph extras"; tested [tests/unit/routes/phase6-links.test.ts](packages/omnimind-api/tests/unit/routes/phase6-links.test.ts).

**Knowledge-graph endpoints (implemented and tested)**
- `GET /graph` — "Bulk, read-only projection… One request returns every Goal, Project, Task, Person, Decision and Commitment the user owns (not soft-deleted), the top-N memories by importance, and every link between them… No memory `content` is returned, only titles." Query: `types` (subset of 7), `domain`, `memoryLimit` (0–500, default 150), `includeArchived`. Response `{ nodes, edges, stats:{nodeCounts, edgeCount, isolatedNodes, memoryLimitHit}, generatedAt }` — [docs/contracts/omnimind-api.contract.md](docs/contracts/omnimind-api.contract.md) lines 758–779; service `DEFAULT_MEMORY_LIMIT = 150; MAX_MEMORY_LIMIT = 500` — [packages/omnimind-api/src/services/knowledge-graph.service.ts](packages/omnimind-api/src/services/knowledge-graph.service.ts) lines 28–29; Zod `KnowledgeGraphQuerySchema` — [packages/shared/src/validation/graph.schema.ts](packages/shared/src/validation/graph.schema.ts) lines 79–92.
- Node types (7): `goal|project|task|person|decision|commitment|memory`; edge types (10): `goal_hierarchy, goal_project, project_task, project_person (label=role), decision_project, task_dependency, commitment_person, commitment_project, commitment_entity, memory_entity (label=linkType)` — [packages/shared/src/types/graph.types.ts](packages/shared/src/types/graph.types.ts) lines 11–30.
- **No pagination, cursor, or depth parameter on `GET /graph`** (the query schema has only `types, domain, memoryLimit, includeArchived`) — [graph.schema.ts](packages/shared/src/validation/graph.schema.ts) lines 79–92.
- `GET /graph/backlinks/:nodeId` — "every edge incident to it, in both directions… Entity edges come from the full entity projection (no cap); memory edges are read directly from `MemoryEntityLink`"; 422 malformed / 404 — [contract](docs/contracts/omnimind-api.contract.md) lines 781–786; tested [tests/unit/services/knowledge-graph-backlinks.test.ts](packages/omnimind-api/tests/unit/services/knowledge-graph-backlinks.test.ts).
- `GET /graph/unlinked-mentions?limit=` — word-boundary, case-insensitive match of Person names / Project / Goal titles (≥3 chars) over the newest 500 live memories; ministry memories match title only; `limit` 1–200 default 50 — [contract](docs/contracts/omnimind-api.contract.md) lines 788–794; constants `UNLINKED_MENTIONS_MAX_LIMIT = 200`, `DEFAULT = 50` — [unlinked-mentions.service.ts](packages/omnimind-api/src/services/unlinked-mentions.service.ts) lines 21–22; tested [tests/unit/services/unlinked-mentions.service.test.ts](packages/omnimind-api/tests/unit/services/unlinked-mentions.service.test.ts).
- `POST /graph/unlinked-mentions/link` → creates `relates_to` `MemoryEntityLink`, 201/200/404/422 — contract lines 796–802.
- `GET /people/duplicates` — `pg_trgm similarity(name) >= 0.6`, no auto-merge — [person-duplicates.service.ts](packages/omnimind-api/src/services/person-duplicates.service.ts) lines 6, 39–52; tested.
- Legacy `GET /relationships/graph` ("pre-computed relationship graph") still exists alongside — [contract](docs/contracts/omnimind-api.contract.md) line 808; [relationships.routes.ts](packages/omnimind-api/src/routes/relationships.routes.ts) line 9.

**Background jobs (node-cron)**
- Cortex: memo `'0 18 * * 0'` (Sun 18:00), patterns `'0 3 * * 1'` (Mon 03:00), contradictions `'0 4 * * 1'` (Mon 04:00) — [packages/shared/src/constants/cortex-config.ts](packages/shared/src/constants/cortex-config.ts) lines 5–7. (Note: `.claude/CLAUDE.md` Phase table says "contradiction alerts (cron Tue 9pm)" — stale vs. config.)
- Reflection capsules `'30 2 * * *'` (`REFLECTION_SCHEDULE`), commitment nudges `'0 7 * * *'`, importance decay `'0 2 * * 0'`, weekly digest `'0 18 * * 5'`, embedding retry `*/2 * * * *`, session summarizer `*/10 * * * *` — [packages/omnimind-api/src/jobs/](packages/omnimind-api/src/jobs/) (`reflection-scheduler.ts:11`, `commitment-nudge-scheduler.ts:10`, `importance-decay-scheduler.ts:9`, `weekly-digest-scheduler.ts:10`, `embedding-retry-scheduler.ts:83`, `session-summarizer.ts:15`).
- Reflection contract: nightly, Haiku, regenerates `ContextCapsule` when new-memory importance ≥ 0.8, `staleAfter = +14d`, `version++`; `POST /context/reflect`; `GET /context/capsules?entityIds=` — [PHASE-6-CONTRACTS.md](docs/contracts/PHASE-6-CONTRACTS.md) "Reflection / capsules".

**Multi-tenancy**
- `Agent { apiKeyHash, tenantId, scopes String[], sourceWeight }` with `@@index([tenantId])`, `@@index([apiKeyHash])` — [schema.prisma](packages/omnimind-api/prisma/schema.prisma) lines 801–813.
- Agent context middleware: Path 1 `x-agent-key` (sha256 lookup; header mismatches rejected), Path 2 legacy `x-agent-id`+`x-tenant-id`+`x-source-weight` trusted as-is unless `OMNIMIND_REQUIRE_AGENT_KEY=true` — [agent-context.ts](packages/omnimind-api/src/middleware/agent-context.ts) lines 9–20, 141–182; tested.
- Server-side scope enforcement only for verified agents ("there is no trustworthy scope list to enforce" for legacy) — [scope-enforcer.ts](packages/omnimind-api/src/middleware/scope-enforcer.ts) lines 5–10, 83–99.
- Graph tenant rule: "when an agent context is present, memories are limited to that tenant; entities are user-scoped" — [contract](docs/contracts/omnimind-api.contract.md) line 764. Three tenants documented — [docs/MEMORY-PROTOCOL.md](docs/MEMORY-PROTOCOL.md) lines 241–249.

**Embedding providers**
- `EMBEDDING_PROVIDER=openai|mock` (mock = deterministic 1536-dim unit vector from sha256); OpenAI `text-embedding-3-small` 1536-dim; ministry domain → Ollama `bge-base-en-v1.5` (768-dim, zero-padded to 1536, `OLLAMA_API_URL`) with no fallback — [packages/omnimind-api/src/services/embedding.service.ts](packages/omnimind-api/src/services/embedding.service.ts) lines 7–9, 43–58, 101–145.

**Idempotency middleware (tested)**
- Header `Idempotency-Key` ≤128 chars; scope `agent:<agentId>:user:<x-user-id>` for verified agents; 24 h TTL; replay with original status + `Idempotent-Replayed: true`; storage `IdempotencyKey` table — [idempotency.ts](packages/omnimind-api/src/middleware/idempotency.ts) lines 2–35; tested [tests/unit/middleware/idempotency.test.ts](packages/omnimind-api/tests/unit/middleware/idempotency.test.ts).

**Known limitation relevant to search**
- "`includeEntities: commitments|tasks` is accepted by `/context/for-persona` but those tables are not yet searched by the assembler" — [.claude/CLAUDE.md](.claude/CLAUDE.md) Known Limitations item 10.

### Inferences
- Because `GET /graph` is a bulk projection capped only on memories (≤500), graph size scales with entity count unbounded; for a solo founder this is fine, but there is no server-side neighbourhood query beyond 1-hop backlinks, so any deeper traversal is N round-trips (the MCP `graph_neighborhood` does exactly this).
- Temporal validity is already a differentiator versus simple key-value memory stores; it is exposed to MCP clients via `asOf` on `memory_search` but not surfaced in any UI (see KQ4).

### Gaps
- Did not inspect `relationship.service.ts` to see whether the roadmap's recursive-CTE `findRelatedEntities(entityId, hops)` (Phase 4) exists; the `/relationships/related/:id` endpoint named in the roadmap is not in the route list (only `/relationships/graph`), so treat Phase 4 as **not built** pending confirmation.
- Did not measure actual DB-gated integration coverage (CURRENT-PHASE notes "8 DB-gated integration" tests skipped).

---

## Key Question 3 — Graph UI (`GraphPage.tsx`, `components/graph/*`): library, features, limits, tests

### Takeaway
The graph page is an Obsidian-style canvas built on `react-force-graph-2d ^1.29.2` (d3-force) with hover fade, local-graph depth 0–3, search-to-focus, type/domain/orphan/label filters, a backlinks inspector with three link editors, an unlinked-mentions panel, shape+colour encoding from CSS tokens, reduced-motion support and URL-shareable focus. It is a single global projection capped at 200 memories client-side with no clustering, no timeline, no edge-type filter, no saved views, and only one unit test (data-sync helper); the rendering components themselves are untested.

### Cited Findings

**Library and rendering**
- `"react-force-graph-2d": "^1.29.2"`, plus `d3-force`, `d3-drag`, `d3-selection`, `d3-zoom` `^3.0.0` — [packages/boardroom-ai/package.json](packages/boardroom-ai/package.json) lines 30–33, 45.
- Research justification: "`react-force-graph-2d` (canvas, d3-force underneath, MIT) — adopted. Sigma.js/graphology is the step up past ~10k nodes" — [docs/research/IMPROVEMENT-RESEARCH-2026-10-02.md](docs/research/IMPROVEMENT-RESEARCH-2026-10-02.md) line 63.

**Interaction features (in `KnowledgeGraphView.tsx`, 251 lines)**
- Header comment: "hover a node → it and its 1-hop neighbourhood stay vivid, everything else fades to ~12% alpha; labels for the neighbourhood appear… wheel / pinch → zoom; drag background → pan; node radius ∝ √degree, clamped; labels appear above a zoom threshold or for hovered / selected / neighbour nodes" — [packages/boardroom-ai/client/src/components/graph/KnowledgeGraphView.tsx](packages/boardroom-ai/client/src/components/graph/KnowledgeGraphView.tsx) lines 13–19.
- `prefers-reduced-motion` honoured: `warmupTicks={reducedMotion ? 300 : 0}`, `cooldownTicks={reducedMotion ? 0 : 220}`, zero-duration zoom/centre — lines 55–56, 99, 113–114, 235–236.
- Charge strength scales with node count (`n > 600 ? -40 : n > 200 ? -70 : -120`, `distanceMax(400)`) — line 91; `minZoom={0.15} maxZoom={8}` — lines 246–247; imperative handle `focusNode(id, zoom=2.2)` / `zoomToFit()` — lines 27–30, 124–130; labels truncated at 42 chars with halo stroke — lines 184–191.
- `depthById` drives per-ring fade in local-graph mode — line 39.

**Page-level features (`GraphPage.tsx`, ~310 lines)**
- Fetch `api.getKnowledgeGraph({ memoryLimit: 200 })`; header shows "memories capped at 200 by importance" when `stats.memoryLimitHit` — [packages/boardroom-ai/client/src/pages/GraphPage.tsx](packages/boardroom-ai/client/src/pages/GraphPage.tsx) lines 75, 183, 195.
- Filters `{ types:Set, domain, showOrphans, showLabels, depth: 0|1|2|3 }` persisted in `sessionStorage` key `boardroom.graph.filters.v1` (depth not persisted) — lines 15–37; `depth` type in [GraphControls.tsx](packages/boardroom-ai/client/src/components/graph/GraphControls.tsx) lines 11–12.
- Local graph: BFS `neighbourhood(root, adjacency, depth)` over the kept subgraph — lines 39–53, 143–155; domain filter keeps domain-less nodes only if adjacent to a kept domain node — lines 132–142.
- `?focus=<nodeId>` kept in URL "so a node is shareable / reload-safe" — lines 87–92.
- Keyboard: `/` focuses search, `Esc` clears selection — lines 94–104.
- Search: top-8 results scored (prefix match first, memories de-prioritised), ArrowUp/Down + Enter, `role="listbox"`, placeholder "Search nodes…  ( / )" — [GraphControls.tsx](packages/boardroom-ai/client/src/components/graph/GraphControls.tsx) lines 57–67, 96–110.
- Responsive: inspector/mentions panel become a bottom sheet (`max-md:absolute … max-h-[55%]`) — GraphPage lines 268–272, 284–288.
- Empty / no-match / loading states with "Reset filters" action — lines 236–254.

**Encoding / theming**
- Shapes per type: goal diamond, project square, task triangle, person circle (+ ring/hexagon/dot for the rest); colours read live from CSS custom properties `--color-entity-*`, `--graph-surface`, `--graph-edge`, `--graph-label`, `--font-sans` with fallbacks ("so the canvas follows [theme]… cannot be told apart by hue alone") — [graph-theme.ts](packages/boardroom-ai/client/src/components/graph/graph-theme.ts) lines 6–8, 35–48, 82–101; legend glyphs match canvas shapes — GraphControls lines 27–47.
- `entityRoute(type, refId, meta)` deep-links a node to its entity page — graph-theme.ts line 150.

**Inspector + link editors (`NodeInspector.tsx`, 318 lines)**
- "Backlinks panel for the selected node — the part of Obsidian's graph that people actually use. Linked list comes from `GET /graph/backlinks/:id`" with local-edge fallback — lines 191–219.
- Link editors (Phase 6): project→person with role (`api.addProjectPerson`), project→decision (`api.linkProjectDecision`), task→depends-on (`api.addTaskDependency`), via `EntityPicker` (type-to-filter, top 8, arrow keys) — lines 61–179; [EntityPicker.tsx](packages/boardroom-ai/client/src/components/graph/EntityPicker.tsx) lines 21–38.
- "Focus local" button sets depth to 2 — GraphPage line 262.

**Unlinked mentions panel**
- Loads `api.getUnlinkedMentions(50)`, one-click `linkUnlinkedMention`, removes row optimistically, triggers graph refetch; header button shows count — [UnlinkedMentionsPanel.tsx](packages/boardroom-ai/client/src/components/graph/UnlinkedMentionsPanel.tsx) lines 24–60; GraphPage lines 206–214.

**Data-sync layer**
- `syncGraphData` keeps stable node/link object identities so the simulation does not restart on filter changes — [graph-data.ts](packages/boardroom-ai/client/src/components/graph/graph-data.ts) lines 10–20, 58–120.

**Legacy graph still present**
- `components/memory/RelationshipGraph.tsx` (d3-force over SVG, 125 lines) is still used by `PeopleDirectoryPage.tsx` and `dashboard/RelationshipMapWidget.tsx` — grep result; file header imports `d3-force` and `svgRef`.

**Tests**
- Client: only [tests/components/graph/graph-data.test.ts](packages/boardroom-ai/client/tests/components/graph/graph-data.test.ts) (3 cases on `syncGraphData` identity stability) and [tests/lib/api.phase6.test.ts](packages/boardroom-ai/client/tests/lib/api.phase6.test.ts) (API client shapes). **No tests reference `KnowledgeGraphView`, `GraphPage`, `GraphControls`, `NodeInspector`, or `UnlinkedMentionsPanel`** (find/grep over `*.test.ts(x)` for `graph|Graph|backlink|unlinked`).
- Server/API side of the graph is tested (`knowledge-graph.service.test.ts`, `knowledge-graph-backlinks.test.ts`, `unlinked-mentions.service.test.ts`, `person-duplicates.service.test.ts`, `phase6-links.test.ts`).

**Research-stated interaction rules (all claimed implemented)**
- "hover highlights the 1-hop neighbourhood and fades the rest to ~12–15%; radius ∝ √degree, clamped; click pins and opens backlinks; depth slider 1–3 with faded rings by distance; search focuses and zooms; freeze the simulation after ~200–300 ticks; labels only above a zoom threshold…; respect `prefers-reduced-motion`. (All implemented in `components/graph/KnowledgeGraphView.tsx`.)" — [IMPROVEMENT-RESEARCH-2026-10-02.md](docs/research/IMPROVEMENT-RESEARCH-2026-10-02.md) line 61.

### Inferences
- Known UI limits (derived from code, not from a doc): no clustering/community detection, no timeline/temporal slider despite `validAt/invalidAt` existing server-side, no edge-type filter (only node-type), no saved/named views, no export (PNG/JSON), no multi-select, no pinning beyond selection, 200-memory cap, single whole-graph fetch per page load (silent refetch after link writes).
- Rendering is canvas, so accessibility of the graph itself is limited to the search listbox, inspector and controls (no per-node DOM).

### Gaps
- Node-count performance ceiling was not measured; only the charge-strength branches (>200, >600 nodes) hint at the expected range.
- Whether `showLabels` / zoom threshold values are tuned (constant values not extracted here).

---

## Key Question 4 — Search UX across the client: command palette, global search, memory explorer filters, keyboard shortcuts

### Takeaway
`cmdk` is used: a lazy-loaded `CommandPalette` (⌘/Ctrl-K) searches goals, projects, people and recent decisions from the Zustand entities store plus navigation/actions, with `shouldFilter={false}` (custom matching). There is no global search over memories or graph nodes from the palette, the Memory Explorer offers q/domain/class/status/sort filters only (no tags, `asOf`, or archived toggle), and the graph page has its own node search; a shortcuts hook defines seven global chords.

### Cited Findings
- `import { Command } from 'cmdk'` in [packages/boardroom-ai/client/src/components/ui/CommandPalette.tsx](packages/boardroom-ai/client/src/components/ui/CommandPalette.tsx) line 2; groups "Navigation", "Goals", "Projects", "People", "Recent Decisions", "Actions" — lines 85–163; data from `useEntitiesStore()` (`goals, projects, people, decisions`) — line 25; `shouldFilter={false}` — line 72; placeholder "Search or type a command..." — line 77; lazy-loaded in [App.tsx](packages/boardroom-ai/client/src/App.tsx) lines 8, 110.
- Palette has a "Memory Explorer" navigation entry but no memory-content search — line 13 (`{ name: 'Memory Explorer', path: '/memory' }`); no `api.` calls in the file (grep).
- Global shortcuts: ⌘K palette, ⌘N new decision session, ⌘⇧G dashboard, ⌘⇧M memory, ⌘⇧D decisions, ⌘⇧P people, ⌘/ shortcuts modal — [hooks/useKeyboardShortcuts.ts](packages/boardroom-ai/client/src/hooks/useKeyboardShortcuts.ts) lines 27–33.
- Memory Explorer search bar: debounced `q` (300 ms), free-text `domain`, class select ("All Classes"), status select ("All Statuses"), sort (`createdAt`…) — [components/memory/MemorySearch.tsx](packages/boardroom-ai/client/src/components/memory/MemorySearch.tsx) lines 8–24, 58–106. Grep for `tags|asOf|includeArchived` in that file: no hits.
- BoardRoom server proxies both `GET /memories/search?q=` (legacy) and `POST /memories/search` (hybrid, cursor) — [server/src/routes/entities.routes.ts](packages/boardroom-ai/server/src/routes/entities.routes.ts) lines 405–415; client has `api.ts` wrappers for both — [client/src/lib/api.ts](packages/boardroom-ai/client/src/lib/api.ts) lines 417, 1169–1172.
- Graph page search is separate (`#graph-search`, "/" hotkey) — [GraphControls.tsx](packages/boardroom-ai/client/src/components/graph/GraphControls.tsx) lines 89–107.
- Pages present: Admin, CustomPersonas, Dashboard, DecisionLab, DecisionSession, Graph, Integrations, Login, MemoryExplorer, Onboarding, PeopleDirectory, Settings — [client/src/pages/](packages/boardroom-ai/client/src/pages/) listing; **no SearchPage / `/search` route** (grep `GlobalSearch|SearchPage|/search` in `.tsx` files: no hits).

### Inferences
- The hybrid `POST /memories/search` (with `asOf`, tags, cursor) is wired end-to-end to the client API layer but the Memory Explorer UI still exposes only the simpler filter set, so the richest search is reachable only from MCP today.
- Entity search in the palette is in-memory over already-loaded store slices, so it will not find memories, tasks or commitments and will not scale beyond what the store preloads.

### Gaps
- Did not confirm whether `MemoryExplorerPage` calls the legacy `GET /memories/search?q=` or the hybrid POST (both wrappers exist in `api.ts`).
- Did not check for per-entity "backlinks" sections on Goal/Project/Person pages (research item "Next: … per-entity backlinks on entity pages" suggests they may be absent).

---

## Key Question 5 — Already-planned graph / search / MCP improvements (do not re-propose)

### Takeaway
Three sources already plan work in this space: the roadmap's **Phase 10 (OAuth 2.1 + PKCE + Dynamic Client Registration via WorkOS/Ory Hydra, resources with `notifications/resources/updated`, Connector Directory submission)**, **Phase 4 (recursive-CTE `findRelatedEntities(entityId, hops≤2)` + `/relationships/related/:id`)**, **Phase 11 (Markdown export + git sync)** and **Phase 12 (webhooks/event bus)**; the Phase 6 research marks per-entity backlinks on entity pages as the "next" graph step and explicitly rules out a graph DB, cross-encoder, MemGPT tiers, exposing the whole graph as one resource, and a `memory_delete` tool. Note the roadmap's Phase 10 was written before the standalone MCP package shipped and partly duplicates it.

### Cited Findings
- Phase 10 README: "**Time budget:** 4-6 weeks… OAuth 2.1 + DCR is the long pole"; "OAuth 2.1 + PKCE + Dynamic Client Registration via WorkOS or Ory Hydra — do NOT roll our own OAuth provider"; acceptance "OAuth 2.1 flow works end-to-end from Claude Desktop (manual test)" — [docs/roadmap/04-roadmap/PHASE-10-mcp-server/README.md](docs/roadmap/04-roadmap/PHASE-10-mcp-server/README.md) lines 3, 17, 48.
- Phase 10 tasks: 10.1 WorkOS vs Ory Hydra spike (→ ADR-014), 10.2 provision provider, 10.3 scaffold `/mcp` route, 10.4 protected-resource discovery, 10.5 token validation + RFC 8707 audience binding, 10.6 `searchMemories`, 10.7 `createMemory`, 10.8 `getEntity`/`findRelatedEntities`/`getDecisionContext`, 10.9 "Implement `memory://{id}`, `decision://{id}`, `entity://{type}/{id}`, `persona://{name}` as MCP resources with `notifications/resources/updated` support", 10.10 per-tenant isolation eval, 10.11 "Submit to Anthropic Connector Directory" — [tasks-and-prompts.md](docs/roadmap/04-roadmap/PHASE-10-mcp-server/tasks-and-prompts.md) lines 7–117.
- Tracker row: "| 10 | Streamable HTTP transport + OAuth 2.1 + DCR + RFC 8707 | todo |" — [docs/STATUS/PHASE-PROGRESS-TRACKER.md](docs/STATUS/PHASE-PROGRESS-TRACKER.md) line 138.
- Feature spec: "Ship a Streamable HTTP MCP server at `/mcp` on the existing OmniMind Railway domain… Sessions tracked via the `Mcp-Session-Id` header. Auth: OAuth 2.1 with PKCE + Dynamic Client Registration, delegated to a managed provider" — [docs/roadmap/05-features-to-10/memory-mcp-server.md](docs/roadmap/05-features-to-10/memory-mcp-server.md) line 15; risk: "OAuth 2.1 + DCR + RFC 8707 audience binding + RFC 9728 metadata is a lot of moving parts" — line 90.
- Research: "DCR is make-or-break: without it, every user manually copies a `client_id` into Claude Desktop" — [docs/roadmap/03-research/ai-memory-sota.md](docs/roadmap/03-research/ai-memory-sota.md) line 124.
- Phase 4: "`relationship.service.ts::findRelatedEntities(entityId, hops)` — recursive CTE query, depth-capped at 2… `/relationships/related/:id` endpoint… Pagination, max-depth validation"; "Defer multi-hop beyond 2 until production logs show >15% of queries are multi-hop" — [docs/roadmap/04-roadmap/PHASE-4-graph-traversal/README.md](docs/roadmap/04-roadmap/PHASE-4-graph-traversal/README.md) "What this phase is".
- Phase 11: "Markdown Export + Git Sync… 3-4 weeks… vault-layout design + git OAuth + conflict folder" — [PHASE-11-markdown-export/README.md](docs/roadmap/04-roadmap/PHASE-11-markdown-export/README.md) lines 1–5. Phase 12: outbox + webhook endpoints + delivery worker + admin replay — [PHASE-12-webhooks-event-bus/tasks-and-prompts.md](docs/roadmap/04-roadmap/PHASE-12-webhooks-event-bus/tasks-and-prompts.md) tasks 12.1–12.8. Timeline: "T+19.5w Memory MCP server live (Phase 10)… T+23w Markdown export… T+25w Webhooks" — [ROADMAP-OVERVIEW.md](docs/roadmap/04-roadmap/ROADMAP-OVERVIEW.md) lines 122–124.
- Phase 6 research, graph: "Shipped 2026-10-02. Next: unlinked mentions + per-entity backlinks on entity pages. The global hairball is the trap; local graph and backlinks are what people use." — [IMPROVEMENT-RESEARCH-2026-10-02.md](docs/research/IMPROVEMENT-RESEARCH-2026-10-02.md) line 21; "Global graph [M] [low] — ship last, capped; shipped capped at 500 memories" — line 59.
- Phase 6 research, MCP "Do not": "expose the whole graph as one resource; add `memory_delete` (keep invalidate/supersede); mirror all 15 tools as resources; run Sonnet synchronously inside a tool call" — line 118; architecture "Do not": "adopt a graph DB (ADR-004 holds); add a cross-encoder (DEF-002); build MemGPT paging (DEF-004)" — line 42.
- CURRENT-PHASE operator checklist already lists: "Add `OMNIMIND_MCP_USER_ID` to MCP agent configs so resources can read", private networking switch, OTel, backups, branch protection — [docs/STATUS/CURRENT-PHASE.md](docs/STATUS/CURRENT-PHASE.md) checklist items 1–6.
- Known limitations already acknowledged: in-memory rate limiting (item 2), `x-agent-key` opt-in (item 8), ministry gated (item 9), commitments/tasks not searched by assembler (item 10), weak `update` retrieval slice (item 11) — [.claude/CLAUDE.md](.claude/CLAUDE.md) "Known Limitations".
- Earlier next-phase triggers noted: "bitemporal validity windows, Letta-style core memory tier, multi-user (Postgres RLS)" — [CURRENT-PHASE.md](docs/STATUS/CURRENT-PHASE.md) Phase 5.5 note (bitemporal since shipped in Phase 6).

### Inferences
- The roadmap's Phase 10 tool names (`searchMemories`, `createMemory`, `getEntity`…) and resource URIs (`memory://`, `decision://`, `entity://`, `persona://`) **conflict with what shipped** (`memory_search`, `memory_write`, `omnimind://{tenant}/…`). A later report should treat Phase 10 as "partially superseded: transport, tools, resources, prompts done; OAuth 2.1/DCR, `resources/updated` notifications, per-tenant isolation eval and Connector Directory submission remain".
- Phase 4's server-side k-hop traversal would directly replace the MCP's N-round-trip BFS in `graph_neighborhood`.

### Gaps
- No doc in `docs/roadmap` or `docs/research` mentions command-palette search over memories, graph clustering, a timeline view, or a graph-node search in the palette (grep `command palette|global search|cluster|timeline` across `docs/roadmap`, `docs/research/IMPROVEMENT-RESEARCH-2026-10-02.md`: no relevant hits) — so those are genuinely unplanned.
- `docs/roadmap/03-research/obsidian-patterns.md` was not read in full; only its graph-view sentence (line 98) was sampled.

---

## Capability checklist (requested summary)

Status legend: **yes** = implemented (T = has tests) · **partial** = exists with notable limits · **no** = absent · **planned** = documented in roadmap but not built.

| Capability | Status | Where |
|---|---|---|
| MCP server package | yes (T, 138 tests) | `packages/omnimind-mcp/` |
| 18 tools with `title`, `annotations`, `outputSchema`, `structuredContent` | yes (T) | `src/server.ts`, `tests/server-registry.test.ts` |
| Tool annotations `readOnly/destructive/idempotent/openWorld` | yes (T) | `src/types.ts` |
| Resources (`omnimind://{tenant}/status|goal|person|graph`) | yes (T), narrow; only `status` enumerable | `src/resources.ts` |
| Prompts (`session_start`, `decision_review`, `session_end`) | yes (T) | `src/prompts.ts` |
| stdio transport | yes | `src/transports/stdio.ts` |
| Streamable HTTP transport, stateful sessions | yes (T) — 30 min idle TTL, cap 100, LRU eviction, 1 MiB body, DNS-rebinding guard | `src/transports/http.ts` |
| HTTP `/health` (unauthenticated) | yes (T) — `{status, uptime, sessions}` (agent-config docs stale) | `http.ts` lines 231–239 |
| Inbound auth | partial — single static bearer per process (`OMNIMIND_MCP_API_KEY`) | `http.ts` lines 92–110 |
| OAuth 2.1 / PKCE / DCR / RFC 8707 | **no** (planned Phase 10) | `docs/roadmap/04-roadmap/PHASE-10-mcp-server/` |
| Per-agent identity, tenant, scopes, source weight | yes — env-bound per process; `omk_` key hashed in `agents` table | `src/lib/auth.ts`, `keygen.ts`, API `agent-context.ts` |
| Server-side scope enforcement | partial — only for `x-agent-key`-verified agents; legacy headers trusted unless `OMNIMIND_REQUIRE_AGENT_KEY=true` | API `scope-enforcer.ts`, `agent-context.ts` |
| Multi-tenancy | partial — one tenant per MCP process; memories tenant-scoped, entities user-scoped | `resources.ts`, `graph` contract line 764 |
| Idempotency (`idempotencyKey` → `Idempotency-Key`, 24 h, replay header) | yes (T) + MCP replay cache (500 entries / 24 h) | `src/lib/replay-cache.ts`, API `middleware/idempotency.ts` |
| Cursor pagination (≤20/page) | yes (T) on `memory_search`, `task_list`, `commitment_list` | `src/lib/cursor.ts` |
| Resource subscriptions / `notifications/resources/updated` | **no** (planned Phase 10 task 10.9) | grep of `src/` — zero hits |
| `tools/resources/prompts list_changed` notifications | **no** | grep — zero hits |
| ChatGPT-connector-shaped `search` / `fetch` tools | **no** (tools are `memory_search` etc.) | `src/server.ts` lines 18–40 |
| ChatGPT Desktop config (HTTP + Bearer) | yes (documented, curl/SDK-smoke-tested only) | `docs/agent-configs/chatgpt-desktop.json`, SMOKE-TESTS Tier 6 |
| Rate limiting | partial — per-agent hourly in OmniMind API (in-memory); none in MCP process | API `agent-rate-limiter.ts` |
| Audit log of every tool/resource call with ministry redaction | yes (T) | `src/lib/audit.ts`, `McpAuditLog` |
| Typed error taxonomy | yes — `SCOPE_DENIED`, `VALIDATION_ERROR`, `TENANT_MISMATCH`, `NO_USER_BOUND`, `MINISTRY_DEFERRED`, `FACT_EXTRACTOR_UNAVAILABLE`; HTTP JSON-RPC codes | `server.ts`, `types.ts`, `http.ts` |
| Hybrid retrieval (semantic + FTS + trigram + structured, forgetting curve) | yes (T + CI IR eval) | API `src/retrieval/`, `memory.service.ts` |
| `POST /memories/search` (hybrid, `asOf`, tags, status, cursor ≤50) | yes (T) | API `memories.routes.ts` 166–192; contract lines 132–162 |
| Temporal validity (`valid_at`/`invalid_at`, `asOf`) | yes | `retrieval/temporal-validity.ts`, schema 203–205 |
| Supersede / consolidation / provenance (`superseded_by`, `consolidatedFrom`, `version`) | yes | `PATCH /memories/:id {supersedes}`, `memory_consolidate` |
| Entities + 7 link tables | yes | `schema.prisma` |
| Link writer endpoints (project↔person/decision, task deps) | yes (T) | `phase6-links.test.ts` |
| Background jobs (memo, patterns, contradictions, reflection, nudges, decay, digest, embed-retry, summarizer) | yes | API `src/jobs/`, `shared/constants/cortex-config.ts` |
| Embedding providers (OpenAI, Ollama ministry, mock) | yes | `embedding.service.ts` |
| `GET /graph` bulk projection (7 node types, 10 edge types, `types/domain/memoryLimit/includeArchived`) | yes (T) | `knowledge-graph.service.ts`, contract 758–779 |
| `GET /graph` pagination / depth / cursor | **no** | `shared/validation/graph.schema.ts` 79–92 |
| `GET /graph/backlinks/:nodeId` (1-hop, both directions) | yes (T) | `knowledge-graph-backlinks.test.ts` |
| Server-side k-hop traversal (`findRelatedEntities`) | **no** (planned Phase 4); MCP BFS composes 2 hops client-side | `PHASE-4-graph-traversal/README.md`, `graph.tool.ts` |
| Unlinked mentions (find + one-click link) | yes (T) | `unlinked-mentions.service.ts`, `UnlinkedMentionsPanel.tsx` |
| People duplicates (pg_trgm ≥0.6, no auto-merge) | yes (T) | `person-duplicates.service.ts` |
| Graph UI: `react-force-graph-2d` canvas | yes | `KnowledgeGraphView.tsx` |
| Hover fade (1-hop vivid, rest ~12%) | yes | `KnowledgeGraphView.tsx` 13–19, 136–170 |
| Local graph depth 1–3 with distance fade | yes | `GraphPage.tsx` 39–53, 143–155 |
| Search-to-focus (top 8, keyboard, "/" hotkey) | yes | `GraphControls.tsx` 57–110 |
| Filters: node type, domain, orphans, labels (sessionStorage) | yes | `GraphPage.tsx` 15–37 |
| Edge-type filter | **no** | — |
| Inspector with backlinks + link editors | yes | `NodeInspector.tsx` |
| Shape + token-colour encoding, light/dark | yes | `graph-theme.ts` |
| Reduced-motion support | yes | `KnowledgeGraphView.tsx` 55–56, 235–236 |
| Shareable `?focus=` URL | yes | `GraphPage.tsx` 87–92 |
| Mobile bottom-sheet inspector | yes | `GraphPage.tsx` 268–288 |
| Clustering / community detection | **no** | — |
| Timeline / temporal slider in graph UI | **no** | — |
| Saved views / export (PNG, JSON) | **no** | — |
| Graph render-component tests | **no** (only `graph-data.test.ts`, 3 cases) | `client/tests/components/graph/` |
| Memory cap in UI | partial — 200 memories by importance (server max 500) | `GraphPage.tsx` 75, 195 |
| Legacy SVG `RelationshipGraph` still in use | yes (People page, dashboard widget) | `components/memory/RelationshipGraph.tsx` |
| Command palette (`cmdk`, ⌘K) | yes — goals/projects/people/decisions from store + nav/actions | `components/ui/CommandPalette.tsx` |
| Palette searches memories / graph nodes / tasks / commitments | **no** | `CommandPalette.tsx` line 25 |
| Global search page / route | **no** | pages listing |
| Memory Explorer filters (q, domain, class, status, sort) | yes | `components/memory/MemorySearch.tsx` |
| Memory Explorer tags / `asOf` / archived toggle | **no** | grep of `MemorySearch.tsx` |
| Global keyboard shortcuts (7 chords) | yes | `hooks/useKeyboardShortcuts.ts` 27–33 |
| Markdown export / git sync | **no** (planned Phase 11) | `PHASE-11-markdown-export/` |
| Webhooks / event bus | **no** (planned Phase 12) | `PHASE-12-webhooks-event-bus/` |
| Connector Directory submission | **no** (planned Phase 10 task 10.11) | `PHASE-10-mcp-server/tasks-and-prompts.md` |
