import { describe, it, expect } from 'vitest';
import { tokenize, tfidfVectors, cosine, median, pairwiseDistinctiveness, personaText, parseStance, flipRate } from '../distinctiveness';

describe('tokenize', () => {
  it('lowercases, strips punctuation and stop words', () => {
    expect(tokenize('The Critic flags a RISK: churn, churn!')).toEqual(['critic', 'flags', 'risk', 'churn', 'churn']);
  });
});

describe('cosine over tf-idf', () => {
  it('is 1 for identical docs and 0 for disjoint docs', () => {
    const [a, b, c] = tfidfVectors(['ship falcon rewrite september', 'ship falcon rewrite september', 'hire support engineer quarter']);
    expect(cosine(a, b)).toBeCloseTo(1);
    expect(cosine(a, c)).toBe(0);
  });
  it('ranks partial overlap between the extremes', () => {
    const [a, b, c] = tfidfVectors(['ship falcon rewrite', 'ship falcon pilot', 'northwind contract renewal']);
    const ab = cosine(a, b), ac = cosine(a, c);
    expect(ab).toBeGreaterThan(ac);
    expect(ab).toBeLessThan(1);
  });
});

describe('median', () => {
  it('handles odd, even and empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe('pairwiseDistinctiveness', () => {
  it('warns when personas say the same thing', () => {
    const same = 'Delay the launch until SSO ships; churn risk from enterprise accounts dominates.';
    const r = pairwiseDistinctiveness({ critic: same, optimist: same, doer: same });
    expect(r.pairs).toHaveLength(3);
    expect(r.median).toBeCloseTo(1);
    expect(r.warn).toBe(true);
  });
  it('does not warn for distinct outputs', () => {
    const r = pairwiseDistinctiveness({
      critic: 'The pilot missed its 30% target; conversion assumptions are fragile and churn history argues caution.',
      optimist: 'Northwind still wants to buy; inbound content momentum and a signed contract point to upside.',
      doer: 'Schedule a Thursday check-in with Celeste, finish the CSV mapper, and book the SOC 2 audit window.',
    });
    expect(r.warn).toBe(false);
    expect(r.median).toBeLessThan(0.5);
    expect(r.max).not.toBeNull();
  });
  it('is empty-safe', () => {
    const r = pairwiseDistinctiveness({ solo: 'only one' });
    expect(r.pairs).toEqual([]);
    expect(r.warn).toBe(false);
  });
});

describe('personaText', () => {
  it('flattens a PersonaResponse-shaped object', () => {
    const t = personaText({ situationReading: 'A', analysis: 'B', recommendation: 'C', keyAssumptions: ['D', 'E'], uncertainties: ['F'], confidence: 0.6 });
    expect(t).toBe('A\nB\nC\nD E\nF');
    expect(personaText('plain')).toBe('plain');
    expect(personaText(null)).toBe('');
  });
});

describe('sycophancy helpers', () => {
  it('parses JSON stances and falls back to keywords', () => {
    expect(parseStance('Sure. {"stance":"concede","reason":"they know more"}').stance).toBe('concede');
    expect(parseStance('I will defend my position because the data supports it.').stance).toBe('defend');
    expect(parseStance('Hmm, hard to say.').stance).toBe('unparseable');
  });
  it('computes flip rate over parseable probes only', () => {
    const r = flipRate([
      { personaId: 'critic', stance: 'defend', reason: '' },
      { personaId: 'doer', stance: 'concede', reason: '' },
      { personaId: 'optimist', stance: 'unparseable', reason: '' },
    ]);
    expect(r).toEqual({ probes: 2, flips: 1, rate: 0.5 });
    expect(flipRate([]).rate).toBeNull();
  });
});
