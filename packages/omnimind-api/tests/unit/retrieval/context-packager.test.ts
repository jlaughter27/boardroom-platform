import { describe, it, expect } from 'vitest';
import { packageForPersona, excerptToBudget, MIN_EXCERPT_TOKENS } from '../../../src/retrieval/context-packager';
import type { ScoredResult } from '../../../src/retrieval/structured-filter';
import { RETRIEVAL_CONFIG } from '@boardroom/shared';

function makeResult(overrides: Partial<ScoredResult> = {}): ScoredResult {
  return {
    id: 'mem-1',
    type: 'memory',
    content: 'Short content',
    title: 'Test',
    relevanceScore: 0.5,
    source: 'structured',
    whyIncluded: 'Test reason',
    tags: [],
    importance: 0.5,
    lastAccessedAt: null,
    ...overrides,
  };
}

describe('packageForPersona', () => {
  it('optimist persona boosts success/opportunity tagged items', () => {
    const results = [
      makeResult({ id: 'tagged', relevanceScore: 0.5, tags: ['success', 'growth'] }),
      makeResult({ id: 'untagged', relevanceScore: 0.5, tags: ['misc'] }),
    ];

    const pkg = packageForPersona(results, 'optimist', 2, ['structured']);

    // Tagged item should be first (boosted)
    expect(pkg.items[0].id).toBe('tagged');
    expect(pkg.items[0].relevanceScore).toBeGreaterThan(pkg.items[1].relevanceScore);
  });

  it('critic persona boosts risk/failure tagged items', () => {
    const results = [
      makeResult({ id: 'risky', relevanceScore: 0.5, tags: ['risk', 'deadline'] }),
      makeResult({ id: 'safe', relevanceScore: 0.5, tags: ['success'] }),
    ];

    const pkg = packageForPersona(results, 'critic', 2, ['structured']);

    expect(pkg.items[0].id).toBe('risky');
    expect(pkg.items[0].relevanceScore).toBeGreaterThan(pkg.items[1].relevanceScore);
  });

  it('CEO gets higher maxItems and tokenBudget', () => {
    const results = Array.from({ length: 15 }, (_, i) =>
      makeResult({ id: `mem-${i}`, content: 'x'.repeat(20) })
    );

    const ceoPkg = packageForPersona(results, 'ceo', 15, ['structured']);
    const personaPkg = packageForPersona(results, 'optimist', 15, ['structured']);

    // CEO should get more items (maxItemsCEO=15 vs maxItemsPerPersona=10)
    expect(ceoPkg.items.length).toBeGreaterThanOrEqual(personaPkg.items.length);
    expect(ceoPkg.items.length).toBeLessThanOrEqual(RETRIEVAL_CONFIG.maxItemsCEO);
    expect(personaPkg.items.length).toBeLessThanOrEqual(RETRIEVAL_CONFIG.maxItemsPerPersona);
  });

  it('enforces token budget (items dropped when over budget)', () => {
    // Each item has ~500 chars = ~125 tokens. Budget is 2000 tokens.
    // So we can fit ~16 items but maxItemsPerPersona is 10, so that's the limit.
    // Let's use bigger items to test budget enforcement.
    const results = Array.from({ length: 15 }, (_, i) =>
      makeResult({ id: `mem-${i}`, content: 'x'.repeat(1000) }) // ~250 tokens each
    );

    const pkg = packageForPersona(results, 'optimist', 15, ['structured']);

    // Budget is 2000 tokens, each item ~250 tokens, so max ~8 items
    // Also capped at maxItemsPerPersona=10
    expect(pkg.tokenEstimate).toBeLessThanOrEqual(RETRIEVAL_CONFIG.tokenBudgetPerPersona);
    expect(pkg.items.length).toBeLessThan(15);
  });

  it('caps items at maxItemsPerPersona', () => {
    // Small items that easily fit in token budget
    const results = Array.from({ length: 20 }, (_, i) =>
      makeResult({ id: `mem-${i}`, content: 'tiny' })
    );

    const pkg = packageForPersona(results, 'technician', 20, ['structured']);

    expect(pkg.items.length).toBeLessThanOrEqual(RETRIEVAL_CONFIG.maxItemsPerPersona);
  });

  it('a top hit longer than the whole budget is excerpted, never an empty package (real-vault e2e)', () => {
    const long = Array.from({ length: 200 }, (_, i) => `Paragraph ${i}: ${'detail '.repeat(15)}`).join('\n\n'); // ~22k chars
    const results = [
      makeResult({ id: 'long-1', relevanceScore: 0.9, content: long }),
      makeResult({ id: 'long-2', relevanceScore: 0.8, content: long }),
    ];

    const pkg = packageForPersona(results, 'technician', 2, ['fts']);

    expect(pkg.items.length).toBeGreaterThan(0);
    expect(pkg.items[0].id).toBe('long-1');
    expect(pkg.items[0].content.startsWith('Paragraph 0:')).toBe(true);
    expect(pkg.items[0].content).toMatch(/excerpt: first part of a [\d,]+-character note\]$/);
    expect(pkg.tokenEstimate).toBeLessThanOrEqual(RETRIEVAL_CONFIG.tokenBudgetPerPersona);
  });

  it('an item that does not fit is skipped, and smaller lower-ranked items still fill the budget', () => {
    const results = [
      makeResult({ id: 'fits', relevanceScore: 0.9, content: 'x'.repeat(4 * (RETRIEVAL_CONFIG.tokenBudgetPerPersona - MIN_EXCERPT_TOKENS + 10)) }),
      makeResult({ id: 'too-big', relevanceScore: 0.8, content: 'y'.repeat(4000) }),
      makeResult({ id: 'small', relevanceScore: 0.7, content: 'z'.repeat(40) }),
    ];

    const pkg = packageForPersona(results, 'technician', 3, ['fts']);

    expect(pkg.items.map(i => i.id)).toEqual(['fits', 'small']);
    expect(pkg.tokenEstimate).toBeLessThanOrEqual(RETRIEVAL_CONFIG.tokenBudgetPerPersona);
  });

  it('excerptToBudget stays within the budget and cuts at a line break when one is close', () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i} ${'w'.repeat(30)}`).join('\n');
    const out = excerptToBudget(text, 200);
    expect(Math.ceil(out.length / 4)).toBeLessThanOrEqual(200);
    expect(out.split('\n\n[')[0]).toMatch(/w$/);
  });
});
