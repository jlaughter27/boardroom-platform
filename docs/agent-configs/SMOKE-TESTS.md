# MCP Agent Smoke Tests

Manual verification checklist. Run after keygen, before declaring Phase 2 complete.

**Prerequisites:** All 7 agent keys generated (6 legacy agents + the `omnimind-mcp-gateway` with scope `mcp:delegate`) and placed in their respective configs. OmniMind API live. For the hosted path (Tier 8) the MCP Railway service is deployed per `docs/runbooks/omnimind-mcp.md` §1–4.

---

## Tier 1 — Server Health (run first, blocks everything else)

```bash
# Verify omnimind-mcp package is built
pnpm --filter @boardroom/omnimind-mcp build

# Run built-in smoke test (spawns stdio server, lists tools, verifies count)
node packages/omnimind-mcp/dist/index.js smoke

# Also execute status_get + memory_search for real (read-only) against the configured API:
OMNIMIND_MCP_SMOKE_USER_ID=<user id> node packages/omnimind-mcp/dist/index.js smoke
```

Expected: `smoke OK — 20 tools, 3 prompts, 4 resource templates registered` (or `..., 3 tools executed` with `OMNIMIND_MCP_SMOKE_USER_ID`: `status_get`, `memory_search`, then `graph_neighborhood` on the first memory the search returned — set `OMNIMIND_MCP_SMOKE_NODE_ID=<type>:<refId>` to pick the node yourself). Tier 1 also fails if any tool is missing `annotations` or `outputSchema`.

---

## Tier 2 — claude-code-josh (stdio, full write)

Set env vars in your shell:
```bash
export OMNIMIND_MCP_AGENT_NAME=claude-code-josh
export OMNIMIND_MCP_TENANT_ID=josh-business
export OMNIMIND_MCP_SCOPES="memory:read,memory:write,decision:write,task:write,project:write,commitment:write,code:write"
export OMNIMIND_MCP_SOURCE_WEIGHT=1.0
export OMNIMIND_API_URL=https://omnimind-api-production.up.railway.app
export OMNIMIND_API_KEY=<service-key>
export ANTHROPIC_API_KEY=<anthropic-key>
```

**Test 1 — Write + read round trip**
1. In Claude Code, call `memory_write` with: `"Josh decided to use Railway Private Networking for the OmniMind → BoardRoom service-to-service call to eliminate the public internet round-trip."`
2. Expected: JSON with `created: [<id>]`
3. Call `memory_search` with query: `"railway networking omnimind"`
4. Expected: The fact from step 1 appears in results

**Test 2 — Duplicate dedup**
1. Call `memory_write` again with the exact same text as Test 1
2. Expected: `created: []`, `updated: [<id>]` (superseded, not duplicated) OR `skipped: 1`

**Test 3 — decision_log**
1. Call `decision_log` with: question=`"Use Railway private networking?"`, chosen=`"Yes — TCP socket, no public hop"`, rationale=`"Eliminates public internet surface, lower latency"`
2. Expected: `{ id: "...", status: "logged" }`

**Test 4 — status_get**
1. Call `status_get`
2. Expected: JSON with `snapshot`, `counts` and `commitmentsDueSoon: { dueSoon, overdue }` keys — no error. Clients that support structured output see the same object as `structuredContent`.

**Test 4b — pagination + idempotency (Phase 6)**
1. Call `task_list` with `limit: 2`. Expected: ≤2 tasks and a `nextCursor` string when more exist; call again with `cursor: <nextCursor>` → the next page, `nextCursor: null` on the last one.
2. Call `decision_log` twice with the same `idempotencyKey: "smoke-<date>"`. Expected: identical `id` both times (second call is a replay, not a new row).

**Test 4c — new tools (Phase 6)**
1. `graph_neighborhood` with `nodeId: "memory:<id from Test 1>"`, `hops: 1`. Expected: `{ nodes: [...], edges: [...], truncated: false }`.
2. `memory_consolidate` with defaults (`dryRun: true`). Expected: `{ dryRun: true, scanned, pairs: [...], applied: 0 }`. Do **not** run `dryRun: false` against production during the smoke pass.
3. `memory_reflect` with `entityType: "project"`, `entityId: <a real project id>`. Expected: `{ capsule: { summary, openRisks, ... } }`.

**Test 4d — resources + prompts (Phase 6)**
1. With `OMNIMIND_MCP_USER_ID` set, read `omnimind://josh-business/status`. Expected: the `status_get` JSON. Read `omnimind://josh-personal/status` from the same server → refused (`TENANT_MISMATCH`).
2. Get prompt `session_start`. Expected: text telling the agent to run `status_get` then `memory_search`.

**Test 5 — scope denial (simulate)**
Temporarily change `OMNIMIND_MCP_SCOPES` to `memory:read` (read-only).
1. Call `decision_log`
2. Expected: `{ error: "SCOPE_DENIED", message: "..." }` — not a thrown error

---

## Tier 3 — claude-desktop-josh (stdio, personal tenant)

