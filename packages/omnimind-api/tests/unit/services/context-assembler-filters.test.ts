import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../src/lib/db', () => ({ prisma: {} }));
vi.mock('../../../src/services/embedding.service', () => ({ generateEmbeddingWithRetry: vi.fn().mockResolvedValue([0.1, 0.2]) }));

import { assembleContextForPersona, normalizeMemoryClass } from '../../../src/services/context-assembler.service';

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
