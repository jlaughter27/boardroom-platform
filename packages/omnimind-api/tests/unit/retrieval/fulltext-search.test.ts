import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fulltextSearch } from '../../../src/retrieval/fulltext-search';

/**
 * NOTE: WS-6 F-107 — fulltext-search now uses Prisma's tagged-template form for
 * `$queryRaw` instead of a `(sql as any)` string call. The tagged form is called
 * as `$queryRaw(stringsArray, ...values)`. These tests assert on the JOINED
 * template (i.e. all `strings` concatenated with placeholders elided) so we can
 * still check the SQL shape (LIMIT clauses, tsquery glue) without coupling to
 * Prisma's internal parameter encoding.
 *
 * The previous implementation built a plain string and (silently) threw at
 * runtime → returned [] for every call. The mock-based unit tests passed
 * because they only asserted on the string shape, not on actual data flow.
 * That gap is now also covered by `tests/e2e/E2E-7-scope-bypass-attempts.test.ts`
 * (real DB, real query) — see WS-6.3.
 */

function joinedSql(call: any[]): string {
  // The first arg to $queryRaw is a TemplateStringsArray. Join it so existing
  // string-shape assertions still work.
  const strings = call[0];
  if (Array.isArray(strings)) {
    return strings.join('?');
  }
  return String(strings);
}

describe('fulltextSearch', () => {
  const mockPrisma = {
    $queryRaw: vi.fn(),
  } as any;

  // Post-WS-1: retrieval layers default to tenant-scoped. These legacy unit
  // tests don't care about tenant isolation — they assert SQL shape only —
  // so they opt into all-tenants explicitly to keep their scope.
  const baseOpts = { includeAllTenants: true } as const;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty array for empty query', async () => {
    const result = await fulltextSearch('user-1', '', baseOpts, mockPrisma);
    expect(result).toEqual([]);
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('should return empty array for query with only whitespace', async () => {
    const result = await fulltextSearch('user-1', '   ', baseOpts, mockPrisma);
    expect(result).toEqual([]);
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('should pass tokenized query as a bound parameter (not interpolated into SQL)', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);

    await fulltextSearch('user-1', 'test query', baseOpts, mockPrisma);

    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    // Tokens flow through as a bound parameter, not interpolated. Check the
    // values array contains the AND-joined tsquery.
    const call = mockPrisma.$queryRaw.mock.calls[0];
    const values = call.slice(1);
    expect(values).toContain('test & query');
  });

  it('should filter non-alphanumeric characters from query terms', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);

    await fulltextSearch('user-1', 'test-query! with.special@chars', baseOpts, mockPrisma);

    const call = mockPrisma.$queryRaw.mock.calls[0];
    const values = call.slice(1);
    expect(values).toContain('testquery & with & special & chars');
  });

  it('should return formatted results', async () => {
    const mockResults = [
      {
        id: 'mem-1',
        title: 'Test Memory',
        content: 'Test content',
        tags: ['test'],
        importance: 0.7,
        last_accessed_at: new Date('2024-01-01'),
        source_weight: 1.0,
        rank: 0.8,
      },
      {
        id: 'mem-2',
        title: 'Another Memory',
        content: 'More content',
        tags: [],
        importance: 0.5,
        last_accessed_at: null,
        source_weight: 0.7,
        rank: 0.6,
      },
    ];

    mockPrisma.$queryRaw.mockResolvedValue(mockResults);

    const result = await fulltextSearch('user-1', 'test', { limit: 10, ...baseOpts }, mockPrisma);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 'mem-1',
      type: 'memory',
      content: 'Test content',
      title: 'Test Memory',
      relevanceScore: 0.8,
      source: 'fts',
      whyIncluded: 'Full-text match for "test"',
      tags: ['test'],
      importance: 0.7,
      lastAccessedAt: new Date('2024-01-01'),
      sourceWeight: 1.0,
    });
    expect(result[1].relevanceScore).toBe(0.6);
  });

  it('should cap relevance score at 1.0', async () => {
    const mockResults = [
      {
        id: 'mem-1',
        title: 'Test',
        content: 'Test',
        tags: [],
        importance: 0.5,
        last_accessed_at: null,
        source_weight: 1.0,
        rank: 1.5, // Above 1.0
      },
    ];

    mockPrisma.$queryRaw.mockResolvedValue(mockResults);

    const result = await fulltextSearch('user-1', 'test', baseOpts, mockPrisma);

    expect(result[0].relevanceScore).toBe(1.0);
  });

  it('should default to LIMIT 20 when not specified', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);

    await fulltextSearch('user-1', 'test', baseOpts, mockPrisma);

    const sql = joinedSql(mockPrisma.$queryRaw.mock.calls[0]);
    expect(sql).toContain('LIMIT');
    // Limit is bound as a parameter — check the values list contains the integer.
    const values = mockPrisma.$queryRaw.mock.calls[0].slice(1);
    expect(values).toContain(20);
  });

  it('should use provided limit', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);

    await fulltextSearch('user-1', 'test', { limit: 50, ...baseOpts }, mockPrisma);

    const values = mockPrisma.$queryRaw.mock.calls[0].slice(1);
    expect(values).toContain(50);
  });

  it('should return empty array on database error', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('FTS not enabled'));

    const result = await fulltextSearch('user-1', 'test', baseOpts, mockPrisma);

    expect(result).toEqual([]);
  });
});
