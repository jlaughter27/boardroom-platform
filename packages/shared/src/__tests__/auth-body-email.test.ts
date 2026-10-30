import { describe, it, expect } from 'vitest';
import { RegisterBodySchema, LoginBodySchema } from '../validation/request-body.schema';
import { normalizeEmail } from '../utils/string';

/**
 * Security fix C1 (2026-10-30) — auth bodies carry the canonical
 * `lower(trim(email))`, so BoardRoom never forwards a case/whitespace variant
 * of an address to OmniMind (and the admin allow-list compares like-for-like).
 */
describe('auth body e-mail normalisation (C1)', () => {
  it('normalizeEmail is lower(trim())', () => {
    expect(normalizeEmail('  Founder@Example.TEST ')).toBe('founder@example.test');
  });

  it.each(['ADMIN@l3.test', 'Admin@L3.test', ' admin@l3.test', 'admin@l3.test '])(
    'RegisterBodySchema canonicalises %j',
    (email) => {
      const parsed = RegisterBodySchema.parse({ email, password: 'Passw0rd-l3!', name: 'Case trick' });
      expect(parsed.email).toBe('admin@l3.test');
    },
  );

  it('LoginBodySchema canonicalises too', () => {
    expect(LoginBodySchema.parse({ email: ' Owner@Example.TEST', password: 'x' }).email).toBe('owner@example.test');
  });

  it('still rejects a malformed address', () => {
    expect(RegisterBodySchema.safeParse({ email: 'not an email', password: 'Passw0rd-l3!', name: 'n' }).success).toBe(false);
    expect(LoginBodySchema.safeParse({ email: '   ', password: 'x' }).success).toBe(false);
  });
});
