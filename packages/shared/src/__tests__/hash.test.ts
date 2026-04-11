import { describe, it, expect, vi } from 'vitest';
import { 
  sha256, 
  deterministicHash, 
  hashPassword, 
  verifyPassword,
  generateRandomToken,
  generateHmac,
  verifyHmac
} from '../utils/hash';

// Mock bcryptjs
vi.mock('bcryptjs', () => ({
  hash: vi.fn().mockResolvedValue('hashed_password'),
  compare: vi.fn().mockResolvedValue(true),
}));

describe('hash utilities', () => {
  describe('sha256', () => {
    it('produces a 64-character hex string', () => {
      const hash = sha256('test content');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces the same hash for the same input', () => {
      const input = 'hello world';
      expect(sha256(input)).toBe(sha256(input));
    });

    it('produces different hashes for different inputs', () => {
      expect(sha256('hello')).not.toBe(sha256('world'));
    });
  });

  describe('deterministicHash', () => {
    it('creates hash from string', () => {
      const hash = deterministicHash('test string');
      expect(hash).toHaveLength(64);
    });

    it('creates hash from object', () => {
      const obj = { userId: 123, type: 'profile' };
      const hash = deterministicHash(obj);
      expect(hash).toHaveLength(64);
    });

    it('produces same hash for same object', () => {
      const obj = { userId: 123, type: 'profile' };
      const hash1 = deterministicHash(obj);
      const hash2 = deterministicHash(obj);
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different objects', () => {
      const obj1 = { userId: 123 };
      const obj2 = { userId: 456 };
      expect(deterministicHash(obj1)).not.toBe(deterministicHash(obj2));
    });
  });

  describe('hashPassword', () => {
    it('returns a hashed password', async () => {
      const hashed = await hashPassword('password123');
      expect(hashed).toBe('hashed_password');
    });

    it('accepts custom salt rounds', async () => {
      await hashPassword('password123', 12);
      // The mock will be called, test passes if no error
    });
  });

  describe('verifyPassword', () => {
    it('verifies a password against a hash', async () => {
      const isValid = await verifyPassword('password123', 'hashed_password');
      expect(isValid).toBe(true);
    });
  });

  describe('generateRandomToken', () => {
    it('generates a token of specified length', () => {
      const token = generateRandomToken(16);
      expect(token).toHaveLength(32); // 16 bytes = 32 hex characters
    });

    it('generates a token with default length', () => {
      const token = generateRandomToken();
      expect(token).toHaveLength(64); // 32 bytes = 64 hex characters
    });
  });

  describe('generateHmac and verifyHmac', () => {
    const secret = 'my-secret-key';
    const data = 'sensitive data';

    it('generates an HMAC', () => {
      const hmac = generateHmac(data, secret);
      expect(hmac).toHaveLength(64);
      expect(hmac).toMatch(/^[0-9a-f]{64}$/);
    });

    it('verifies a valid HMAC', () => {
      const hmac = generateHmac(data, secret);
      const isValid = verifyHmac(data, secret, hmac);
      expect(isValid).toBe(true);
    });

    it('rejects an invalid HMAC', () => {
      const hmac = generateHmac(data, secret);
      const isValid = verifyHmac('different data', secret, hmac);
      expect(isValid).toBe(false);
    });

    it('rejects HMAC with wrong secret', () => {
      const hmac = generateHmac(data, secret);
      const isValid = verifyHmac(data, 'wrong-secret', hmac);
      expect(isValid).toBe(false);
    });
  });
});