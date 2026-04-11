#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
SERVICES_ONLY=false
TESTS_ONLY=false
CLEANUP=true

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --services-only)
      SERVICES_ONLY=true
      shift
      ;;
    --tests-only)
      TESTS_ONLY=true
      shift
      ;;
    --no-cleanup)
      CLEANUP=false
      shift
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

echo -e "${GREEN}🚀 BoardRoom E2E Test Runner${NC}"
echo "======================================"

# Function to check if Docker is running
check_docker() {
  if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}✗ Docker is not running. Please start Docker and try again.${NC}"
    exit 1
  fi
  echo -e "${GREEN}✓ Docker is running${NC}"
}

# Function to start test services
start_services() {
  echo -e "${YELLOW}Starting test services...${NC}"
  
  # Build and start services
  docker-compose -f docker-compose.test.yml up -d --build --force-recreate
  
  # Wait for services to be healthy
  echo -e "${YELLOW}Waiting for services to become healthy...${NC}"
  
  MAX_WAIT=120
  WAIT_TIME=0
  while [ $WAIT_TIME -lt $MAX_WAIT ]; do
    if docker-compose -f docker-compose.test.yml ps | grep -q "(healthy)"; then
      echo -e "${GREEN}✓ All services are healthy${NC}"
      return 0
    fi
    sleep 5
    WAIT_TIME=$((WAIT_TIME + 5))
    echo -e "${YELLOW}Waiting... (${WAIT_TIME}s/${MAX_WAIT}s)${NC}"
  done
  
  echo -e "${RED}✗ Services did not become healthy within ${MAX_WAIT} seconds${NC}"
  docker-compose -f docker-compose.test.yml logs
  exit 1
}

# Function to run tests
run_tests() {
  echo -e "${YELLOW}Running E2E tests...${NC}"
  
  # Set test environment variables
  export OMNIMIND_URL="http://localhost:3334"
  export BOARDROOM_URL="http://localhost:3002"
  export NODE_ENV="test"
  export MOCK_LLM="true"
  
  # Run tests with increased timeout
  npx vitest run --config vitest.e2e.config.ts --testTimeout=60000 --hookTimeout=60000
  
  TEST_EXIT_CODE=$?
  
  if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
  else
    echo -e "${RED}✗ Tests failed with exit code $TEST_EXIT_CODE${NC}"
  fi
  
  return $TEST_EXIT_CODE
}

# Function to cleanup
cleanup() {
  if [ "$CLEANUP" = true ]; then
    echo -e "${YELLOW}Cleaning up test services...${NC}"
    docker-compose -f docker-compose.test.yml down -v
    echo -e "${GREEN}✓ Cleanup complete${NC}"
  else
    echo -e "${YELLOW}Skipping cleanup (services left running)${NC}"
  fi
}

# Main execution
check_docker

# Handle different modes
if [ "$SERVICES_ONLY" = true ]; then
  start_services
  echo -e "${GREEN}✅ Test services are running${NC}"
  echo "  - PostgreSQL: localhost:5433"
  echo "  - Redis: localhost:6379"
  echo "  - OmniMind API: http://localhost:3334"
  echo "  - BoardRoom AI: http://localhost:3002"
  echo ""
  echo "Run tests with: npm run test:e2e -- --tests-only"
  exit 0
elif [ "$TESTS_ONLY" = true ]; then
  run_tests
  exit $?
else
  # Full run
  start_services
  run_tests
  TEST_RESULT=$?
  cleanup
  exit $TEST_RESULT
fi
