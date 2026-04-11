# BoardRoom Test Suite

This directory contains the comprehensive test suite for the BoardRoom platform, including unit tests, integration tests, and end-to-end (E2E) tests.

## Test Structure

```
tests/
├── e2e/                    # End-to-end tests
│   ├── flows/             # Complete user flow tests
│   │   ├── auth-flow.e2e.test.ts        # Full authentication flow
│   │   ├── payment-flow.e2e.test.ts     # Payment/subscription flow  
│   │   ├── entity-crud.e2e.test.ts      # Entity CRUD operations
│   │   ├── memory-lifecycle.e2e.test.ts # Memory create/store/search
│   │   └── decision-session.e2e.test.ts # Decision session lifecycle
│   ├── utils/             # Test utilities
│   │   └── llm-mocks.ts   # LLM mocking utilities
│   └── setup.ts           # E2E test setup utilities
├── integration/           # Integration tests
│   ├── auth.integration.test.ts    # Authentication integration
│   └── session.integration.test.ts # Session management integration
└── README.md              # This file
```

## Test Infrastructure

### Docker Compose for Testing

We use a separate Docker Compose configuration for test infrastructure:

```yaml
# docker-compose.test.yml
services:
  postgres-test:    # PostgreSQL with pgvector on port 5433
  redis-test:       # Redis on port 6379  
  omnimind-api-test: # OmniMind API on port 3334
  boardroom-ai-test: # BoardRoom AI on port 3002
```

### Test Environment

Test services run with mock LLM responses enabled (`MOCK_LLM=true`) to avoid actual API calls and ensure deterministic test results.

## Running Tests

### Available Test Commands

Add to your `package.json` scripts:

```json
{
  "scripts": {
    "test:unit": "turbo run test",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:e2e": "./scripts/test-e2e.sh",
    "test:e2e:services": "./scripts/test-e2e.sh --services-only",
    "test:e2e:tests": "./scripts/test-e2e.sh --tests-only",
    "test:all": "npm run test:unit && npm run test:integration && npm run test:e2e",
    "test:ci": "./scripts/test-e2e.sh --no-cleanup"
  }
}
```

### E2E Test Runner

The main E2E test runner (`scripts/test-e2e.sh`) provides:

```bash
# Full test run (builds services, runs tests, cleans up)
./scripts/test-e2e.sh

# Start test services only (useful for development)
./scripts/test-e2e.sh --services-only

# Run tests against already running services
./scripts/test-e2e.sh --tests-only

# Run tests without cleanup (useful for CI/debugging)
./scripts/test-e2e.sh --no-cleanup
```

## Test Categories

### Unit Tests
- **Location**: Within each package (`packages/*/tests/unit/`)
- **Purpose**: Test individual functions, classes, and modules in isolation
- **Dependencies**: None (mocked dependencies)
- **Run**: `npm run test:unit`

### Integration Tests  
- **Location**: `tests/integration/`
- **Purpose**: Test service integration, database interactions, and API endpoints
- **Dependencies**: Requires test database (PostgreSQL)
- **Run**: `npm run test:integration`

### End-to-End (E2E) Tests
- **Location**: `tests/e2e/`
- **Purpose**: Test complete user flows across the entire system
- **Dependencies**: Requires all test services running (Docker Compose)
- **Run**: `npm run test:e2e`

## Test Coverage Areas

### Authentication & Security
- User registration and login flows
- JWT token validation and session management
- Rate limiting and security measures
- Password validation and hashing

### Session Management
- Decision session creation and retrieval
- Persona orchestration and dispatch
- CEO synthesis and memory extraction
- Session export functionality

### Entity Management
- CRUD operations for all entity types (goals, projects, tasks, people)
- Data validation and error handling
- User isolation and access control

### Memory System
- Memory creation, storage, and retrieval
- Semantic search and vector similarity
- Memory archiving and lifecycle management

### Payment & Subscription
- Stripe checkout flow
- Webhook processing
- Subscription status management
- Plan upgrades and cancellations

## Mocking Strategy

### LLM Mocking
To avoid actual API calls and ensure deterministic tests:

```typescript
// Set environment variable
process.env.MOCK_LLM = 'true';

// Use mock responses
import { getMockPersonaResponse, getMockMemoryProposals } from './utils/llm-mocks';
```

### External Service Mocking
- **Database**: Use test database with `test_` prefix
- **Redis**: Use test Redis instance (port 6379)
- **Stripe**: Use test/mock API keys
- **Email/SMS**: Mocked or disabled in test environment

## Continuous Integration

For CI environments, configure:

```yaml
# Example GitHub Actions workflow
test:
  runs-on: ubuntu-latest
  services:
    postgres:
      image: pgvector/pgvector:pg16
      env:
        POSTGRES_USER: test_user
        POSTGRES_PASSWORD: test_password
        POSTGRES_DB: boardroom_test
      options: >-
        --health-cmd pg_isready
        --health-interval 10s
        --health-timeout 5s
        --health-retries 5
    redis:
      image: redis:7-alpine
      options: >-
        --health-cmd "redis-cli ping"
        --health-interval 10s
        --health-timeout 5s
        --health-retries 5
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
    - run: npm ci
    - run: npm run test:ci
```

## Best Practices

1. **Isolation**: Each test should be independent and not rely on state from other tests
2. **Cleanup**: Always clean up test data after tests complete
3. **Determinism**: Use mocks for external dependencies to ensure consistent results
4. **Speed**: Mock expensive operations (LLM calls, external API calls)
5. **Coverage**: Aim for comprehensive coverage of user flows and edge cases
6. **Readability**: Tests should be self-documenting and easy to understand

## Debugging Tests

### Common Issues

1. **Services not starting**: Check Docker is running and ports are available
2. **Database connection errors**: Verify PostgreSQL credentials and connection URL
3. **Timeout errors**: Increase timeouts in vitest config for slower environments
4. **Mock issues**: Ensure `MOCK_LLM=true` is set for tests that mock LLM responses

### Debug Commands

```bash
# Check service status
docker-compose -f docker-compose.test.yml ps

# View service logs
docker-compose -f docker-compose.test.yml logs

# Run single test file
npx vitest run tests/e2e/flows/auth-flow.e2e.test.ts

# Run tests with debug output
DEBUG=* npm run test:e2e
```

## Adding New Tests

1. **Identify test category** (unit/integration/e2e)
2. **Create test file** in appropriate directory
3. **Follow naming convention**: `*.test.ts` or `*.spec.ts`
4. **Add to appropriate test config** if needed
5. **Update this README** if adding new test category or pattern

## Test Data Management

### Test Databases
- Use separate database (`boardroom_test`) for tests
- Apply migrations before running tests
- Clean database between test runs

### Test Users
- Create unique users for each test (using timestamps in email)
- Clean up test users after tests complete
- Never use production user data in tests

### Test Sessions & Data
- Create fresh test data for each test
- Use descriptive names and clear test data structure
- Include cleanup in `afterAll` hooks
