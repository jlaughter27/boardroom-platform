/**
 * D5 — sourceWeight Ranking Audit Test
 *
 * Demonstrates that sourceWeight multiplier in ranker.ts is DEAD CODE:
 * no retrieval layer populates sourceWeight on ScoredResult objects,
 * so the multiplier condition `if (sw !== 1.0)` is never triggered.
 */
import { describe, it, expect } from 'vitest';
import { rankAndDeduplicate } from '../../packages/omnimind-api/src/retrieval/ranker';
import type { ScoredResult } from '../../packages/omnimind-api/src/retrieval/structured-filter';

function makeResult(id: string, score: number, sourceWeight?: number): ScoredResult & { sourceWeight?: number } {
  return {
    id,
    type: 'memory',
    content: `Memory content for ${id}`,
    title: `Memory ${id}`,
    relevanceScore: score,
    source: 'structured',
    whyIncluded: 'test',
    tags: [],
    importance: 0.5,
    lastAccessedAt: null,
    ...(sourceWeight !== undefined ? { sourceWeight } : {}),
  };
}

describe('D5 — sourceWeight ranking', () => {
  it('PASSING: sourceWeight=0.6 agent result ranks LOWER than sourceWeight=1.0 when field is populated', () => {
    // These results have sourceWeight explicitly set (as if the retrieval layer populated it)
    const highTrust = makeResult('high-trust', 0.7, 1.0);
    const lowTrust = makeResult('low-trust', 0.7, 0.6);

    const ranked = rankAndDeduplicate([
      { layer: 'structured', results: [highTrust, lowTrust] },
    ], 10);

    // When sourceWeight IS populated, low-trust should rank lower
    const highPos = ranked.findIndex(r => r.id === 'high-trust');
    const lowPos = ranked.findIndex(r => r.id === 'low-trust');
    expect(highPos).toBeLessThan(lowPos); // high trust should rank first
  });

  it('FAILING (BUG): without sourceWeight on result, low-trust agent ranks EQUAL to high-trust', () => {
    // This simulates the ACTUAL behavior: retrieval layers never add sourceWeight
    const highTrust = makeResult('high-trust', 0.7); // NO sourceWeight
    const lowTrust = makeResult('low-trust', 0.7);   // NO sourceWeight

    const ranked = rankAndDeduplicate([
      { layer: 'structured', results: [highTrust, lowTrust] },
    ], 10);

    // Both rank the same because sourceWeight defaults to 1.0 for both
    // First result wins by insertion order — not by trust
    const scores = ranked.map(r => r.relevanceScore);
    // Both have same weighted score — no differentiation by trust
    expect(scores[0]).toBe(scores[1]); // BUG: should differ by sourceWeight

    // Document the bug: the ranker's sourceWeight branch is UNREACHABLE in practice
    // because structuredFilter, semanticSearch, fulltextSearch, trigramSearch
    // all return ScoredResult objects WITHOUT a sourceWeight field.
  });

  it('REGRESSION GUARD: sourceWeight=1.2 (manual edit) should outrank 1.0 when field is populated', () => {
    const manual = makeResult('manual', 0.7, 1.2);
    const agent = makeResult('agent', 0.7, 1.0);

    const ranked = rankAndDeduplicate([
      { layer: 'semantic', results: [agent, manual] },
    ], 10);

    const manualPos = ranked.findIndex(r => r.id === 'manual');
    const agentPos = ranked.findIndex(r => r.id === 'agent');
    expect(manualPos).toBeLessThan(agentPos);
  });
});
