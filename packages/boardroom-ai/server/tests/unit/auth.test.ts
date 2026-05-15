import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  authMiddleware,
  createToken,
  verifyToken,
  hashPassword,
  verifyPassword,
  __resetJwtSecretForTest,
  type AuthPayload,
} from '../../src/middleware/auth';
import type { Response } from 'express';

// authMiddleware now makes an async OmniMind call to validate password-changed-at.
// Stub it out so tests don't need a running OmniMind server.
vi.mock('../../src/services/omnimind-client', () => ({
  omnimindClient: {
    getPasswordChangedAt: vi.fn().mockResolvedValue({ passwordChangedAt: null }),
  },
}));

describe('auth', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, JWT_SECRET: 'test-jwt-secret' };
    __resetJwtSecretForTest();
  });

  afterEach(() => {
    process.env = originalEnv;
    __resetJwtSecretForTest();
  });

  describe('authMiddleware()', () => {
    it('allows request with valid token cookie', async () => {
      const authPayload: AuthPayload = { userId: 'user-123', email: 'test@test.com', teamId: 'team-123' };
      const token = createToken(authPayload);

      const mockReq = {
        cookies: { boardroom_token: token },
      };

      const mockRes: Partial<Response> = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };

      const next = vi.fn();

      authMiddleware(mockReq as any, mockRes as Response, next);
      // Flush the promise chain: loadPasswordChangedAt → getPasswordChangedAt → .then
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(next).toHaveBeenCalled();
      // JWT decoding adds iat/exp, so match subset of fields rather than deep-equal.
      expect((mockReq as any).auth).toMatchObject(authPayload);
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('returns 401 when no token cookie', () => {
      const mockReq = {
        cookies: {},
      };
      
      const mockRes: Partial<Response> = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      
      const next = vi.fn();

      authMiddleware(mockReq as any, mockRes as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'unauthorized',
        message: 'Authentication required',
      });
    });

    it('returns 401 when token is invalid', () => {
      const mockReq = {
        cookies: { boardroom_token: 'invalid-token' },
      };
      
      const mockRes: Partial<Response> = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      
      const next = vi.fn();

      authMiddleware(mockReq as any, mockRes as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'unauthorized',
        message: 'Invalid or expired token',
      });
    });

    it('returns 401 when token is expired', () => {
      // Create a token that expires immediately
      process.env.JWT_SECRET = 'test-secret';
      const jwt = require('jsonwebtoken');
      const expiredToken = jwt.sign(
        { userId: 'user-123', email: 'test@test.com', teamId: 'team-123' },
        'test-secret',
        { expiresIn: '-1s' } // Expired 1 second ago
      );
      
      const mockReq = {
        cookies: { boardroom_token: expiredToken },
      };
      
      const mockRes: Partial<Response> = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      
      const next = vi.fn();

      authMiddleware(mockReq as any, mockRes as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'unauthorized',
        message: 'Invalid or expired token',
      });
    });

    it('throws error when JWT_SECRET is not set', () => {
      process.env.JWT_SECRET = '';
      __resetJwtSecretForTest();

      expect(() => createToken({ userId: 'user-123', email: 'test@test.com', teamId: 'team-123' }))
        .toThrow('FATAL: JWT_SECRET environment variable is not set. Server cannot start.');
    });
  });

  describe('createToken() and verifyToken()', () => {
    it('creates and verifies token successfully', () => {
      const payload: AuthPayload = { userId: 'user-123', email: 'test@test.com', teamId: 'team-123' };
      const token = createToken(payload);

      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);

      const decoded = verifyToken(token);
      // JWT decoding adds iat/exp, so match the original payload as a subset.
      expect(decoded).toMatchObject(payload);
    });

    it('returns null for invalid token', () => {
      const result = verifyToken('invalid-token');
      expect(result).toBeNull();
    });

    it('returns null for malformed token', () => {
      const result = verifyToken('not.a.jwt.token');
      expect(result).toBeNull();
    });
  });

  describe('hashPassword() and verifyPassword()', () => {
    it('hashes password and verifies correctly', async () => {
      const password = 'my-secret-password';
      const hash = await hashPassword(password);
      
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
      expect(hash).not.toBe(password);
      
      const isValid = await verifyPassword(password, hash);
      expect(isValid).toBe(true);
    });

    it('returns false for wrong password', async () => {
      const password = 'my-secret-password';
      const hash = await hashPassword(password);
      
      const isValid = await verifyPassword('wrong-password', hash);
      expect(isValid).toBe(false);
    });

    it('returns false for different hash', async () => {
      const password = 'my-secret-password';
      const hash = await hashPassword(password);
      const differentHash = await hashPassword('different-password');
      
      const isValid = await verifyPassword(password, differentHash);
      expect(isValid).toBe(false);
    });
  });
});
