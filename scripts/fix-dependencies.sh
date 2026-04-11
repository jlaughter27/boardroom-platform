#!/bin/bash
set -e

echo "🔧 Fixing dependencies for BoardRoom AI + OmniMind Platform..."

cd "/Users/Joshua/windsurf boradroom test/boardroom-platform"

echo ""
echo "📦 Root dependencies..."
npm install --save-dev @types/node typescript

echo ""
echo "📦 BoardRoom Server dependencies..."
cd packages/boardroom-ai/server
npm install ioredis
npm install --save-dev @types/node

echo ""
echo "📦 OmniMind API dependencies..."
cd ../../omnimind-api
npm install --save-dev @types/node @types/express
npm install express

echo ""
echo "🔧 Generating Prisma client..."
npx prisma generate

echo ""
echo "📦 BoardRoom Client dependencies..."
cd ../boardroom-ai/client
npm install --save-dev @types/react @types/react-dom

echo ""
echo "✅ Dependencies installed successfully!"
echo ""
echo "Next steps:"
echo "1. Run: npm run build:all"
echo "2. Check for any remaining type errors"
