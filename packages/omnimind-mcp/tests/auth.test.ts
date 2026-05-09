import { describe, it, expect } from 'vitest';
import { hashApiKey, verifyApiKey } from '../src/lib/auth';

describe('hashApiKey', () => {
  it('returns a 64-char hex string', () => {
    const hash = hashApiKey('omk_abc123');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic', () => {
    expect(hashApiKey('test-key')).toBe(hashApiKey('test-key'));
  });

  it('differs for different inputs', () => {
    expect(hashApiKey('key-a')).not.toBe(hashApiKey('key-b'));
  });
});

describe('verifyApiKey', () => {
  it('returns true for matching key', () => {
    const key = 'omk_test_key_12345';
    const hash = hashApiKey(key);
    expect(verifyApiKey(key, hash)).toBe(true);
  });

  it('returns false for wrong key', () => {
    const hash = hashApiKey('correct-key');
    expect(verifyApiKey('wrong-key', hash)).toBe(false);
  });

  it('returns false for wrong-length hash', () => {
    expect(verifyApiKey('key', 'short')).toBe(false);
  });
});
