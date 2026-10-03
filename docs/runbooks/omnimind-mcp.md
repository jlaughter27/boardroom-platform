# OmniMind-MCP Operational Runbook

Last updated: 2026-10-02 | Phase 6 (MCP spec conformance: annotations, structuredContent, pagination, idempotency, resources, prompts)

---

## Health Check

```bash
# Test MCP server is reachable
curl -s https://omnimind-api-production.up.railway.app/health | jq .

# Test MCP HTTP transport (if running in HTTP mode on port 3334) — no auth needed
curl -s http://localhost:3334/health | jq .
```

Expected: OmniMind API → `{ "status": "ok", ... }`; MCP HTTP → `{ "status": "ok", "uptime": <seconds>, "sessions": <n> }` — exactly those three keys. The endpoint is unauthenticated, so it deliberately does not reveal the agent name or tenant id (they were removed in R-M-05); read them from the startup log instead.

---

## HTTP Mode (Streamable HTTP, stateful)

`node packages/omnimind-mcp/dist/index.js http` (port from `PORT`, default 3334).

| Env var | Required | Purpose |
|---|---|---|
| `OMNIMIND_MCP_API_KEY` | **yes** | Inbound bearer token clients present (`Authorization: Bearer …` or `x-mcp-api-key`). Server **exits 1** when unset — it never runs open. Compared in constant time. |
| `OMNIMIND_MCP_ALLOWED_HOSTS` | no | Comma-separated exact `Host` values accepted (DNS-rebinding protection). Default `127.0.0.1:<port>,localhost:<port>,[::1]:<port>`. Set this when fronting with a proxy/hostname. The effective list is logged at startup (`[omnimind-mcp] allowedHosts: …`) together with a hint when the loopback default is in use — if clients see `403 Invalid Host header`, copy the `Host` they send into this variable. |
| `OMNIMIND_MCP_SESSION_IDLE_MS` | no | Idle timeout per MCP session (default `1800000` = 30 min). A sweeper runs every minute and closes sessions with no request for longer than this; invalid or non-positive values fall back to the default. |
| `OMNIMIND_MCP_AGENT_KEY` | recommended | This agent's `omk_` key from keygen; sent to OmniMind as `x-agent-key` (outbound). Different thing from `OMNIMIND_MCP_API_KEY`. |

| `OMNIMIND_MCP_USER_ID` | no (both modes) | User the `omnimind://{tenant}/…` **resources** read as. Tools always take `userId` explicitly; resources have no argument channel. Unset → resources return `{ error: "NO_USER_BOUND" }`. |

Behaviour: one MCP session per `initialize` (response carries `mcp-session-id`; clients must echo it), `GET` opens the SSE stream, `DELETE` ends the session, request bodies capped at 1 MiB (413), any handler failure → 500 JSON (process keeps running; `unhandledRejection` / `uncaughtException` are logged, not fatal).

Session lifecycle: every request on a session refreshes its `lastSeenAt`. Sessions idle longer than `OMNIMIND_MCP_SESSION_IDLE_MS` are closed by a once-a-minute sweeper (`session idle-closed <id>` in the log; the client gets `404 Session not found` on its next call and must re-`initialize`). The cap is 100 live sessions; when it is reached a new `initialize` evicts the least-recently-seen session (`session evicted (cap 100)`) instead of answering 503, so an abandoned client can never lock out a live one.

---

## Agent Key Rotation

Agent API keys are one-way hashed (SHA-256) in the `agents` table. Rotation requires generating a new key and updating the agent config. `--source-weight` must be a finite number in `[0, 2]`.

**1. Generate a new key**

```bash
node packages/omnimind-mcp/dist/index.js keygen \
  --agent <agent-name> \
  --tenant <tenant-id> \
  --scopes 'memory:read,memory:write,decision:write,task:write,project:write,commitment:write' \
  --source-weight 1.0
```

Copy the printed API key — it is shown only once.

**2. Update the agent record**

The keygen command registers the agent via `POST /mcp/agents`; if the API is unreachable it prints a fallback `INSERT INTO agents …` for psql. Verify:

```bash
# Via OmniMind API
curl -s https://omnimind-api-production.up.railway.app/mcp/agents \
  -H "x-api-key: $OMNIMIND_API_KEY" | jq '.[] | {name, tenantId, lastSeenAt}'
```

**3. Update agent config**

Set the printed `omk_…` key as **`OMNIMIND_MCP_AGENT_KEY`** in the agent's MCP config env (Claude Desktop, Cursor, etc.). The MCP server sends it as the `x-agent-key` header on every OmniMind request. Do **not** put it in `OMNIMIND_API_KEY` (the shared service key) or `OMNIMIND_MCP_API_KEY` (the HTTP-mode inbound bearer). Old key is invalid once the API agent record is updated.

