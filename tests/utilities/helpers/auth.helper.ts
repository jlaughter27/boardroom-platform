import { vi } from 'vitest';
import jwt from 'jsonwebtoken';
import type { AuthPayload } from '../../../packages/boardroom-ai/server/src/middleware/auth';

export const TEST_JWT_SECRET = 'test-jwt-secret-for-unit-tests-only';
export const TEST_USER_ID = 'test-user-123';
export const TEST_EMAIL = 'test@example.com';
export const TEST_TEAM_ID = 'test-team-123';

export function createTestToken(payload?: Partial<AuthPayload>): string {
  const basePayload: AuthPayload = {
    userId: TEST_USER_ID,
    email: TEST_EMAIL,
    teamId: TEST_TEAM_ID,
  };
  
  return jwt.sign(
    { ...basePayload, ...payload },
    TEST_JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function createExpiredToken(payload?: Partial<AuthPayload>): string {
  const basePayload: AuthPayload = {
    userId: TEST_USER_ID,
    email: TEST_EMAIL,
    teamId: TEST_TEAM_ID,
  };
  
  return jwt.sign(
    { ...basePayload, ...payload },
    TEST_JWT_SECRET,
    { expiresIn: '-1h' } // Already expired
  );
}

export function createInvalidToken(): string {
  return 'invalid.token.string';
}

export function mockAuthRequest(
  token?: string,
  authPayload?: AuthPayload
): any {
  const mockReq: any = {
    cookies: {},
    auth: authPayload,
  };
  
  if (token) {
    mockReq.cookies.boardroom_token = token;
  }
  
  return mockReq;
}

export function mockAuthResponse(): any {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  return res;
}

export function mockNextFunction(): any {
  return vi.fn();
}

// Test scenarios for auth middleware
// These constants represent common test cases

export const AuthTestScenarios = {
  validToken: {
    description: 'Valid JWT token',
    setup: () => ({
      token: createTestToken(),
      shouldCallNext: true,
      expectedStatus: undefined,
    }),
  },
  
  missingToken: {
    description: 'Missing token',
    setup: () => ({
      token: undefined,
      shouldCallNext: false,
      expectedStatus: 401,
    }),
  },
  
  invalidToken: {
    description: 'Invalid token format',
    setup: () => ({
      token: createInvalidToken(),
      shouldCallNext: false,
      expectedStatus: 401,
    }),
  },
  
  expiredToken: {
    description: 'Expired JWT token',
    setup: () => ({
      token: createExpiredToken(),
      shouldCallNext: false,
      expectedStatus: 401,
    }),
  },
  
  tokenWithDifferentUser: {
    description: 'Token with different user ID',
    setup: () => ({
      token: createTestToken({ userId: 'different-user-456' }),
      shouldCallNext: true,
      expectedStatus: undefined,
    }),
  },
} as const;

// Type helper for test scenarios
type AuthTestScenario = keyof typeof AuthTestScenarios;

export function runAuthTestScenario(
  scenario: AuthTestScenario,
  authMiddleware: (req: any, res: any, next: any) => void
) {
  const { setup } = AuthTestScenarios[scenario];
  const { token, shouldCallNext, expectedStatus } = setup();
  
  const req = mockAuthRequest(token);
  const res = mockAuthResponse();
  const next = mockNextFunction();
  
  // Temporarily set JWT_SECRET for test
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  
  try {
    authMiddleware(req, res, next);
    
    if (shouldCallNext) {
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    } else {
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(expectedStatus);
    }
    
    return { req, res, next };
  } finally {
    // Restore original secret
    if (originalSecret !== undefined) {
      process.env.JWT_SECRET = originalSecret;
    } else {
      delete process.env.JWT_SECRET;
    }
  }
}
