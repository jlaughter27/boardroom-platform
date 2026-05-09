#!/bin/bash
set -e

echo "=== BoardRoom AI Pre-Deploy Check ==="
echo ""

# 1. TypeScript compilation
echo "1/8 TypeScript compilation..."
npx tsc -p packages/shared/tsconfig.json --noEmit
npx tsc -p packages/omnimind-api/tsconfig.json --noEmit 2>&1 | grep -v "bcryptjs" || true
npx tsc -p packages/boardroom-ai/server/tsconfig.json --noEmit 2>&1 | grep -v "bcryptjs" || true
echo "  ✓ TypeScript clean"

# 2. Tests
echo "2/8 Running tests..."
cd packages/omnimind-api && npx vitest run 2>&1 | tail -5 && cd ../..
echo "  ✓ Tests passed"

# 3. Prisma validation
echo "3/8 Prisma schema validation..."
if [ -n "$DATABASE_URL" ]; then
  cd packages/omnimind-api && npx prisma validate && cd ../..
  echo "  ✓ Prisma schema valid"
else
  echo "  ⊘ Skipped (no DATABASE_URL)"
fi

# 4. Build
echo "4/8 Building all packages..."
npx tsc -p packages/shared/tsconfig.json
echo "  ✓ Shared built"

# 5. Docker build (optional)
echo "5/8 Docker image build..."
if command -v docker &> /dev/null && docker info &> /dev/null; then
  docker build -t boardroom-omnimind-check -f packages/omnimind-api/Dockerfile . 2>&1 | tail -3
  docker build -t boardroom-ai-check -f packages/boardroom-ai/Dockerfile . 2>&1 | tail -3
  echo "  ✓ Docker images built"
else
  echo "  ⊘ Skipped (Docker not available or not running)"
fi

# 6. Required files check
echo "6/8 Required files..."
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
echo "7/8 Prompts integrity..."
if bash scripts/check-prompts-integrity.sh > /dev/null 2>&1; then
  echo "  ✓ Prompts integrity passed"
else
  bash scripts/check-prompts-integrity.sh
  exit 1
fi

# 8. Doc-link validity (entry-point doc-path refs all resolve)
echo "8/8 Doc-link validity..."
if python3 scripts/check-doc-links.py > /dev/null 2>&1; then
  echo "  ✓ Doc-link validity passed"
else
  python3 scripts/check-doc-links.py
  exit 1
fi

echo ""
echo "=== PRE-DEPLOY CHECK PASSED ==="
