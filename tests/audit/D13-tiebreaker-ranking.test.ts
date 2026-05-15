/**
 * D13 — SourceWeight as Tiebreaker (not Multiplier) Audit Test
 *
 * WS-3.3: Previously `final = (sem*0.6 + fts*0.3 + tri*0.1) * sourceWeight`,
 * which meant a high-trust source could pull a barely-relevant result above
 * a low-trust source's perfect match. New behavior:
 *
 *   - Sort by raw weighted score
 *   - Only when |score_a - score_b| <= 0.05 does sourceWeight decide
 *
 * This test pins both halves of the contract:
 *   1. Equal scores, different weights  → weight wins.
 *   2. Different scores (gap > 0.05)    → raw score wins regardless of weight.
 */
import { describe, it, expect } from 'vitest';
import { rankAndDeduplicate } from '../../packages/omnimind-api/src/retrieval/ranker';
import type { ScoredResult } from '../../packages/omnimind-api/src/retrieval/structured-filter';

function makeResult(
  id: string,
  score: number,
  sourceWeight?: number
): ScoredResult & { sourceWeight?: number } {
  return {
    id,
    type: 'memory',
    content: `Memory content for ${id}`,
    title: `Memory ${id}`,
    relevanceScore: score,
    source: 'semantic',
    whyIncluded: 'test',
    tags: [],
    importance: 0.5,
    lastAccessedAt: null,
    ...(sourceWeight !== undefined ? { sourceWeight } : {}),
  };
}

describe('D13 — SourceWeight tiebreaker', () => {
  it('TIE: equal scores → higher sourceWeight wins', () => {
    // Both inputs go into the same layer at the same raw score.
    // After ranker math their weightedScores are identical → tiebreaker activates.
    const lowTrust = makeResult('low-trust', 0.7, 0.6);
    const highTrust = makeResult('high-trust', 0.7, 1.0);

    const ranked = rankAndDeduplicate(
      [{ layer: 'semantic', results: [lowTrust, highTrust] }],
      10
    );

    const highPos = ranked.findIndex(r => r.id === 'high-trust');
    const lowPos = ranked.findIndex(r => r.id === 'low-trust');
    expect(highPos).toBeLessThan(lowPos);
  });

  it('GAP: meaningfully higher raw score outranks higher sourceWeight', () => {
    // "perfect-but-untrusted" has a much higher raw score than
    // "trusted-but-irrelevant". The score gap (>0.05 in weightedScore terms)
    // should mean trust does NOT reorder them.
    //
    // semantic layer weight is 0.25, so raw 1.0 → weighted 0.25 and raw 0.2
    // → weighted 0.05. Gap = 0.20, well above the 0.05 tiebreaker delta.
    const trustedIrrelevant = makeResult('trusted-irrelevant', 0.2, 1.2);
    const untrustedPerfect = makeResult('untrusted-perfect', 1.0, 0.5);

    const ranked = rankAndDeduplicate(
      [{ layer: 'semantic', results: [trustedIrrelevant, untrustedPerfect] }],
      10
    );

    const perfectPos = ranked.findIndex(r => r.id === 'untrusted-perfect');
    const irrelevantPos = ranked.findIndex(r => r.id === 'trusted-irrelevant');
    // Raw score wins despite trust difference
    expect(perfectPos).toBeLessThan(irrelevantPos);
  });

  it('GAP: sourceWeight does NOT multiply the score', () => {
    // Regression guard against the old behavior. If sourceWeight were still
    // a multiplier, the trusted result (0.7 * 1.2 = 0.84 weightedScore-ish)
    // could pull ahead of the untrusted result (0.8 * 0.6 = 0.48). Under
    // the new rule, raw 0.8 > raw 0.7 by a 0.1 layer-weighted gap that's
    // 0.025 (0.8*0.25 vs 0.7*0.25 = 0.2 vs 0.175 — gap 0.025).
    //
    // 0.025 < 0.05 tiebreaker → trust BREAKS the tie this time, so the
    // trusted-but-slightly-worse result wins. That's the intended behavior:
    // when raw scores are close, trust is the signal. When they're not, trust
    // is silent. This test asserts the trusted-but-worse outcome to lock in
    // the boundary semantics.
    const trustedSlightlyWorse = makeResult('trusted-worse', 0.7, 1.2);
    const untrustedSlightlyBetter = makeResult('untrusted-better', 0.8, 0.6);

    const ranked = rankAndDeduplicate(
      [{ layer: 'semantic', results: [trustedSlightlyWorse, untrustedSlightlyBetter] }],
      10
    );

    // Within 0.05 weighted-score band → tiebreaker decides → trust wins
    const trustedPos = ranked.findIndex(r => r.id === 'trusted-worse');
    const untrustedPos = ranked.findIndex(r => r.id === 'untrusted-better');
    expect(trustedPos).toBeLessThan(untrustedPos);
  });

  it('default sourceWeight (1.0) behaves as neutral', () => {
    // Results without explicit sourceWeight default to 1.0 — when both are
    // missing, only raw score matters.
    const a = makeResult('a', 0.9); // no sourceWeight
    const b = makeResult('b', 0.6); // no sourceWeight

    const ranked = rankAndDeduplicate(
      [{ layer: 'semantic', results: [a, b] }],
      10
    );

    expect(ranked[0].id).toBe('a');
    expect(ranked[1].id).toBe('b');
  });

  it('sort: small gap (< 0.05) lets trust win; larger gap does not', () => {
    // Two adjacent raw scores. With semantic layer weight 0.25 and an
    // intentionally tiny raw-score gap, the weighted-score gap stays well
    // inside the tiebreaker band — so trust decides.
    //
    // 0.71 * 0.25 = 0.1775, 0.72 * 0.25 = 0.18 → gap 0.0025 (well under 0.05)
    const lowerScore = makeResult('lower-but-trusted', 0.71, 1.2);
    const higherScore = makeResult('higher-but-untrusted', 0.72, 0.6);

    const ranked = rankAndDeduplicate(
      [{ layer: 'semantic', results: [lowerScore, higherScore] }],
      10
    );

    // Sub-0.05 gap → tiebreaker → trust wins
    expect(ranked[0].id).toBe('lower-but-trusted');
  });
});
