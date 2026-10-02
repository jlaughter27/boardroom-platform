import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor, pageOf, MAX_PAGE_SIZE } from '../src/lib/cursor';
import { McpValidationError } from '../src/types';

describe('cursor (Phase 6 pagination)', () => {
  it('round-trips an offset through an opaque base64url string', () => {
    const c = encodeCursor(40);
    expect(c).not.toContain('40');
    expect(decodeCursor(c)).toBe(40);
    expect(decodeCursor(undefined)).toBe(0);
    expect(decodeCursor(null)).toBe(0);
  });

  it('accepts the API encoding (plain base64 of {"offset":n}) too', () => {
    expect(decodeCursor(Buffer.from('{"offset":5}').toString('base64'))).toBe(5);
  });

  it('rejects garbage, negative and non-integer offsets as McpValidationError', () => {
    for (const bad of ['nope', Buffer.from('{"offset":-1}').toString('base64url'), Buffer.from('{"offset":1.5}').toString('base64url'), Buffer.from('[]').toString('base64url')]) {
      expect(() => decodeCursor(bad)).toThrow(McpValidationError);
    }
  });

  it('pageOf trims the sentinel row and mints nextCursor only when more exist', () => {
    const rows = [1, 2, 3];
    expect(pageOf(rows, 0, 2)).toEqual({ items: [1, 2], nextCursor: encodeCursor(2) });
    expect(pageOf(rows, 10, 3)).toEqual({ items: [1, 2, 3], nextCursor: null });
    expect(pageOf([], 0, 5)).toEqual({ items: [], nextCursor: null });
    expect(MAX_PAGE_SIZE).toBe(20);
  });
});
