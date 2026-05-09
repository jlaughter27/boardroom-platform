#!/usr/bin/env bash
# Keygen commands for all 6 MCP agents.
# Run these ONCE against a live OmniMind API.
# Keys are printed to stdout — copy immediately to 1Password.
# After running, keys cannot be retrieved again (only the hash is stored).
#
# Prerequisites:
#   1. OmniMind API running and OMNIMIND_API_URL + OMNIMIND_API_KEY set in env
#   2. Tenants seeded (run the migration: prisma/migrations/20260509000000_mcp_phase_1)
#   3. Built: pnpm --filter @boardroom/omnimind-mcp build

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
echo "=== Done. Update agent-configs/*.json with the generated keys. ==="