**4. Verify connectivity**

```bash
node packages/omnimind-mcp/dist/index.js smoke
```

Tier 1 verifies all 18 tools (each with `annotations` + `outputSchema`), 3 prompts and 4 resource templates are registered. Add `OMNIMIND_MCP_SMOKE_USER_ID=<user id>` to also execute `status_get`, `memory_search` and `graph_neighborhood` (read-only) against the API; `OMNIMIND_MCP_SMOKE_NODE_ID=<type>:<refId>` picks the graph node (default: the first memory returned by the search).

---

## Tool Surface (Phase 6)

18 tools, registered via `registerTool` with annotations + Zod `outputSchema` (schemas in `packages/shared/src/validation/mcp.schema.ts`), 4 resource templates, 3 prompts. The full matrix (scope, readOnly / destructive / idempotent hints, pagination, idempotency keys) is in `docs/MEMORY-PROTOCOL.md` → "Tool Reference".

| What | Backing OmniMind endpoint(s) |
|------|------------------------------|
| `memory_search` (hybrid, `cursor`/`nextCursor`, `asOf`) | `POST /memories/search` |
| `task_list` / `commitment_list` (`cursor`/`nextCursor`) | `GET /memories?tags=…&limit=<n+1>&offset=<cursor>` |
| `memory_write` / `task_upsert` / `decision_log` / `commitment_log` `idempotencyKey` | `Idempotency-Key` header on `POST /memories` / `PATCH /memories/:id` (24 h replay) |
| `memory_reflect` | `POST /context/reflect` |
| `memory_consolidate` | `GET /memories?sortBy=createdAt` → `POST /memories/search-similar` (≥0.92) → `PATCH /memories/:keepId { supersedes }` (only `dryRun=false`) |
| `graph_neighborhood`, `omnimind://{tenant}/graph/{nodeId}` | `GET /graph/backlinks/:nodeId` (BFS, ≤60 nodes) |
| `status_get.commitmentsDueSoon`, `omnimind://{tenant}/status` | `GET /commitments/nudges` (degrades to `{ dueSoon: [], overdue: [], error }` if unavailable) |
| `omnimind://{tenant}/goal/{id}` / `person/{id}` | `GET /goals/:id`, `GET /people/:id`, `GET /context/capsules?entityIds=` |
| fact-extractor usage rows | `POST /usage/llm` (`service: omnimind-mcp`, `purpose: mcp:fact-extractor`, model `MODEL_IDS.haiku`; fire-and-forget) |

**Consolidation safety:** `memory_consolidate` defaults to `dryRun: true`. Review the proposed pairs (`mcp_audit_logs.output_json->'pairs'`) before anyone runs `dryRun: false`. Applied pairs are reversible — the archived row keeps its content with `invalid_at` / `superseded_by` set; nothing is deleted. Ministry rows are never scanned.

**Resources tenant pin:** a resource URI whose `{tenant}` differs from `OMNIMIND_MCP_TENANT_ID` is refused with `TENANT_MISMATCH`; this is the only boundary a resource client can probe, so it is checked before any HTTP call.

---

## Per-Agent Rate Limits

Limits are enforced per `x-agent-id` header, hourly windows:

| Operation type | Limit | Env override |
|----------------|-------|-------------|
| Reads (GET) | 1000/hr | `AGENT_RATE_READ` |
| Writes (POST/PATCH/DELETE) | 200/hr | `AGENT_RATE_WRITE` |
| Decisions | 100/hr | `AGENT_RATE_DECISION` |

Buckets reset every hour and are held in-memory (restart clears them). A 429 response includes `retryAfter` in seconds.

---

## Audit Log Review

The `mcp_audit_logs` table captures every MCP tool call, including refusals (ministry gate → `output_json = {"success": false, "reason": "MINISTRY_DEFERRED"}`, `error_message = MINISTRY_DEFERRED`). Inputs for ministry-domain calls are redacted to `[REDACTED:ministry]`; outputs of every tool are reduced to ids / titles / counts / domains / tags (no memory content is ever copied into `output_json`), and any returned ministry item collapses to `{id, domain, title: "[REDACTED:ministry]"}`.