Set env vars:
```bash
export OMNIMIND_MCP_AGENT_NAME=claude-desktop-josh
export OMNIMIND_MCP_TENANT_ID=josh-personal
export OMNIMIND_MCP_SCOPES="memory:read,memory:write,context:write,preference:write,person:write"
export OMNIMIND_MCP_SOURCE_WEIGHT=0.85
export OMNIMIND_API_URL=https://omnimind-api-production.up.railway.app
export OMNIMIND_API_KEY=<service-key>
export ANTHROPIC_API_KEY=<anthropic-key>
```

**Test 6 — Personal tenant isolation**
1. Call `memory_write` with: `"Josh prefers async communication over synchronous meetings for deep work."`
2. Call `memory_search` with: `"josh preferences communication"`
3. Expected: The preference appears in results under `josh-personal` tenant

**Test 7 — Cross-tenant isolation**
1. Switch env to `josh-business` tenant
2. Call `memory_search` with same query from Test 6
3. Expected: Empty results — personal preferences don't bleed into business tenant

---

## Tier 4 — Ministry tenant (Ollama required)

**Prerequisite:** Ollama running locally with `bge-base-en-v1.5` pulled:
```bash
ollama pull bge-base-en-v1.5
ollama serve  # or verify it's running
```

Set env vars:
```bash
export OMNIMIND_MCP_AGENT_NAME=claude-desktop-josh
export OMNIMIND_MCP_TENANT_ID=tgfc-ministry
export OMNIMIND_MCP_SCOPES="memory:read,memory:write,context:write,preference:write,person:write"
export OMNIMIND_MCP_SOURCE_WEIGHT=0.85
export OMNIMIND_API_URL=https://omnimind-api-production.up.railway.app
export OMNIMIND_API_KEY=<service-key>
export ANTHROPIC_API_KEY=<anthropic-key>
export OLLAMA_URL=http://localhost:11434
```

**Test 8 — Ministry write routes to Ollama**
1. Call `memory_write` with domain `ministry`: `"TGFC is planning a website redesign for Q3 2026, led by the communications team."`
2. Check OmniMind logs — embedding call should go to Ollama, not OpenAI
3. Expected: memory created with `embeddingModel: 'ollama/bge-base-en-v1.5'`

**Test 9 — Ministry write refused when Ollama down**
1. Stop Ollama
2. Call `memory_write` with domain `ministry`
3. Expected: Write refused with error message mentioning Ollama unavailable — NOT silently written with OpenAI embedding

---

## Tier 5 — cursor-josh (read-only)

**Test 10 — Read-only enforcement**
1. Configure as `cursor-josh` with `memory:read` scope only
2. Call `memory_search` — expected: works
3. Call `memory_write` — expected: `SCOPE_DENIED`
4. Call `decision_log` — expected: `SCOPE_DENIED`

---

## Tier 6 — HTTP transport (chatgpt-desktop-josh)

The HTTP transport is **stateful Streamable HTTP**: `initialize` returns an
`mcp-session-id` header, every later request must carry it, and `DELETE` ends
the session. The server refuses to start without `OMNIMIND_MCP_API_KEY`.

Start HTTP server in one terminal:
```bash
OMNIMIND_MCP_AGENT_NAME=chatgpt-desktop-josh \
OMNIMIND_MCP_TENANT_ID=josh-personal \
OMNIMIND_MCP_SCOPES=memory:read \
OMNIMIND_MCP_SOURCE_WEIGHT=0.6 \
OMNIMIND_MCP_AGENT_KEY=<omk_ key from keygen> \
OMNIMIND_MCP_API_KEY=<inbound mcp bearer token> \
OMNIMIND_MCP_ALLOWED_HOSTS=127.0.0.1:3334,localhost:3334 \
OMNIMIND_API_URL=https://omnimind-api-production.up.railway.app \
OMNIMIND_API_KEY=<service-key> \
node packages/omnimind-mcp/dist/index.js http
```

**Test 11 — Health + fail-closed auth**
```bash
# Health needs no key
curl -s http://localhost:3334/health | jq .
# Expected: {"status":"ok","uptime":<s>,"sessions":0} — exactly three keys. The agent name
# and tenant were removed from this unauthenticated endpoint (R-M-05); read them from the
# startup log. A payload with "agent"/"tenant" means an old build.

# Should fail (no key)
curl -s -i -X POST http://localhost:3334/ -H 'content-type: application/json' -d '{}' | head -1
# Expected: HTTP/1.1 401 Unauthorized

# Should fail (missing OMNIMIND_MCP_API_KEY at startup)
OMNIMIND_MCP_API_KEY= node packages/omnimind-mcp/dist/index.js http
# Expected: exits 1 with "OMNIMIND_MCP_API_KEY is required in HTTP mode"
```

**Test 11b — Session handshake (correct key, Bearer or x-mcp-api-key)**
```bash
curl -s -i -X POST http://localhost:3334/ \
  -H "Authorization: Bearer <mcp-api-key>" \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
# Expected: 200 with an `mcp-session-id: <uuid>` response header.
# Reuse that header on tools/list; a POST without it → 400, unknown id → 404,
# body > 1 MiB → 413, foreign Host header → 403.
```

