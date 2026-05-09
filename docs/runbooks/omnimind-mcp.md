# OmniMind-MCP Operational Runbook

Last updated: 2026-05-09 | Phase 4

---

## Health Check

```bash
# Test MCP server is reachable
curl -s https://omnimind-api-production.up.railway.app/health | jq .

# Test MCP HTTP transport (if running in HTTP mode on port 3334)
curl -s http://localhost:3334/health | jq .
```

Expected response: `{ "status": "ok", "uptime": <seconds> }`

---

## Agent Key Rotation

Agent API keys are one-way hashed (bcrypt) in the `agents` table. Rotation requires generating a new key and updating the agent config.

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

The keygen command writes directly to the DB. Verify:

```bash
# Via OmniMind API
curl -s https://omnimind-api-production.up.railway.app/mcp/agents \
  -H "x-api-key: $OMNIMIND_API_KEY" | jq '.[] | {name, tenantId, lastSeenAt}'
```

**3. Update agent config**

Replace `OMNIMIND_API_KEY` in the agent's environment (Claude Desktop, Cursor, etc.) with the new key. Old key is immediately invalid.

**4. Verify connectivity**

```bash
node packages/omnimind-mcp/dist/index.js smoke
```

All 3 smoke tests should pass (memory write, search, status get).

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

The `mcp_audit_logs` table captures every MCP tool call. Ministry content is redacted to `[REDACTED:ministry]` before logging.

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
| `Fact extraction failed` | Claude Haiku timeout | Transient; MCP retries 3 times; escalate if persistent |
