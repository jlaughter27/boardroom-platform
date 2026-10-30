import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  buildOverdueWhere,
  buildDueSoonWhere,
  buildWaitingLaterWhere,
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

  it('waitingLater = OPEN delegations (owedBy STAKEHOLDER) due after the horizon or undated', () => {
    const horizon = new Date(now.getTime() + NUDGE_HORIZON_DAYS * day);
    expect(buildWaitingLaterWhere('u1', now)).toEqual({
      userId: 'u1', deletedAt: null, status: 'OPEN', owedBy: 'STAKEHOLDER',
      OR: [{ deadline: { gt: horizon } }, { deadline: null }],
    });
  });

  it('a delegation due next week is returned in waitingLater, never dropped (real-vault e2e 2026-10-30)', async () => {
    const later = { id: 'd9', description: 'Send the rota', status: 'OPEN', owedBy: 'STAKEHOLDER', deadline: new Date(now.getTime() + 7 * day), stakeholder: { name: 'Pat Example' } };
    const prisma = { commitment: { findMany: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(where.OR ? [later] : [])) } } as any;
    const res = await getCommitmentNudges('u1', prisma, now);
    expect(res.waitingLater).toEqual([expect.objectContaining({ id: 'd9', stakeholderName: 'Pat Example' })]);
    expect(res.overdue).toEqual([]);
    expect(res.dueSoon).toEqual([]);
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
        Promise.resolve(where.OR ? [] : where.deadline.lt ? [overdueRow] : [soonRow]),
      );
    });

    it('runs both queries ordered by deadline asc and splits into {dueSoon, overdue}', async () => {
      const res = await getCommitmentNudges('u1', mockPrisma, now);
      expect(res.overdue).toEqual([{ ...overdueRow, stakeholderName: null }]);
      expect(res.dueSoon).toEqual([{ ...soonRow, stakeholderName: null }]);
      expect(res.waitingLater).toEqual([]);
      expect(mockPrisma.commitment.findMany).toHaveBeenCalledTimes(3);
      for (const call of mockPrisma.commitment.findMany.mock.calls.slice(0, 2)) {
        expect(call[0].orderBy).toEqual({ deadline: 'asc' });
        expect(call[0].where.status).toBe('OPEN');
        expect(call[0].where.deletedAt).toBeNull();
      }
    });

    it('RD-12: includes the stakeholder name and flattens it to stakeholderName (null-safe, no nested key)', async () => {
      mockPrisma.commitment.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(where.OR ? [] : where.deadline.lt
          ? [{ ...overdueRow, owedBy: 'STAKEHOLDER', stakeholderId: 'p1', stakeholder: { name: 'Sam Rivera' } }]
          : [{ ...soonRow, owedBy: 'USER', stakeholderId: null, stakeholder: null }]),
      );
      const res = await getCommitmentNudges('u1', mockPrisma, now);
      for (const call of mockPrisma.commitment.findMany.mock.calls) {
        expect(call[0].include).toEqual({ stakeholder: { select: { name: true } } });
        expect(call[0].take).toBe(50);
      }
      // where-builders unchanged
      expect(mockPrisma.commitment.findMany.mock.calls.map((c: any) => c[0].where)).toEqual(
        expect.arrayContaining([buildOverdueWhere('u1', now), buildDueSoonWhere('u1', now)]),
      );
      expect(res.overdue[0]).toMatchObject({ id: 'c1', owedBy: 'STAKEHOLDER', stakeholderName: 'Sam Rivera' });
      expect(res.dueSoon[0]).toMatchObject({ id: 'c2', owedBy: 'USER', stakeholderName: null });
      expect(res.overdue[0]).not.toHaveProperty('stakeholder');
      expect(res.dueSoon[0]).not.toHaveProperty('stakeholder');
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
