import { describe, it, expect, afterAll, afterEach } from 'vitest';
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

describe('crypto hardening (AUDIT-2026-10-02 F-108 / F-109 / O-111)', () => {
  const { randomBytes } = require('crypto') as typeof import('crypto');
  const originalKey = process.env.ENCRYPTION_KEY;
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalKey) process.env.ENCRYPTION_KEY = originalKey; else delete process.env.ENCRYPTION_KEY;
    process.env.NODE_ENV = originalEnv;
  });

  it('F-109: tampered ciphertext THROWS and never returns the ciphertext', async () => {
    const { encrypt, decrypt, CryptoError } = await import('../../src/lib/crypto');
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
    const enc = encrypt('secret');
    const [iv, tag, ct] = enc.split(':');
    const flipped = (parseInt(ct.slice(0, 2), 16) ^ 0xff).toString(16).padStart(2, '0');
    const tampered = `${iv}:${tag}:${flipped}${ct.slice(2)}`;
    expect(() => decrypt(tampered)).toThrow(CryptoError);
    try { decrypt(tampered); } catch (e) { expect((e as any).code).toBe('CRYPTO_DECRYPT_FAILED'); }
  });

  it('F-109: wrong key THROWS', async () => {
    const { encrypt, decrypt } = await import('../../src/lib/crypto');
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
    const enc = encrypt('secret');
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
    expect(() => decrypt(enc)).toThrow();
  });

  it('F-108: validateEncryptionKey rejects a key that is not 64 hex chars', async () => {
    const { validateEncryptionKey } = await import('../../src/lib/crypto');
    process.env.ENCRYPTION_KEY = 'dev-encryption-key-32-characters-minimum-here';
    expect(() => validateEncryptionKey()).toThrow(/64 hex/);
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
    expect(() => validateEncryptionKey()).not.toThrow();
  });

  it('F-108: in production a missing key is fatal and there is no plaintext passthrough', async () => {
    const { validateEncryptionKey, encrypt, decrypt } = await import('../../src/lib/crypto');
    delete process.env.ENCRYPTION_KEY;
    process.env.NODE_ENV = 'production';
    expect(() => validateEncryptionKey()).toThrow(/required in production/);
    expect(() => encrypt('x')).toThrow();
    expect(() => decrypt('x')).toThrow();
  });

  it('O-111: encryptMemoryContent encrypts ministry rows and decryptMemory restores them', async () => {
    const { encryptMemoryContent, decryptMemory, ENCRYPTED_CONTENT_PLACEHOLDER } = await import('../../src/lib/memory-crypto');
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
    expect(encryptMemoryContent('business', 'hello')).toBeNull();
    const enc = encryptMemoryContent(' Ministry ', 'pastoral note')!;
    expect(enc.content).toBe(ENCRYPTED_CONTENT_PLACEHOLDER);
    expect(enc.encryptionAlgorithm).toBe('aes-256-gcm');
    expect(enc.encryptionKeyId).toMatch(/^sha256:/);
    expect(Buffer.from(enc.encryptedContent).toString('utf-8')).not.toContain('pastoral');
    const row = { id: 'm1', domain: 'ministry', content: enc.content, encryptedContent: enc.encryptedContent };
    expect(decryptMemory(row).content).toBe('pastoral note');
  });

  it('O-111 / F-109: decryptMemory throws when the row is encrypted but no key is configured', async () => {
    const { encryptMemoryContent, decryptMemory, tryDecryptMemory } = await import('../../src/lib/memory-crypto');
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
    const enc = encryptMemoryContent('ministry', 'x')!;
    delete process.env.ENCRYPTION_KEY;
    const row = { id: 'm1', domain: 'ministry', content: enc.content, encryptedContent: enc.encryptedContent };
    expect(() => decryptMemory(row)).toThrow();
    expect(tryDecryptMemory(row)).toBeNull();
  });
});
