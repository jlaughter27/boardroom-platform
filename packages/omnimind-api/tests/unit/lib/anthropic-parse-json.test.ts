/**
 * R-O-11 — parseJsonFromText tolerates fences, preambles and trailers; fails
 * with a clear error when no JSON can be recovered.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/lib/db', () => ({ prisma: {} }));
vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../src/services/llm-usage.service', () => ({ recordLlmUsage: vi.fn().mockResolvedValue(null) }));

import { parseJsonFromText } from '../../../src/lib/anthropic';

describe('parseJsonFromText (R-O-11)', () => {
  it('parses bare JSON and ```json fences (any case)', () => {
    expect(parseJsonFromText('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonFromText('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonFromText('```JSON\n[1,2]\n```')).toEqual([1, 2]);
    expect(parseJsonFromText('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('falls back to the outermost object when the model adds a preamble / trailer', () => {
    const text = 'Sure — here is the memo as JSON:\n\n{"summary":"ok","items":[{"k":"v"}]}\n\nLet me know if you need changes.';
    expect(parseJsonFromText(text)).toEqual({ summary: 'ok', items: [{ k: 'v' }] });
  });

  it('falls back to the outermost array too, and prefers whichever bracket opens first', () => {
    expect(parseJsonFromText('Result: [{"a":{"b":1}}] done')).toEqual([{ a: { b: 1 } }]);
    expect(parseJsonFromText('x {"list":[1,2]} y')).toEqual({ list: [1, 2] });
  });

  it('throws a clear error when nothing parseable is present', () => {
    expect(() => parseJsonFromText('I cannot produce that.')).toThrow(/no valid JSON object\/array/);
    expect(() => parseJsonFromText('{"unterminated": ')).toThrow(/no valid JSON object\/array/);
  });
});
