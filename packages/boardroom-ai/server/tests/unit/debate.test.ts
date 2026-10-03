import { describe, it, expect } from 'vitest';
import type { PersonaResponse, Rebuttal } from '@boardroom/shared';
import {
  tokenize, jaccard, clusterByMajority, selectRebutters, anonymizeViews, buildRebuttalUserMessage,
  buildDisagreementLedger, computeDroppedConsiderations, formatLedgerForCEO, debateEnabled, maxRebuttals,
} from '../../src/agents/debate';

function pr(personaId: string, recommendation: string, extra: Partial<PersonaResponse> = {}): PersonaResponse {
  return {
    personaId,
    situationReading: 'reading',
    keyAssumptions: ['a1'],
    analysis: 'analysis',
    recommendation,
    uncertainties: [],
    sourceMemoryIds: [],
    confidence: 0.7,
    dissentFlag: false,
    ...extra,
  };
}

const HIRE = 'Hire the senior engineer now to protect the Q3 launch date';
const HIRE2 = 'Hire the senior engineer now and protect the Q3 launch date with a phased plan';
const WAIT = 'Wait one quarter and extend runway before any hiring commitment';

describe('debate — tokenize / jaccard', () => {
  it('drops stopwords and short tokens, lower-cases', () => {
    expect(Array.from(tokenize('The Hire is URGENT, for Q3!')).sort()).toEqual(['hire', 'urgent']);
  });
  it('jaccard is 1 for identical, 0 for disjoint, symmetric', () => {
    const a = tokenize(HIRE); const b = tokenize(WAIT);
    expect(jaccard(a, a)).toBe(1);
    expect(jaccard(a, b)).toBe(jaccard(b, a));
    expect(jaccard(tokenize('alpha beta'), tokenize('gamma delta'))).toBe(0);
  });
});

describe('debate — clusterByMajority', () => {
  it('groups near-identical recommendations (Jaccard ≥ 0.4) and flags the outlier as dissenter', () => {
    const responses = new Map<string, PersonaResponse>([
      ['optimist', pr('optimist', HIRE)],
      ['technician', pr('technician', HIRE2)],
      ['critic', pr('critic', WAIT)],
    ]);
    const r = clusterByMajority(responses);
    expect(r.majority).toEqual(['optimist', 'technician']);
    expect(r.dissenters).toEqual(['critic']);
    expect(r.clusters).toEqual([['optimist', 'technician'], ['critic']]);
  });

  it('a dissentFlag persona inside the majority is still a dissenter', () => {
    const responses = new Map<string, PersonaResponse>([
      ['optimist', pr('optimist', HIRE)],
      ['technician', pr('technician', HIRE2, { dissentFlag: true })],
      ['critic', pr('critic', WAIT)],
    ]);
    expect(clusterByMajority(responses).dissenters).toEqual(['critic', 'technician']);
  });

  it('no cluster of ≥2 → no majority; only dissentFlag personas are dissenters', () => {
    const responses = new Map<string, PersonaResponse>([
      ['a', pr('a', 'alpha bravo charlie')],
      ['b', pr('b', 'delta echo foxtrot', { dissentFlag: true })],
      ['c', pr('c', 'golf hotel india')],
    ]);
    const r = clusterByMajority(responses);
    expect(r.majority).toEqual([]);
    expect(r.dissenters).toEqual(['b']);
  });

  it('is deterministic regardless of insertion order', () => {
    const a = new Map<string, PersonaResponse>([['critic', pr('critic', WAIT)], ['optimist', pr('optimist', HIRE)], ['technician', pr('technician', HIRE2)]]);
    const b = new Map<string, PersonaResponse>([['technician', pr('technician', HIRE2)], ['critic', pr('critic', WAIT)], ['optimist', pr('optimist', HIRE)]]);
    expect(clusterByMajority(a)).toEqual(clusterByMajority(b));
  });
});

describe('debate — selectRebutters', () => {
  const responses = new Map<string, PersonaResponse>([
    ['optimist', pr('optimist', HIRE)],
    ['technician', pr('technician', HIRE2)],
    ['critic', pr('critic', WAIT)],
    ['alternate', pr('alternate', 'Outsource the whole build to an agency', { dissentFlag: true })],
    ['custom-x', pr('custom-x', 'Pause everything and rethink the market')],
  ]);
  it('dissentFlag first, capped at MAX_REBUTTALS', () => {
    const cluster = clusterByMajority(responses);
    expect(selectRebutters(cluster, responses, 3)[0]).toBe('alternate');
    expect(selectRebutters(cluster, responses, 3)).toHaveLength(3);
    expect(selectRebutters(cluster, responses, 1)).toEqual(['alternate']);
    expect(selectRebutters(cluster, responses, 0)).toEqual([]);
  });
});

describe('debate — anonymization', () => {
  it('labels others Advisor A/B/C and never leaks persona ids', () => {
    const others: Array<[string, PersonaResponse]> = [
      ['technician', pr('technician', HIRE2, { sourceMemoryIds: ['mem_2'] })],
      ['optimist', pr('optimist', HIRE, { sourceMemoryIds: ['mem_1'] })],
    ];
    const text = anonymizeViews(others);
    expect(text).toContain('### Advisor A');
    expect(text).toContain('### Advisor B');
    expect(text).not.toMatch(/optimist|technician/i);
    expect(text).toContain('mem_1');
    const msg = buildRebuttalUserMessage('Q?', pr('critic', WAIT), others);
    expect(msg).toContain('## Your Round-1 Position');
    expect(msg).toContain('## Other Advisors (anonymized)');
    expect(msg).not.toMatch(/optimist|technician/i);
  });
});

