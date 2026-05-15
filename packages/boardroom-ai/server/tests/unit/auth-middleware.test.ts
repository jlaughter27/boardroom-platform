import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { authMiddleware, AuthRequest, verifyToken, createToken, hashPassword, verifyPassword } from '../../src/middleware/auth';
import jwt from 'jsonwebtoken';

// authMiddleware now makes an async OmniMind call to validate password-changed-at.
// Stub it out so tests don't need a running OmniMind server and can run synchronously.
vi.mock('../../src/services/omnimind-client', () => ({
  omnimindClient: {
    getPasswordChangedAt: vi.fn().mockResolvedValue({ passwordChangedAt: null }),
  },
}));

export const TEST_JWT_SECRET = 'test-jwt-secret-for-unit-tests-only';
export const TEST_USER_ID = 'test-user-123';
export const TEST_EMAIL = 'test@example.com';
export const TEST_TEAM_ID = 'test-team-123';

export function createTestToken(payload?: any): string {
  const basePayload = {
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

export function createExpiredToken(payload?: any): string {
  const basePayload = {
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

export function mockAuthRequest(token?: string, authPayload?: any): any {
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

describe('authMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set test JWT secret
    process.env.JWT_SECRET = TEST_JWT_SECRET;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.JWT_SECRET;
  });

  describe('authentication scenarios', () => {
    it('should call next() with valid JWT token', async () => {
      const token = createTestToken();
      const req = mockAuthRequest(token);
      const res = mockAuthResponse();
      const next = mockNextFunction();

      authMiddleware(req, res, next);
      // Flush the promise chain: loadPasswordChangedAt → getPasswordChangedAt → .then
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(req.auth).toMatchObject({
        userId: TEST_USER_ID,
        email: TEST_EMAIL,
        teamId: TEST_TEAM_ID,
      });
    });

    it('should return 401 when token is missing', () => {
      const req = mockAuthRequest();
      const res = mockAuthResponse();
      const next = mockNextFunction();
      
      authMiddleware(req, res, next);
      
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'unauthorized',
        message: 'Authentication required',
      });
    });

    it('should return 401 when token is invalid', () => {
      const req = mockAuthRequest(createInvalidToken());
      const res = mockAuthResponse();
      const next = mockNextFunction();
      
      authMiddleware(req, res, next);
      
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'unauthorized',
        message: 'Invalid or expired token',
      });
    });

    it('should return 401 when token is expired', () => {
      const req = mockAuthRequest(createExpiredToken());
      const res = mockAuthResponse();
      const next = mockNextFunction();
      
      authMiddleware(req, res, next);
      
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'unauthorized',
        message: 'Invalid or expired token',
      });
    });

    it('should set auth payload with different user ID', async () => {
      const differentUserId = 'different-user-456';
      const token = createTestToken({ userId: differentUserId });

      const req = mockAuthRequest(token);
      const res = mockAuthResponse();
      const next = mockNextFunction();

      authMiddleware(req, res, next);
      // Flush the promise chain: loadPasswordChangedAt → getPasswordChangedAt → .then
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(next).toHaveBeenCalled();
      expect(req.auth?.userId).toBe(differentUserId);
      expect(req.auth?.email).toBe(TEST_EMAIL);
      expect(req.auth?.teamId).toBe(TEST_TEAM_ID);
    });
  });

  describe('edge cases', () => {
    it('should handle cookies object being undefined', () => {
      const req = { cookies: undefined } as any;
      const res = mockAuthResponse();
      const next = mockNextFunction();
      
      authMiddleware(req, res, next);
      
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should handle empty cookies object', () => {
      const req = { cookies: {} } as any;
      const res = mockAuthResponse();
      const next = mockNextFunction();
      
      authMiddleware(req, res, next);
      
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('token utilities', () => {
    beforeEach(() => {
      process.env.JWT_SECRET = TEST_JWT_SECRET;
    });

    afterEach(() => {
      delete process.env.JWT_SECRET;
    });

    describe('verifyToken', () => {
      it('should return payload for valid token', () => {
        const token = createTestToken();
        const payload = verifyToken(token);
        
        expect(payload).toMatchObject({
          userId: TEST_USER_ID,
          email: TEST_EMAIL,
          teamId: TEST_TEAM_ID,
        });
      });

      it('should return null for invalid token', () => {
        const payload = verifyToken('invalid.token.string');
        expect(payload).toBeNull();
      });

      it('should return null for expired token', () => {
        const token = createExpiredToken();
        const payload = verifyToken(token);
        expect(payload).toBeNull();
      });
    });

    describe('createToken', () => {
      it('should create a valid JWT token', () => {
        const payload = {
          userId: TEST_USER_ID,
          email: TEST_EMAIL,
          teamId: TEST_TEAM_ID,
        };
        
        const token = createToken(payload);
        expect(typeof token).toBe('string');
        expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
        
        // Verify the token can be decoded
        const decoded = verifyToken(token);
        expect(decoded).toMatchObject(payload);
      });
    });
  });

  describe('password utilities', () => {
    describe('hashPassword', () => {
      it('should hash a password', async () => {
        const password = 'test-password-123';
        const hash = await hashPassword(password);
        
        expect(typeof hash).toBe('string');
        expect(hash).not.toBe(password);
        expect(hash.length).toBeGreaterThan(10);
      });

      it('should produce different hashes for same password', async () => {
        const password = 'test-password';
        const hash1 = await hashPassword(password);
        const hash2 = await hashPassword(password);
        
        expect(hash1).not.toBe(hash2);
      });
    });

    describe('verifyPassword', () => {
      it('should return true for matching password and hash', async () => {
        const password = 'test-password-123';
        const hash = await hashPassword(password);
        const isValid = await verifyPassword(password, hash);
        
        expect(isValid).toBe(true);
      });

      it('should return false for incorrect password', async () => {
        const password = 'test-password-123';
        const wrongPassword = 'wrong-password';
        const hash = await hashPassword(password);
        const isValid = await verifyPassword(wrongPassword, hash);
        
        expect(isValid).toBe(false);
      });

      it('should return false for invalid hash', async () => {
        const password = 'test-password';
        const invalidHash = 'invalid-hash-string';
        const isValid = await verifyPassword(password, invalidHash);
        
        expect(isValid).toBe(false);
      });
    });
  });
});
