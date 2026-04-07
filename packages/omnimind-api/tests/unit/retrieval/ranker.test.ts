import { describe, it, expect } from 'vitest';
import { rankAndDeduplicate } from '../../../src/retrieval/ranker';
import type { ScoredResult } from '../../../src/retrieval/structured-filter';

function makeResult(overrides: Partial<ScoredResult> = {}): ScoredResult {
  return {
    id: 'mem-1',
    type: 'memory',
    content: 'Test content',
    title: 'Test title',
    relevanceScore: 0.8,
    source: 'structured',
    whyIncluded: 'Test reason',
    tags: [],
    importance: 0.5,
    lastAccessedAt: null,
    ...overrides,
  };
}

describe('rankAndDeduplicate', () => {
  it('deduplicates same ID from multiple layers', () => {
    const results = rankAndDeduplicate(
      [
        { layer: 'structured', results: [makeResult({ id: 'mem-1', relevanceScore: 0.9 })] },
        { layer: 'fts', results: [makeResult({ id: 'mem-1', relevanceScore: 0.7 })] },
      ],
      10
    );

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('mem-1');
  });

  it('weighted scoring: structured result ranks higher than trigram-only', () => {
    const results = rankAndDeduplicate(
      [
        { layer: 'structured', results: [makeResult({ id: 'structured-only', relevanceScore: 0.8 })] },
        { layer: 'fts', results: [] },
        { layer: 'trigram', results: [makeResult({ id: 'trigram-only', relevanceScore: 0.8 })] },
        { layer: 'semantic', results: [] },
      ],
      10
    );

    expect(results).toHaveLength(2);
    // structured weight 0.3 > trigram weight 0.2, so structured-only ranks first
    expect(results[0].id).toBe('structured-only');
    expect(results[1].id).toBe('trigram-only');
  });

  it('applies recency boost for recently accessed items', () => {
    const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

    const results = rankAndDeduplicate(
      [
        {
          layer: 'structured',
          results: [
            makeResult({ id: 'recent', relevanceScore: 0.5, lastAccessedAt: recentDate }),
            makeResult({ id: 'old', relevanceScore: 0.5, lastAccessedAt: oldDate }),
          ],
        },
      ],
      10
    );

    expect(results).toHaveLength(2);
    // Recent item should rank higher due to recency boost
    expect(results[0].id).toBe('recent');
  });

  it('applies importance boost for high-importance items', () => {
    const results = rankAndDeduplicate(
      [
        {
          layer: 'structured',
          results: [
            makeResult({ id: 'low-imp', relevanceScore: 0.5, importance: 0.3 }),
            makeResult({ id: 'high-imp', relevanceScore: 0.5, importance: 0.9 }),
          ],
        },
      ],
      10
    );

    expect(results).toHaveLength(2);
    // High importance item should rank higher
    expect(results[0].id).toBe('high-imp');
  });

  it('returns no more than maxItems', () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      makeResult({ id: `mem-${i}`, relevanceScore: 0.5 + i * 0.01 })
    );

    const results = rankAndDeduplicate(
      [{ layer: 'structured', results: items }],
      5
    );

    expect(results).toHaveLength(5);
  });
});
