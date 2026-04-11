#!/bin/bash
set -e

echo "=== Testing Docker Compose Setup ==="
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

# Check Docker Compose files exist
echo "1. Checking Docker Compose files..."
FILES=("docker-compose.yml" "docker-compose.dev.yml" "docker-compose.test.yml")
ALL_EXIST=true

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        print_status "success" "$file exists"
    else
        print_status "error" "$file not found"
        ALL_EXIST=false
    fi
done

if [ "$ALL_EXIST" = false ]; then
    echo ""
    print_status "error" "Some Docker Compose files are missing"
    exit 1
fi

# Validate Docker Compose configurations
echo ""
echo "2. Validating Docker Compose configurations..."

echo "  - docker-compose.yml..."
if docker-compose -f docker-compose.yml config > /dev/null 2>&1; then
    print_status "success" "docker-compose.yml is valid"
else
    print_status "error" "docker-compose.yml validation failed"
    docker-compose -f docker-compose.yml config
    exit 1
fi

echo "  - docker-compose.dev.yml..."
if docker-compose -f docker-compose.dev.yml config > /dev/null 2>&1; then
    print_status "success" "docker-compose.dev.yml is valid"
else
    print_status "error" "docker-compose.dev.yml validation failed"
    docker-compose -f docker-compose.dev.yml config
    exit 1
fi

echo "  - docker-compose.test.yml..."
if docker-compose -f docker-compose.test.yml config > /dev/null 2>&1; then
    print_status "success" "docker-compose.test.yml is valid"
else
    print_status "error" "docker-compose.test.yml validation failed"
    docker-compose -f docker-compose.test.yml config
    exit 1
fi

# Check Dockerfile.dev files exist
echo ""
echo "3. Checking development Dockerfiles..."

if [ -f "packages/omnimind-api/Dockerfile.dev" ]; then
    print_status "success" "OmniMind API Dockerfile.dev exists"
else
    print_status "error" "packages/omnimind-api/Dockerfile.dev not found"
    exit 1
fi

if [ -f "packages/boardroom-ai/Dockerfile.dev" ]; then
    print_status "success" "BoardRoom AI Dockerfile.dev exists"
else
    print_status "error" "packages/boardroom-ai/Dockerfile.dev not found"
    exit 1
fi

# Check environment files
echo ""
echo "4. Checking environment files..."

if [ -f ".env.example" ]; then
    print_status "success" ".env.example exists"
    
    # Check for required variables in .env.example
    REQUIRED_VARS=("DATABASE_URL" "REDIS_URL" "ANTHROPIC_API_KEY" "OPENAI_API_KEY")
    MISSING_VARS=()
    
    for var in "${REQUIRED_VARS[@]}"; do
        if grep -q "^$var=" .env.example || grep -q "^$var=" .env.example; then
            print_status "success" "  $var is defined"
        else
            print_status "warning" "  $var not found in .env.example"
            MISSING_VARS+=("$var")
        fi
    done
    
    if [ ${#MISSING_VARS[@]} -gt 0 ]; then
        print_status "warning" "Some recommended variables missing from .env.example"
    fi
else
    print_status "error" ".env.example not found"
    exit 1
fi

if [ -f ".env.test.example" ]; then
    print_status "success" ".env.test.example exists"
fi

# Check setup script
echo ""
echo "5. Checking setup scripts..."

if [ -f "scripts/dev-setup.sh" ]; then
    print_status "success" "dev-setup.sh exists"
    if [ -x "scripts/dev-setup.sh" ]; then
        print_status "success" "dev-setup.sh is executable"
    else
        print_status "warning" "dev-setup.sh is not executable (run: chmod +x scripts/dev-setup.sh)"
    fi
else
    print_status "error" "scripts/dev-setup.sh not found"
    exit 1
fi

# Summary
echo ""
echo "=== Docker Compose Setup Test Summary ==="
echo ""
echo "Configuration files:"
echo "  - docker-compose.yml: Production-like setup"
echo "  - docker-compose.dev.yml: Development with hot reload"
echo "  - docker-compose.test.yml: Test environment"
echo ""
echo "Services configured:"
echo "  - PostgreSQL 16 with pgvector extension"
echo "  - Redis 7 for caching and sessions"
echo "  - OmniMind API (port 3333)"
echo "  - BoardRoom AI (port 3001)"
echo ""
echo "Next steps:"
echo "  1. Run: ./scripts/dev-setup.sh"
echo "  2. Start services: docker-compose up"
echo "  3. For development: docker-compose -f docker-compose.dev.yml up"
echo ""
print_status "success" "All checks passed! Docker Compose setup is ready."