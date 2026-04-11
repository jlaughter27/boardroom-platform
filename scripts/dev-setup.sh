#!/bin/bash
set -e

echo "=== BoardRoom Platform Development Setup ==="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    if [ "$1" = "success" ]; then
        echo -e "${GREEN}✓${NC} $2"
    elif [ "$1" = "warning" ]; then
        echo -e "${YELLOW}⚠${NC} $2"
    elif [ "$1" = "error" ]; then
        echo -e "${RED}✗${NC} $2"
    else
        echo "  $1"
    fi
}

# Check prerequisites
echo "1. Checking prerequisites..."
if command -v docker &> /dev/null; then
    print_status "success" "Docker is installed"
else
    print_status "error" "Docker is not installed. Please install Docker first."
    exit 1
fi

if command -v docker-compose &> /dev/null; then
    print_status "success" "Docker Compose is installed"
else
    # Check for Docker Compose plugin
    if docker compose version &> /dev/null; then
        print_status "success" "Docker Compose plugin is available"
    else
        print_status "error" "Docker Compose is not installed. Please install Docker Compose."
        exit 1
    fi
fi

if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -ge 20 ]; then
        print_status "success" "Node.js v$NODE_VERSION is installed"
    else
        print_status "error" "Node.js version $NODE_VERSION is installed, but v20+ is required"
        exit 1
    fi
else
    print_status "error" "Node.js is not installed. Please install Node.js v20+."
    exit 1
fi

# Setup environment file
echo ""
echo "2. Setting up environment files..."
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        print_status "success" "Created .env from .env.example"
        print_status "warning" "Please edit .env file and add your API keys"
    else
        print_status "error" ".env.example not found"
        exit 1
    fi
else
    print_status "success" ".env file already exists"
fi

if [ ! -f ".env.test" ]; then
    if [ -f ".env.test.example" ]; then
        cp .env.test.example .env.test
        print_status "success" "Created .env.test from .env.test.example"
    fi
fi

# Install dependencies
echo ""
echo "3. Installing dependencies..."
if command -v pnpm &> /dev/null; then
    print_status "success" "pnpm is installed"
    pnpm install
else
    print_status "warning" "pnpm not found, installing..."
    npm install -g pnpm
    pnpm install
fi

# Build shared package
echo ""
echo "4. Building shared package..."
cd packages/shared
pnpm exec tsc
cd ../..
print_status "success" "Shared package built"

# Generate Prisma client
echo ""
echo "5. Generating Prisma client..."
cd packages/omnimind-api
pnpm exec prisma generate
cd ../..
print_status "success" "Prisma client generated"

# Database setup instructions
echo ""
echo "6. Database setup..."
echo "You have several options for running the database:"
echo ""
echo "  a) Use Docker Compose (recommended for development):"
echo "     $ docker-compose up postgres redis"
echo ""
echo "  b) Use development Docker Compose (with hot reload):"
echo "     $ docker-compose -f docker-compose.dev.yml up"
echo ""
echo "  c) Use test environment:"
echo "     $ docker-compose -f docker-compose.test.yml up"
echo ""
echo "  d) Use existing PostgreSQL/Redis instances:"
echo "     Update DATABASE_URL and REDIS_URL in .env file"
echo ""

# Migration instructions
echo "7. Database migrations:"
echo "   Once PostgreSQL is running, run migrations with:"
echo "   $ cd packages/omnimind-api && pnpm exec prisma migrate dev"
echo ""

# Running the application
echo "8. Running the application:"
echo ""
echo "   Option 1: Full Docker Compose (all services):"
echo "     $ docker-compose up"
echo ""
echo "   Option 2: Development with hot reload:"
echo "     $ docker-compose -f docker-compose.dev.yml up"
echo ""
echo "   Option 3: Local development (requires local PostgreSQL/Redis):"
echo "     $ pnpm run dev"
echo ""
echo "   Option 4: Test environment:"
echo "     $ docker-compose -f docker-compose.test.yml up"
echo "     $ pnpm run test:e2e"
echo ""

echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Edit .env file and add your API keys"
echo "2. Start database: docker-compose up postgres redis"
echo "3. Run migrations: cd packages/omnimind-api && pnpm exec prisma migrate dev"
echo "4. Start services: pnpm run dev OR docker-compose up"
echo ""