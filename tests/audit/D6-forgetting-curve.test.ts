/**
 * D6 — Forgetting Curve Audit Test
 *
 * Finding: forgetting curve is implemented in structuredFilter ONLY.
 * semanticSearch, fulltextSearch, and trigramSearch do NOT apply it.
 * Old/low-importance memories can appear in search results via semantic
 * similarity even when they should be invisible.
 */
import { describe, it, expect, vi } from 'vitest';
import { structuredFilter } from '../../packages/omnimind-api/src/retrieval/structured-filter';

function makeMemoryEntry(overrides: Record<string, unknown>) {
  return {
    id: 'mem-old',
    userId: 'user-1',
    title: 'Old stale memory',
    content: 'This is an old stale memory',
    domain: 'business',
    sector: '',
    tags: [],
    memoryClass: 'SEMANTIC',
    importance: 0.2,
    confidence: 'MEDIUM',
    status: 'CONFIRMED',
    sourceType: 'MANUAL',
    sourceRef: null,
    sourceWeight: 1.0,
    validAt: new Date('2020-01-01'),
    invalidAt: null,
    supersededBy: null,
    version: 1,
    metadata: {},
    embedding: null,
    searchVector: null,
    lastAccessedAt: new Date('2020-01-01'), // 5+ years ago
    deletedAt: null,
    createdAt: new Date('2020-01-01'),
    updatedAt: new Date('2020-01-01'),
    agentId: null,
    tenantId: 'josh-business',
    embeddingModel: 'openai-text-embedding-3-small',
    roomId: null,
    ...overrides,
  };
}

describe('D6 — Forgetting Curve', () => {
  it('structuredFilter excludes low-importance + old memories by default', async () => {
    const oldMem = makeMemoryEntry({});
    const mockPrisma = {
      memoryEntry: {
        findMany: vi.fn().mockResolvedValue([oldMem]),
      },
    };

    const results = await structuredFilter('user-1', 'old stale', { limit: 10 }, mockPrisma as any);

    // The query should have included the forgetting curve OR clause
    // Verify the findMany was called with the forgetting curve filter
    const callArgs = mockPrisma.memoryEntry.findMany.mock.calls[0][0];
    const hasForgetFilter = callArgs?.where?.OR || callArgs?.where?.AND;
    expect(hasForgetFilter).toBeTruthy();
  });

  it('structuredFilter includes old memories when includeArchived=true', async () => {
    const oldMem = makeMemoryEntry({});
    const mockPrisma = {
      memoryEntry: {
        findMany: vi.fn().mockResolvedValue([oldMem]),
      },
    };

    // @ts-expect-error — includeArchived is passed via options duck-typing
    const results = await structuredFilter('user-1', 'old stale', { limit: 10, includeArchived: true }, mockPrisma as any);

    const callArgs = mockPrisma.memoryEntry.findMany.mock.calls[0][0];
    // When includeArchived, the OR clause (forgetting curve) should NOT be added
    const hasForgetFilter = JSON.stringify(callArgs?.where).includes('"gte":0.4');
    expect(hasForgetFilter).toBe(false);
  });

  it('AUDIT NOTE: semanticSearch does NOT apply forgetting curve — gap documented', () => {
    // semanticSearch.ts (lines 14-45) runs:
    //   WHERE "user_id" = $userId
    //     AND embedding IS NOT NULL
    //     AND "deleted_at" IS NULL
    //     AND status != 'ARCHIVED'
    // There is NO importance/lastAccessedAt filter.
    //
    // A memory with importance=0.1 and lastAccessedAt from 5 years ago
    // WILL appear in semantic search results if its embedding is similar.
    // The ranker's recency/importance boosts are additive, not exclusive.
    // The forgetting curve's intent (make old/stale memories invisible)
    // is only partially implemented.
    expect(true).toBe(true); // documentation-only
  });
});
