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

  // RD-12 — byte-identical guard: this is the exact block (and hash) the
  // renderer produced at 75d75ae, before the delegations section existed.
  const GOLDEN_BLOCK = '# Core context\n\n## Profile\n- decision_frequency: weekly\n- industry: SaaS\n- risk_profile: financial=0.30, strategic=0.70\n- role: Founder\n- values: family > craft\n\n## Active goals (top 8)\n- Grow ARR (level 0, business)\n- Launch v2 (level 1, business, due 2026-12-01)\n  - projects: API; Billing\n\n## Open commitments (due within 14 days)\n- Send proposal to Dana — due 2026-10-05\n- Call accountant\n\n## Standing constraints\n- Keep burn under 20k\n- No hires before Q2\n';
  const GOLDEN_HASH = '57d054fa4b659b6a43e2afd02977d9a9d9104659e6a986b344f492fe583fc6a5';

  it('RD-12: a fixture with no delegations renders byte-identical to the pre-RD-12 block', () => {
    expect(renderCoreBlock(baseInput())).toBe(GOLDEN_BLOCK);
    expect(hashBlock(renderCoreBlock(baseInput()))).toBe(GOLDEN_HASH);
    expect(renderCoreBlock({ ...baseInput(), delegations: [] })).toBe(GOLDEN_BLOCK);
  });

  it('RD-12: delegations add a sorted "Waiting on others" section after open commitments', () => {
    const block = renderCoreBlock({
      ...baseInput(),
      delegations: [
        { id: 'd2', description: 'Return the projector', deadline: null, personName: null },
        { id: 'd1', description: 'Send the volunteer rota', deadline: '2026-11-07', personName: 'Sam Rivera' },
      ],
    });
    expect(block).toContain('- Call accountant\n\n## Waiting on others (due within 14 days)\n- Sam Rivera: Send the volunteer rota — due 2026-11-07\n- someone: Return the projector\n\n## Standing constraints');
    expect(block).not.toContain('to Sam Rivera');
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

    it('R-O-05: constraint memories are tenant-scoped for agents and the cache is keyed per (user, tenant)', async () => {
      await getCoreContext('u1', mockPrisma, { tenantId: 'josh-business' });
      expect(mockPrisma.memoryEntry.findMany.mock.calls[0][0].where).toMatchObject({ userId: 'u1', tags: { has: 'constraint' }, tenantId: 'josh-business' });

      // same user, no tenant (BoardRoom) → separate slot + unscoped query
      await getCoreContext('u1', mockPrisma);
      expect(mockPrisma.goal.findMany).toHaveBeenCalledTimes(2);
      expect(mockPrisma.memoryEntry.findMany.mock.calls[1][0].where).not.toHaveProperty('tenantId');

      // same user, other tenant → third slot
      await getCoreContext('u1', mockPrisma, { tenantId: 'tgfc-ministry' });
      expect(mockPrisma.goal.findMany).toHaveBeenCalledTimes(3);

      // cache hits within the TTL for each variant
      await getCoreContext('u1', mockPrisma, { tenantId: 'josh-business' });
      await getCoreContext('u1', mockPrisma);
      expect(mockPrisma.goal.findMany).toHaveBeenCalledTimes(3);

      // invalidation clears every tenant variant for that user
      invalidateCoreContext('u1');
      await getCoreContext('u1', mockPrisma, { tenantId: 'josh-business' });
      await getCoreContext('u1', mockPrisma);
      await getCoreContext('u1', mockPrisma, { tenantId: 'tgfc-ministry' });
      expect(mockPrisma.goal.findMany).toHaveBeenCalledTimes(6);
    });

    it('RD-12: the user-owed query filters owedBy USER; a second take-5 query loads delegations', async () => {
      mockPrisma.commitment.findMany.mockImplementation(({ where }: any) => Promise.resolve(where.owedBy === 'STAKEHOLDER'
        ? [{ id: 'd1', description: 'Send the volunteer rota', deadline: new Date('2026-10-07T23:59:59.999Z'), stakeholder: { name: 'Sam Rivera' } }]
        : [{ id: 'c1', description: 'Ship', deadline: new Date('2026-10-04T10:00:00Z'), stakeholder: { name: 'Lee' } }]));
      const out = await getCoreContext('u1', mockPrisma);
      const calls = mockPrisma.commitment.findMany.mock.calls.map((c: any) => c[0]);
      expect(calls).toHaveLength(2);
      const own = calls.find((c: any) => c.where.owedBy === 'USER');
      const del = calls.find((c: any) => c.where.owedBy === 'STAKEHOLDER');
      expect(own.take).toBe(20);
      expect(del.take).toBe(5);
      expect(del.include).toEqual(own.include);
      expect(del.orderBy).toEqual(own.orderBy);
      expect({ ...del.where, owedBy: 'USER', deadline: null }).toEqual({ ...own.where, deadline: null });
      expect(out.block).toContain('- Ship to Lee — due 2026-10-04');
      expect(out.block).toContain('## Waiting on others (due within 14 days)\n- Sam Rivera: Send the volunteer rota — due 2026-10-07');
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
