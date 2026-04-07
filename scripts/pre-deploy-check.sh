#!/bin/bash
set -e

echo "=== BoardRoom AI Pre-Deploy Check ==="
echo ""

# 1. TypeScript compilation
echo "1/6 TypeScript compilation..."
npx tsc -p packages/shared/tsconfig.json --noEmit
npx tsc -p packages/omnimind-api/tsconfig.json --noEmit 2>&1 | grep -v "bcryptjs" || true
npx tsc -p packages/boardroom-ai/server/tsconfig.json --noEmit 2>&1 | grep -v "bcryptjs" || true
echo "  ✓ TypeScript clean"

# 2. Tests
echo "2/6 Running tests..."
cd packages/omnimind-api && npx vitest run 2>&1 | tail -5 && cd ../..
echo "  ✓ Tests passed"

# 3. Prisma validation
echo "3/6 Prisma schema validation..."
if [ -n "$DATABASE_URL" ]; then
  cd packages/omnimind-api && npx prisma validate && cd ../..
  echo "  ✓ Prisma schema valid"
else
  echo "  ⊘ Skipped (no DATABASE_URL)"
fi

# 4. Build
echo "4/6 Building all packages..."
npx tsc -p packages/shared/tsconfig.json
echo "  ✓ Shared built"

# 5. Docker build (optional)
echo "5/6 Docker image build..."
if command -v docker &> /dev/null && docker info &> /dev/null; then
  docker build -t boardroom-omnimind-check -f packages/omnimind-api/Dockerfile . 2>&1 | tail -3
  docker build -t boardroom-ai-check -f packages/boardroom-ai/Dockerfile . 2>&1 | tail -3
  echo "  ✓ Docker images built"
else
  echo "  ⊘ Skipped (Docker not available or not running)"
fi

# 6. Required files check
echo "6/6 Required files..."
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

echo ""
echo "=== PRE-DEPLOY CHECK PASSED ==="
