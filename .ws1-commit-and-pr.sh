#!/usr/bin/env bash
# WS-1 finalization script — run this from /Users/Joshua/boardroom-platform on the host.
#
# What it does:
#   1. Clears any stale .git/index.lock
#   2. Stages ONLY the WS-1 files (excludes WS-3 work-in-progress already in the tree)
#   3. Commits with the prescribed message
#   4. Pushes the branch
#   5. Creates the PR via `gh`
#
# Prereqs: `gh` CLI authenticated; current branch is `feat/seam-agent-context`.
set -euo pipefail

cd "$(dirname "$0")"

# 1. Clear stale lock from the sandbox session that created it
rm -f .git/index.lock

# 2. Verify branch
branch=$(git branch --show-current)
if [ "$branch" != "feat/seam-agent-context" ]; then
  echo "ERROR: expected branch feat/seam-agent-context, got $branch" >&2
  exit 1
fi

# 3. Stage ONLY WS-1 files. WS-3 changes already in the tree (ranker.ts,
#    importance-decay.service.ts, schema.prisma recallCount field, fact-extractor
#    threshold, D12/D13 tests, recall_count migration) are intentionally NOT
#    staged — they belong to a separate PR.
git add \
  packages/omnimind-api/src/middleware/agent-context.ts \
  packages/omnimind-api/src/index.ts \
  packages/omnimind-api/src/services/memory.service.ts \
  packages/omnimind-api/src/services/context-assembler.service.ts \
  packages/omnimind-api/src/services/session-summarizer.service.ts \
  packages/omnimind-api/src/routes/memories.routes.ts \
  packages/omnimind-api/src/routes/admin.routes.ts \
  packages/omnimind-api/src/routes/context.routes.ts \
  packages/omnimind-api/src/retrieval/semantic-search.ts \
  packages/omnimind-api/src/retrieval/fulltext-search.ts \
  packages/omnimind-api/src/retrieval/trigram-search.ts \
  packages/omnimind-api/src/retrieval/structured-filter.ts \
  packages/omnimind-api/tests/unit/retrieval/fulltext-search.test.ts \
  packages/omnimind-mcp/src/lib/client.ts \
  packages/omnimind-mcp/src/server.ts \
  tests/audit/D3-tool-surface.test.ts \
  tests/audit/D6-forgetting-curve.test.ts \
  tests/audit/D8-agent-context-propagation.test.ts \
  tests/audit/D9-cross-tenant-isolation.test.ts

echo "=== Staged files ==="
git diff --cached --stat
echo

# 4. Commit
git commit -m "feat(seam): propagate agent context (agentId, tenantId, sourceWeight) end-to-end

Fixes Bugs #1, #2, #3, #5, #7 from Hermes round-trip findings:
- Bug #1: agent_id NULL on writes — new agent-context middleware reads
  x-agent-id / x-tenant-id / x-source-weight from request headers (or
  falls back to Agent table lookup by API-key hash) and attaches them
  to req.agentContext.
- Bug #2: POST /memories/search-similar dropped tenantId — now scopes
  the cosine query by req.agentContext.tenantId.
- Bug #3: dedup branch in createMemory stripped tenantId / agentId /
  sourceWeight on the supersede update — fixed by threading
  agentContext through to updateMemory.
- Bug #5: auth middleware didn't propagate context — new middleware
  (mounted AFTER apiKeyAuth) extracts and attaches the trio for every
  authenticated request.
- Bug #7: memory.tool.ts update path missing context — N/A server-side;
  the MCP client now sends x-agent-id / x-tenant-id / x-source-weight
  on every outbound request, and the server middleware does the rest.

Service-layer signatures: createMemory / updateMemory / getMemory /
searchMemories / archiveMemory now accept an optional agentContext
parameter (third or fourth arg depending on the function). A backward-
compat shim detects the legacy (userId, input, prisma) call shape so
BoardRoom AI and existing unit tests keep working unchanged.

Retrieval layer: structuredFilter / semanticSearch / fulltextSearch /
trigramSearch now accept tenantId in their options object. Default
behavior when no tenantId AND no includeAllTenants flag is passed:
return zero results (safer than silent leakage). admin.routes.ts
defaults to tenant-scoped; pass ?includeAllTenants=true for cross-
tenant view. context.routes.ts forwards req.agentContext.tenantId into
the retrieval scope.

Adds D8 + D9 audit tests:
- D8-agent-context-propagation: writes a memory via memory.service
  with a fake agentContext, asserts the create payload carries the
  correct agentId/tenantId/sourceWeight, and verifies the dedup branch
  propagates context.
- D9-cross-tenant-isolation: writes as tenant A, searches as tenant B,
  asserts empty results across the service layer and each retrieval
  primitive."

# 5. Push
git push -u origin feat/seam-agent-context

# 6. PR via gh
gh pr create \
  --base main \
  --head feat/seam-agent-context \
  --title "feat(seam): propagate agent context end-to-end (fixes Bugs #1, #2, #3, #5, #7)" \
  --body-file .ws1-pr-body.md

echo
echo "=== Done. PR opened. ==="
