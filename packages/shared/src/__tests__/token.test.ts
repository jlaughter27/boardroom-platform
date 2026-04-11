import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  generateJwt,
  verifyJwt,
  decodeJwt,
  generateShortCode,
  generateApiToken,
  generateBearerToken,
  extractTokenFromHeader,
  generateRefreshToken,
  generatePasswordResetToken,
  generateEmailVerificationToken,
  isTokenExpired,
  getTokenExpirationTime
} from '../utils/token';

// Mock jsonwebtoken
vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn().mockReturnValue('mock.jwt.token'),
    verify: vi.fn().mockReturnValue({ userId: '123', exp: 1735675200 }),
    decode: vi.fn().mockReturnValue({ userId: '123', exp: 1735675200 }),
  }
}));

describe('token utilities', () => {
  const secret = 'test-secret-key';
  const userId = 'user-123';
  const email = 'test@example.com';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateJwt', () => {
    it('generates a JWT with payload and expiration', () => {
      const payload = { userId, email };
      const token = generateJwt(payload, secret, '7d');
      
      expect(jwt.sign).toHaveBeenCalledWith(payload, secret, { expiresIn: '7d' });
      expect(token).toBe('mock.jwt.token');
    });
  });

  describe('verifyJwt', () => {
    it('verifies and decodes a JWT', () => {
      const token = 'mock.jwt.token';
      const payload = verifyJwt(token, secret);
      
      expect(jwt.verify).toHaveBeenCalledWith(token, secret);
      expect(payload).toEqual({ userId: '123', exp: 1735675200 });
    });

    it('throws error for invalid token', () => {
      (jwt.verify as any).mockImplementationOnce(() => {
        throw new Error('Invalid token');
      });

      expect(() => verifyJwt('invalid.token', secret)).toThrow('Invalid token');
    });
  });
});