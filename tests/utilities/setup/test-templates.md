# Test Templates Guide

## Unit Test Template (Services/Middleware)

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { YourService } from '../../../path/to/service';
import { someMockHelper } from '../../helpers/some.helper';

describe('YourService', () => {
  let service: YourService;
  let mockDependency: any;

  beforeEach(() => {
    // Setup mocks
    mockDependency = vi.fn();
    
    // Create service instance
    service = new YourService(mockDependency);
    
    // Clear mocks before each test
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('methodName', () => {
    it('should do something when condition', async () => {
      // Arrange
      const input = 'test-input';
      mockDependency.mockResolvedValue('mocked-response');

      // Act
      const result = await service.methodName(input);

      // Assert
      expect(result).toBe('expected-result');
      expect(mockDependency).toHaveBeenCalledWith('expected-args');
    });

    it('should throw error when invalid input', async () => {
      // Arrange
      const invalidInput = '';
      
      // Act & Assert
      await expect(service.methodName(invalidInput))
        .rejects
        .toThrow('Expected error message');
    });

    it('should handle edge case', () => {
      // Test edge cases
    });
  });

  // Test error scenarios
  describe('error handling', () => {
    it('should propagate dependency errors', async () => {
      mockDependency.mockRejectedValue(new Error('Dependency failed'));
      
      await expect(service.methodName('test'))
        .rejects
        .toThrow('Dependency failed');
    });
  });
});
```

## Integration Test Template (API Routes)

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../../src/app';
import { setupTestDatabase, teardownTestDatabase } from '../../helpers/db.helper';
import { createTestUser, getTestToken } from '../../helpers/auth.helper';

describe('POST /api/endpoint', () => {
  let testUser: any;
  let authToken: string;

  beforeAll(async () => {
    await setupTestDatabase();
    testUser = await createTestUser();
    authToken = getTestToken(testUser.id);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it('should return 201 with valid request', async () => {
    const payload = {
      // Valid payload
    };

    const response = await request(app)
      .post('/api/endpoint')
      .set('Authorization', `Bearer ${authToken}`)
      .send(payload);

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body).toMatchObject({
      // Expected response shape
    });
  });

  it('should return 400 with invalid payload', async () => {
    const invalidPayload = {
      // Invalid payload
    };

    const response = await request(app)
      .post('/api/endpoint')
      .set('Authorization', `Bearer ${authToken}`)
      .send(invalidPayload);

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toBe('validation_error');
  });

  it('should return 401 without authentication', async () => {
    const response = await request(app)
      .post('/api/endpoint')
      .send({});

    expect(response.status).toBe(401);
  });
});
```

## Component Test Template (React Components)

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { YourComponent } from '../../../path/to/component';
import { MockProviders } from '../../helpers/react.helper';

// Mock external dependencies
vi.mock('../../../path/to/hook', () => ({
  useSomeHook: () => ({
    data: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

describe('YourComponent', () => {
  const defaultProps = {
    // Default props
  };

  it('should render with default props', () => {
    render(
      <MockProviders>
        <YourComponent {...defaultProps} />
      </MockProviders>
    );

    expect(screen.getByText('Expected text')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeEnabled();
  });

  it('should display loading state', () => {
    vi.mock('../../../path/to/hook', () => ({
      useSomeHook: () => ({
        data: null,
        loading: true,
        error: null,
        refetch: vi.fn(),
      }),
    }));

    render(
      <MockProviders>
        <YourComponent {...defaultProps} />
      </MockProviders>
    );

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('should call onClick when button is clicked', () => {
    const handleClick = vi.fn();
    
    render(
      <MockProviders>
        <YourComponent {...defaultProps} onClick={handleClick} />
      </MockProviders>
    );

    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('should display error message', () => {
    vi.mock('../../../path/to/hook', () => ({
      useSomeHook: () => ({
        data: null,
        loading: false,
        error: new Error('Failed to load'),
        refetch: vi.fn(),
      }),
    }));

    render(
      <MockProviders>
        <YourComponent {...defaultProps} />
      </MockProviders>
    );

    expect(screen.getByText('Failed to load')).toBeInTheDocument();
  });
});
```

## E2E Test Template (User Flows)

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, Browser, Page } from 'playwright';
import { startTestServer, stopTestServer } from '../../helpers/e2e.helper';
import { createTestUser } from '../../helpers/auth.helper';

describe('User Onboarding Flow', () => {
  let browser: Browser;
  let page: Page;
  let testUser: any;
  let serverUrl: string;

  beforeAll(async () => {
    // Start test server
    serverUrl = await startTestServer();
    
    // Create test user
    testUser = await createTestUser();
    
    // Launch browser
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    // Cleanup
    await browser?.close();
    await stopTestServer();
  });

  beforeEach(async () => {
    page = await browser.newPage();
    await page.goto(serverUrl);
  });

  afterEach(async () => {
    await page.close();
  });

  it('should complete onboarding flow successfully', async () => {
    // Step 1: Navigate to login
    await page.click('text=Sign In');
    await expect(page).toHaveURL(`${serverUrl}/login`);

    // Step 2: Fill login form
    await page.fill('input[name="email"]', testUser.email);
    await page.fill('input[name="password"]', 'test-password');
    await page.click('button[type="submit"]');

    // Step 3: Verify redirect to dashboard
    await page.waitForURL(`${serverUrl}/dashboard`);
    await expect(page.locator('h1')).toContainText('Dashboard');

    // Step 4: Complete onboarding steps
    await page.click('text=Get Started');
    await page.fill('input[name="companyName"]', 'Test Company');
    await page.click('button:has-text("Continue")');

    // Verify completion
    await expect(page.locator('text=Onboarding Complete')).toBeVisible();
  });

  it('should show validation errors for invalid input', async () => {
    await page.click('text=Sign In');
    await page.fill('input[name="email"]', 'invalid-email');
    await page.click('button[type="submit"]');

    await expect(page.locator('text=Invalid email address')).toBeVisible();
  });
});
```

## Test Structure Best Practices

1. **Arrange-Act-Assert Pattern**: Always structure tests with clear sections.
2. **Descriptive Test Names**: Use `should [do something] when [condition]` format.
3. **One Assertion Per Test**: Focus each test on one behavior.
4. **Clean Setup/Teardown**: Use beforeEach/afterEach for isolation.
5. **Mock External Dependencies**: Never call real APIs/services in unit tests.
6. **Test Error Scenarios**: Include tests for failure cases.
7. **Edge Cases**: Test boundaries, null values, and extremes.
8. **Avoid Test Interdependence**: Tests should not rely on each other.
