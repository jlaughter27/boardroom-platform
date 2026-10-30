/**
 * Fix lane H (2026-10-30) — legacy ministry rows never reach a non-ministry
 * caller on the memory read paths, and the budget buckets ministry spellings
 * under one `ministry` row.
 *
 * Legacy rows stored before the write gate was hardened can carry any ministry
 * spelling (`Ministry `, `ministry/pastoral`, lookalikes) or sit in the
 * ministry tenant. Canonical forms are filtered in SQL, every other spelling
 * after the query (same approach as lane F's /admin/memories).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../src/lib/db', () => ({ prisma: {} }));
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
import { getMemoryBudget, hybridSearchMemories, searchMemories } from '../../../src/services/memory.service';
import { assembleContextForPersona } from '../../../src/services/context-assembler.service';
import { getKnowledgeGraph, getBacklinks } from '../../../src/services/knowledge-graph.service';
import { isHiddenMinistryRow, ministryExclusionWhere } from '../../../src/lib/ministry-read';

const USER = 'user-synthetic-1';
const MINISTRY_SQL = { NOT: { domain: { startsWith: 'ministry', mode: 'insensitive' } } };
const MINISTRY_TENANT_SQL = { NOT: { tenantId: 'tgfc-ministry' } };

const hit = (id: string, score: number) => ({
  id, type: 'memory' as const, title: id, content: `c-${id}`, relevanceScore: score, source: 'fts' as const,
  whyIncluded: '', tags: [], importance: 0.5, lastAccessedAt: null, sourceWeight: 1,
});
const row = (id: string, domain = 'business', tenantId = 'synthetic-business') => ({
  id, userId: USER, title: `Title ${id}`, content: `Content ${id}`, domain, tenantId, tags: [], status: 'CONFIRMED',
  validAt: new Date('2026-01-01T00:00:00Z'), invalidAt: null, encryptedContent: null, consolidatedFrom: [],
  importance: 0.5, memoryClass: 'SEMANTIC', createdAt: new Date('2026-01-01T00:00:00Z'),
});

// Legacy rows: keep-* are visible, drop-* are ministry in some form.
const LEGACY = [
  row('keep-1'),
  row('drop-1', 'Ministry '),
  row('drop-2', 'ministry/pastoral'),
  row('drop-3', '  MINISTRY '),
  row('drop-4', 'mіnistry'), // Cyrillic і
  row('drop-5', 'general', 'tgfc-ministry'),
  row('keep-2', 'administration'),
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(structuredFilter).mockResolvedValue([]);
  vi.mocked(fulltextSearch).mockResolvedValue([]);
  vi.mocked(trigramSearch).mockResolvedValue([]);
  vi.mocked(semanticSearch).mockResolvedValue([]);
});

describe('ministry-read helpers', () => {
  it('hides every ministry spelling and the ministry tenant from a non-ministry caller', () => {
    for (const r of LEGACY) expect(isHiddenMinistryRow(r)).toBe(r.id.startsWith('drop'));
    expect(isHiddenMinistryRow(row('x', 'minister'))).toBe(false);
  });
  it('a caller in the ministry tenant still never sees a ministry-domain row, but sees its own tenant', () => {
    expect(isHiddenMinistryRow(row('x', 'general', 'tgfc-ministry'), 'tgfc-ministry')).toBe(false);
    expect(isHiddenMinistryRow(row('x', 'ministry', 'tgfc-ministry'), 'tgfc-ministry')).toBe(true);
    expect(ministryExclusionWhere('tgfc-ministry')).toEqual([MINISTRY_SQL]);
    expect(ministryExclusionWhere(undefined)).toEqual([MINISTRY_SQL, MINISTRY_TENANT_SQL]);
  });
});

describe('POST /memories/search (hybridSearchMemories) — MCP memory_search', () => {
  it('never returns a legacy ministry spelling or a ministry-tenant row; canonical forms filtered in SQL', async () => {
    vi.mocked(fulltextSearch).mockResolvedValue(LEGACY.map((r, i) => hit(r.id, 0.9 - i * 0.01)));
    const prisma = { memoryEntry: { findMany: vi.fn(async () => LEGACY) } } as any;

    const res = await hybridSearchMemories(USER, { query: 'retreat' }, undefined, prisma);
    expect(res.items.map((i: any) => i.id)).toEqual(['keep-1', 'keep-2']);
    expect(JSON.stringify(res)).not.toMatch(/Content drop/);
    const where = prisma.memoryEntry.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(expect.arrayContaining([MINISTRY_SQL, MINISTRY_TENANT_SQL]));
  });

  it('an agent in a business tenant gets the same exclusion', async () => {
    vi.mocked(fulltextSearch).mockResolvedValue([hit('keep-1', 0.9), hit('drop-2', 0.8)]);
    const prisma = { memoryEntry: { findMany: vi.fn(async () => [row('keep-1'), row('drop-2', 'ministry/pastoral')]) } } as any;
    const ctx = { agentId: 'agent-x', tenantId: 'synthetic-business', sourceWeight: 1 } as any;
    const res = await hybridSearchMemories(USER, { query: 'q' }, ctx, prisma);
    expect(res.items.map((i: any) => i.id)).toEqual(['keep-1']);
  });

  it('an explicit ministry domain filter answers no items without querying', async () => {
    const prisma = { memoryEntry: { findMany: vi.fn(async () => LEGACY) } } as any;
    const res = await hybridSearchMemories(USER, { query: 'q', domain: 'Ministry' }, undefined, prisma);
    expect(res).toEqual({ items: [], nextCursor: null });
    expect(fulltextSearch).not.toHaveBeenCalled();
  });
});

describe('GET /memories (searchMemories)', () => {
  it('excludes ministry rows (SQL + post-filter), reduces total, and orders with an id tie-breaker', async () => {
    const prisma = { memoryEntry: { findMany: vi.fn(async () => LEGACY), count: vi.fn(async () => LEGACY.length) } } as any;
    const res = await searchMemories(USER, { limit: 20 }, prisma);
    expect(res.items.map((m: any) => m.id)).toEqual(['keep-1', 'keep-2']);
    expect(res.total).toBe(2);
    const args = prisma.memoryEntry.findMany.mock.calls[0][0];
    expect(args.where.AND).toEqual(expect.arrayContaining([MINISTRY_SQL, MINISTRY_TENANT_SQL]));
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(prisma.memoryEntry.count.mock.calls[0][0].where.AND).toEqual(args.where.AND);
  });

  it('keeps a caller-chosen sort and still adds the id tie-breaker', async () => {
    const prisma = { memoryEntry: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) } } as any;
    await searchMemories(USER, { sortBy: 'importance', sortOrder: 'asc' }, prisma);
    expect(prisma.memoryEntry.findMany.mock.calls[0][0].orderBy).toEqual([{ importance: 'asc' }, { id: 'desc' }]);
  });

  it.each([['domain', 'ministry/pastoral'], ['tenantId', 'tgfc-ministry']])(
    'an explicit ministry %s filter answers an empty page without querying', async (key, value) => {
      const prisma = { memoryEntry: { findMany: vi.fn(async () => LEGACY), count: vi.fn(async () => 7) } } as any;
      const res = await searchMemories(USER, { [key]: value }, prisma);
      expect(res).toMatchObject({ items: [], total: 0 });
      expect(prisma.memoryEntry.findMany).not.toHaveBeenCalled();
    });
});

describe('GET /memories/budget (getMemoryBudget)', () => {
  it('buckets by normalizeDomain and folds every ministry spelling into one `ministry` row', async () => {
    const prisma = {
      memoryEntry: {
        groupBy: vi.fn(async () => [
          { domain: 'Ministry', _count: { _all: 2 } },
          { domain: '  MINISTRY ', _count: { _all: 3 } },
          { domain: 'ministry/pastoral', _count: { _all: 4 } },
          { domain: 'Business', _count: { _all: 5 } },
          { domain: 'business', _count: { _all: 1 } },
          { domain: ' Research ', _count: { _all: 2 } },
        ]),
      },
    } as any;
    const report = await getMemoryBudget(USER, null, prisma);
    const byDomain = Object.fromEntries(report.domains.map((d) => [d.domain, d.count]));
    expect(byDomain.ministry).toBe(9);
    expect(byDomain.business).toBe(6);
    expect(byDomain.research).toBe(2);
    const names = report.domains.map((d) => d.domain);
    expect(names.filter((n) => n === 'ministry')).toHaveLength(1);
    expect(names).not.toContain('Ministry');
    expect(names).not.toContain('  MINISTRY ');
    expect(names).not.toContain('ministry/pastoral');
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('POST /context/for-persona (assembleContextForPersona)', () => {
  it('drops ranked memories that are ministry in any spelling or tenant before packaging', async () => {
    vi.mocked(fulltextSearch).mockResolvedValue(LEGACY.map((r, i) => hit(r.id, 0.9 - i * 0.01)));
    const prisma = {
      memoryEntry: {
        findMany: vi.fn(async () => LEGACY.map(({ id, domain, tenantId }) => ({ id, domain, tenantId }))),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      $executeRaw: vi.fn().mockResolvedValue(0),
      contextCapsule: { findMany: vi.fn().mockResolvedValue([]) },
    } as any;

    const pkg = await assembleContextForPersona(USER, 'retreat', 'optimist', prisma, {
      includeEntities: ['memories'], includeAllTenants: true,
    });
    expect(pkg.items.map((i) => i.id).sort()).toEqual(['keep-1', 'keep-2']);
    const check = prisma.memoryEntry.findMany.mock.calls.find((c: any[]) => c[0]?.where?.id?.in);
    expect(check[0].where.AND).toEqual(expect.arrayContaining([MINISTRY_SQL, MINISTRY_TENANT_SQL]));
  });
});

describe('GET /graph (getKnowledgeGraph) + backlinks', () => {
  const d = new Date('2026-10-01T00:00:00Z');
  const table = (rows: unknown[] = [], count?: number) => ({ findMany: vi.fn(async () => rows), count: vi.fn(async () => count ?? rows.length), findFirst: vi.fn(async () => rows[0] ?? null) });
  const memRows = LEGACY.map((r) => ({ id: r.id, title: r.title, domain: r.domain, tenantId: r.tenantId, importance: 0.5, status: 'CONFIRMED', memoryClass: 'SEMANTIC', createdAt: d }));
  const prismaWith = (memories: unknown[], count?: number) => ({
    goal: table(), project: table(), task: table(), person: table(), decision: table(), commitment: table(),
    memoryEntry: table(memories, count),
    goalProjectLink: table(), projectTaskLink: table(), projectPersonLink: table(), decisionProjectLink: table(),
    taskDependency: table(), memoryEntityLink: table(), commitmentLink: table(),
  }) as any;

  it('memory nodes exclude every ministry spelling and the ministry tenant; memoryTotal is reduced', async () => {
    const prisma = prismaWith(memRows, memRows.length);
    const g = await getKnowledgeGraph(USER, {}, prisma);
    const memIds = g.nodes.filter((n) => n.type === 'memory').map((n) => n.refId).sort();
    expect(memIds).toEqual(['keep-1', 'keep-2']);
    expect(JSON.stringify(g)).not.toMatch(/Title drop/);
    expect(g.stats.memoryTotal).toBe(2);
    const where = prisma.memoryEntry.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(expect.arrayContaining([MINISTRY_SQL, MINISTRY_TENANT_SQL]));
  });

  it('backlinks of a ministry memory node → null (404)', async () => {
    const prisma = prismaWith([memRows[2]]); // ministry/pastoral
    const res = await getBacklinks(USER, 'memory:drop-2', {}, prisma);
    expect(res).toBeNull();
  });
});
