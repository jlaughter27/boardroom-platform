import { describe, it, expect, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({ $executeRaw: vi.fn() }));
vi.mock('../../../src/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { computeDecayedImportance, runImportanceDecay } from '../../../src/services/importance-decay.service';

describe('importance decay (O-103: non-compounding)', () => {
  it('is idempotent: applying the formula twice from the same base yields the same value', () => {
    const once = computeDecayedImportance({ baseImportance: 0.5, recallCount: 0, daysSinceAccess: 7 });
    const again = computeDecayedImportance({ baseImportance: 0.5, recallCount: 0, daysSinceAccess: 7 });
    expect(again).toBe(once);
    // The OLD behaviour fed the decayed value back in as the base — that must be strictly lower.
    const compounded = computeDecayedImportance({ baseImportance: once, recallCount: 0, daysSinceAccess: 7 });
    expect(compounded).toBeLessThan(once);
  });

  it('a recall (days reset to 0) restores importance to the full base, not the decayed floor', () => {
    const decayed = computeDecayedImportance({ baseImportance: 0.8, recallCount: 0, daysSinceAccess: 30 });
    expect(decayed).toBeLessThan(0.8);
    const afterRecall = computeDecayedImportance({ baseImportance: 0.8, recallCount: 1, daysSinceAccess: 0 });
    expect(afterRecall).toBeGreaterThanOrEqual(0.8);
  });

  it('higher base decays slower (λ = 0.16·(1 − 0.8·base))', () => {
    const low = computeDecayedImportance({ baseImportance: 0.2, recallCount: 0, daysSinceAccess: 10 }) / 0.2;
    const high = computeDecayedImportance({ baseImportance: 1.0, recallCount: 0, daysSinceAccess: 10 }) / 1.0;
    expect(high).toBeGreaterThan(low);
  });

  it('clamps to [0, 1]', () => {
    expect(computeDecayedImportance({ baseImportance: 1, recallCount: 50, daysSinceAccess: 0 })).toBe(1);
    expect(computeDecayedImportance({ baseImportance: 0, recallCount: 0, daysSinceAccess: 0 })).toBe(0);
  });

  it('SQL recomputes from base_importance and uses COALESCE(last_accessed_at, created_at)', async () => {
    mockPrisma.$executeRaw.mockResolvedValue(7);
    const result = await runImportanceDecay();
    expect(result).toEqual({ decayed: 7 });
    const [strings] = mockPrisma.$executeRaw.mock.calls[0];
    const sql = (strings as string[]).join('?').replace(/\s+/g, ' ');
    expect(sql).toContain('SET base_importance = COALESCE(base_importance, importance)');
    expect(sql).toContain('COALESCE(base_importance, importance) * EXP(');
    expect(sql).toContain('COALESCE(last_accessed_at, created_at)');
    // never multiplies the already-decayed `importance` column by the decay factor
    expect(sql).not.toMatch(/0\.0, importance \* EXP/);
  });
});
