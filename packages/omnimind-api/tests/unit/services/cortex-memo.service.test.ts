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

// ── RD-11 — load section in the weekly memo + D3 soft-delete filters ──

describe('generateWeeklyMemo load section (RD-11) + D3', () => {
  beforeEach(() => vi.clearAllMocks());

  const MEMO_JSON = JSON.stringify({ thinkingQualityScore: 6, decisionsMade: 1, patternsNoticed: [], activeContradictions: [], upcomingPressurePoints: [], recommendedFocus: [], fullMemoText: 'Memo body' });

  /** fakePrisma + the load reads: 4 business projects (invented titles), 1 overdue open commitment. */
  function loadPrisma(existingMemo: unknown) {
    const prisma = fakePrisma(existingMemo);
    prisma.project = {
      findMany: vi.fn().mockResolvedValue(['Podcast relaunch', 'Newsletter rebuild', 'Partner portal', 'Pricing page test'].map((title, i) => ({ id: `pb${i}`, title, status: 'active', domain: 'business', updatedAt: new Date() }))),
    };
    prisma.commitment.findMany = vi.fn().mockResolvedValue([{ id: 'c1', description: 'Send the deck', deadline: new Date(Date.now() - 86_400_000), linkedProjectId: 'pb1', project: { id: 'pb1', domain: 'business', deletedAt: null } }]);
    prisma.decision.count = vi.fn().mockImplementation(({ where }: any) => Promise.resolve(where.reviewAt ? 1 : 100));
    return prisma;
  }

  it('the LLM context contains ## Current load; fullMemoText does not (one visible load number)', async () => {
    const prisma = loadPrisma(null);
    mockCreateMessage.mockResolvedValue({ content: [{ type: 'text', text: MEMO_JSON }], usage: { input_tokens: 1, output_tokens: 1 } });
    await generateWeeklyMemo('u1', prisma);

    const context: string = mockCreateMessage.mock.calls[0][0].messages[0].content;
    expect(context).toContain('## Current load (computed from your records; formula v1)');
    expect(context).toContain('  - business: 4 / 1, 1 / 0, 0 / 20');
    expect(context).toContain('- decisions past their review date: 1');
    expect(context).toContain('domain_sprawl (business: 4 active projects)');

    const data = prisma.weeklyMemo.create.mock.calls[0][0].data;
    expect(data.fullMemoText.startsWith('Memo body')).toBe(true);
    expect(data.fullMemoText).not.toContain('## Current load');
    for (const t of ['Podcast relaunch', 'Newsletter rebuild', 'Partner portal', 'Pricing page test']) expect(context).not.toContain(t);
    expect(context).not.toContain('could pause');
  });

  it('a load failure still produces the memo, without the section', async () => {
    const prisma = loadPrisma(null);
    prisma.project.findMany.mockRejectedValue(new Error('db down'));
    mockCreateMessage.mockResolvedValue({ content: [{ type: 'text', text: MEMO_JSON }], usage: { input_tokens: 1, output_tokens: 1 } });
    const out = await generateWeeklyMemo('u1', prisma) as Record<string, unknown>;
    expect(out.id).toBe('memo-new');
    expect(mockCreateMessage.mock.calls[0][0].messages[0].content).not.toContain('## Current load');
    expect(prisma.weeklyMemo.create.mock.calls[0][0].data.fullMemoText).not.toContain('## Current load');
  });

  it('D3: the decision and commitment queries exclude soft-deleted rows', async () => {
    const prisma = loadPrisma(null);
    mockCreateMessage.mockResolvedValue({ content: [{ type: 'text', text: MEMO_JSON }], usage: { input_tokens: 1, output_tokens: 1 } });
    await generateWeeklyMemo('u1', prisma);
    const decisionWheres = prisma.decision.findMany.mock.calls.map((c: any[]) => c[0].where);
    expect(decisionWheres.find((w: any) => w.createdAt)).toMatchObject({ userId: 'u1', deletedAt: null });
    for (const call of prisma.commitment.findMany.mock.calls) expect(call[0].where).toMatchObject({ userId: 'u1', deletedAt: null, status: 'OPEN' });
  });

  it('the idempotent path (memo already exists) runs no load queries', async () => {
    const prisma = loadPrisma({ id: 'memo-1', userId: 'u1', thinkingQualityScore: 7, weekStart: new Date() });
    await generateWeeklyMemo('u1', prisma);
    expect(prisma.project.findMany).not.toHaveBeenCalled();
    expect(prisma.decision.count).not.toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ reviewAt: expect.anything() }) }));
    expect(prisma.task.findMany).toHaveBeenCalledTimes(1); // the memo's own read only
    expect(mockCreateMessage).not.toHaveBeenCalled();
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
