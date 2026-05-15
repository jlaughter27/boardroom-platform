import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  signLoginState,
  verifyLoginState,
  __resetOAuthNoncesForTest,
} from '../../src/services/oauth-state';

describe('oauth-state (Wave 3 Track E UX-1.2)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, JWT_SECRET: 'test-jwt-secret-for-oauth-state' };
    __resetOAuthNoncesForTest();
  });

  afterEach(() => {
    process.env = originalEnv;
    __resetOAuthNoncesForTest();
  });

  it('signs and verifies a fresh state', () => {
    const s = signLoginState('google-login');
    expect(verifyLoginState(s, 'google-login')).toBe(true);
  });

  it('rejects a replayed nonce (verify consumes it)', () => {
    const s = signLoginState('google-login');
    expect(verifyLoginState(s, 'google-login')).toBe(true);
    // Replay → reject.
    expect(verifyLoginState(s, 'google-login')).toBe(false);
  });

  it('rejects state intended for a different provider', () => {
    const s = signLoginState('google-login');
    expect(verifyLoginState(s, 'github-login')).toBe(false);
  });

  it('rejects malformed state', () => {
    expect(verifyLoginState('not-a-jwt', 'google-login')).toBe(false);
    expect(verifyLoginState(undefined, 'google-login')).toBe(false);
    expect(verifyLoginState('', 'google-login')).toBe(false);
  });

  it('rejects state signed with a different secret', () => {
    const s = signLoginState('google-login');
    process.env.JWT_SECRET = 'a-different-secret';
    // Force the module to read the new secret. signLoginState/verifyLoginState
    // resolve env lazily on each call, so this works.
    expect(verifyLoginState(s, 'google-login')).toBe(false);
  });
});
