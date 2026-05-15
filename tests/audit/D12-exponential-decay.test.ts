/**
 * D12 — Exponential Decay + Recall Reinforcement Audit Test
 *
 * WS-3.1: Replaced linear `importance -= 0.05` with the YourMemory pattern:
 *
 *   strength = importance * EXP(-λ * days_since_access) * (1 + recall_count * 0.2)
 *   λ        = 0.16 * (1 - importance * 0.8)
 *
 * These tests validate the pure formula via `computeDecayedImportance`. The
 * SQL path is exercised indirectly — the formula is the contract.
 */
import { describe, it, expect } from 'vitest';
import { computeDecayedImportance } from '../../packages/omnimind-api/src/services/importance-decay.service';

describe('D12 — Exponential decay with recall reinforcement', () => {
  it('zero days, zero recalls → strength equals importance', () => {
    const strength = computeDecayedImportance({
      importance: 0.7,
      recallCount: 0,
      daysSinceAccess: 0,
    });
    // EXP(0) = 1, reinforcement = 1 → 0.7 * 1 * 1 = 0.7
    expect(strength).toBeCloseTo(0.7, 5);
  });

  it('high recall_count outranks low recall_count for identical importance', () => {
    // Both have importance 0.5 and were accessed 7 days ago,
    // but one has been recalled 5 times, the other 0.
    const accessed = computeDecayedImportance({
      importance: 0.5,
      recallCount: 5,
      daysSinceAccess: 7,
    });
    const stale = computeDecayedImportance({
      importance: 0.5,
      recallCount: 0,
      daysSinceAccess: 7,
    });

    // Reinforcement factor: 5 recalls → 1 + 5*0.2 = 2.0x
    expect(accessed).toBeGreaterThan(stale);
    // Specifically: accessed should be ~2x stale (the recall multiplier)
    expect(accessed / stale).toBeCloseTo(2.0, 5);
  });

  it('higher importance decays slower (smaller λ)', () => {
    // After 30 days, no recalls, compare two memories starting at different
    // importance. The high-importance one should retain more of its starting
    // value (proportionally).
    const highStart = 0.9;
    const lowStart = 0.3;

    const highAfter = computeDecayedImportance({
      importance: highStart,
      recallCount: 0,
      daysSinceAccess: 30,
    });
    const lowAfter = computeDecayedImportance({
      importance: lowStart,
      recallCount: 0,
      daysSinceAccess: 30,
    });

    const highRetention = highAfter / highStart;
    const lowRetention = lowAfter / lowStart;

    // λ_high = 0.16 * (1 - 0.9*0.8) = 0.16 * 0.28 = 0.0448
    // λ_low  = 0.16 * (1 - 0.3*0.8) = 0.16 * 0.76 = 0.1216
    // High-importance retention factor > low-importance retention factor
    expect(highRetention).toBeGreaterThan(lowRetention);
  });

  it('ordering: accessed-recently-with-recalls > old-untouched', () => {
    // Memory A: importance 0.6, accessed today, recalled 3 times
    // Memory B: importance 0.6, last accessed 60 days ago, never recalled
    const a = computeDecayedImportance({
      importance: 0.6,
      recallCount: 3,
      daysSinceAccess: 0,
    });
    const b = computeDecayedImportance({
      importance: 0.6,
      recallCount: 0,
      daysSinceAccess: 60,
    });

    expect(a).toBeGreaterThan(b);
  });

  it('ordering changes vs. importance-only ranking', () => {
    // Memory C has lower starting importance (0.4) but has been recalled
    // many times (10) and accessed recently. Memory D has higher importance
    // (0.7) but no recalls and was last accessed 14 days ago.
    //
    // Under the old linear -0.05/week scheme, D would always outrank C.
    // Under the new formula, C's reinforcement may overtake D — this is
    // exactly the YourMemory thesis (52% Recall@5 win).
    const c = computeDecayedImportance({
      importance: 0.4,
      recallCount: 10,
      daysSinceAccess: 1,
    });
    const d = computeDecayedImportance({
      importance: 0.7,
      recallCount: 0,
      daysSinceAccess: 14,
    });

    // C: 0.4 * EXP(-0.1088 * 1) * (1 + 2)  ≈ 0.4 * 0.897 * 3.0 ≈ 1.076 → clamped to 1.0
    // D: 0.7 * EXP(-0.0704 * 14) * 1       ≈ 0.7 * 0.373        ≈ 0.261
    expect(c).toBeGreaterThan(d);
  });

  it('strength is clamped to [0, 1]', () => {
    // Extreme reinforcement should not overflow.
    const high = computeDecayedImportance({
      importance: 1.0,
      recallCount: 100,
      daysSinceAccess: 0,
    });
    expect(high).toBeLessThanOrEqual(1.0);
    expect(high).toBeGreaterThanOrEqual(0.0);

    const veryOld = computeDecayedImportance({
      importance: 0.1,
      recallCount: 0,
      daysSinceAccess: 365 * 10,
    });
    expect(veryOld).toBeGreaterThanOrEqual(0.0);
  });
});
