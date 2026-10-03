import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../src/lib/db', () => ({ prisma: {} }));
vi.mock('../../../src/services/embedding.service', () => ({ generateEmbeddingWithRetry: vi.fn().mockResolvedValue([0.1, 0.2]) }));

import { assembleContextForPersona, normalizeMemoryClass, MIN_RANKED_ITEMS, CAPSULE_SUMMARY_MAX_CHARS } from '../../../src/services/context-assembler.service';
import { personaLimits } from '../../../src/retrieval/context-packager';
import { estimateTokens } from '@boardroom/shared';

const isSqlFragment = (v: unknown): v is { sql: string; values: unknown[] } =>
  !!v && typeof v === 'object' && typeof (v as any).sql === 'string' && Array.isArray((v as any).values);

describe('assembleContextForPersona — includeArchived + memoryClass (Phase 6, lane B)', () => {
  const mockPrisma = {
    $queryRaw: vi.fn(),
    memoryEntry: { findMany: vi.fn(), updateMany: vi.fn() },
    contextCapsule: { findMany: vi.fn() },
  } as any;
  const base = { includeEntities: ['memories'], includeAllTenants: true };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.memoryEntry.findMany.mockResolvedValue([]);
  });

  it('normalises memoryClass and ignores unknown values', () => {
    expect(normalizeMemoryClass('decision')).toBe('DECISION');
    expect(normalizeMemoryClass(' Semantic ')).toBe('SEMANTIC');
    expect(normalizeMemoryClass('bogus')).toBeUndefined();
    expect(normalizeMemoryClass(undefined)).toBeUndefined();
  });

  it("Critic: includeArchived:true + memoryClass:'DECISION' reach all four layers", async () => {
    await assembleContextForPersona('u1', 'hiring risk', 'critic', mockPrisma, { ...base, includeArchived: true, memoryClass: 'DECISION' });

    // structured layer: memory_class predicate + no forgetting-curve OR clause
    const where = mockPrisma.memoryEntry.findMany.mock.calls[0][0].where;
    expect(where.memoryClass).toBe('DECISION');
    const hasCurve = (where.AND ?? []).some((c: any) => Array.isArray(c.OR) && c.OR.some((x: any) => 'importance' in x));
    expect(hasCurve).toBe(false);

    // fts / trigram / semantic: a `memory_class::text = ?` fragment bound to DECISION
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(3);
    for (const call of mockPrisma.$queryRaw.mock.calls) {
      const frag = call.slice(1).filter(isSqlFragment).find((f: any) => f.sql.includes('memory_class::text = ?'));
      expect(frag?.values).toEqual(['DECISION']);
    }
    // fts: includeArchived branch has no cutoff Date bound (trigram/semantic bind the boolean)
    const ftsCall = mockPrisma.$queryRaw.mock.calls.find((c: any[]) => c.slice(1).includes('hiring & risk'))!;
    expect(ftsCall.slice(1).some((v: unknown) => v instanceof Date)).toBe(false);
    const others = mockPrisma.$queryRaw.mock.calls.filter((c: any[]) => c !== ftsCall);
    for (const c of others) expect(c.slice(1)).toContain(true);
  });

  it('defaults: forgetting curve on, no memory_class predicate (TRUE placeholder)', async () => {
    await assembleContextForPersona('u1', 'hiring risk', 'optimist', mockPrisma, base);
    const where = mockPrisma.memoryEntry.findMany.mock.calls[0][0].where;
    expect(where.memoryClass).toBeUndefined();
    expect((where.AND ?? []).some((c: any) => Array.isArray(c.OR) && c.OR.some((x: any) => 'importance' in x))).toBe(true);
    for (const call of mockPrisma.$queryRaw.mock.calls) {
      const frags = call.slice(1).filter(isSqlFragment);
      expect(frags.some((f: any) => f.sql === 'TRUE')).toBe(true);
      expect(frags.some((f: any) => f.sql.includes('memory_class'))).toBe(false);
    }
  });

  it('unknown memoryClass is dropped rather than failing the call', async () => {
    const pkg = await assembleContextForPersona('u1', 'hiring risk', 'critic', mockPrisma, { ...base, memoryClass: 'nope' });
    expect(pkg.items).toEqual([]);
    expect(mockPrisma.memoryEntry.findMany.mock.calls[0][0].where.memoryClass).toBeUndefined();
  });
});

