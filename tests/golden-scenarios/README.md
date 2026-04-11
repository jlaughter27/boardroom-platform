# Golden Test Scenarios

This directory contains comprehensive golden test scenarios for the Boardroom Platform. These scenarios serve as reference implementations and regression tests covering critical user flows, edge cases, and integration points.

## Overview

Golden test scenarios are high-quality, comprehensive test cases that:
- Serve as reference implementations for developers
- Provide regression protection for critical user journeys
- Document expected system behavior
- Validate integration points between components

## Categories

### 1. Authentication & Authorization (`auth-scenarios.test.ts`)
- User registration with valid/invalid credentials
- Login/logout flows
- Session management and token validation
- Rate limiting and security controls
- Authentication failure scenarios

### 2. User Onboarding & Profile (`onboarding-scenarios.test.ts`)
- Complete user onboarding flow
- Profile creation and updates
- Preference settings
- Dashboard customization

### 3. Memory Lifecycle (`memory-lifecycle.test.ts`)
- Memory creation, retrieval, search, and archiving
- Memory linking and relationships
- Memory extraction from sessions
- Memory search and filtering

### 4. Decision Sessions (`decision-sessions.test.ts`)
- Session creation with different modes (Decide, Plan, Brainstorm, Reflect)
- Persona dispatch and synthesis
- Questionnaire and ambiguity checking
- Memory extraction from sessions
- Session export and reporting

### 5. Entity Management (`entity-management.test.ts`)
- Goals, Projects, Tasks, and People CRUD operations
- Relationships and linking between entities
- Outcome reviews and commitment tracking
- Entity search and filtering

### 6. Integration Scenarios (`integration-scenarios.test.ts`)
- Boardroom ↔ OmniMind communication
- External API integrations (calendar, email, etc.)
- Webhook handling and event propagation
- Data synchronization between services

### 7. Performance & Load (`performance-scenarios.test.ts`)
- Concurrent user sessions
- Large dataset handling
- Memory and CPU usage under load
- Response time benchmarks
- Rate limiting under load

### 8. Security & Error Handling (`security-scenarios.test.ts`)
- Authentication bypass attempts
- Authorization boundary testing
- Input validation and sanitization
- Error handling and graceful degradation
- Data isolation between users

### 9. Edge Cases (`edge-case-scenarios.test.ts`)
- Boundary value testing
- Invalid input handling
- Network failure scenarios
- Service dependency failures
- Data consistency edge cases

### 10. Export & Reporting (`export-scenarios.test.ts`)
- Session export in different formats
- Report generation
- Data aggregation and summarization
- Historical data access

## Running the Tests

```bash
# Run all golden scenarios
npm test -- tests/golden-scenarios/

# Run specific category
npm test -- tests/golden-scenarios/auth-scenarios.test.ts

# Run with coverage
npm test -- tests/golden-scenarios/ --coverage
```

## Test Structure

Each scenario follows this pattern:

```typescript
describe('Scenario Name', () => {
  // Setup
  beforeAll(async () => {
    // Initialize test data and dependencies
  });

  // Cleanup
  afterAll(async () => {
    // Clean up test data
  });

  it('should perform action with expected outcome', async () => {
    // 1. Setup test conditions
    // 2. Execute the action
    // 3. Validate the results
    // 4. Assert success criteria
  });

  // Additional test cases for the scenario
});
```

## Success Criteria

Each scenario includes clear success criteria:
- ✅ HTTP status codes
- ✅ Response structure validation
- ✅ Data integrity checks
- ✅ Side effect verification
- ✅ Error handling validation
- ✅ Performance benchmarks (where applicable)

## Data Management

- Test data is isolated using unique identifiers (timestamps, UUIDs)
- Cleanup routines ensure no test data leaks between runs
- Realistic data patterns mirror production usage
- Edge case data covers boundary conditions

## Contributing

When adding new golden scenarios:
1. Follow the existing structure and patterns
2. Include comprehensive error handling
3. Document the business logic being tested
4. Add appropriate cleanup
5. Ensure tests are self-contained and idempotent
6. Update this README with new categories if needed