import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Prisma } from '@prisma/client';
import { temporalValiditySql, temporalValidityWhere, parseAsOf } from '../../../src/retrieval/temporal-validity';
import { fulltextSearch } from '../../../src/retrieval/fulltext-search';
import { trigramSearch } from '../../../src/retrieval/trigram-search';
import { semanticSearch } from '../../../src/retrieval/semantic-search';
import { structuredFilter } from '../../../src/retrieval/structured-filter';

vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

/**
 * Find the nested Prisma.Sql fragment(s) among a $queryRaw call's bound values.
 * Duck-typed (`sql` string + `values` array): the generated client does not
 * expose the Sql class as a runtime constructor for `instanceof`.
 */
function sqlFragments(call: unknown[]): Prisma.Sql[] {
  return call.slice(1).filter((v): v is Prisma.Sql =>
    !!v && typeof v === 'object' && typeof (v as Prisma.Sql).sql === 'string' && Array.isArray((v as Prisma.Sql).values));
}

describe('temporal validity (Phase 6)', () => {
  const asOf = new Date('2026-06-01T00:00:00Z');

  describe('temporalValiditySql', () => {
    it('without asOf → (invalid_at IS NULL OR invalid_at > NOW()) with no bound values', () => {
      const frag = temporalValiditySql();
      expect(frag.sql.replace(/\s+/g, ' ')).toBe('(invalid_at IS NULL OR invalid_at > NOW())');
      expect(frag.values).toEqual([]);
    });

    it('with asOf → valid_at <= $1 AND (invalid_at IS NULL OR invalid_at > $2), asOf bound twice', () => {
      const frag = temporalValiditySql(asOf);
      expect(frag.sql.replace(/\s+/g, ' ')).toBe('(valid_at <= ? AND (invalid_at IS NULL OR invalid_at > ?))');
      expect(frag.values).toEqual([asOf, asOf]);
    });
  });

  describe('temporalValidityWhere (Prisma where for the structured layer)', () => {
    it('defaults to invalidAt null OR > now', () => {
      const now = new Date('2026-06-02T00:00:00Z');
      expect(temporalValidityWhere(undefined, now)).toEqual({ OR: [{ invalidAt: null }, { invalidAt: { gt: now } }] });
    });
    it('with asOf adds validAt <= asOf', () => {
      expect(temporalValidityWhere(asOf)).toEqual({ validAt: { lte: asOf }, OR: [{ invalidAt: null }, { invalidAt: { gt: asOf } }] });
    });
  });

  describe('parseAsOf', () => {
    it('accepts ISO strings and Dates, rejects garbage', () => {
      expect(parseAsOf('2026-06-01T00:00:00Z')?.toISOString()).toBe('2026-06-01T00:00:00.000Z');
      expect(parseAsOf(asOf)).toBe(asOf);
      expect(parseAsOf('not a date')).toBeUndefined();
      expect(parseAsOf(undefined)).toBeUndefined();
    });
  });

  describe('all four layers apply the filter', () => {
    const mockPrisma = { $queryRaw: vi.fn(), memoryEntry: { findMany: vi.fn() } } as any;
    const opts = { includeAllTenants: true } as const;

    beforeEach(() => {
      vi.clearAllMocks();
      mockPrisma.$queryRaw.mockResolvedValue([]);
      mockPrisma.memoryEntry.findMany.mockResolvedValue([]);
    });

    it.each([
      ['fts', (o: any) => fulltextSearch('u1', 'hello world', o, mockPrisma)],
      ['trigram', (o: any) => trigramSearch('u1', 'hello world', o, mockPrisma)],
      ['semantic', (o: any) => semanticSearch('u1', [0.1, 0.2], o, mockPrisma)],
    ])('%s: default filter is invalid_at IS NULL OR invalid_at > NOW()', async (_name, run) => {
      await run(opts);
      const frags = sqlFragments(mockPrisma.$queryRaw.mock.calls[0]).filter(f => f.sql.includes('invalid_at'));
      expect(frags).toHaveLength(1);
      expect(frags[0].sql).toContain('invalid_at IS NULL OR invalid_at > NOW()');
      expect(frags[0].values).toEqual([]);
    });

    it.each([
      ['fts', (o: any) => fulltextSearch('u1', 'hello world', o, mockPrisma)],
      ['trigram', (o: any) => trigramSearch('u1', 'hello world', o, mockPrisma)],
      ['semantic', (o: any) => semanticSearch('u1', [0.1, 0.2], o, mockPrisma)],
    ])('%s: asOf filters valid_at <= asOf AND (invalid_at IS NULL OR invalid_at > asOf)', async (_name, run) => {
      await run({ ...opts, asOf });
      const frags = sqlFragments(mockPrisma.$queryRaw.mock.calls[0]).filter(f => f.sql.includes('invalid_at'));
      expect(frags).toHaveLength(1);
      expect(frags[0].sql).toContain('valid_at <= ?');
      expect(frags[0].sql).toContain('invalid_at > ?');
      expect(frags[0].values).toEqual([asOf, asOf]);
    });

    it('fts: tenant-scoped branch also carries the filter', async () => {
      await fulltextSearch('u1', 'hello', { tenantId: 't1', asOf }, mockPrisma);
      const call = mockPrisma.$queryRaw.mock.calls[0];
      expect(call.slice(1)).toContain('t1');
      expect(sqlFragments(call).find(f => f.sql.includes('invalid_at'))!.values).toEqual([asOf, asOf]);
    });

    it('structured: default where has AND[{OR:[invalidAt null, invalidAt > now]}]', async () => {
      await structuredFilter('u1', 'hello', opts, mockPrisma);
      const where = mockPrisma.memoryEntry.findMany.mock.calls[0][0].where;
      const validity = where.AND.find((c: any) => Array.isArray(c.OR) && c.OR.some((x: any) => 'invalidAt' in x));
      expect(validity).toBeDefined();
      expect(validity.OR[0]).toEqual({ invalidAt: null });
      expect(validity.OR[1].invalidAt.gt).toBeInstanceOf(Date);
      expect(validity.validAt).toBeUndefined();
    });

    it('structured: asOf adds validAt <= asOf and keeps the forgetting-curve + content clauses', async () => {
      await structuredFilter('u1', 'hello', { ...opts, asOf }, mockPrisma);
      const where = mockPrisma.memoryEntry.findMany.mock.calls[0][0].where;
      expect(where.AND).toHaveLength(3); // forgetting-curve OR, content OR, validity
      expect(where.AND[2]).toEqual({ validAt: { lte: asOf }, OR: [{ invalidAt: null }, { invalidAt: { gt: asOf } }] });
    });
  });
});
