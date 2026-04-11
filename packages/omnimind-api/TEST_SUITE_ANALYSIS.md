# Omnimind-API Test Suite Analysis & Implementation Plan

## Current State Analysis

### Existing Tests (8 files, 522 lines)
- **Unit Tests (6 files):**
  - `tests/unit/memory/` (3 files): budget-enforcer, temporal-validator, schema-validator
  - `tests/unit/retrieval/` (2 files): context-packager, ranker
  - `tests/unit/crypto.test.ts` (1 file)
- **Integration Tests (2 files):**
  - `tests/integration/memories.test.ts` - Memory CRUD with real DB (skipped without DATABASE_URL)
  - `tests/integration/health.test.ts` - Health endpoint tests

### Code Coverage Gaps

Based on analysis of 52 source files, major gaps exist in:

#### 1. Middleware (4/4 files untested)
- `auth.ts` - API key authentication
- `rate-limiter.ts` - Rate limiting by user/method  
- `validate.ts` - Request body validation
- `error-handler.ts` - Global error handling

#### 2. Services (16/16 files mostly untested)
- `auth.service.ts` - User registration/auth
- `memory.service.ts` - Memory CRUD operations  
- `embedding.service.ts` - OpenAI embeddings
- `context-assembler.service.ts` - Context assembly
- Various cortex services (patterns, contradictions, memo)
- Entity, relationship, decision, outcome-review services

#### 3. Retrieval (5/6 files partially tested)
- `fulltext-search.ts` - Full-text search
- `semantic-search.ts` - Vector similarity search  
- `trigram-search.ts` - Fuzzy search
- `structured-filter.ts` - Structured filtering
- `context-packager.ts` - Partially tested
- `ranker.ts` - Partially tested

#### 4. Memory Validation (4/4 files partially tested)
- `pipeline.ts` - Validation pipeline orchestration
- `schema-validator.ts` - Zod schema validation
- `temporal-validator.ts` - Temporal consistency
- `budget-enforcer.ts` - Domain budget limits

#### 5. Jobs (1/1 file untested)
- `cortex-scheduler.ts` - Scheduled jobs for cortex

#### 6. Lib (6/6 files partially tested)
- `crypto.ts` - Encryption/decryption (tested)
- `db.ts` - Prisma client
- `env.ts` - Environment validation
- `logger.ts` - Structured logging
- `prompt-loader.ts` - Prompt loading

## New Test Suite Implementation

### Phase 1: Complete Unit Test Coverage (Created)

**Middleware (4 new files):**
- ✅ `auth.test.ts` - API key authentication tests
- ✅ `rate-limiter.test.ts` - Rate limiting logic
- ✅ `validate.test.ts` - Request validation
- ✅ `error-handler.test.ts` - Error handling

**Services (2 new files):**
- ✅ `auth.service.test.ts` - User auth/registration
- ✅ `memory.service.test.ts` - Memory CRUD operations

**Retrieval (1 new file):**
- ✅ `fulltext-search.test.ts` - Full-text search logic

### Phase 2: Remaining Unit Tests Needed

**Services (14 files):**
1. `embedding.service.test.ts` - OpenAI embeddings with mocks
2. `context-assembler.service.test.ts` - Context assembly logic
3. `cortex-memo.service.test.ts` - Weekly memo generation
4. `cortex-patterns.service.test.ts` - Pattern detection
5. `cortex-contradictions.service.test.ts` - Contradiction scanning
6. `decision.service.test.ts` - Decision processing
7. `entity.service.test.ts` - Entity management
8. `outcome-review.service.test.ts` - Outcome review logic
9. `relationship.service.test.ts` - Relationship management
10. `simulation.service.test.ts` - Simulation logic
11. `user-profile.service.test.ts` - User profile operations
12. `commitment.service.test.ts` - Commitment tracking

**Retrieval (4 files):**
1. `semantic-search.test.ts` - Vector similarity search
2. `trigram-search.test.ts` - Fuzzy search algorithms
3. `structured-filter.test.ts` - Structured filtering
4. `retrieval-integration.test.ts` - Combined retrieval tests

**Jobs (1 file):**
1. `cortex-scheduler.test.ts` - Job scheduling tests

**Lib (5 files):**
1. `db.test.ts` - Prisma client setup
2. `env.test.ts` - Environment validation
3. `logger.test.ts` - Logging functionality
4. `prompt-loader.test.ts` - Prompt loading
5. `crypto.test.ts` - Already exists

**Memory Validation (1 file):**
1. `pipeline.test.ts` - Validation pipeline orchestration

### Phase 3: Integration Test Expansion

**Route Integration Tests:**
1. `auth.routes.test.ts` - Authentication endpoints
2. `context.routes.test.ts` - Context retrieval endpoints
3. `cortex.routes.test.ts` - Cortex analysis endpoints
4. `decisions.routes.test.ts` - Decision endpoints
5. `goals.routes.test.ts` - Goal management
6. `projects.routes.test.ts` - Project endpoints
7. `tasks.routes.test.ts` - Task management
8. `people.routes.test.ts` - People/contacts
9. `subscription.routes.test.ts` - Subscription handling
10. `oauth.routes.test.ts` - OAuth integration

**End-to-End Test Scenarios:**
1. `memory-lifecycle.e2e.test.ts` - Complete memory flow
2. `context-retrieval.e2e.test.ts` - Context retrieval flow
3. `cortex-analysis.e2e.test.ts` - Cortex analysis pipeline

### Phase 4: Mock Strategy

**Database Mocking:**
- Use vi.mock() for Prisma client
- Mock individual Prisma methods (findMany, create, etc.)
- Use factory functions for test data

**External Service Mocks:**
- OpenAI API (embeddings) - mock generateEmbedding
- Anthropic Claude API - mock prompt execution
- Redis - mock cache operations
- External APIs (email, calendar, etc.)

**Test Data Factories:**
```typescript
interface MemoryFactory {
  create(overrides?: Partial<Memory>): Memory;
  createList(count: number): Memory[];
}
```

## Implementation Priority

### High Priority (Core Business Logic)
1. Memory service (✅ Done)
2. Auth service (✅ Done)
3. Embedding service
4. Context assembler
5. Retrieval components

### Medium Priority (Supporting Services)
1. Cortex services (memo, patterns, contradictions)
2. Entity/relationship services
3. Decision/outcome services

### Low Priority (Infrastructure)
1. Lib utilities
2. Job scheduling
3. Route integration tests

## Test Configuration

**Vitest Configuration Recommended:**
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/tests/**'],
    },
  },
});
```

**Setup File:**
```typescript
// tests/setup.ts
import { vi } from 'vitest';

// Global mocks
vi.mock('../src/lib/db', () => ({
  prisma: {
    memoryEntry: {
      findMany: vi.fn(),
      create: vi.fn(),
      // ... other methods
    },
  },
}));
```

## Success Metrics

1. **Test Coverage Goals:**
   - 80%+ line coverage for core services
   - 70%+ line coverage for all business logic
   - 50%+ line coverage for infrastructure

2. **Integration Test Coverage:**
   - All major API routes tested
   - Critical user flows validated
   - Error scenarios covered

3. **Mock Coverage:**
   - All external dependencies mocked
   - Database operations isolated
   - API calls simulated

## Next Steps

1. Fix failing tests in current implementation
2. Implement high-priority service tests
3. Add integration tests for key routes
4. Set up coverage reporting
5. Add CI pipeline for test execution
