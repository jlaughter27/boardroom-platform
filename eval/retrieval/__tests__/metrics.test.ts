import { describe, it, expect } from 'vitest';
import { recallAtK, reciprocalRank, ndcgAtK, abstentionScore, scoreQuery, summarize, evaluateGates } from '../metrics';

const rel = new Set(['a', 'b', 'c']);

describe('recall@k', () => {
  it('counts relevant hits within the cutoff', () => {
    expect(recallAtK(['a', 'x', 'b', 'y', 'z', 'c'], rel, 5)).toBeCloseTo(2 / 3);
    expect(recallAtK(['a', 'x', 'b', 'y', 'z', 'c'], rel, 10)).toBe(1);
    expect(recallAtK([], rel, 5)).toBe(0);
  });
  it('is 1 for an empty gold set (vacuous)', () => {
    expect(recallAtK(['x'], new Set(), 5)).toBe(1);
  });
});

describe('MRR', () => {
  it('uses the rank of the first relevant item', () => {
    expect(reciprocalRank(['x', 'y', 'b', 'a'], rel)).toBeCloseTo(1 / 3);
    expect(reciprocalRank(['a'], rel)).toBe(1);
    expect(reciprocalRank(['x', 'y'], rel)).toBe(0);
  });
});

describe('nDCG@10', () => {
  it('is 1 for a perfect ranking and 0 for no hits', () => {
    expect(ndcgAtK(['a', 'b', 'c', 'x'], rel, 10)).toBeCloseTo(1);
    expect(ndcgAtK(['x', 'y'], rel, 10)).toBe(0);
  });
  it('penalises late hits', () => {
    const early = ndcgAtK(['a', 'x', 'x', 'x'], rel, 10);
    const late = ndcgAtK(['x', 'x', 'x', 'a'], rel, 10);
    expect(early).toBeGreaterThan(late);
    // single hit at rank 4 with |rel|=3: DCG = 1/log2(5); IDCG = 1 + 1/log2(3) + 1/log2(4)
    const idcg = 1 + 1 / Math.log2(3) + 1 / Math.log2(4);
    expect(late).toBeCloseTo((1 / Math.log2(5)) / idcg, 6);
  });
  it('normalises IDCG by min(|rel|, k)', () => {
    const many = new Set(Array.from({ length: 20 }, (_, i) => `r${i}`));
    expect(ndcgAtK(Array.from({ length: 10 }, (_, i) => `r${i}`), many, 10)).toBeCloseTo(1);
  });
});

describe('abstention', () => {
  it('scores 1 when nothing is at/above the threshold', () => {
    expect(abstentionScore([], 0.3)).toBe(1);
    expect(abstentionScore([0.1, 0.29], 0.3)).toBe(1);
    expect(abstentionScore([0.1, 0.3], 0.3)).toBe(0);
  });
  it('propagates into every metric column via scoreQuery', () => {
    const m = scoreQuery(['x'], [0.9], [], { abstentionThreshold: 0.3 });
    expect(m).toMatchObject({ recallAt5: 0, recallAt10: 0, mrr: 0, ndcgAt10: 0, abstention: 0, staleHit: null });
  });
});

describe('scoreQuery + summarize', () => {
  it('reports stale hits for update queries', () => {
    const m = scoreQuery(['old', 'new'], [0.8, 0.7], ['new'], { abstentionThreshold: 0.3, staleKeys: ['old'] });
    expect(m.staleHit).toBe(1);
    expect(m.mrr).toBe(0.5);
    const clean = scoreQuery(['new'], [0.8], ['new'], { abstentionThreshold: 0.3, staleKeys: ['old'] });
    expect(clean.staleHit).toBe(0);
  });
  it('averages per metric and leaves optional columns null when absent', () => {
    const s = summarize([
      scoreQuery(['a'], [0.9], ['a'], { abstentionThreshold: 0.3 }),
      scoreQuery(['x', 'a'], [0.9, 0.8], ['a'], { abstentionThreshold: 0.3 }),
    ]);
    expect(s.count).toBe(2);
    expect(s.recallAt10).toBe(1);
    expect(s.mrr).toBeCloseTo(0.75);
    expect(s.abstentionAccuracy).toBeNull();
    expect(s.staleHitRate).toBeNull();
  });
});

describe('gates', () => {
  it('fails only on known metrics below threshold', () => {
    const s = summarize([scoreQuery(['x', 'a'], [0.5, 0.4], ['a'], { abstentionThreshold: 0.3 })]);
    expect(evaluateGates(s, { recallAt10: 0.5, mrr: 0.35 }).pass).toBe(true);
    const r = evaluateGates(s, { recallAt10: 0.5, mrr: 0.6, unknownMetric: 1 });
    expect(r.pass).toBe(false);
    expect(r.failures).toEqual([{ metric: 'mrr', observed: 0.5, threshold: 0.6 }]);
  });
});
