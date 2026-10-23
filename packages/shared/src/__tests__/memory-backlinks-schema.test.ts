import { describe, it, expect } from 'vitest';
import { MemoryBacklinksResponseSchema, MEMORY_BACKLINKS_MAX_ROWS } from '../validation/graph.schema';
import type { MemoryBacklinksResponse } from '../types/graph.types';

describe('MemoryBacklinksResponseSchema (GET /memories/:id/backlinks, RD-1)', () => {
  const ok: MemoryBacklinksResponse = {
    items: [{ memoryId: 'm2', title: 'Pricing notes', domain: 'business', status: 'CONFIRMED', linkTypes: ['wikilink'] }],
    truncated: false,
  };

  it('accepts a well-formed response and an empty one', () => {
    expect(MemoryBacklinksResponseSchema.parse(ok)).toEqual(ok);
    expect(MemoryBacklinksResponseSchema.parse({ items: [], truncated: false })).toEqual({ items: [], truncated: false });
  });

  it('accepts a null domain', () => {
    const r = { ...ok, items: [{ ...ok.items[0], domain: null }] };
    expect(MemoryBacklinksResponseSchema.safeParse(r).success).toBe(true);
  });

  it('rejects an item without link types, an empty id, or a missing truncated flag', () => {
    expect(MemoryBacklinksResponseSchema.safeParse({ ...ok, items: [{ ...ok.items[0], linkTypes: [] }] }).success).toBe(false);
    expect(MemoryBacklinksResponseSchema.safeParse({ ...ok, items: [{ ...ok.items[0], memoryId: '' }] }).success).toBe(false);
    expect(MemoryBacklinksResponseSchema.safeParse({ items: [] }).success).toBe(false);
  });

  it('caps the read at 500 rows', () => {
    expect(MEMORY_BACKLINKS_MAX_ROWS).toBe(500);
  });
});
