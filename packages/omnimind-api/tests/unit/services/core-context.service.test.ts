import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderCoreBlock,
  hashBlock,
  getCoreContext,
  invalidateCoreContext,
  __resetCoreContextCacheForTest,
  type CoreContextInput,
} from '../../../src/services/core-context.service';

vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const baseInput = (): CoreContextInput => ({
  profile: {
    role: 'Founder',
    industry: 'SaaS',
    decisionFrequency: 'weekly',
    riskProfile: { strategic: 0.7, financial: 0.3 },
    valueHierarchy: ['family', 'craft'],
  },
  goals: [
    { id: 'g2', title: 'Launch v2', level: 1, status: 'active', deadline: '2026-12-01', domain: 'business', projects: ['Billing', 'API'] },
    { id: 'g1', title: 'Grow ARR', level: 0, status: 'active', deadline: null, domain: 'business', projects: [] },
  ],
  commitments: [
    { id: 'c1', description: 'Send proposal', deadline: '2026-10-05', personName: 'Dana' },
    { id: 'c2', description: 'Call accountant', deadline: null, personName: null },
  ],
  constraints: ['No hires before Q2', 'Keep burn under 20k'],
});

describe('core context (Phase 6)', () => {
  beforeEach(() => __resetCoreContextCacheForTest());

  it('is deterministic: same input → same block + hash regardless of input ordering', () => {
    const a = baseInput();
    const b = baseInput();
    b.goals.reverse();
    b.commitments.reverse();
    b.constraints.reverse();
    b.profile!.riskProfile = { financial: 0.3, strategic: 0.7 }; // key order differs
    b.goals[0].projects = [...b.goals[0].projects].reverse();

    const blockA = renderCoreBlock(a);
    const blockB = renderCoreBlock(b);
    expect(blockA).toBe(blockB);
    expect(hashBlock(blockA)).toBe(hashBlock(blockB));
    expect(hashBlock(blockA)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('contains no timestamps (no ISO datetimes, no "now"-relative phrasing)', () => {
    const block = renderCoreBlock(baseInput());
    expect(block).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/); // no ISO datetime
    expect(block).not.toMatch(/\bin \d+ ?d(ays)?\b/i);           // no relative "in 3 days"
    expect(block).not.toMatch(/generated|as of/i);
    // absolute dates ARE allowed (they only change when data changes)
    expect(block).toContain('due 2026-12-01');
  });

  it('renders profile, goals with projects, commitments with names, constraints — sorted', () => {
    const block = renderCoreBlock(baseInput());
    expect(block).toContain('# Core context');
    expect(block).toContain('- role: Founder');
    expect(block).toContain('- risk_profile: financial=0.30, strategic=0.70');
    expect(block).toContain('- values: family > craft');
    // level 0 before level 1
    expect(block.indexOf('Grow ARR')).toBeLessThan(block.indexOf('Launch v2'));
    expect(block).toContain('  - projects: API; Billing');
    // dated commitment before undated
    expect(block.indexOf('Send proposal to Dana — due 2026-10-05')).toBeLessThan(block.indexOf('Call accountant'));
    expect(block).toContain('- Keep burn under 20k\n- No hires before Q2');
  });

  it('caps goals at 8, lowest level first', () => {
    const input = baseInput();
    input.goals = Array.from({ length: 12 }, (_, i) => ({
      id: `g${i}`, title: `Goal ${String(i).padStart(2, '0')}`, level: i < 6 ? 1 : 0, status: 'active', deadline: null, domain: '', projects: [],
    }));
    const block = renderCoreBlock(input);
    const goalLines = block.split('\n').filter(l => /^- Goal \d\d/.test(l));
    expect(goalLines).toHaveLength(8);
    // all six level-0 goals (06..11) present, then two level-1
    expect(goalLines.slice(0, 6).every(l => /Goal (06|07|08|09|10|11)/.test(l))).toBe(true);
  });

  it('changes the hash when data changes', () => {
    const a = renderCoreBlock(baseInput());
    const input = baseInput();
    input.commitments.push({ id: 'c3', description: 'New promise', deadline: '2026-10-09', personName: null });
    expect(hashBlock(renderCoreBlock(input))).not.toBe(hashBlock(a));
  });

  describe('getCoreContext cache + invalidation', () => {
    const mockPrisma = {
      userProfile: { findUnique: vi.fn() },
      goal: { findMany: vi.fn() },
      commitment: { findMany: vi.fn() },
      memoryEntry: { findMany: vi.fn() },
    } as any;

    beforeEach(() => {
      vi.clearAllMocks();
      mockPrisma.userProfile.findUnique.mockResolvedValue({ role: 'Founder', industry: null, decisionFrequency: null, riskProfile: { strategic: 0.5 }, valueHierarchy: [] });
      mockPrisma.goal.findMany.mockResolvedValue([{ id: 'g1', title: 'Grow', level: 0, status: 'active', deadline: null, domain: '', projectLinks: [{ project: { title: 'P', deletedAt: null, status: 'active' } }] }]);
      mockPrisma.commitment.findMany.mockResolvedValue([{ id: 'c1', description: 'Ship', deadline: new Date('2026-10-04T10:00:00Z'), stakeholder: { name: 'Lee' } }]);
      mockPrisma.memoryEntry.findMany.mockResolvedValue([{ title: 'Constraint A' }]);
    });

    it('serves from cache within the TTL and refetches after invalidation', async () => {
      const first = await getCoreContext('u1', mockPrisma);
      expect(first.tokensEstimate).toBeGreaterThan(0);
      expect(first.block).toContain('Ship to Lee — due 2026-10-04');
      expect(first.block).toContain('- Constraint A');
      expect(mockPrisma.goal.findMany).toHaveBeenCalledTimes(1);

      const second = await getCoreContext('u1', mockPrisma);
      expect(second).toBe(first); // same cached object
      expect(mockPrisma.goal.findMany).toHaveBeenCalledTimes(1);

      invalidateCoreContext('u1');
      const third = await getCoreContext('u1', mockPrisma);
      expect(mockPrisma.goal.findMany).toHaveBeenCalledTimes(2);
      expect(third.hash).toBe(first.hash); // data unchanged → same hash even though generatedAt differs
    });

    it('caches per user', async () => {
      await getCoreContext('u1', mockPrisma);
      await getCoreContext('u2', mockPrisma);
      expect(mockPrisma.goal.findMany).toHaveBeenCalledTimes(2);
      expect(mockPrisma.goal.findMany.mock.calls[1][0].where.userId).toBe('u2');
    });

    it('queries only live, active, level ≤ 1 goals and open commitments inside the 14-day horizon', async () => {
      await getCoreContext('u1', mockPrisma);
      expect(mockPrisma.goal.findMany.mock.calls[0][0].where).toMatchObject({ userId: 'u1', deletedAt: null, status: 'active', level: { lte: 1 } });
      const cw = mockPrisma.commitment.findMany.mock.calls[0][0].where;
      expect(cw).toMatchObject({ userId: 'u1', deletedAt: null, status: 'OPEN' });
      const lte: Date = cw.deadline.lte;
      const days = (lte.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(13.9);
      expect(days).toBeLessThanOrEqual(14.01);
    });
  });
});
