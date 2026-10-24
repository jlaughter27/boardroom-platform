import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderCoreBlock,
  hashBlock,
  getCoreContext,
  invalidateCoreContext,
  __resetCoreContextCacheForTest,
  type CoreContextInput,
} from '../../../src/services/core-context.service';
import { createEntity, updateEntity, deleteEntity } from '../../../src/services/entity.service';
import { computeLoad, type LoadInput } from '../../../src/services/load.service';
import { logger } from '../../../src/lib/logger';

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

  // ── RD-11 — `## Current load` section ──

  describe('RD-11 load section', () => {
    /** Pre-RD-11 sha256 of renderCoreBlock(baseInput()) — captured from 75d75ae. */
    const PRE_RD11_BASE_HASH = '57d054fa4b659b6a43e2afd02977d9a9d9104659e6a986b344f492fe583fc6a5';
    const NOW = new Date('2026-11-02T12:00:00.000Z');
    const loadInput = (): LoadInput => ({
      projects: [
        { id: 'pb1', title: 'Podcast relaunch', status: 'active', domain: 'business' },
        { id: 'pm1', title: 'Choir retreat', status: 'active', domain: 'ministry' },
      ],
      tasks: [{ id: 't1', status: 'pending', deadline: null, projects: [{ id: 'pb1', domain: 'business', deleted: false }] }],
      commitments: [],
      awaitingReview: 0,
    });

    it('a block without load is byte-identical to the pre-change output (load absent or null)', () => {
      expect(hashBlock(renderCoreBlock(baseInput()))).toBe(PRE_RD11_BASE_HASH);
      expect(renderCoreBlock({ ...baseInput(), load: null })).toBe(renderCoreBlock(baseInput()));
      expect(renderCoreBlock(baseInput())).not.toContain('## Current load');
    });

    it('with load, the block ends with the ## Current load section after ## Standing constraints', () => {
      const block = renderCoreBlock({ ...baseInput(), load: computeLoad(loadInput(), NOW) });
      const constraintsAt = block.indexOf('## Standing constraints');
      const loadAt = block.indexOf('## Current load (computed from your records; formula v1)');
      expect(constraintsAt).toBeGreaterThan(-1);
      expect(loadAt).toBeGreaterThan(constraintsAt);
      expect(block).toContain('- No hires before Q2\n\n## Current load');
      expect(block.endsWith('  - Podcast relaunch (business; 1 open tasks, 0 open commitments)\n')).toBe(true);
      expect(block).not.toContain('Choir retreat');
      expect(block).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    });

    const fullPrisma = () => ({
      userProfile: { findUnique: vi.fn().mockResolvedValue(null) },
      goal: { findMany: vi.fn().mockResolvedValue([]) },
      commitment: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
      memoryEntry: { findMany: vi.fn().mockResolvedValue([]) },
      project: { findMany: vi.fn().mockResolvedValue([{ id: 'pb1', title: 'Podcast relaunch', status: 'active', domain: 'business', updatedAt: NOW }]) },
      task: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 't-new' }),
        update: vi.fn().mockResolvedValue({ id: 't-new' }),
        findFirst: vi.fn().mockResolvedValue({ id: 't-new', userId: 'u1', version: 1 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      decision: { count: vi.fn().mockResolvedValue(0) },
    }) as any;

    it('getCoreContext with tenantId runs no load queries and the block has no load section; without tenantId it is present', async () => {
      const prisma = fullPrisma();
      const agent = await getCoreContext('u1', prisma, { tenantId: 'tenant-fixture' });
      expect(prisma.project.findMany).not.toHaveBeenCalled();
      expect(prisma.task.findMany).not.toHaveBeenCalled();
      expect(prisma.decision.count).not.toHaveBeenCalled();
      expect(agent.block).not.toContain('## Current load');

      const boardroom = await getCoreContext('u1', prisma);
      expect(prisma.project.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.task.findMany).toHaveBeenCalledTimes(1);
      expect(boardroom.block).toContain('## Current load');
      expect(boardroom.block).toContain('  - business: 1 / 0, 0 / 0, 0 / 4');
      expect(boardroom.block).toContain('- level: UNKNOWN — records show 4 points (capacity 40); spare capacity cannot be confirmed');
    });

    it('fails open: when task.findMany rejects, the block is returned without the load section and a warning is logged', async () => {
      const prisma = fullPrisma();
      prisma.task.findMany.mockRejectedValue(new Error('db down'));
      const res = await getCoreContext('u1', prisma);
      expect(res.block).toContain('# Core context');
      expect(res.block).not.toContain('## Current load');
      expect(logger.warn).toHaveBeenCalledWith('[core-context] load unavailable', { userId: 'u1', message: 'db down' });
    });

    it('two calls with unchanged data return the same hash; the hash changes when the load changes', async () => {
      const prisma = fullPrisma();
      const a = await getCoreContext('u1', prisma);
      invalidateCoreContext('u1');
      const b = await getCoreContext('u1', prisma);
      expect(b.hash).toBe(a.hash);
      prisma.task.findMany.mockResolvedValue([{ id: 't1', status: 'pending', deadline: null, projectLinks: [] }]);
      invalidateCoreContext('u1');
      const c = await getCoreContext('u1', prisma);
      expect(c.hash).not.toBe(a.hash);
      expect(c.block).toContain('  - unassigned: 0 / 0, 0 / 1, 0 / 1');
    });

    it.each(['create', 'update', 'delete'] as const)('entity.service %s for model task invalidates the core-context cache', async (op) => {
      const prisma = fullPrisma();
      await getCoreContext('u1', prisma);
      await getCoreContext('u1', prisma);
      expect(prisma.goal.findMany).toHaveBeenCalledTimes(1); // cached

      if (op === 'create') await createEntity('task', 'u1', { title: 'Draft outline' }, prisma);
      if (op === 'update') await updateEntity('task', 'u1', 't-new', { title: 'Draft outline v2' }, prisma);
      if (op === 'delete') await deleteEntity('task', 'u1', 't-new', prisma);

      await getCoreContext('u1', prisma);
      expect(prisma.goal.findMany).toHaveBeenCalledTimes(2); // cache dropped → recomputed
    });
  });
});
