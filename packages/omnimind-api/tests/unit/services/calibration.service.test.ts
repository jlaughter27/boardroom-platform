import { describe, it, expect } from 'vitest';
import {
  computeCalibration,
  binIndex,
  recommendationMatchesChosenPath,
  CALIBRATION_MIN_FOR_SIGNAL,
} from '../../../src/services/calibration.service';

describe('calibration math (Phase 6)', () => {
  it('bins forecasts into [0,.2) [.2,.4) [.4,.6) [.6,.8) [.8,1]', () => {
    expect(binIndex(0)).toBe(0);
    expect(binIndex(0.19)).toBe(0);
    expect(binIndex(0.2)).toBe(1);
    expect(binIndex(0.59)).toBe(2);
    expect(binIndex(0.6)).toBe(3);
    expect(binIndex(0.79)).toBe(3);
    expect(binIndex(0.8)).toBe(4);
    expect(binIndex(1)).toBe(4);
    expect(binIndex(1.5)).toBe(4); // clamped
  });

  it('matches recommendation to chosenPath exactly or by case-insensitive prefix (either way)', () => {
    expect(recommendationMatchesChosenPath('Hire now', 'hire now')).toBe(true);
    expect(recommendationMatchesChosenPath('Hire now', 'Hire now, but part-time')).toBe(true);
    expect(recommendationMatchesChosenPath('Hire now, but part-time', 'hire now')).toBe(true);
    expect(recommendationMatchesChosenPath('Wait', 'Hire now')).toBe(false);
    expect(recommendationMatchesChosenPath('Hire now', null)).toBe(false);
    expect(recommendationMatchesChosenPath('   ', 'Hire now')).toBe(false);
  });

  it('computes Brier = mean((p − o)²) with o = outcomeRating ≥ threshold', () => {
    const report = computeCalibration([
      { chosenPath: 'A', probabilitySuccess: 0.9, outcomeRating: 5, personaForecasts: [] }, // (0.9-1)² = 0.01
      { chosenPath: 'A', probabilitySuccess: 0.7, outcomeRating: 2, personaForecasts: [] }, // (0.7-0)² = 0.49
      { chosenPath: 'A', probabilitySuccess: 0.3, outcomeRating: 4, personaForecasts: [] }, // (0.3-1)² = 0.49
      { chosenPath: 'A', probabilitySuccess: 0.1, outcomeRating: 1, personaForecasts: [] }, // (0.1-0)² = 0.01
    ], 4);
    expect(report.reviewedDecisions).toBe(4);
    expect(report.user.brier).toBeCloseTo(0.25, 4);
    expect(report.successThreshold).toBe(4);
    expect(report.minimumForSignal).toBe(CALIBRATION_MIN_FOR_SIGNAL);
  });

  it('skips decisions missing outcomeRating or probabilitySuccess', () => {
    const report = computeCalibration([
      { chosenPath: 'A', probabilitySuccess: null, outcomeRating: 5, personaForecasts: [] },
      { chosenPath: 'A', probabilitySuccess: 0.5, outcomeRating: null, personaForecasts: [] },
    ]);
    expect(report.reviewedDecisions).toBe(0);
    expect(report.user.brier).toBeNull();
    expect(report.user.bins).toHaveLength(5);
    expect(report.user.bins.every(b => b.count === 0)).toBe(true);
  });

  it('fills bins with count, meanForecast and observedRate', () => {
    const report = computeCalibration([
      { chosenPath: 'A', probabilitySuccess: 0.85, outcomeRating: 5, personaForecasts: [] },
      { chosenPath: 'A', probabilitySuccess: 0.95, outcomeRating: 2, personaForecasts: [] },
      { chosenPath: 'A', probabilitySuccess: 0.25, outcomeRating: 4, personaForecasts: [] },
    ]);
    const top = report.user.bins[4];
    expect(top).toMatchObject({ lower: 0.8, upper: 1, count: 2, meanForecast: 0.9, observedRate: 0.5 });
    const second = report.user.bins[1];
    expect(second).toMatchObject({ lower: 0.2, upper: 0.4, count: 1, meanForecast: 0.25, observedRate: 1 });
    expect(report.user.bins[0].count).toBe(0);
  });

  it('scores a persona only where its recommendation matched chosenPath', () => {
    const report = computeCalibration([
      {
        chosenPath: 'Ship in Q1',
        probabilitySuccess: 0.6,
        outcomeRating: 5,
        personaForecasts: [
          { personaId: 'optimist', recommendation: 'ship in q1', confidence: 0.9 },   // match → (0.9-1)² = 0.01
          { personaId: 'critic', recommendation: 'Delay to Q2', confidence: 0.8 },     // no match → skipped
        ],
      },
      {
        chosenPath: 'Delay to Q2',
        probabilitySuccess: 0.4,
        outcomeRating: 1,
        personaForecasts: [
          { personaId: 'optimist', recommendation: 'Ship in Q1', confidence: 0.7 },    // no match
          { personaId: 'critic', recommendation: 'Delay to Q2 and re-plan', confidence: 0.6 }, // prefix match → (0.6-0)² = 0.36
        ],
      },
    ]);
    expect(Object.keys(report.personas).sort()).toEqual(['critic', 'optimist']);
    expect(report.personas.optimist.count).toBe(1);
    expect(report.personas.optimist.brier).toBeCloseTo(0.01, 4);
    expect(report.personas.critic.count).toBe(1);
    expect(report.personas.critic.brier).toBeCloseTo(0.36, 4);
  });

  it('ignores malformed personaForecasts payloads', () => {
    const report = computeCalibration([
      { chosenPath: 'A', probabilitySuccess: 0.5, outcomeRating: 4, personaForecasts: 'garbage' },
      { chosenPath: 'A', probabilitySuccess: 0.5, outcomeRating: 4, personaForecasts: [{ personaId: 'x', recommendation: 'A', confidence: 7 }] },
    ]);
    expect(report.reviewedDecisions).toBe(2);
    expect(report.personas).toEqual({});
  });
});
