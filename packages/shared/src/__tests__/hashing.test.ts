import { describe, it, expect } from 'vitest';
import { sha256Hash } from '../utils/hashing';

describe('sha256Hash', () => {
  it('produces the same hash for the same input', () => {
    const input = 'hello world';
    expect(sha256Hash(input)).toBe(sha256Hash(input));
  });

  it('produces different hashes for different inputs', () => {
    expect(sha256Hash('hello')).not.toBe(sha256Hash('world'));
  });

  it('returns a 64-character hex string', () => {
    const hash = sha256Hash('test content');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
