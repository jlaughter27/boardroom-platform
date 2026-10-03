import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  buildOverdueWhere,
  buildDueSoonWhere,
  getCommitmentNudges,
  getCachedNudges,
  invalidateNudgeCache,
  renderCommitmentLines,
  NUDGE_HORIZON_DAYS,
} from '../../../src/services/commitment.service';

const now = new Date('2026-10-02T09:00:00Z');
const day = 86_400_000;

describe('commitment nudges (Phase 6, SQL only)', () => {
  it('overdue = OPEN, not deleted, deadline < now', () => {
    expect(buildOverdueWhere('u1', now)).toEqual({ userId: 'u1', deletedAt: null, status: 'OPEN', deadline: { lt: now } });
  });

  it('dueSoon = OPEN, not deleted, now <= deadline <= now + 3 days', () => {
    expect(NUDGE_HORIZON_DAYS).toBe(3);
    expect(buildDueSoonWhere('u1', now)).toEqual({
      userId: 'u1', deletedAt: null, status: 'OPEN',
      deadline: { gte: now, lte: new Date(now.getTime() + 3 * day) },
    });
  });

  describe('getCommitmentNudges', () => {
    const mockPrisma = { commitment: { findMany: vi.fn() } } as any;
    const overdueRow = { id: 'c1', description: 'Send invoice', deadline: new Date(now.getTime() - 2 * day), status: 'OPEN' };
    const soonRow = { id: 'c2', description: 'Call Dana', deadline: new Date(now.getTime() + 1 * day), status: 'OPEN' };

    beforeEach(() => {
      vi.clearAllMocks();
      invalidateNudgeCache('u1');
      mockPrisma.commitment.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(where.deadline.lt ? [overdueRow] : [soonRow]),
      );
    });

    it('runs both queries ordered by deadline asc and splits into {dueSoon, overdue}', async () => {
      const res = await getCommitmentNudges('u1', mockPrisma, now);
      expect(res.overdue).toEqual([overdueRow]);
      expect(res.dueSoon).toEqual([soonRow]);
      expect(mockPrisma.commitment.findMany).toHaveBeenCalledTimes(2);
      for (const call of mockPrisma.commitment.findMany.mock.calls) {
        expect(call[0].orderBy).toEqual({ deadline: 'asc' });
        expect(call[0].where.status).toBe('OPEN');
        expect(call[0].where.deletedAt).toBeNull();
      }
    });

    it('refreshes the in-process nudge list the daily job also writes', async () => {
      expect(getCachedNudges('u1')).toBeNull();
      const res = await getCommitmentNudges('u1', mockPrisma, now);
      expect(getCachedNudges('u1')).toEqual(res);
      invalidateNudgeCache('u1');
      expect(getCachedNudges('u1')).toBeNull();
    });
  });

  it('renders Doer "Open commitments" lines: overdue first, with relative day counts', () => {
    const lines = renderCommitmentLines({
      overdue: [{ id: 'c1', description: 'Send invoice', deadline: new Date(now.getTime() - 2 * day) } as any],
      dueSoon: [
        { id: 'c2', description: 'Call Dana', deadline: new Date(now.getTime() + 1 * day) } as any,
        { id: 'c3', description: 'Ship fix', deadline: new Date(now.getTime() + 2 * 60 * 60 * 1000) } as any,
      ],
    }, now);
    expect(lines).toEqual([
      'OVERDUE: Send invoice — due 2026-09-30 (2d overdue)',
      'DUE SOON: Call Dana — due 2026-10-03 (in 1d)',
      'DUE SOON: Ship fix — due 2026-10-02 (today)',
    ]);
  });
});