describe('assembleContextForPersona — prepended items respect maxItems + token budget (R-O-06)', () => {
  const now = new Date('2026-10-02T00:00:00Z');
  const capsule = (id: string, long = false) => ({
    entityType: 'project', entityId: id, version: 1, staleAfter: new Date(now.getTime() + 86_400_000),
    summary: long ? 'S'.repeat(5000) : `Summary for ${id}`,
    openRisks: long ? Array.from({ length: 10 }, (_, i) => `risk ${i} ${'r'.repeat(400)}`) : ['r1'],
    unresolvedQuestions: long ? Array.from({ length: 10 }, (_, i) => `q ${i}`) : [],
    recentChanges: long ? Array.from({ length: 10 }, (_, i) => `change ${i}`) : [],
    activeStakeholders: ['Dana'],
  });
  const projectRows = Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, title: `Rollout ${i}`, status: 'active', deadline: null }));
  // 20 ranked memory candidates, each ~40 tokens
  const memoryRows = Array.from({ length: 20 }, (_, i) => ({
    id: `m${i}`, type: 'memory', content: `memory ${i} ${'x'.repeat(150)}`, title: `m${i}`, relevanceScore: 0.9 - i * 0.01, source: 'structured', whyIncluded: 'test',
  }));

  const mk = (caps: unknown[]) => ({
    $queryRaw: vi.fn().mockResolvedValue([]),
    memoryEntry: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    project: { findMany: vi.fn().mockResolvedValue(projectRows) },
    contextCapsule: { findMany: vi.fn().mockResolvedValue(caps) },
  }) as any;

  beforeEach(() => vi.clearAllMocks());

  it('with 3 capsules the total item count ≤ persona maxItems and tokenEstimate ≤ persona budget', async () => {
    const prisma = mk([capsule('p0'), capsule('p1'), capsule('p2')]);
    // the structured layer (memoryEntry.findMany) returns many memories so the ranked list would otherwise fill maxItems
    prisma.memoryEntry.findMany.mockResolvedValue(memoryRows.map(m => ({
      id: m.id, title: m.title, content: m.content, domain: 'business', tags: [], importance: 0.8, sourceWeight: 1, lastAccessedAt: null, createdAt: now, encryptedContent: null,
    })));

    const pkg = await assembleContextForPersona('u1', 'rollout', 'critic', prisma, { includeEntities: ['memories', 'projects'], includeAllTenants: true });
    const limits = personaLimits('critic');
    const capsules = pkg.items.filter(i => i.whyIncluded.startsWith('Reflection capsule'));
    expect(capsules).toHaveLength(3);
    expect(pkg.items.length).toBeLessThanOrEqual(limits.maxItems);
    expect(pkg.tokenEstimate).toBeLessThanOrEqual(limits.tokenBudget);
    // the ranked list still got at least MIN_RANKED_ITEMS slots
    expect(pkg.items.length - capsules.length).toBeGreaterThanOrEqual(MIN_RANKED_ITEMS);
    // tokenEstimate is the real sum over every item (prepended included)
    expect(pkg.tokenEstimate).toBe(pkg.items.reduce((s, i) => s + estimateTokens(i.content), 0));
  });

  it('capsule text is truncated (summary ≤600 chars, ≤3 entries per list) so oversized capsules stay inside the budget', async () => {
    const prisma = mk([capsule('p0', true), capsule('p1', true), capsule('p2', true)]);
    const pkg = await assembleContextForPersona('u1', 'rollout', 'critic', prisma, { includeEntities: ['memories', 'projects'], includeAllTenants: true });
    const limits = personaLimits('critic');
    expect(pkg.tokenEstimate).toBeLessThanOrEqual(limits.tokenBudget);
    const capsules = pkg.items.filter(i => i.whyIncluded.startsWith('Reflection capsule'));
    expect(capsules.length).toBeGreaterThan(0);
    for (const c of capsules) {
      const summaryLine = c.content.split('\n')[0];
      expect(summaryLine.length).toBeLessThanOrEqual(CAPSULE_SUMMARY_MAX_CHARS + 'Capsule (project) — '.length + 1);
      expect((c.content.match(/risk \d+/g) ?? []).length).toBeLessThanOrEqual(3);
      expect((c.content.match(/change \d+/g) ?? []).length).toBeLessThanOrEqual(3);
    }
  });

  it('a caller maxItems below the persona default is honoured as an upper cap', async () => {
    const prisma = mk([capsule('p0')]);
    prisma.memoryEntry.findMany.mockResolvedValue(memoryRows.slice(0, 10).map(m => ({
      id: m.id, title: m.title, content: m.content, domain: 'business', tags: [], importance: 0.8, sourceWeight: 1, lastAccessedAt: null, createdAt: now, encryptedContent: null,
    })));
    const pkg = await assembleContextForPersona('u1', 'rollout', 'optimist', prisma, { includeEntities: ['memories', 'projects'], includeAllTenants: true, maxItems: 5 });
    expect(pkg.items.length).toBeLessThanOrEqual(5);
  });
});
