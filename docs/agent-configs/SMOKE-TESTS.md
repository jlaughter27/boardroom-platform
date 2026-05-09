# MCP Agent Smoke Tests

Manual verification checklist. Run after keygen, before declaring Phase 2 complete.

**Prerequisites:** All 6 agent keys generated and placed in their respective configs. OmniMind API live.

---

## Tier 1 — Server Health (run first, blocks everything else)

```bash
# Verify omnimind-mcp package is built
pnpm --filter @boardroom/omnimind-mcp build

# Run built-in smoke test (spawns stdio server, lists tools, verifies count)
node packages/omnimind-mcp/dist/index.js smoke
```

Expected: `smoke OK — 15 tools registered`

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
2. Expected: JSON with `decisions`, `tasks`, `blockers`, `commitments` keys — no error

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

Start HTTP server in one terminal:
```bash
OMNIMIND_MCP_AGENT_NAME=chatgpt-desktop-josh \
OMNIMIND_MCP_TENANT_ID=josh-personal \
OMNIMIND_MCP_SCOPES=memory:read \
OMNIMIND_MCP_SOURCE_WEIGHT=0.6 \
OMNIMIND_MCP_API_KEY=<mcp-api-key> \
OMNIMIND_API_URL=https://omnimind-api-production.up.railway.app \
OMNIMIND_API_KEY=<service-key> \
node packages/omnimind-mcp/dist/index.js http
```

**Test 11 — HTTP auth check**
```bash
# Should fail (no key)
curl -s http://localhost:3334 | jq .
# Expected: {"error":"Unauthorized"}

# Should succeed (correct key)
curl -s -H "x-mcp-api-key: <mcp-api-key>" http://localhost:3334 | jq .
```

**Test 12 — HTTP read-only**
1. Connect ChatGPT Desktop to `http://localhost:3334`
2. Verify `memory_search` works
3. Verify `memory_write` returns `SCOPE_DENIED`

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

## Phase 2 Gate Criteria

- [ ] Tier 1: smoke test passes (15 tools)
- [ ] Tier 2: claude-code-josh round trip, dedup, scope denial all pass
- [ ] Tier 3: claude-desktop-josh personal tenant isolated
- [ ] Tier 4: ministry writes route to Ollama; refused when Ollama down
- [ ] Tier 5: cursor-josh read-only enforced
- [ ] Tier 6: HTTP transport auth works; chatgpt read-only enforced
- [ ] Tier 7: all tool calls appear in audit log
- [ ] Cross-agent: memory written by claude-code-josh is readable by cursor-josh (same tenant)

All boxes checked = Phase 2 complete. Start dogfooding for 1 week before Phase 3.
