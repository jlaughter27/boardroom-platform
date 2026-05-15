/**
 * D9 — Cross-Tenant Isolation Audit Test
 *
 * Verifies that retrieval & service-layer paths filter by tenantId. Writing
 * a memory as tenant A and reading it as tenant B must return zero results.
 *
 * Covers:
 *   - searchMemories: tenant-scoped via service signature
 *   - structuredFilter / semanticSearch / fulltextSearch / trigramSearch:
 *     defaults to "no tenant => no results" (safer than silent leakage)
 *   - includeAllTenants admin flag still works
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../packages/omnimind-api/src/services/embedding.service', () => ({
  embedMemory: vi.fn().mockResolvedValue(undefined),
  generateEmbeddingWithRetry: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../packages/omnimind-api/src/lib/crypto', () => ({
  encrypt: vi.fn((s: string) => s),
  decrypt: vi.fn((s: string) => s),
}));

import { searchMemories } from '../../packages/omnimind-api/src/services/memory.service';
import { semanticSearch } from '../../packages/omnimind-api/src/retrieval/semantic-search';
import { structuredFilter } from '../../packages/omnimind-api/src/retrieval/structured-filter';
import { trigramSearch } from '../../packages/omnimind-api/src/retrieval/trigram-search';
import { fulltextSearch } from '../../packages/omnimind-api/src/retrieval/fulltext-search';
import type { AgentContext } from '../../packages/omnimind-api/src/middleware/agent-context';

function makeMockPrisma() {
  return {
    memoryEntry: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
  } as any;
}

const tenantBContext: AgentContext = {
  agentId: 'agent-b',
  tenantId: 'josh-personal',
  sourceWeight: 1.0,
};

describe('D9 — Cross-tenant isolation', () => {
  it('searchMemories applies tenantId filter from agentContext', async () => {
    const prisma = makeMockPrisma();

    await searchMemories('user-1', { q: 'hermes' }, tenantBContext, prisma);

    expect(prisma.memoryEntry.findMany).toHaveBeenCalledTimes(1);
    const whereArg = prisma.memoryEntry.findMany.mock.calls[0][0].where;
    expect(whereArg.tenantId).toBe('josh-personal');
  });

  it('searchMemories with includeAllTenants=true skips the tenant filter', async () => {
    const prisma = makeMockPrisma();

    await searchMemories(
      'user-1',
      { q: 'hermes', includeAllTenants: true },
      tenantBContext,
      prisma
    );

    const whereArg = prisma.memoryEntry.findMany.mock.calls[0][0].where;
    expect(whereArg.tenantId).toBeUndefined();
  });

  it('searchMemories with explicit filters.tenantId overrides context tenant', async () => {
    const prisma = makeMockPrisma();

    await searchMemories(
      'user-1',
      { q: 'hermes', tenantId: 'josh-business' },
      tenantBContext, // context says josh-personal
      prisma
    );

    const whereArg = prisma.memoryEntry.findMany.mock.calls[0][0].where;
    expect(whereArg.tenantId).toBe('josh-business'); // explicit filter wins
  });

  it('semanticSearch returns empty when no tenantId and no includeAllTenants (safe default)', async () => {
    const prisma = makeMockPrisma();
    const embedding = new Array(1536).fill(0.01);

    const results = await semanticSearch('user-1', embedding, {}, prisma);

    expect(results).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('semanticSearch with tenantId scopes the SQL query', async () => {
    const prisma = makeMockPrisma();
    const embedding = new Array(1536).fill(0.01);

    await semanticSearch(
      'user-1',
      embedding,
      { tenantId: 'josh-personal' },
      prisma
    );

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    // Inspect the tagged-template string parts: tenant_id clause must be present.
    const tplParts = prisma.$queryRaw.mock.calls[0][0] as string[] | { raw: string[] };
    const sql = Array.isArray(tplParts)
      ? tplParts.join('?')
      : (tplParts as { raw: string[] }).raw.join('?');
    expect(sql).toMatch(/tenant_id/i);
  });

  it('structuredFilter returns empty when no tenantId and no includeAllTenants', async () => {
    const prisma = makeMockPrisma();

    const results = await structuredFilter('user-1', 'anything', {}, prisma);

    expect(results).toEqual([]);
    expect(prisma.memoryEntry.findMany).not.toHaveBeenCalled();
  });

  it('structuredFilter with tenantId scopes the Prisma query', async () => {
    const prisma = makeMockPrisma();

    await structuredFilter(
      'user-1',
      'anything',
      { tenantId: 'josh-personal' },
      prisma
    );

    expect(prisma.memoryEntry.findMany).toHaveBeenCalledTimes(1);
    const whereArg = prisma.memoryEntry.findMany.mock.calls[0][0].where;
    expect(whereArg.tenantId).toBe('josh-personal');
  });

  it('trigramSearch returns empty when no tenantId and no includeAllTenants', async () => {
    const prisma = makeMockPrisma();

    const results = await trigramSearch('user-1', 'fuzzy', {}, prisma);

    expect(results).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('fulltextSearch returns empty when no tenantId and no includeAllTenants', async () => {
    const prisma = makeMockPrisma();

    const results = await fulltextSearch('user-1', 'keyword', {}, prisma);

    expect(results).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('fulltextSearch with tenantId embeds tenant_id into the SQL string', async () => {
    const prisma = makeMockPrisma();

    await fulltextSearch(
      'user-1',
      'keyword',
      { tenantId: 'josh-personal' },
      prisma
    );

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    // fulltextSearch passes raw SQL string (legacy spy-friendly form).
    const sql = String(prisma.$queryRaw.mock.calls[0][0]);
    expect(sql).toMatch(/tenant_id\s*=\s*'josh-personal'/i);
  });

  it('end-to-end: write as tenant A, read as tenant B yields zero results', async () => {
    // Simulate the DB layer respecting the tenant filter. The service layer
    // passes tenantId='josh-personal' (tenant B) → findMany sees that filter
    // and returns [] (because no rows match).
    const prisma = makeMockPrisma();
    prisma.memoryEntry.findMany.mockResolvedValue([]);
    prisma.memoryEntry.count.mockResolvedValue(0);

    const result = await searchMemories(
      'user-1',
      { q: 'hermes-written-as-tenant-A' },
      tenantBContext, // searching as tenant B
      prisma
    );

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);

    // The filter was indeed scoped to tenant B
    const whereArg = prisma.memoryEntry.findMany.mock.calls[0][0].where;
    expect(whereArg.tenantId).toBe('josh-personal');
  });
});
