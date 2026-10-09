/**
 * Phase 6 (A2) — POST /memories/search service + PATCH supersedes.
 * Hybrid stack reuse, tenant scoping, asOf pass-through, cursor paging,
 * score on each item, filters applied to the row fetch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../src/memory/validation/pipeline', () => ({ runValidationPipeline: vi.fn() }));
vi.mock('../../../src/services/embedding.service', () => ({
  embedMemory: vi.fn().mockResolvedValue(undefined),
  generateEmbeddingWithRetry: vi.fn().mockResolvedValue([0.1, 0.2]),
  getEmbeddingStatus: vi.fn().mockResolvedValue('ready'),
}));
vi.mock('../../../src/retrieval/structured-filter', () => ({ structuredFilter: vi.fn() }));
vi.mock('../../../src/retrieval/fulltext-search', () => ({ fulltextSearch: vi.fn() }));
vi.mock('../../../src/retrieval/trigram-search', () => ({ trigramSearch: vi.fn() }));
vi.mock('../../../src/retrieval/semantic-search', () => ({ semanticSearch: vi.fn() }));

import { structuredFilter } from '../../../src/retrieval/structured-filter';
import { fulltextSearch } from '../../../src/retrieval/fulltext-search';
import { trigramSearch } from '../../../src/retrieval/trigram-search';
import { semanticSearch } from '../../../src/retrieval/semantic-search';
import { generateEmbeddingWithRetry } from '../../../src/services/embedding.service';
import {
  decodeSearchCursor,
  encodeSearchCursor,
  hybridSearchMemories,
  updateMemory,
} from '../../../src/services/memory.service';
import { HttpError } from '../../../src/middleware/error-handler';

const hit = (id: string, score: number, source: 'structured' | 'fts' | 'trigram' | 'semantic') => ({
  id, type: 'memory' as const, title: id, content: `c-${id}`, relevanceScore: score, source, whyIncluded: '', tags: [], importance: 0.5, lastAccessedAt: null, sourceWeight: 1,
});
const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id, userId: 'user-1', title: id, content: `c-${id}`, domain: 'business', tags: [], status: 'CONFIRMED',
  validAt: new Date('2026-01-01T00:00:00Z'), invalidAt: null, encryptedContent: null, consolidatedFrom: [], ...extra,
});

function mockPrisma(rows: any[]) {
  return {
    memoryEntry: {
      findMany: vi.fn(async () => rows),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(generateEmbeddingWithRetry).mockResolvedValue([0.1, 0.2]);
  vi.mocked(structuredFilter).mockResolvedValue([]);
  vi.mocked(fulltextSearch).mockResolvedValue([]);
  vi.mocked(trigramSearch).mockResolvedValue([]);
  vi.mocked(semanticSearch).mockResolvedValue([]);
});

describe('search cursor', () => {
  it('round-trips an opaque base64 {offset}', () => {
    const c = encodeSearchCursor(40);
    expect(JSON.parse(Buffer.from(c, 'base64').toString('utf-8'))).toEqual({ offset: 40 });
    expect(decodeSearchCursor(c)).toBe(40);
    expect(decodeSearchCursor(null)).toBe(0);
    expect(decodeSearchCursor(undefined)).toBe(0);
  });
  it('rejects garbage / negative / non-integer cursors with HttpError 400', () => {
    for (const bad of ['zzz', Buffer.from('{"offset":-1}').toString('base64'), Buffer.from('{"offset":1.5}').toString('base64'), Buffer.from('[]').toString('base64')]) {
      expect(() => decodeSearchCursor(bad)).toThrow(HttpError);
      try { decodeSearchCursor(bad); } catch (e) { expect((e as HttpError).statusCode).toBe(400); }
    }
  });
});

describe('hybridSearchMemories', () => {
  it('runs all four layers with the agent tenant, forwards asOf/includeArchived, and returns ranked items with a score', async () => {
    vi.mocked(fulltextSearch).mockResolvedValue([hit('m1', 0.9, 'fts')]);
    vi.mocked(semanticSearch).mockResolvedValue([hit('m1', 0.8, 'semantic'), hit('m2', 0.7, 'semantic')]);
    const prisma = mockPrisma([row('m1'), row('m2')]);
    const asOf = new Date('2026-06-01T00:00:00Z');

    const res = await hybridSearchMemories('user-1', { query: 'pricing', asOf, includeArchived: true, domain: 'Business', tags: ['x'] },
      { agentId: 'a', tenantId: 'josh-business', sourceWeight: 1 }, prisma);

    const scope = expect.objectContaining({ tenantId: 'josh-business', includeAllTenants: false, includeArchived: true, asOf, limit: 50 });
    expect(structuredFilter).toHaveBeenCalledWith('user-1', 'pricing', expect.objectContaining({ tenantId: 'josh-business', domain: 'business', tags: ['x'], asOf }), prisma);
    expect(fulltextSearch).toHaveBeenCalledWith('user-1', 'pricing', scope, prisma);
    expect(trigramSearch).toHaveBeenCalledWith('user-1', 'pricing', scope, prisma);
    expect(semanticSearch).toHaveBeenCalledWith('user-1', [0.1, 0.2], scope, prisma);
    expect(generateEmbeddingWithRetry).toHaveBeenCalledWith('pricing', 'business');

    expect(res.items.map(i => i.id)).toEqual(['m1', 'm2']);
    expect(typeof res.items[0].score).toBe('number');
    expect(res.items[0].score).toBeGreaterThan(res.items[1].score);
    expect(res.nextCursor).toBeNull();

    // row fetch re-applies tenant + explicit filters
    expect(prisma.memoryEntry.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1', 'm2'] }, userId: 'user-1', deletedAt: null, tenantId: 'josh-business', domain: 'business', tags: { hasEvery: ['x'] }, status: { not: 'ARCHIVED' } },
    });
  });

  it('BoardRoom caller (no agent context) opts into all tenants, like /context/for-persona', async () => {
    const prisma = mockPrisma([]);
    await hybridSearchMemories('user-1', { query: 'q' }, undefined, prisma);
    expect(fulltextSearch).toHaveBeenCalledWith('user-1', 'q', expect.objectContaining({ tenantId: undefined, includeAllTenants: true }), prisma);
  });

  it('skips the semantic layer when no embedding is available', async () => {
    vi.mocked(generateEmbeddingWithRetry).mockResolvedValue(null as any);
    const prisma = mockPrisma([]);
    const res = await hybridSearchMemories('user-1', { query: 'q' }, undefined, prisma);
    expect(semanticSearch).not.toHaveBeenCalled();
    expect(res).toEqual({ items: [], nextCursor: null });
    expect(prisma.memoryEntry.findMany).not.toHaveBeenCalled();
  });

  it('pages the ranked pool with an opaque cursor and caps limit at 50', async () => {
    const hits = Array.from({ length: 7 }, (_, i) => hit(`m${i}`, 1 - i * 0.1, 'fts'));
    vi.mocked(fulltextSearch).mockResolvedValue(hits);
    const prisma = mockPrisma(hits.map(h => row(h.id)));

    const p1 = await hybridSearchMemories('user-1', { query: 'q', limit: 3 }, undefined, prisma);
    expect(p1.items.map(i => i.id)).toEqual(['m0', 'm1', 'm2']);
    expect(p1.nextCursor).toBe(encodeSearchCursor(3));

    const p2 = await hybridSearchMemories('user-1', { query: 'q', limit: 3, cursor: p1.nextCursor }, undefined, prisma);
    expect(p2.items.map(i => i.id)).toEqual(['m3', 'm4', 'm5']);
    expect(p2.nextCursor).toBe(encodeSearchCursor(6));

    const p3 = await hybridSearchMemories('user-1', { query: 'q', limit: 3, cursor: p2.nextCursor }, undefined, prisma);
    expect(p3.items.map(i => i.id)).toEqual(['m6']);
    expect(p3.nextCursor).toBeNull();

    const big = await hybridSearchMemories('user-1', { query: 'q', limit: 500 }, undefined, prisma);
    expect(big.items).toHaveLength(7);
  });

  it('drops rows the row-fetch filtered out (status/tenant) and rows invalid at asOf', async () => {
    vi.mocked(fulltextSearch).mockResolvedValue([hit('m1', 0.9, 'fts'), hit('m2', 0.8, 'fts'), hit('m3', 0.7, 'fts')]);
    const asOf = new Date('2026-03-01T00:00:00Z');
    const prisma = mockPrisma([
      row('m1'),
      // m2 missing → filtered by SQL (e.g. other status)
      row('m3', { invalidAt: new Date('2026-02-01T00:00:00Z') }), // superseded before asOf
    ]);
    const res = await hybridSearchMemories('user-1', { query: 'q', status: 'CONFIRMED', asOf }, undefined, prisma);
    expect(res.items.map(i => i.id)).toEqual(['m1']);
    expect(prisma.memoryEntry.findMany.mock.calls[0][0].where.status).toBe('CONFIRMED');
  });
});

describe('updateMemory supersedes', () => {
  const existing = { id: 'new1', userId: 'user-1', domain: 'business', content: 'new', encryptedContent: null, consolidatedFrom: [] };

  it('stamps the old row invalidAt/supersededBy and appends it to consolidatedFrom, through the service', async () => {
    const prisma = mockPrisma([]);
    prisma.memoryEntry.findFirst
      .mockResolvedValueOnce(existing)              // ownership of :id
      .mockResolvedValueOnce({ id: 'old1' });        // ownership of supersedes
    prisma.memoryEntry.update.mockResolvedValue({ ...existing, consolidatedFrom: ['old1'] });

    const before = Date.now();
    const result = await updateMemory('user-1', 'new1', { supersedes: 'old1', title: 'T' }, { agentId: 'a', tenantId: 'josh-business', sourceWeight: 1 }, prisma);
    expect(result).toMatchObject({ consolidatedFrom: ['old1'] });

    expect(prisma.memoryEntry.findFirst).toHaveBeenNthCalledWith(2, {
      where: { id: 'old1', userId: 'user-1', deletedAt: null, tenantId: 'josh-business' },
      select: { id: true },
    });
    const [newUpdate, oldUpdate] = prisma.memoryEntry.update.mock.calls;
    expect(newUpdate[0].where).toEqual({ id: 'new1' });
    expect(newUpdate[0].data).toMatchObject({ title: 'T', consolidatedFrom: { push: 'old1' }, version: { increment: 1 } });
    expect(newUpdate[0].data).not.toHaveProperty('supersedes');
    expect(oldUpdate[0].where).toEqual({ id: 'old1' });
    expect(oldUpdate[0].data).toMatchObject({ supersededBy: 'new1', version: { increment: 1 } });
    expect(oldUpdate[0].data.invalidAt.getTime()).toBeGreaterThanOrEqual(before);
    // old content is never touched
    expect(oldUpdate[0].data).not.toHaveProperty('content');
  });

  it('does not re-append an id already in consolidatedFrom', async () => {
    const prisma = mockPrisma([]);
    prisma.memoryEntry.findFirst.mockResolvedValueOnce({ ...existing, consolidatedFrom: ['old1'] }).mockResolvedValueOnce({ id: 'old1' });
    prisma.memoryEntry.update.mockResolvedValue(existing);
    await updateMemory('user-1', 'new1', { supersedes: 'old1' }, prisma);
    expect(prisma.memoryEntry.update.mock.calls[0][0].data).not.toHaveProperty('consolidatedFrom');
  });

  it('404 when the superseded memory is not in scope; 422 on self-supersede', async () => {
    const p1 = mockPrisma([]);
    p1.memoryEntry.findFirst.mockResolvedValueOnce(existing).mockResolvedValueOnce(null);
    await expect(updateMemory('user-1', 'new1', { supersedes: 'ghost' }, p1)).rejects.toMatchObject({ statusCode: 404 });
    expect(p1.memoryEntry.update).not.toHaveBeenCalled();

    const p2 = mockPrisma([]);
    p2.memoryEntry.findFirst.mockResolvedValueOnce(existing);
    await expect(updateMemory('user-1', 'new1', { supersedes: 'new1' }, p2)).rejects.toMatchObject({ statusCode: 422 });
  });
});