```bash
# Last 50 tool calls for a given agent
psql $DATABASE_URL -c "
  SELECT tool_name, input_json->>'domain' AS domain, duration_ms, created_at
  FROM mcp_audit_logs
  WHERE agent_id = '<agent-id>'
  ORDER BY created_at DESC
  LIMIT 50;
"

# High-latency calls (>2s)
psql $DATABASE_URL -c "
  SELECT agent_id, tool_name, duration_ms, created_at
  FROM mcp_audit_logs
  WHERE duration_ms > 2000
  ORDER BY created_at DESC
  LIMIT 20;
"

# Ministry write attempts
psql $DATABASE_URL -c "
  SELECT agent_id, tool_name, input_json->>'content' AS content_preview, created_at
  FROM mcp_audit_logs
  WHERE tool_name = 'memory_write'
    AND input_json->>'domain' = 'ministry'
  ORDER BY created_at DESC
  LIMIT 10;
"
```

All `content_preview` for ministry rows should show `[REDACTED:ministry]`.

---

## Ministry Domain Troubleshooting

Ministry writes require Ollama (`bge-base-en-v1.5`). If Ollama is down:

- Writes return HTTP 422: `Ministry embedding unavailable — Ollama is down. Write refused.`
- This is intentional. Do NOT fall back to OpenAI for ministry content.

**Check Ollama status:**

```bash
curl -s http://localhost:11434/api/tags | jq '.models[].name'
# Should include: bge-base-en-v1.5
```

**Start Ollama if down:**

```bash
ollama serve &
ollama pull bge-base-en-v1.5
```

---

## Tenant Isolation Check

Each MCP agent is bound to exactly one tenant. Cross-tenant reads are impossible from MCP tools. To verify a memory is tenant-scoped:

```bash
psql $DATABASE_URL -c "
  SELECT COUNT(*) FROM memory_entries WHERE tenant_id != 'josh-business' AND agent_id = 'claude-code-josh';
"
# Should return 0
```

---

## Decryption Key Management

Ministry memories are encrypted with AES-256-GCM using the `ENCRYPTION_KEY` env var (32-byte hex).

- Key ID stored in `memory_entries.encryption_key_id` as `env:ENCRYPTION_KEY`
- If `ENCRYPTION_KEY` is not set, encryption is a no-op in dev (content stored plaintext)
- Key rotation requires re-encrypting existing ministry entries (manual procedure, contact maintainer)

**Verify encryption is active:**

```bash
psql $DATABASE_URL -c "
  SELECT COUNT(*) as encrypted
  FROM memory_entries
  WHERE domain = 'ministry' AND encrypted_content IS NOT NULL;
"
```

---

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `scope_denied` on tool call | Agent lacks required scope | Re-keygen with correct scopes |
| `tenant_mismatch` on search | Agent calling wrong tenant path | Check `OMNIMIND_MCP_TENANT_ID` env var |
| 429 `agent_rate_limited` | Agent over hourly limit | Wait for reset or increase `AGENT_RATE_*` env vars |
| `Ministry embedding unavailable` | Ollama down | Start Ollama, re-run write |
| `Fact extraction failed` / `FACT_EXTRACTOR_UNAVAILABLE` | Claude Haiku timeout | Transient; memory is NOT written; agent should retry; escalate if persistent |
| `VALIDATION_ERROR` on tool call | Bad tool arguments | Message lists `field: problem`; fix the call |
| HTTP mode exits with `OMNIMIND_MCP_API_KEY is required` | Inbound token unset | Set `OMNIMIND_MCP_API_KEY` (see HTTP Mode) |
| HTTP `403 Invalid Host header` | DNS-rebinding guard | Add the exact `Host` value to `OMNIMIND_MCP_ALLOWED_HOSTS` |
| HTTP `400 no valid session ID` | Client skipped `initialize` or dropped `mcp-session-id` | Client must echo the session header on every request |
| `task_list` / `commitment_list` / `status_get` return 0 | Rows written before 2026-10-02 lack tags? | Tools now filter by tags (`task`, `task:<status>`, `commitment:pending`, `decision`); re-upsert legacy rows via `task_upsert` |
| `VALIDATION_ERROR … cursor: not a cursor issued by this server` | Client built / edited a cursor | Pass `nextCursor` back verbatim as `cursor`; cursors are opaque |
| `Output validation error: … structured content` from the SDK | OmniMind returned a shape outside the tool's `outputSchema` (e.g. graph node missing a field) | Compare the endpoint response with `packages/shared/src/validation/mcp.schema.ts`; fix the API shape, do not loosen the schema silently |
| `status_get` has `commitmentsDueSoon.error` | `GET /commitments/nudges` unavailable (older API build) | Snapshot is still valid; deploy the Phase 6 OmniMind build |
| Resource read returns `NO_USER_BOUND` | `OMNIMIND_MCP_USER_ID` unset | Set it in the agent's env (optional; tools are unaffected) |
| Resource read fails `TENANT_MISMATCH` | URI tenant ≠ bound tenant | Use `omnimind://<OMNIMIND_MCP_TENANT_ID>/…`; cross-tenant reads are impossible by design |