describe('debate — buildDisagreementLedger', () => {
  const responses = new Map<string, PersonaResponse>([
    ['optimist', pr('optimist', HIRE, { sourceMemoryIds: ['mem_1', 'mem_3'], confidence: 0.8 })],
    ['technician', pr('technician', HIRE2, { sourceMemoryIds: ['mem_2'], confidence: 0.6 })],
    ['critic', pr('critic', WAIT, { sourceMemoryIds: ['mem_9', 'mem_1'], dissentFlag: true })],
  ]);

  it('one row per cluster: claim from the highest-confidence holder, heldBy/opposedBy sorted, cited ids union-sorted', () => {
    const ledger = buildDisagreementLedger(responses);
    expect(ledger).toEqual([
      { claim: HIRE, heldBy: ['optimist', 'technician'], opposedBy: ['critic'], citedMemoryIds: ['mem_1', 'mem_2', 'mem_3'] },
      { claim: WAIT, heldBy: ['critic'], opposedBy: ['optimist', 'technician'], citedMemoryIds: ['mem_1', 'mem_9'] },
    ]);
  });

  it('a conceding persona leaves heldBy; its row disappears when nobody still holds the claim', () => {
    const rebuttals = new Map<string, Rebuttal>([
      ['critic', { personaId: 'critic', stance: 'concede', reason: 'mem_2 changes it', revisedRecommendation: 'Hire now, but phase it', revisedConfidence: 0.5 }],
    ]);
    const ledger = buildDisagreementLedger(responses, rebuttals);
    expect(ledger).toEqual([
      { claim: HIRE, heldBy: ['optimist', 'technician'], opposedBy: ['critic'], citedMemoryIds: ['mem_1', 'mem_2', 'mem_3'] },
    ]);
  });

  it('a defending persona with a revised recommendation gets the revised claim', () => {
    const rebuttals = new Map<string, Rebuttal>([
      ['critic', { personaId: 'critic', stance: 'defend', reason: 'runway', revisedRecommendation: 'Wait one quarter; revisit with Q2 cash numbers', revisedConfidence: 0.75 }],
    ]);
    const ledger = buildDisagreementLedger(responses, rebuttals);
    expect(ledger[1].claim).toBe('Wait one quarter; revisit with Q2 cash numbers');
    expect(ledger[1].heldBy).toEqual(['critic']);
  });

  it('empty when everyone agrees and nobody dissents', () => {
    const agree = new Map<string, PersonaResponse>([['a', pr('a', HIRE)], ['b', pr('b', HIRE2)]]);
    expect(buildDisagreementLedger(agree)).toEqual([]);
  });

  it('falls back to one row per dissentFlag persona when clustering finds no split', () => {
    const agree = new Map<string, PersonaResponse>([['a', pr('a', HIRE)], ['b', pr('b', HIRE2, { dissentFlag: true, sourceMemoryIds: ['m'] })]]);
    expect(buildDisagreementLedger(agree)).toEqual([{ claim: HIRE2, heldBy: ['b'], opposedBy: ['a'], citedMemoryIds: ['m'] }]);
  });

  it('is deterministic and renders every row for the CEO', () => {
    const l1 = buildDisagreementLedger(responses); const l2 = buildDisagreementLedger(responses);
    expect(l1).toEqual(l2);
    const text = formatLedgerForCEO(l1);
    expect(text).toContain('## Disagreement Ledger');
    expect(text).toContain('1. **Claim:**');
    expect(text).toContain('2. **Claim:**');
    expect(formatLedgerForCEO([])).toBe('');
  });
});

describe('debate — computeDroppedConsiderations', () => {
  it('round-1 ids minus CEO ids, sorted, deduplicated', () => {
    const responses = [
      pr('a', HIRE, { sourceMemoryIds: ['mem_3', 'mem_1'] }),
      pr('b', WAIT, { sourceMemoryIds: ['mem_2', 'mem_1'] }),
    ];
    expect(computeDroppedConsiderations(responses, { sourceMemoryIds: ['mem_1'] })).toEqual(['mem_2', 'mem_3']);
    expect(computeDroppedConsiderations(responses, { sourceMemoryIds: ['mem_1', 'mem_2', 'mem_3', 'mem_x'] })).toEqual([]);
    expect(computeDroppedConsiderations([], { sourceMemoryIds: [] })).toEqual([]);
  });
});

describe('debate — env switches', () => {
  it('DEBATE_ROUND2 defaults on; false/0/off disable; MAX_REBUTTALS defaults 3', () => {
    expect(debateEnabled({})).toBe(true);
    expect(debateEnabled({ DEBATE_ROUND2: 'false' })).toBe(false);
    expect(debateEnabled({ DEBATE_ROUND2: '0' })).toBe(false);
    expect(debateEnabled({ DEBATE_ROUND2: 'TRUE' })).toBe(true);
    expect(maxRebuttals({})).toBe(3);
    expect(maxRebuttals({ MAX_REBUTTALS: '1' })).toBe(1);
    expect(maxRebuttals({ MAX_REBUTTALS: 'nope' })).toBe(3);
  });
});
