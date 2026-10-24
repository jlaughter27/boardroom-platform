/**
 * R-O-12 — generateWeeklyMemo: the "memo already exists for this week" check
 * runs BEFORE the LLM call, and both return shapes are identical.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../src/lib/db', () => ({ prisma: {} }));
vi.mock('../../../src/lib/prompt-loader', () => ({ loadSystemPrompt: vi.fn(() => 'MEMO SYSTEM') }));
vi.mock('../../../src/services/memory.service', () => ({ createMemory: vi.fn() }));

const mockCreateMessage = vi.hoisted(() => vi.fn());
vi.mock('../../../src/lib/anthropic', () => ({
  createMessage: mockCreateMessage,
  extractText: (m: any) => m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim(),
  parseJsonFromText: (t: string) => JSON.parse(t),
  hasAnthropicKey: () => true,
}));

import { generateWeeklyMemo } from '../../../src/services/cortex-memo.service';

function fakePrisma(existingMemo: unknown) {
  return {
    decision: {
      findMany: vi.fn().mockImplementation(({ select }: any) => Promise.resolve(select ? [{ id: 'd1', title: 'Hire', reviewAt: new Date('2026-10-05T00:00:00Z'), expectedOutcome: null, probabilitySuccess: null }] : [])),
      count: vi.fn().mockResolvedValue(100),
    },
    goal: { findMany: vi.fn().mockResolvedValue([]) },
    task: { findMany: vi.fn().mockResolvedValue([]) },
    commitment: { findMany: vi.fn().mockResolvedValue([]) },
    thinkingPattern: { findMany: vi.fn().mockResolvedValue([]) },
    contradictionAlert: { findMany: vi.fn().mockResolvedValue([]) },
    weeklyMemo: {
      findFirst: vi.fn().mockResolvedValue(existingMemo),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'memo-new', ...data })),
    },
  } as any;
}

describe('generateWeeklyMemo idempotency (R-O-12)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the existing memo (+ decisionsAwaitingReview) WITHOUT calling the LLM', async () => {
    const existing = { id: 'memo-1', userId: 'u1', thinkingQualityScore: 7, weekStart: new Date() };
    const prisma = fakePrisma(existing);
    const out = await generateWeeklyMemo('u1', prisma) as Record<string, unknown>;
    expect(mockCreateMessage).not.toHaveBeenCalled();
    expect(prisma.weeklyMemo.create).not.toHaveBeenCalled();
    expect(out).toEqual({ ...existing, decisionsAwaitingReview: ['d1'] });
  });

  it('calls the LLM and creates the memo when none exists this week — same shape', async () => {
    const prisma = fakePrisma(null);
    mockCreateMessage.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ thinkingQualityScore: 6, decisionsMade: 1, patternsNoticed: [], activeContradictions: [], upcomingPressurePoints: [], recommendedFocus: [], fullMemoText: 'Memo body' }) }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const out = await generateWeeklyMemo('u1', prisma) as Record<string, unknown>;
    expect(mockCreateMessage).toHaveBeenCalledTimes(1);
    expect(prisma.weeklyMemo.create).toHaveBeenCalledTimes(1);
    expect(out.id).toBe('memo-new');
    expect(out.decisionsAwaitingReview).toEqual(['d1']);
    expect(out.upcomingPressurePoints).toEqual(['review:d1']);
  });
});

describe('generateWeeklyMemo — RD-12 delegations + soft-delete fix', () => {
  beforeEach(() => vi.clearAllMocks());

  it('filters deletedAt: null, lists only USER rows under Open Commitments and delegations under Waiting on Others', async () => {
    const prisma = fakePrisma(null);
    prisma.commitment.findMany.mockResolvedValue([
      { description: 'Book the hall', owedBy: 'USER', deadline: new Date('2026-11-09T12:00:00Z'), stakeholder: { name: 'Dana Okafor' } },
      { description: 'Send the volunteer rota', owedBy: 'STAKEHOLDER', deadline: new Date('2026-11-07T23:59:59.999Z'), stakeholder: { name: 'Sam Rivera' } },
      { description: 'Return the projector', owedBy: 'STAKEHOLDER', deadline: null, stakeholder: null },
    ]);
    mockCreateMessage.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ thinkingQualityScore: 6, decisionsMade: 1, patternsNoticed: [], activeContradictions: [], upcomingPressurePoints: [], recommendedFocus: [], fullMemoText: 'Memo body' }) }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await generateWeeklyMemo('u1', prisma);
    const q = prisma.commitment.findMany.mock.calls[0][0];
    expect(q.where).toEqual({ userId: 'u1', status: 'OPEN', deletedAt: null });
    expect(q.include).toEqual({ stakeholder: { select: { name: true } } });
    const prompt = JSON.stringify(mockCreateMessage.mock.calls[0][0].messages);
    expect(prompt).toContain('## Open Commitments (1)\\n- Book the hall due 2026-11-09\\n\\n## Waiting on Others (2)\\n- Waiting on Sam Rivera: Send the volunteer rota due 2026-11-07\\n- Waiting on someone: Return the projector\\n');
  });

  it('no delegations → no Waiting on Others section', async () => {
    const prisma = fakePrisma(null);
    prisma.commitment.findMany.mockResolvedValue([{ description: 'Book the hall', owedBy: 'USER', deadline: null, stakeholder: null }]);
    mockCreateMessage.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ thinkingQualityScore: 6, decisionsMade: 1, patternsNoticed: [], activeContradictions: [], upcomingPressurePoints: [], recommendedFocus: [], fullMemoText: 'Memo body' }) }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await generateWeeklyMemo('u1', prisma);
    const prompt = JSON.stringify(mockCreateMessage.mock.calls[0][0].messages);
    expect(prompt).toContain('## Open Commitments (1)\\n- Book the hall\\n\\n## Known Thinking Patterns');
    expect(prompt).not.toContain('Waiting on Others');
  });
});
