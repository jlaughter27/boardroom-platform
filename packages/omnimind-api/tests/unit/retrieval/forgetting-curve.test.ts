import { describe, it, expect, vi, beforeEach } from 'vitest';
import { semanticSearch } from '../../../src/retrieval/semantic-search';
import { fulltextSearch } from '../../../src/retrieval/fulltext-search';
import { trigramSearch } from '../../../src/retrieval/trigram-search';
import { structuredFilter } from '../../../src/retrieval/structured-filter';
import { forgettingCurveSQL } from '../../../src/retrieval/forgetting-curve';

vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { logger } from '../../../src/lib/logger';

const joined = (call: any[]) => (call[0] as string[]).join('?').replace(/\s+/g, ' ');

describe('forgetting curve uses COALESCE(last_accessed_at, created_at) in all four layers (O-103)', () => {
  const prisma = { $queryRaw: vi.fn(), memoryEntry: { findMany: vi.fn() } } as any;
  const opts = { tenantId: 'josh-business' };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.memoryEntry.findMany.mockResolvedValue([]);
  });

  it('semantic', async () => {
    await semanticSearch('u', [0.1, 0.2], opts, prisma);
    expect(joined(prisma.$queryRaw.mock.calls[0])).toContain('COALESCE(last_accessed_at, created_at) >= ?');
    expect(joined(prisma.$queryRaw.mock.calls[0])).toContain('encrypted_content');
  });

  it('fts', async () => {
    await fulltextSearch('u', 'hello world', opts, prisma);
    expect(joined(prisma.$queryRaw.mock.calls[0])).toContain('COALESCE(last_accessed_at, created_at) >= ?');
  });

  it('trigram', async () => {
    await trigramSearch('u', 'hello', opts, prisma);
    expect(joined(prisma.$queryRaw.mock.calls[0])).toContain('COALESCE(last_accessed_at, created_at) >= ?');
  });

  it('structured (Prisma where: never-accessed rows fall back to createdAt)', async () => {
    await structuredFilter('u', '', opts, prisma);
    const where = prisma.memoryEntry.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { importance: { gte: 0.4 } },
      { lastAccessedAt: { gte: expect.any(Date) } },
      { lastAccessedAt: null, createdAt: { gte: expect.any(Date) } },
    ]);
  });

  it('raw SQL helper', () => {
    expect(forgettingCurveSQL(false)).toContain('COALESCE(last_accessed_at, created_at)');
    expect(forgettingCurveSQL(true)).toBe('TRUE');
  });
});

describe('F-204: retrieval layers log and report errors instead of silently returning []', () => {
  const failing = { $queryRaw: vi.fn().mockRejectedValue(new Error('pgvector missing')) } as any;

  it.each([
    ['semantic', () => semanticSearch('u', [0.1], { tenantId: 't', onLayerError: hook }, failing)],
    ['fts', () => fulltextSearch('u', 'q', { tenantId: 't', onLayerError: hook }, failing)],
    ['trigram', () => trigramSearch('u', 'q', { tenantId: 't', onLayerError: hook }, failing)],
  ] as const)('%s', async (layer, run) => {
    hook.mockClear();
    vi.mocked(logger.error).mockClear();
    const out = await run();
    expect(out).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(`[${layer}]`), expect.objectContaining({ error: 'pgvector missing' }));
    expect(hook).toHaveBeenCalledWith(layer, expect.any(Error));
  });
});
const hook = vi.fn();
