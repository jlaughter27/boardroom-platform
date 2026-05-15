import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fulltextSearch } from '../../../src/retrieval/fulltext-search';

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

  it('should convert query to tsquery format', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);

    await fulltextSearch('user-1', 'test query', baseOpts, mockPrisma);

    expect(mockPrisma.$queryRaw).toHaveBeenCalledWith(expect.stringContaining('test & query'));
  });

  it('should filter non-alphanumeric characters from query terms', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);

    await fulltextSearch('user-1', 'test-query! with.special@chars', baseOpts, mockPrisma);

    // Should filter to 'testquery & with & special & chars'
    expect(mockPrisma.$queryRaw).toHaveBeenCalledWith(expect.stringContaining('testquery & with & special & chars'));
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
        rank: 0.8,
      },
      {
        id: 'mem-2',
        title: 'Another Memory',
        content: 'More content',
        tags: [],
        importance: 0.5,
        last_accessed_at: null,
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
      relevanceScore: 0.8, // rank capped at 1.0
      source: 'fts',
      whyIncluded: 'Full-text match for "test"',
      tags: ['test'],
      importance: 0.7,
      lastAccessedAt: new Date('2024-01-01'),
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
        rank: 1.5, // Above 1.0
      },
    ];
    
    mockPrisma.$queryRaw.mockResolvedValue(mockResults);

    const result = await fulltextSearch('user-1', 'test', baseOpts, mockPrisma);

    expect(result[0].relevanceScore).toBe(1.0);
  });

  it('should use default limit when not specified', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);

    await fulltextSearch('user-1', 'test', baseOpts, mockPrisma);

    expect(mockPrisma.$queryRaw).toHaveBeenCalledWith(expect.stringContaining('LIMIT 20'));
  });

  it('should use provided limit', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);

    await fulltextSearch('user-1', 'test', { limit: 50, ...baseOpts }, mockPrisma);

    expect(mockPrisma.$queryRaw).toHaveBeenCalledWith(expect.stringContaining('LIMIT 50'));
  });

  it('should return empty array on database error', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('FTS not enabled'));

    const result = await fulltextSearch('user-1', 'test', baseOpts, mockPrisma);

    expect(result).toEqual([]);
  });
});
