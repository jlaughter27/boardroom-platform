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

  // RD-2: identical queries on identical data reordered in the 2026-10-23
  // real-data run. The comparator was not transitive, so the output followed
  // the arbitrary input order whenever scores were flat.
  describe('RD-2 determinism', () => {
    const flat = () => [
      makeResult({ id: 'n-07', relevanceScore: 0.41 }),
      makeResult({ id: 'n-02', relevanceScore: 0.42 }),
      makeResult({ id: 'n-11', relevanceScore: 0.415 }),
      makeResult({ id: 'n-05', relevanceScore: 0.42 }),
      makeResult({ id: 'n-09', relevanceScore: 0.44 }),
      makeResult({ id: 'n-01', relevanceScore: 0.43 }),
    ];
    const ids = (r: ScoredResult[]) => r.map(x => x.id);

    it('the order does not depend on the order the layers returned rows in', () => {
      const base = flat();
      const fts = [makeResult({ id: 'n-11', relevanceScore: 0.2 }), makeResult({ id: 'n-02', relevanceScore: 0.2 })];
      const expected = ids(rankAndDeduplicate([{ layer: 'structured', results: base }, { layer: 'fts', results: fts }], 10));
      for (let k = 0; k < base.length; k++) {
        const rotated = [...base.slice(k), ...base.slice(0, k)];
        for (const rows of [rotated, [...rotated].reverse()]) {
          const got = ids(rankAndDeduplicate([{ layer: 'structured', results: rows }, { layer: 'fts', results: [...fts].reverse() }], 10));
          expect(got).toEqual(expected);
        }
      }
    });

    it('flat scores with equal trust sort by score, then id — not by arrival order', () => {
      const r = rankAndDeduplicate([{ layer: 'structured', results: flat() }], 10);
      expect(ids(r)).toEqual(['n-09', 'n-01', 'n-02', 'n-05', 'n-11', 'n-07']);
    });

    it('keeps WS-3: within the tie delta sourceWeight wins; a larger gap beats trust', () => {
      const r = rankAndDeduplicate([{ layer: 'structured', results: [
        makeResult({ id: 'gold-low-trust', relevanceScore: 0.9, sourceWeight: 0.5 }),
        makeResult({ id: 'close-high-trust', relevanceScore: 0.8, sourceWeight: 1.0 }),
        makeResult({ id: 'garbage-high-trust', relevanceScore: 0.2, sourceWeight: 1.0 }),
      ] }], 10);
      // weighted 0.27 vs 0.24 (within 0.05) → trust decides; 0.06 is a real gap.
      expect(ids(r)).toEqual(['close-high-trust', 'gold-low-trust', 'garbage-high-trust']);
    });

    it('inside a band, a lexical hit beats an item lifted only by the importance boost', () => {
      const r = rankAndDeduplicate([
        { layer: 'fts', results: [makeResult({ id: 'real-hit', relevanceScore: 0.38 })] },               // 0.095
        { layer: 'semantic', results: [makeResult({ id: 'boosted-noise', relevanceScore: 0.01, importance: 0.9 })] }, // 0.0025 + 0.1
      ], 10);
      expect(ids(r)).toEqual(['real-hit', 'boosted-noise']);
    });

    it('the result does not depend on the order layers are passed in', () => {
      const s = [makeResult({ id: 'x', relevanceScore: 0.2 }), makeResult({ id: 'y', relevanceScore: 0.25 })];
      const f = [makeResult({ id: 'y', relevanceScore: 0.3 }), makeResult({ id: 'z', relevanceScore: 0.5 })];
      const a = rankAndDeduplicate([{ layer: 'structured', results: s }, { layer: 'semantic', results: f }], 10);
      const b = rankAndDeduplicate([{ layer: 'semantic', results: [...f].reverse() }, { layer: 'structured', results: [...s].reverse() }], 10);
      expect(ids(b)).toEqual(ids(a));
    });

    it('recencyBoost:false ignores last_accessed_at (written by other reads)', () => {
      const recent = new Date(Date.now() - 60_000);
      const rows = [
        // weighted: a 0.125; b 0.100 (+0.1 recency = 0.200, a real gap)
        makeResult({ id: 'a', relevanceScore: 0.5 }),
        makeResult({ id: 'b', relevanceScore: 0.4, lastAccessedAt: recent }),
      ];
      expect(ids(rankAndDeduplicate([{ layer: 'fts', results: rows }], 10))).toEqual(['b', 'a']);
      expect(ids(rankAndDeduplicate([{ layer: 'fts', results: rows }], 10, { recencyBoost: false }))).toEqual(['a', 'b']);
    });
  });
});