**Test 12 — HTTP read-only**
1. Connect ChatGPT Desktop to `http://localhost:3334` with `Authorization: Bearer <mcp-api-key>`
2. Verify `memory_search` works
3. Verify `memory_write` returns `SCOPE_DENIED`

The automated equivalent lives in `packages/omnimind-mcp/tests/http.transport.test.ts`
(initialize → initialized → tools/list over HTTP with the SDK client, 20 tools, plus prompts/list and resources/templates/list).

---

## Tier 6b — HTTP server exits when no inbound auth is configured

```bash
OMNIMIND_MCP_API_KEY= OMNIMIND_MCP_TOKEN_AUTH=false node packages/omnimind-mcp/dist/index.js http
# Expected: exits 1 — never starts an open endpoint. With OMNIMIND_MCP_TOKEN_AUTH=true the
# static bearer becomes optional (per-user omt_ tokens are the credential instead).
```

---

## Tier 7 — Audit log verification

After running all tests above:

```bash
# Check audit log via API
curl -s \
  -H "x-api-key: <omnimind-api-key>" \
  "https://omnimind-api-production.up.railway.app/mcp/audit?limit=20" | jq '.entries[] | {agentId, toolName, durationMs}'
```

Expected: Every tool call from the tests above appears with agentId, toolName, and durationMs. No gaps — failed calls must also be logged.

---

## Tier 8 — Hosted gateway (per-user tokens, Railway)

Run against the deployed service (`https://<mcp-host>`), token from BoardRoom → Settings → Connected AI tools.

**Test 13 — Discovery + fail-closed**
```bash
curl -s https://<mcp-host>/health | jq .                                  # {status, uptime, sessions}
curl -s -i https://<mcp-host>/.well-known/oauth-protected-resource | head -1  # 200 + resource == OMNIMIND_MCP_PUBLIC_URL in OAuth mode; 404 in token-only mode
curl -s -i -X POST https://<mcp-host>/mcp -H 'content-type: application/json' -d '{}' | head -3
# Expected: 401 with WWW-Authenticate: Bearer … . A 403 here means OMNIMIND_MCP_ALLOWED_HOSTS is wrong.
```

**Test 14 — Token round trip + principal attribution**
1. `initialize` with `Authorization: Bearer omt_…` (curl in runbook §7b). Expected: 200, `mcp-session-id`, `instructions` present, `tools/list` → 20 tools incl. `search` and `fetch` with `readOnlyHint: true`.
2. Call `memory_write` with a read-only token → `SCOPE_DENIED` tool result. With a write token → `created: [<id>]`.
3. `GET /mcp/audit?limit=5` on OmniMind: the row's `agentId` is the token's `agentName` (`mcp-token:<slug>-<6 chars>`), the tenant/user are the token's — the gateway's name appears nowhere.
4. Revoke the token in Settings; a new `initialize` → 401 within 60 s (positive resolutions are cached that long).
5. Negative control: a gateway whose agent row holds only `mcp:delegate` makes every tool, reads included, return `SCOPE_DENIED` — effective scopes are `token ∩ (gateway − mcp:delegate)`.

**Test 15 — Two users, one URL**
Two tokens for two BoardRoom users (or two tenants). `memory_write` from A, `memory_search` from B for the same text → empty. Same search from A → hit. (This is the property the single-identity transport could not provide.)

**Test 16 — Bench**
`node packages/omnimind-mcp/dist/index.js bench --n 10 --user <id>` (in-process `memory_write` with the stdio/gateway env; also reports server-side p95 from `GET /mcp/audit/stats`) → `memory_write` p95 < 10 s, and no `recommendAsync` warning (fires above 20 s). Time `status_get` in Test 14 over the public URL → p95 < 1.5 s. Above ~20 s set `OMNIMIND_MCP_WRITE_EXTRACT=async` and re-run.

**Test 17 — One real client per family**
Claude.ai connector (`claude-ai-connector.md`), Claude Code (`claude mcp add …`), Cursor (`cursor.json`), ChatGPT (OAuth mode only). Each: list tools, `status_get`, a `memory_search`. ChatGPT: a plain "search OmniMind for …" must route to `search` then `fetch` without a confirmation prompt.

---

## Phase 2 Gate Criteria

- [ ] Tier 1: smoke test passes (20 tools, 3 prompts, 4 resource templates)
- [ ] Tier 2: claude-code-josh round trip, dedup, scope denial all pass
- [ ] Tier 3: claude-desktop-josh personal tenant isolated
- [ ] Tier 4: ministry writes route to Ollama; refused when Ollama down
- [ ] Tier 5: cursor-josh read-only enforced
- [ ] Tier 6: HTTP transport auth works; chatgpt read-only enforced
- [ ] Tier 7: all tool calls appear in audit log
- [ ] Tier 8: hosted gateway — 401 without token (PRM served when OAuth is on), token round trip, per-token attribution in audit, revocation → 401 within 60 s, scope-ceiling negative control, bench within targets
- [ ] Cross-agent: memory written by claude-code-josh is readable by cursor-josh (same tenant)

All boxes checked = Phase 2 complete. Start dogfooding for 1 week before Phase 3.
