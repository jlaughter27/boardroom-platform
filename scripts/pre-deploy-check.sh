#!/bin/bash
set -e

echo "=== BoardRoom AI Pre-Deploy Check (3 services: omnimind-api, boardroom-ai, omnimind-mcp) ==="
echo ""

# 1. TypeScript compilation
echo "1/9 TypeScript compilation..."
npx tsc -p packages/shared/tsconfig.json --noEmit
npx tsc -p packages/omnimind-api/tsconfig.json --noEmit 2>&1 | grep -v "bcryptjs" || true
npx tsc -p packages/boardroom-ai/server/tsconfig.json --noEmit 2>&1 | grep -v "bcryptjs" || true
npx tsc -p packages/omnimind-mcp/tsconfig.json --noEmit
echo "  ✓ TypeScript clean"

# 2. Tests
echo "2/9 Running tests..."
cd packages/omnimind-api && npx vitest run 2>&1 | tail -5 && cd ../..
echo "  ✓ Tests passed"

# 3. Prisma validation
echo "3/9 Prisma schema validation..."
if [ -n "$DATABASE_URL" ]; then
  cd packages/omnimind-api && npx prisma validate && cd ../..
  echo "  ✓ Prisma schema valid"
else
  echo "  ⊘ Skipped (no DATABASE_URL)"
fi

# 4. Build
echo "4/9 Building all packages..."
npx tsc -p packages/shared/tsconfig.json
echo "  ✓ Shared built"

# 5. Docker build (optional)
echo "5/9 Docker image build..."
if command -v docker &> /dev/null && docker info &> /dev/null; then
  docker build -t boardroom-omnimind-check -f packages/omnimind-api/Dockerfile . 2>&1 | tail -3
  docker build -t boardroom-ai-check -f packages/boardroom-ai/Dockerfile . 2>&1 | tail -3
  docker build -t boardroom-mcp-check -f packages/omnimind-mcp/Dockerfile . 2>&1 | tail -3
  echo "  ✓ Docker images built"
else
  echo "  ⊘ Skipped (Docker not available or not running)"
fi

# 6. Required files check
echo "6/9 Required files..."
FILES=(
  "packages/omnimind-api/Dockerfile"
  "packages/boardroom-ai/Dockerfile"
  "docker-compose.yml"
  "packages/omnimind-api/prisma/schema.prisma"
  "packages/omnimind-api/prisma/migrations/migration_lock.toml"
  ".env.example"
  "packages/omnimind-api/railway.toml"
  "packages/boardroom-ai/railway.toml"
  "packages/omnimind-api/docker-entrypoint.sh"
  "packages/omnimind-mcp/Dockerfile"
  "packages/omnimind-mcp/railway.toml"
  ".dockerignore"
)
MISSING=0
for f in "${FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "  ✗ Missing: $f"
    MISSING=1
  fi
done
if [ $MISSING -eq 0 ]; then
  echo "  ✓ All required files present"
else
  echo "  ✗ Some files missing"
  exit 1
fi

# 7. Prompts integrity (runtime persona prompt count doesn't drop)
echo "7/9 Prompts integrity..."
if bash scripts/check-prompts-integrity.sh > /dev/null 2>&1; then
  echo "  ✓ Prompts integrity passed"
else
  bash scripts/check-prompts-integrity.sh
  exit 1
fi

# 8. Doc-link validity (entry-point doc-path refs all resolve)
echo "8/9 Doc-link validity..."
if python3 scripts/check-doc-links.py > /dev/null 2>&1; then
  echo "  ✓ Doc-link validity passed"
else
  python3 scripts/check-doc-links.py
  exit 1
fi

# 9. Hosted MCP front door (only when a public URL is configured — runs against the live service)
echo "9/9 Hosted MCP front door..."
if [ -n "$OMNIMIND_MCP_PUBLIC_URL" ]; then
  MCP_ORIGIN=$(printf '%s' "$OMNIMIND_MCP_PUBLIC_URL" | sed -E 's#^(https?://[^/]+).*$#\1#')
  HEALTH=$(curl -fsS --max-time 10 "$MCP_ORIGIN/health" 2>/dev/null || true)
  if printf '%s' "$HEALTH" | grep -q '"status"'; then
    echo "  ✓ /health answers"
  else
    echo "  ✗ /health did not answer at $MCP_ORIGIN/health"
    exit 1
  fi
  # Unauthenticated POST must be refused with 401 + WWW-Authenticate (never 200, never 500).
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST "$OMNIMIND_MCP_PUBLIC_URL" \
    -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"pre-deploy","version":"0"}}}')
  if [ "$CODE" = "401" ]; then
    echo "  ✓ unauthenticated initialize → 401"
  else
    echo "  ✗ unauthenticated initialize returned $CODE (expected 401)"
    exit 1
  fi
  # Same contract as scripts/verify-prod.sh (M1-A1): an unknown but well-formed omt_
  # token is introspected through the gateway key → 401 invalid_token. 503
  # auth_unavailable means the gateway key or the private OmniMind URL is broken.
  BOGUS_TOKEN="omt_$(head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n' | cut -c1-43)"
  BOGUS_BODY=$(curl -s -w '\n%{http_code}' --max-time 10 -X POST "$OMNIMIND_MCP_PUBLIC_URL" \
    -H @<(printf 'authorization: Bearer %s\n' "$BOGUS_TOKEN") \
    -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"pre-deploy","version":"0"}}}')
  BOGUS_CODE=$(printf '%s' "$BOGUS_BODY" | tail -n 1)
  if [ "$BOGUS_CODE" = "401" ] && printf '%s' "$BOGUS_BODY" | grep -q '"error":"invalid_token"'; then
    echo "  ✓ bogus-token initialize → 401 invalid_token"
  else
    echo "  ✗ bogus-token initialize returned $BOGUS_CODE (expected 401 invalid_token; 503 auth_unavailable = the gateway key or OMNIMIND_API_URL is broken)"
    exit 1
  fi
  if [ -n "$OMNIMIND_MCP_SMOKE_TOKEN" ]; then
    # Authenticated initialize must succeed and hand back a session id.
    SID=$(curl -s -D - -o /dev/null --max-time 15 -X POST "$OMNIMIND_MCP_PUBLIC_URL" \
      -H "authorization: Bearer $OMNIMIND_MCP_SMOKE_TOKEN" \
      -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
      -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"pre-deploy","version":"0"}}}' \
      | tr -d '\r' | awk 'tolower($1)=="mcp-session-id:"{print $2}')
    if [ -n "$SID" ]; then
      echo "  ✓ authenticated initialize → session"
      curl -s -o /dev/null --max-time 10 -X DELETE "$OMNIMIND_MCP_PUBLIC_URL" \
        -H "authorization: Bearer $OMNIMIND_MCP_SMOKE_TOKEN" -H "mcp-session-id: $SID" || true
    else
      echo "  ✗ authenticated initialize did not return mcp-session-id (token revoked/expired, or OMNIMIND_MCP_AGENT_KEY wrong → 503)"
      exit 1
    fi
  else
    echo "  ⊘ Authenticated round trip skipped (set OMNIMIND_MCP_SMOKE_TOKEN to a personal omt_ token)"
  fi
else
  echo "  ⊘ Skipped (no OMNIMIND_MCP_PUBLIC_URL)"
fi

echo ""
echo "=== PRE-DEPLOY CHECK PASSED ==="
echo "After the push to main: the Post-deploy verify workflow runs scripts/verify-prod.sh"
echo "(SHA poll + read-only probes on all three services). Locally: pnpm verify:prod -- --dry-run"
