import { describe, it, expect } from 'vitest';
import type { CalibrationReport, Goal, Person, Project } from '@boardroom/shared';
import { matchQuestionToEntities, significantTokens } from '../../../src/components/decision/WhatChangedCard';
import { buildSeries } from '../../../src/components/decision/CalibrationPanel';
import { probabilityLabel } from '../../../src/components/decision/DecisionCommitCard';
import { relativeDue } from '../../../src/components/dashboard/CommitmentNudgesWidget';
import { effectiveState } from '../../../src/components/dashboard/WeeklyMemoCard';
import { fillDays, overallCacheHitRate } from '../../../src/components/dashboard/LlmCostWidget';
import { CLIENT_MODE_CONFIGS, memoItemKey } from '../../../src/types/debate';

const goal = (id: string, title: string) => ({ id, title } as Goal);
const project = (id: string, title: string) => ({ id, title } as Project);
const person = (id: string, name: string) => ({ id, name } as Person);

describe('WhatChangedCard matching', () => {
  it('drops short tokens and stop words', () => {
    expect([...significantTokens('Should we hire for the Atlas project?')]).toEqual(['hire', 'atlas']);
  });

  it('matches case-insensitively on ≥1 significant word of ≥4 chars', () => {
    const m = matchQuestionToEntities('should we pause ATLAS migration this quarter', {
      goals: [goal('g1', 'Ship v2'), goal('g2', 'Quarterly revenue')],
      projects: [project('p1', 'Atlas migration'), project('p2', 'Hiring plan')],
      people: [person('x', 'Mo')],
    });
    expect(m[0]).toMatchObject({ type: 'project', id: 'p1', overlap: 2 });
    expect(m.some((e) => e.id === 'p2')).toBe(false);
  });

  it('matches people by name and prefers the more specific title on ties', () => {
    const m = matchQuestionToEntities('what did Priya say about pricing', {
      goals: [],
      projects: [project('p1', 'Pricing experiments and packaging'), project('p2', 'Pricing page')],
      people: [person('pe1', 'Priya Raman')],
    });
    expect(m).toHaveLength(3);
    expect(m.every((e) => e.overlap === 1)).toBe(true);
    // Ties on overlap are broken by shorter (more specific) title first
    expect(m.map((e) => e.id)).toEqual(['pe1', 'p2', 'p1']);
    expect(m.find((e) => e.id === 'pe1')?.type).toBe('person');
  });

  it('returns nothing for empty / stop-word-only questions', () => {
    expect(matchQuestionToEntities('what should we do', { goals: [goal('g', 'Anything')], projects: [], people: [] })).toEqual([]);
  });
});

describe('CalibrationPanel series', () => {
  const bins = [0, 0.2, 0.4, 0.6, 0.8].map((lower, i) => ({ lower, upper: i === 4 ? 1 : lower + 0.2, count: 2, meanForecast: lower + 0.1, observedRate: lower + 0.05 }));
  const report: CalibrationReport = {
    reviewedDecisions: 22,
    minimumForSignal: 20,
    successThreshold: 4,
    user: { brier: 0.18, bins },
    personas: {
      critic: { brier: 0.22, count: 12, bins },
      optimist: { brier: 0.3, count: 3, bins },
    },
  };

  it('puts the user first and drops personas under 5 counts', () => {
    const s = buildSeries(report);
    expect(s.map((x) => x.id)).toEqual(['user', 'critic']);
    expect(s[0].color).toBe('var(--color-primary)');
    expect(s[1].label).toBe('Critic');
  });
});

describe('small helpers', () => {
  it('probabilityLabel reads like a forecast', () => {
    expect(probabilityLabel(70)).toBe("I'd give this a 70 % chance");
  });

  it('relativeDue', () => {
    const now = new Date('2026-10-02T12:00:00Z').getTime();
    expect(relativeDue('2026-10-02T15:00:00Z', now)).toBe('due today');
    expect(relativeDue('2026-10-03T12:00:00Z', now)).toBe('due tomorrow');
    expect(relativeDue('2026-10-05T12:00:00Z', now)).toBe('due in 3 days');
    expect(relativeDue('2026-09-30T12:00:00Z', now)).toBe('2 days overdue');
    expect(relativeDue(null, now)).toBe('no deadline');
  });

  it('memo item keys and expired snoozes', () => {
    expect(memoItemKey('patternsNoticed', 2)).toBe('patternsNoticed:2');
    const now = new Date('2026-10-02T00:00:00Z').getTime();
    expect(effectiveState({ state: 'snoozed', until: '2026-10-01T00:00:00Z' }, now)).toBeUndefined();
    expect(effectiveState({ state: 'snoozed', until: '2026-10-09T00:00:00Z' }, now)?.state).toBe('snoozed');
    expect(effectiveState({ state: 'accepted', memoryId: 'm' }, now)?.state).toBe('accepted');
  });

  it('cost widget math', () => {
    expect(overallCacheHitRate([{ purpose: 'a', usd: 1, calls: 10, cacheHitRate: 0.5 }, { purpose: 'b', usd: 1, calls: 30, cacheHitRate: 0.9 }])).toBeCloseTo(0.8);
    expect(overallCacheHitRate([])).toBeNull();
    const today = new Date('2026-10-02T12:00:00Z');
    const days = fillDays([{ date: '2026-10-01', usd: 2, calls: 4 }], 3, today);
    expect(days.map((d) => d.date)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02']);
    expect(days[1].usd).toBe(2);
    expect(days[2].usd).toBe(0);
  });

  it('pre-mortem mode is selectable', () => {
    expect(CLIENT_MODE_CONFIGS.premortem.label).toBe('Pre-mortem');
    expect(CLIENT_MODE_CONFIGS.premortem.personas).toEqual(['critic', 'technician', 'questionnaire']);
  });
});
