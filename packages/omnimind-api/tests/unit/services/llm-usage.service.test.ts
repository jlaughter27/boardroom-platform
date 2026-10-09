import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { aggregateUsage, recordLlmUsage, getUsageSummary, type UsageRow } from '../../../src/services/llm-usage.service';

const now = new Date('2026-10-02T15:30:00Z');
const row = (over: Partial<UsageRow>): UsageRow => ({
  purpose: 'persona:critic', model: 'claude-haiku-4-5',
  inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0,
  costUsd: 0.002, createdAt: now, ...over,
});

describe('llm usage (Phase 6)', () => {
  describe('aggregateUsage', () => {
    it('zero-fills byDay for the whole window (UTC days, ascending) and totals usd', () => {
      const out = aggregateUsage([
        row({ costUsd: 0.5, createdAt: new Date('2026-10-02T01:00:00Z') }),
        row({ costUsd: 0.25, createdAt: new Date('2026-09-30T23:59:00Z') }),
        row({ costUsd: 9, createdAt: new Date('2026-09-01T00:00:00Z') }), // outside window → counted in total only if passed in; here we pass it, so excluded from byDay
      ], 3, now);
      expect(out.days).toBe(3);
      expect(out.byDay.map(d => d.date)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02']);
      expect(out.byDay).toEqual([
        { date: '2026-09-30', usd: 0.25, calls: 1 },
        { date: '2026-10-01', usd: 0, calls: 0 },
        { date: '2026-10-02', usd: 0.5, calls: 1 },
      ]);
      expect(out.totalUsd).toBe(9.75);
    });

    it('groups by purpose with cacheHitRate = cacheRead / (input + cacheRead + cacheWrite), sorted by usd desc', () => {
      const out = aggregateUsage([
        row({ purpose: 'ceo', costUsd: 1, inputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 0 }),
        row({ purpose: 'ceo', costUsd: 1, inputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 900 }),
        row({ purpose: 'persona:critic', costUsd: 0.1, inputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 }),
        row({ purpose: 'reflection', costUsd: 0.1, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }),
      ], 7, now);
      expect(out.byPurpose).toEqual([
        { purpose: 'ceo', usd: 2, calls: 2, cacheHitRate: 0.45 },
        { purpose: 'persona:critic', usd: 0.1, calls: 1, cacheHitRate: 0 },
        { purpose: 'reflection', usd: 0.1, calls: 1, cacheHitRate: 0 }, // no input tokens → 0, not NaN
      ]);
    });

    it('groups by model with token totals (input includes cached tokens)', () => {
      const out = aggregateUsage([
        row({ model: 'claude-sonnet-5-5', costUsd: 0.4, inputTokens: 100, cacheReadTokens: 50, cacheWriteTokens: 10, outputTokens: 20 }),
        row({ model: 'claude-haiku-4-5', costUsd: 0.1, inputTokens: 10, outputTokens: 5 }),
        row({ model: 'claude-haiku-4-5', costUsd: 0.1, inputTokens: 10, outputTokens: 5 }),
      ], 7, now);
      expect(out.byModel).toEqual([
        { model: 'claude-sonnet-5-5', usd: 0.4, calls: 1, inputTokens: 160, outputTokens: 20 },
        { model: 'claude-haiku-4-5', usd: 0.2, calls: 2, inputTokens: 20, outputTokens: 10 },
      ]);
    });

    it('handles an empty window', () => {
      const out = aggregateUsage([], 2, now);
      expect(out).toEqual({
        days: 2, totalUsd: 0,
        byDay: [{ date: '2026-10-01', usd: 0, calls: 0 }, { date: '2026-10-02', usd: 0, calls: 0 }],
        byPurpose: [], byModel: [],
      });
    });
  });

  describe('recordLlmUsage', () => {
    const mockPrisma = { llmUsage: { create: vi.fn(), findMany: vi.fn() } } as any;
    beforeEach(() => vi.clearAllMocks());

    it('computes costUsd server-side from shared pricing (sonnet 2/10, cache read 0.2, write 2.5 per MTok)', async () => {
      mockPrisma.llmUsage.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'row1', costUsd: data.costUsd }));
      const res = await recordLlmUsage({
        service: 'boardroom', purpose: 'ceo', model: 'claude-sonnet-5-5',
        inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 200_000,
      }, mockPrisma);
      // 2 + 1 + 0.2 + 0.5
      expect(res).toEqual({ id: 'row1', costUsd: 3.7 });
      const data = mockPrisma.llmUsage.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ service: 'boardroom', purpose: 'ceo', cacheReadTokens: 1_000_000, cacheWriteTokens: 200_000, userId: null, tenantId: null });
    });

    it('never throws — returns null when the insert fails', async () => {
      mockPrisma.llmUsage.create.mockRejectedValue(new Error('db down'));
      await expect(recordLlmUsage({ service: 'omnimind', purpose: 'x', model: 'claude-haiku-4-5', inputTokens: 1, outputTokens: 1 }, mockPrisma)).resolves.toBeNull();
    });

    it('getUsageSummary scopes by user unless userId is null and starts the window at UTC midnight days-1 ago', async () => {
      mockPrisma.llmUsage.findMany.mockResolvedValue([]);
      await getUsageSummary({ days: 7, userId: 'u1' }, mockPrisma, now);
      let where = mockPrisma.llmUsage.findMany.mock.calls[0][0].where;
      expect(where.userId).toBe('u1');
      expect(where.createdAt.gte).toEqual(new Date('2026-09-26T00:00:00Z'));

      await getUsageSummary({ days: 7, userId: null }, mockPrisma, now);
      where = mockPrisma.llmUsage.findMany.mock.calls[1][0].where;
      expect(where).not.toHaveProperty('userId');
    });
  });
});
