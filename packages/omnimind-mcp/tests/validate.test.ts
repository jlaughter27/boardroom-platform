import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { parseInput } from '../src/lib/validate';
import { McpValidationError } from '../src/types';
import { assertSourceWeight } from '../src/lib/auth';
import { buildFallbackSql } from '../src/keygen';

describe('parseInput (M-109)', () => {
  const S = z.object({ a: z.string().min(1), b: z.number().int().optional() });
  it('returns parsed data', () => {
    expect(parseInput(S, { a: 'x', b: 2 })).toEqual({ a: 'x', b: 2 });
  });
  it('converts ZodError into McpValidationError with path info', () => {
    try {
      parseInput(S, { a: '', b: 1.5 });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(McpValidationError);
      const e = err as McpValidationError;
      expect(e.code).toBe('VALIDATION_ERROR');
      expect(e.issues.map(i => i.path)).toEqual(['a', 'b']);
      expect(e.message).toMatch(/^Invalid tool input: a: /);
    }
  });
});

describe('assertSourceWeight (F-217)', () => {
  it('accepts finite values in [0, 2] (string or number)', () => {
    expect(assertSourceWeight('0.85')).toBe(0.85);
    expect(assertSourceWeight(2)).toBe(2);
    expect(assertSourceWeight(0)).toBe(0);
  });
  it('rejects NaN, Infinity, out-of-range, garbage', () => {
    for (const bad of ['abc', 'NaN', 'Infinity', -1, 2.01, null, undefined, {}]) {
      expect(() => assertSourceWeight(bad)).toThrow(/between 0 and 2/);
    }
  });
});

describe('keygen fallback SQL (F-208)', () => {
  it("targets the `agents` table with a text id and escaped literals", () => {
    const sql = buildFallbackSql({ agent: "o'brien", keyHash: 'h'.repeat(64), tenant: 'josh-business', scopes: ['memory:read', 'task:write'], sourceWeight: 0.7 });
    expect(sql).toMatch(/^INSERT INTO agents \(id, name, api_key_hash, tenant_id, scopes, source_weight, created_at\)/);
    expect(sql).toContain('gen_random_uuid()::text');
    expect(sql).toContain("'o''brien'");
    expect(sql).toContain("ARRAY['memory:read', 'task:write']::text[]");
    expect(sql).toContain('ON CONFLICT (name) DO UPDATE');
    expect(sql).not.toContain('"Agent"');
  });
});
