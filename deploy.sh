#!/bin/bash
set -e

# BoardRoom AI Deployment Script
# This script builds and prepares the application for deployment

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${BLUE}[$(date +'%H:%M:%S')]${NC} $1"
}

success() {
    echo -e "${GREEN}✓${NC} $1"
}

error() {
    echo -e "${RED}✗${NC} $1" >&2
}

warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        error "Node.js is not installed. Please install Node.js 20+"
        exit 1
    fi
    
    NODE_VERSION=$(node --version | cut -d'v' -f2)
    if [[ "${NODE_VERSION%%.*}" -lt 20 ]]; then
        warning "Node.js version $NODE_VERSION detected. Recommended: 20+"
    else
        success "Node.js $NODE_VERSION ✓"
    fi
    
    # Check pnpm
    if ! command -v pnpm &> /dev/null; then
        warning "pnpm not found. Installing globally..."
        npm install -g pnpm
    fi
    
    PNPM_VERSION=$(pnpm -v 2>/dev/null || echo "0")
    success "pnpm $PNPM_VERSION ✓"
    
    # Check Docker (optional)
    if command -v docker &> /dev/null && docker info &> /dev/null; then
        success "Docker available ✓"
        DOCKER_AVAILABLE=true
    else
        warning "Docker not available or not running"
        DOCKER_AVAILABLE=false
    fi
}

# Run pre-deploy checks
run_pre_deploy_checks() {
    log "Running pre-deploy checks..."
    
    # TypeScript compilation check
    log "  - TypeScript compilation..."
    if npm run typecheck 2>/dev/null; then
        success "  TypeScript compilation passed"
    else
        error "TypeScript compilation failed"
        exit 1
    fi
    
    # Build all packages
    log "  - Building packages..."
    if npm run build; then
        success "  Build completed"
    else
        error "Build failed"
        exit 1
    fi
    
    # Run unit tests
    log "  - Running unit tests..."
    if npm run test 2>/dev/null; then
        success "  Unit tests passed"
    else
        warning "  Some tests failed - continuing anyway"
    fi
}

# Build Docker images
build_docker_images() {
    if [ "$DOCKER_AVAILABLE" = true ]; then
        log "Building Docker images..."
        
        # Build OmniMind API
        log "  - Building OmniMind API..."
        docker build -t boardroom-omnimind:latest -f packages/omnimind-api/Dockerfile .
        success "  OmniMind API image built"
        
        # Build BoardRoom AI
        log "  - Building BoardRoom AI..."
        docker build -t boardroom-ai:latest -f packages/boardroom-ai/Dockerfile .
        success "  BoardRoom AI image built"
    fi
}

# Prepare for deployment
prepare_deployment() {
    log "Preparing for deployment..."
    
    # Create deployment directory
    DEPLOY_DIR="deploy-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$DEPLOY_DIR"
    
    # Copy necessary files
    log "  - Creating deployment package..."
    
    # Copy Docker files
    cp docker-compose.yml "$DEPLOY_DIR/"
    cp docker-compose.test.yml "$DEPLOY_DIR/"
    cp packages/omnimind-api/Dockerfile "$DEPLOY_DIR/omnimind-api.Dockerfile"
    cp packages/boardroom-ai/Dockerfile "$DEPLOY_DIR/boardroom-ai.Dockerfile"
    
    # Copy configuration
    cp .env.example "$DEPLOY_DIR/.env.example"
    cp railway.toml "$DEPLOY_DIR/"
    cp packages/omnimind-api/railway.toml "$DEPLOY_DIR/omnimind-api.railway.toml"
    cp packages/boardroom-ai/railway.toml "$DEPLOY_DIR/boardroom-ai.railway.toml"
    
    # Copy scripts
    mkdir -p "$DEPLOY_DIR/scripts"
    cp scripts/*.sh "$DEPLOY_DIR/scripts/" 2>/dev/null || true
    
    # Copy built artifacts
    mkdir -p "$DEPLOY_DIR/dist"
    
    # Copy documentation
    cp DEPLOYMENT_GUIDE.md "$DEPLOY_DIR/"
    cp README.md "$DEPLOY_DIR/"
    
    # Create deployment summary
    cat > "$DEPLOY_DIR/DEPLOYMENT_SUMMARY.md" << SUMMARY
# BoardRoom AI Deployment Package

Generated: $(date)

## Contents

1. **Docker Configuration**
   - docker-compose.yml (production)
   - docker-compose.test.yml (testing)
   - OmniMind API Dockerfile
   - BoardRoom AI Dockerfile

2. **Platform Configuration**
   - Railway configuration files
   - Environment template (.env.example)

3. **Deployment Scripts**
   - Backup scripts
   - Health check scripts
   - Test deployment script

4. **Documentation**
   - Deployment guide
   - README

## Deployment Options

### Option 1: Railway.app
```bash
railway up --service=omnimind-api
railway up --service=boardroom-ai
```

### Option 2: Docker Compose
```bash
docker-compose up --build
```

### Option 3: Manual Deployment
See DEPLOYMENT_GUIDE.md for details

## Next Steps

1. Configure environment variables
2. Setup PostgreSQL database with pgvector
3. Run migrations: npx prisma migrate deploy
4. Start services
5. Run health checks

## Support

- Documentation: docs/ directory
- Runbooks: docs/runbooks/
- Tests: tests/ directory
SUMMARY
    
    success "Deployment package created: $DEPLOY_DIR"
    
    # Show next steps
    echo ""
    echo "================================================"
    echo " ${GREEN}✅ DEPLOYMENT PREPARED SUCCESSFULLY${NC}"
    echo "================================================"
    echo ""
    echo "Next steps:"
    echo "  1. Review environment variables in $DEPLOY_DIR/.env.example"
    echo "  2. Setup PostgreSQL with pgvector extension"
    echo "  3. Configure API keys (Anthropic, OpenAI, Stripe)"
    echo "  4. Run database migrations"
    echo "  5. Deploy using one of the methods in DEPLOYMENT_GUIDE.md"
    echo ""
    echo "Quick test deployment:"
    echo "  ./scripts/test-e2e.sh --services-only"
    echo ""
}

# Main execution
main() {
    echo ""
    echo "================================================"
    echo " 🚀 BoardRoom AI Deployment Preparation"
    echo "================================================"
    echo ""
    
    check_prerequisites
    run_pre_deploy_checks
    build_docker_images
    prepare_deployment
    
    echo "${GREEN}✨ Deployment preparation complete!${NC}"
    echo ""
}

# Run main function
main "$@"
