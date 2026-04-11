#!/bin/bash
set -e

echo "🔧 Fixing dependencies with pnpm for BoardRoom AI + OmniMind Platform..."

cd "/Users/Joshua/windsurf boradroom test/boardroom-platform"

echo ""
echo "📦 Installing root dependencies..."
pnpm add -Dw @types/node typescript

echo ""
echo "📦 BoardRoom Server: Adding Redis and types..."
cd packages/boardroom-ai/server
pnpm add ioredis
pnpm add -D @types/node

echo ""
echo "📦 OmniMind API: Adding types..."
cd ../../omnimind-api
pnpm add -D @types/node @types/express

echo ""
echo "🔧 Generating Prisma client..."
npx prisma generate

echo ""
echo "📦 BoardRoom Client: Adding React types..."
cd ../boardroom-ai/client
pnpm add -D @types/react @types/react-dom

echo ""
echo "✅ Dependencies installed successfully!"
echo ""
echo "Next steps:"
echo "1. cd \"/Users/Joshua/windsurf boradroom test/boardroom-platform\""
echo "2. pnpm run typecheck"
echo "3. pnpm run build"
