import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../src/lib/db', () => ({ prisma: {} }));
vi.mock('../../../src/lib/prompt-loader', () => ({ loadSystemPrompt: vi.fn(() => 'REFLECT SYSTEM') }));

const mockCreateMessage = vi.hoisted(() => vi.fn());
vi.mock('../../../src/lib/anthropic', () => ({
  createMessage: mockCreateMessage,
  extractText: (m: any) => m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim(),
  parseJsonFromText: (t: string) => JSON.parse(t.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()),
  hasAnthropicKey: () => true,
}));

import {
  shouldReflect,
  reflectionThreshold,
  reflectionMaxPerTick,
  findReflectionCandidates,
  reflectEntity,
  CAPSULE_STALE_AFTER_DAYS,
} from '../../../src/services/reflection.service';
import { logger } from '../../../src/lib/logger';

describe('reflection (Phase 6)', () => {
  describe('shouldReflect threshold rule', () => {
    it('never reflects with zero new importance', () => {
      expect(shouldReflect({ importanceSinceCapsule: 0, hasCapsule: false, threshold: 0.8 })).toBe(false);
      expect(shouldReflect({ importanceSinceCapsule: 0, hasCapsule: true, threshold: 0.8 })).toBe(false);
    });
    it('reflects an entity without a capsule as soon as it has any linked activity', () => {
      expect(shouldReflect({ importanceSinceCapsule: 0.1, hasCapsule: false, threshold: 0.8 })).toBe(true);
    });
    it('re-reflects an entity with a capsule only at/above the threshold', () => {
      expect(shouldReflect({ importanceSinceCapsule: 0.79, hasCapsule: true, threshold: 0.8 })).toBe(false);
      expect(shouldReflect({ importanceSinceCapsule: 0.8, hasCapsule: true, threshold: 0.8 })).toBe(true);
      expect(shouldReflect({ importanceSinceCapsule: 2.3, hasCapsule: true, threshold: 0.8 })).toBe(true);
    });
  });

  describe('reflectionThreshold()', () => {
    const orig = process.env.REFLECTION_THRESHOLD;
    afterEach(() => { if (orig === undefined) delete process.env.REFLECTION_THRESHOLD; else process.env.REFLECTION_THRESHOLD = orig; });
    it('defaults to 0.8 and honours the env override', () => {
      delete process.env.REFLECTION_THRESHOLD;
      expect(reflectionThreshold()).toBe(0.8);
      process.env.REFLECTION_THRESHOLD = '1.5';
      expect(reflectionThreshold()).toBe(1.5);
      process.env.REFLECTION_THRESHOLD = 'nope';
      expect(reflectionThreshold()).toBe(0.8);
    });
  });

  describe('findReflectionCandidates', () => {
    const mockPrisma = { $queryRaw: vi.fn(), contextCapsule: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } } as any;
    beforeEach(() => vi.clearAllMocks());

    it('filters SQL rows through shouldReflect and records importanceSeen on skipped capsules', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { user_id: 'u1', entity_type: 'goal', entity_id: 'g1', importance_sum: 1.2, has_capsule: true },     // keep
        { user_id: 'u1', entity_type: 'project', entity_id: 'p1', importance_sum: 0.3, has_capsule: true },  // skip (under)
        { user_id: 'u1', entity_type: 'person', entity_id: 'x1', importance_sum: 0.3, has_capsule: false },  // keep (no capsule)
      ]);
      const out = await findReflectionCandidates(mockPrisma, { threshold: 0.8, now: new Date('2026-10-02T00:00:00Z') });
      expect(out.map(c => c.entityId)).toEqual(['g1', 'x1']);
      expect(out[0]).toMatchObject({ userId: 'u1', entityType: 'goal', importanceSum: 1.2, hasCapsule: true });
      expect(mockPrisma.contextCapsule.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', entityType: 'project', entityId: 'p1' },
        data: { importanceSeen: 0.3 },
      });
    });

    it('queries the 7-day window, excludes ministry/archived/deleted and memories older than the capsule', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);
      const now = new Date('2026-10-02T00:00:00Z');
      await findReflectionCandidates(mockPrisma, { now });
      const [strings, ...values] = mockPrisma.$queryRaw.mock.calls[0];
      const sql = (strings as string[]).join('?').replace(/\s+/g, ' ');
      expect(sql).toContain("l.entity_type IN ('goal', 'project', 'person')");
      expect(sql).toContain("lower(trim(m.domain)) <> 'ministry'"); // R-O-10
      expect(sql).toContain('ORDER BY importance_sum DESC');            // R-O-09
      expect(sql).toMatch(/LIMIT \?\s*$/);
      expect(sql).toContain("m.status != 'ARCHIVED'");
      expect(sql).toContain('m.deleted_at IS NULL');
      expect(sql).toContain('(cc.generated_at IS NULL OR m.created_at > cc.generated_at)');
      expect(values[0]).toEqual(new Date('2026-09-25T00:00:00Z'));
    });
  });

  describe('R-O-09: per-tick cap', () => {
    const mockPrisma = { $queryRaw: vi.fn(), contextCapsule: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } } as any;
    const orig = process.env.REFLECTION_MAX_PER_TICK;
    beforeEach(() => vi.clearAllMocks());
    afterEach(() => { if (orig === undefined) delete process.env.REFLECTION_MAX_PER_TICK; else process.env.REFLECTION_MAX_PER_TICK = orig; });

    it('reflectionMaxPerTick defaults to 50 and honours the env override', () => {
      delete process.env.REFLECTION_MAX_PER_TICK;
      expect(reflectionMaxPerTick()).toBe(50);
      process.env.REFLECTION_MAX_PER_TICK = '7';
      expect(reflectionMaxPerTick()).toBe(7);
      process.env.REFLECTION_MAX_PER_TICK = '0';
      expect(reflectionMaxPerTick()).toBe(50);
    });

    it('binds LIMIT maxPerTick+1, returns at most maxPerTick candidates and logs the overflow', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { user_id: 'u1', entity_type: 'goal', entity_id: 'g1', importance_sum: 3.0, has_capsule: false },
        { user_id: 'u1', entity_type: 'goal', entity_id: 'g2', importance_sum: 2.0, has_capsule: false },
        { user_id: 'u1', entity_type: 'goal', entity_id: 'g3', importance_sum: 1.0, has_capsule: false }, // the +1 sentinel row
      ]);
      const out = await findReflectionCandidates(mockPrisma, { maxPerTick: 2, threshold: 0.8 });
      expect(out.map(c => c.entityId)).toEqual(['g1', 'g2']);
      const values = mockPrisma.$queryRaw.mock.calls[0].slice(1);
      expect(values).toContain(3); // LIMIT maxPerTick + 1
      expect(logger.warn).toHaveBeenCalledWith('[reflection] candidate overflow — capping this tick', expect.objectContaining({ maxPerTick: 2, overflow: 1 }));
    });

    it('no overflow log when the result fits', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ user_id: 'u1', entity_type: 'goal', entity_id: 'g1', importance_sum: 3.0, has_capsule: false }]);
      await findReflectionCandidates(mockPrisma, { maxPerTick: 2 });
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('reflectEntity', () => {
    const now = new Date('2026-10-02T12:00:00Z');
    const mockPrisma = {
      goal: { findFirst: vi.fn() },
      project: { findFirst: vi.fn() },
      person: { findFirst: vi.fn() },
      memoryEntityLink: { findMany: vi.fn() },
      memoryEntry: { findMany: vi.fn() },
      contextCapsule: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
      goalProjectLink: { findMany: vi.fn().mockResolvedValue([]) },
    } as any;

    beforeEach(() => {
      vi.clearAllMocks();
      mockPrisma.goal.findFirst.mockResolvedValue({ id: 'g1', title: 'Grow ARR', status: 'active', level: 0, deadline: null, successMetrics: [] });
      mockPrisma.memoryEntityLink.findMany.mockResolvedValue([{ memoryId: 'm1' }, { memoryId: 'm2' }]);
      mockPrisma.memoryEntry.findMany.mockResolvedValue([
        { id: 'm1', title: 'Pricing', content: 'Raised prices 10%', domain: 'business', encryptedContent: null, importance: 0.7, createdAt: new Date('2026-09-30T00:00:00Z'), invalidAt: null, status: 'CONFIRMED' },
        { id: 'm2', title: 'Churn', content: 'Churn up to 4%', domain: 'business', encryptedContent: null, importance: 0.5, createdAt: new Date('2026-10-01T00:00:00Z'), invalidAt: null, status: 'CONFIRMED' },
      ]);
      mockPrisma.contextCapsule.findUnique.mockResolvedValue(null);
      mockPrisma.contextCapsule.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'cap1', ...data }));
      mockCreateMessage.mockResolvedValue({
        content: [{ type: 'text', text: '```json\n{"summary":"ARR goal on track.","openRisks":["churn"],"unresolvedQuestions":[],"recentChanges":["2026-10-01 churn 4%"],"activeStakeholders":["Dana"]}\n```' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });
    });

    it('calls Haiku with effort medium, validates the output and creates a v1 capsule with provenance', async () => {
      const capsule = await reflectEntity('u1', 'goal', 'g1', mockPrisma, now);

      const [params, meta] = mockCreateMessage.mock.calls[0];
      expect(params.model).toBe('claude-haiku-4-5');
      expect(params.output_config).toEqual({ effort: 'medium' });
      expect(params).not.toHaveProperty('temperature');
      expect(params).not.toHaveProperty('thinking');
      expect(params.system[0]).toMatchObject({ type: 'text', text: 'REFLECT SYSTEM', cache_control: { type: 'ephemeral' } });
      expect(params.messages[0].content).toContain('Raised prices 10%');
      expect(meta).toEqual({ purpose: 'reflection', userId: 'u1' });

      expect(mockPrisma.contextCapsule.create).toHaveBeenCalledTimes(1);
      const data = mockPrisma.contextCapsule.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        userId: 'u1', entityType: 'goal', entityId: 'g1',
        summary: 'ARR goal on track.', openRisks: ['churn'], activeStakeholders: ['Dana'],
        importanceSeen: 0, version: 1, generatedAt: now,
      });
      // newest first in provenance
      expect(data.sourceMemoryIds).toEqual(['m2', 'm1']);
      expect((data.staleAfter.getTime() - now.getTime()) / 86_400_000).toBeCloseTo(CAPSULE_STALE_AFTER_DAYS, 5);
      expect(capsule.id).toBe('cap1');
    });

    it('bumps version and resets importanceSeen when a capsule already exists', async () => {
      mockPrisma.contextCapsule.findUnique.mockResolvedValue({ id: 'cap0', summary: 'old', generatedAt: new Date('2026-09-20T00:00:00Z'), version: 2 });
      mockPrisma.contextCapsule.update.mockImplementation(({ data }: any) => Promise.resolve({ id: 'cap0', version: 3, ...data }));
      await reflectEntity('u1', 'goal', 'g1', mockPrisma, now);
      expect(mockPrisma.contextCapsule.create).not.toHaveBeenCalled();
      const { where, data } = mockPrisma.contextCapsule.update.mock.calls[0][0];
      expect(where).toEqual({ id: 'cap0' });
      expect(data.version).toEqual({ increment: 1 });
      expect(data.importanceSeen).toBe(0);
      expect(mockCreateMessage.mock.calls[0][0].messages[0].content).toContain('## Previous capsule (2026-09-20)');
    });

    it('rejects LLM output that fails the Zod schema', async () => {
      mockCreateMessage.mockResolvedValue({ content: [{ type: 'text', text: '{"summary":""}' }], usage: null });
      await expect(reflectEntity('u1', 'goal', 'g1', mockPrisma, now)).rejects.toThrow();
      expect(mockPrisma.contextCapsule.create).not.toHaveBeenCalled();
    });

    it('404s when the entity is not visible to the user', async () => {
      mockPrisma.goal.findFirst.mockResolvedValue(null);
      await expect(reflectEntity('u1', 'goal', 'nope', mockPrisma, now)).rejects.toMatchObject({ statusCode: 404 });
      expect(mockCreateMessage).not.toHaveBeenCalled();
    });

    it('never sends ministry-domain memories to the model (case/whitespace-insensitive, R-O-10)', async () => {
      mockPrisma.memoryEntry.findMany.mockResolvedValue([
        { id: 'm1', title: 'Pricing', content: 'Raised prices 10%', domain: 'business', encryptedContent: null, importance: 0.7, createdAt: new Date('2026-09-30T00:00:00Z'), invalidAt: null, status: 'CONFIRMED' },
        { id: 'm9', title: 'Prayer list', content: 'SECRET PASTORAL NOTE', domain: 'Ministry ', encryptedContent: null, importance: 0.9, createdAt: new Date('2026-10-01T00:00:00Z'), invalidAt: null, status: 'CONFIRMED' },
      ]);
      await reflectEntity('u1', 'goal', 'g1', mockPrisma, now);
      const where = mockPrisma.memoryEntry.findMany.mock.calls[0][0].where;
      expect(where.NOT).toEqual({ domain: { equals: 'ministry', mode: 'insensitive' } });
      const prompt = mockCreateMessage.mock.calls[0][0].messages[0].content as string;
      expect(prompt).toContain('Raised prices 10%');
      expect(prompt).not.toContain('SECRET PASTORAL NOTE');
      // provenance excludes the ministry row too
      expect(mockPrisma.contextCapsule.create.mock.calls[0][0].data.sourceMemoryIds).toEqual(['m1']);
    });
  });
});
