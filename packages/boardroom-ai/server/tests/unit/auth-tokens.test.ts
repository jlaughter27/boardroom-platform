import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  signResetToken,
  signVerifyToken,
  verifyKindToken,
} from '../../src/services/auth-tokens.service';

describe('auth-tokens (Wave 3 Track E UX-1.3 / UX-1.4)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, JWT_SECRET: 'test-secret-auth-tokens' };
    vi.useRealTimers();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.useRealTimers();
  });

  it('signs a pwreset token verifiable as pwreset', () => {
    const t = signResetToken('user-1');
    expect(verifyKindToken(t, 'pwreset')).toBe('user-1');
  });

  it('rejects a pwreset token used as verifyemail (kind cross-use)', () => {
    const t = signResetToken('user-1');
    expect(verifyKindToken(t, 'verifyemail')).toBeNull();
  });

  it('signs a verifyemail token verifiable as verifyemail', () => {
    const t = signVerifyToken('user-1');
    expect(verifyKindToken(t, 'verifyemail')).toBe('user-1');
  });

  it('rejects expired pwreset token (forge an expired one)', () => {
    const expired = jwt.sign({ userId: 'user-1', kind: 'pwreset' }, 'test-secret-auth-tokens', { expiresIn: -1 });
    expect(verifyKindToken(expired, 'pwreset')).toBeNull();
  });

  it('rejects malformed / empty input', () => {
    expect(verifyKindToken(undefined, 'pwreset')).toBeNull();
    expect(verifyKindToken('', 'pwreset')).toBeNull();
    expect(verifyKindToken('not.a.jwt', 'pwreset')).toBeNull();
  });

  it('rejects pwreset token signed with a different secret', () => {
    const wrong = jwt.sign({ userId: 'user-1', kind: 'pwreset' }, 'wrong-secret');
    expect(verifyKindToken(wrong, 'pwreset')).toBeNull();
  });

  it('uses PASSWORD_RESET_TOKEN_SECRET when set', () => {
    process.env.PASSWORD_RESET_TOKEN_SECRET = 'dedicated-secret';
    const t = signResetToken('user-1');
    // Verify with the dedicated secret directly.
    const decoded = jwt.verify(t, 'dedicated-secret') as { userId: string; kind: string };
    expect(decoded.userId).toBe('user-1');
    expect(decoded.kind).toBe('pwreset');
  });
});
