import { describe, it, expect, afterAll } from 'vitest';
import { encrypt, decrypt } from '../../src/lib/crypto';

describe('crypto', () => {
  const originalKey = process.env.ENCRYPTION_KEY;

  afterAll(() => {
    if (originalKey) process.env.ENCRYPTION_KEY = originalKey;
    else delete process.env.ENCRYPTION_KEY;
  });

  it('passes through in dev mode (no ENCRYPTION_KEY)', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(encrypt('hello')).toBe('hello');
    expect(decrypt('hello')).toBe('hello');
  });

  it('encrypts and decrypts roundtrip', () => {
    process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('hex');
    const plaintext = 'ya29.super-secret-google-token';
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted).toContain(':'); // iv:tag:ciphertext format
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it('handles pre-encryption plaintext gracefully', () => {
    process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('hex');
    expect(decrypt('plain-old-token')).toBe('plain-old-token');
  });
});
