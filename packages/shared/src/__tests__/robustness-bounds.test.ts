import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import {
  ListMemoriesQuerySchema,
  ListCommitmentsQuerySchema,
  CreateCommitmentRequestSchema,
  UpdateCommitmentRequestSchema,
  CreatePersonRequestSchema,
  UpdatePersonRequestSchema,
  CreateGoalRequestSchema,
  boundedDate,
  MIN_INPUT_DATE,
  MAX_INPUT_DATE,
} from '../index';
import type { ListMemoriesQuery, ListCommitmentsQuery } from '../index';
import { CommitmentStatus, MemoryStatus } from '../index';

// Compile-time: each list-query schema's output is exactly its companion interface.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const memoriesQueryMatches: Same<z.infer<typeof ListMemoriesQuerySchema>, ListMemoriesQuery> = true;
const commitmentsQueryMatches: Same<z.infer<typeof ListCommitmentsQuerySchema>, ListCommitmentsQuery> = true;

describe('robustness bounds (2026-10-30)', () => {
  it('schemas match their companion interfaces', () => {
    expect(memoriesQueryMatches && commitmentsQueryMatches).toBe(true);
  });

  describe('ListMemoriesQuerySchema', () => {
    it('accepts the client + MCP shapes and treats empty values as absent', () => {
      const r = ListMemoriesQuerySchema.parse({
        q: 'pricing', status: 'CONFIRMED', memoryClass: 'DECISION', sortBy: 'createdAt', sortOrder: 'desc',
        limit: '20', offset: '0', since: '2026-10-01T00:00:00.000Z', tags: '', includeInvalidated: 'TRUE',
      });
      expect(r).toMatchObject({ q: 'pricing', status: MemoryStatus.CONFIRMED, limit: 20, offset: 0, includeInvalidated: true, includeAllTenants: false });
      expect(r.tags).toBeUndefined();
    });

    it.each([
      ['status=ACTIVE', { status: 'ACTIVE' }],
      ['memoryClass=FOO', { memoryClass: 'FOO' }],
      ['sortBy=password', { sortBy: 'password' }],
      ['sortBy=__proto__', { sortBy: '__proto__' }],
      ['sortOrder=sideways', { sortOrder: 'sideways' }],
      ['limit=abc', { limit: 'abc' }],
      ['limit=-1', { limit: '-1' }],
      ['limit=1.5', { limit: '1.5' }],
      ['offset=-1', { offset: '-1' }],
      ['offset=1e400', { offset: '9'.repeat(400) }],
      ['since=garbage', { since: 'garbage' }],
      ['since=-010000-01-01', { since: '-010000-01-01' }],
      ['tenantId[]', { tenantId: ['a', 'b'] }],
      ['q repeated', { q: ['a', 'b'] }],
      ['domain[]', { domain: ['x'] }],
      ['includeInvalidated[]', { includeInvalidated: ['true'] }],
      ['nested object', { q: { a: 'b' } }],
    ])('rejects %s', (_label, query) => {
      expect(ListMemoriesQuerySchema.safeParse(query).success).toBe(false);
    });
  });

  describe('ListCommitmentsQuerySchema', () => {
    it('accepts valid filters', () => {
      expect(ListCommitmentsQuerySchema.parse({ status: 'OPEN', owedBy: 'STAKEHOLDER', overdue: 'true', limit: '5', offset: '10' }))
        .toEqual({ status: CommitmentStatus.OPEN, owedBy: 'STAKEHOLDER', overdue: true, limit: 5, offset: 10 });
    });

    it.each([
      { status: 'FOO' }, { status: 'open' }, { limit: 'abc' }, { offset: '-1' }, { offset: 'abc' },
      { owedBy: 'x' }, { owedBy: '' }, { owedBy: ['USER', 'STAKEHOLDER'] }, { status: ['OPEN'] },
    ])('rejects %o', (query) => {
      expect(ListCommitmentsQuerySchema.safeParse(query).success).toBe(false);
    });
  });

  describe('boundedDate', () => {
    it('accepts the 1900 and 9999 edges, rejects outside them', () => {
      expect(boundedDate().safeParse(MIN_INPUT_DATE.toISOString()).success).toBe(true);
      expect(boundedDate().safeParse(MAX_INPUT_DATE.toISOString()).success).toBe(true);
      expect(boundedDate().safeParse('1899-12-31T23:59:59.999Z').success).toBe(false);
      expect(boundedDate().safeParse('-010000-01-01T00:00:00Z').success).toBe(false);
      expect(boundedDate().safeParse('+275760-09-13T00:00:00.000Z').success).toBe(false);
      expect(boundedDate().safeParse(-8.64e15).success).toBe(false);
      expect(boundedDate().safeParse('not-a-date').success).toBe(false);
    });

    it('is wired into commitment, person and goal request schemas (null still allowed)', () => {
      const far = '-010000-01-01T00:00:00Z';
      expect(CreateCommitmentRequestSchema.safeParse({ description: 'd', deadline: far }).success).toBe(false);
      expect(CreateCommitmentRequestSchema.safeParse({ description: 'd', completedAt: -8.64e15 }).success).toBe(false);
      expect(UpdateCommitmentRequestSchema.safeParse({ deadline: far }).success).toBe(false);
      expect(CreatePersonRequestSchema.safeParse({ name: 'Pat', lastContactAt: far }).success).toBe(false);
      expect(UpdatePersonRequestSchema.safeParse({ lastContactAt: far }).success).toBe(false);
      expect(CreateGoalRequestSchema.safeParse({ title: 'g', deadline: far }).success).toBe(false);
      expect(CreateCommitmentRequestSchema.safeParse({ description: 'd', deadline: null, completedAt: '2026-11-01' }).success).toBe(true);
    });
  });

  it('caps person interactionFrequency to a finite int4 and commitment sourceSessionId length', () => {
    expect(CreatePersonRequestSchema.safeParse({ name: 'Pat', interactionFrequency: 1e308 }).success).toBe(false);
    expect(CreatePersonRequestSchema.safeParse({ name: 'Pat', interactionFrequency: 1.5 }).success).toBe(false);
    expect(CreatePersonRequestSchema.safeParse({ name: 'Pat', interactionFrequency: -1 }).success).toBe(false);
    expect(CreatePersonRequestSchema.safeParse({ name: 'Pat', interactionFrequency: 12 }).success).toBe(true);
    expect(CreateCommitmentRequestSchema.safeParse({ description: 'd', sourceSessionId: 's'.repeat(10_000) }).success).toBe(false);
  });
});
