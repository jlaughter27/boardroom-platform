#!/usr/bin/env bash
# Keygen commands for all 7 MCP agents (6 legacy per-client agents + the hosted gateway).
# Run these ONCE against a live OmniMind API.
# Keys are printed to stdout — copy immediately to 1Password.
# After running, keys cannot be retrieved again (only the hash is stored).
#
# Prerequisites:
#   1. OmniMind API running and OMNIMIND_API_URL + OMNIMIND_API_KEY set in env
#   2. OMNIMIND_ADMIN_KEY set on the API AND exported here — POST /mcp/agents is
#      x-admin-key gated (503 admin_disabled in production without it)
#   3. Tenants seeded (run the migration: prisma/migrations/20260509000000_mcp_phase_1)
#   4. Built: pnpm --filter @boardroom/omnimind-mcp build
#
# POST /mcp/agents is CREATE-ONLY: re-running a block for an agent that already
# exists answers 409 and stores nothing, while keygen still prints a fresh key.
# Deploying that key gives every client 503 auth_unavailable. To rotate, run the
# `INSERT … ON CONFLICT (name) DO UPDATE` SQL keygen prints on the 409 (psql,
# table "agents"), or register a new agent name — docs/runbooks/omnimind-mcp.md §1.
#
# Each printed key is an `omk_...` AGENT key. Set it as OMNIMIND_MCP_AGENT_KEY in
# that agent's stdio MCP config env (the MCP server sends it to OmniMind as
# x-agent-key); for a legacy static-bearer HTTP instance the process identity's
# key goes in OMNIMIND_MCP_STATIC_AGENT_KEY instead. It is NOT OMNIMIND_MCP_API_KEY —
# that variable is the inbound bearer token for HTTP-mode clients only.
# --source-weight must be a finite number in [0, 2].
# If the API is unreachable, keygen prints a fallback INSERT for the `agents` table.

set -euo pipefail

DIST="packages/omnimind-mcp/dist/index.js"

echo "=== Generating agent keys ==="
echo "Keys are shown ONCE. Store in 1Password immediately."
echo ""

echo "--- claude-desktop-josh (josh-personal, rw) ---"
node "$DIST" keygen \
  --agent claude-desktop-josh \
  --tenant josh-personal \
  --scopes "memory:read,memory:write,context:write,preference:write,person:write" \
  --source-weight 0.85

echo ""
echo "--- claude-code-josh (josh-business, full write) ---"
node "$DIST" keygen \
  --agent claude-code-josh \
  --tenant josh-business \
  --scopes "memory:read,memory:write,decision:write,task:write,project:write,commitment:write,code:write" \
  --source-weight 1.0

echo ""
echo "--- cursor-josh (josh-business, read-only) ---"
node "$DIST" keygen \
  --agent cursor-josh \
  --tenant josh-business \
  --scopes "memory:read" \
  --source-weight 0.7

echo ""
echo "--- chatgpt-desktop-josh (josh-personal, read-only) ---"
node "$DIST" keygen \
  --agent chatgpt-desktop-josh \
  --tenant josh-personal \
  --scopes "memory:read" \
  --source-weight 0.6

echo ""
echo "--- boardroom-ai (josh-business, wildcard) ---"
node "$DIST" keygen \
  --agent boardroom-ai \
  --tenant josh-business \
  --scopes "*" \
  --source-weight 1.0

echo ""
echo "--- cortex-summarizer (josh-business, write-only) ---"
node "$DIST" keygen \
  --agent cortex-summarizer \
  --tenant josh-business \
  --scopes "memory:write" \
  --source-weight 0.8

echo ""
echo "--- omnimind-mcp-gateway (hosted HTTP service, delegates to per-user tokens) ---"
# Every hosted session is re-attributed to the omt_/OAuth principal it carries
# (x-mcp-principal), which OmniMind only honours from a verified agent holding
# mcp:delegate. The gateway's scopes are the CEILING for every token
# (effective = token.scopes ∩ gateway.scopes−mcp:delegate), so it must carry
# mcp:delegate PLUS all seven grantable scopes (MCP_GATEWAY_CEILING_SCOPES in
# @boardroom/shared) — a gateway with only mcp:delegate makes every token
# SCOPE_DENIED, and a shorter list silently strips scopes from tokens. Set the
# key as OMNIMIND_MCP_AGENT_KEY on the Railway omnimind-mcp service; the row is
# the ceiling — the hosted gateway does not read OMNIMIND_MCP_SCOPES
# (docs/runbooks/omnimind-mcp.md §1).
node "$DIST" keygen \
  --agent omnimind-mcp-gateway \
  --tenant josh-business \
  --scopes "mcp:delegate,memory:read,memory:write,decision:write,task:write,project:write,commitment:write,code:write" \
  --source-weight 1.0

echo ""
echo "=== Done. Put each key in OMNIMIND_MCP_AGENT_KEY of the matching agent-configs/*.json env (gateway: Railway variable). ==="
