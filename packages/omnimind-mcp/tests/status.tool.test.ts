import { describe, it, expect, vi, afterEach } from 'vitest';
import { statusGetTool, StatusGetOutputSchema } from '../src/tools/status.tool';
import { ScopeDeniedError } from '../src/types';
import type { OmniMindClient } from '../src/lib/client';
import type { AgentContext } from '../src/types';

const ctx: AgentContext = { agentId: 'ag', agentName: 'ag', tenantId: 'josh-business', scopes: ['memory:read'], sourceWeight: 1.0 };

function makeClient(impl?: (p: { tags?: string[] }) => unknown[], nudges: unknown = { dueSoon: [], overdue: [] }): OmniMindClient {
  return {
    searchMemories: vi.fn().mockImplementation(async (p: { tags?: string[] }) => (impl ? impl(p) : [])),
    getCommitmentNudges: nudges instanceof Error ? vi.fn().mockRejectedValue(nudges) : vi.fn().mockResolvedValue(nudges),
    logAudit: vi.fn().mockResolvedValue(undefined),
  } as unknown as OmniMindClient;
}

describe('status_get', () => {
  it('returns composite snapshot', async () => {
    const client = makeClient();
    const result = await statusGetTool(client, ctx).execute({ userId: 'u-1' });
    expect(result.snapshot).toBeDefined();
    expect(result.counts).toBeDefined();
    expect(result.counts.decisions).toBe(0);
  });

  it('M-102: issues 4 tag-based queries (no substring tag strings in q)', async () => {
    const client = makeClient();
    await statusGetTool(client, ctx).execute({ userId: 'u-1' });
    const calls = vi.mocked(client.searchMemories).mock.calls.map(c => c[0]);
    expect(calls).toHaveLength(4);
    for (const c of calls) expect(c.query).toBeUndefined();
    expect(calls.map(c => c.tags)).toEqual([
      ['decision'],
      ['task'],
      ['task', 'task:blocked'],
      ['commitment', 'commitment:pending'],
    ]);
  });

  it('counts only todo/in_progress tasks as active', async () => {
    const client = makeClient(p => {
      if (p.tags?.length === 1 && p.tags[0] === 'task') {
        return [
          { id: 't1', title: 'a', tags: ['task', 'task:todo'] },
          { id: 't2', title: 'b', tags: ['task', 'task:done'] },
          { id: 't3', title: 'c', tags: ['task', 'task:in_progress'] },
        ];
      }
      return [];
    });
    const result = await statusGetTool(client, ctx).execute({ userId: 'u-1' });
    expect(result.counts.activeTasks).toBe(2);
    expect(result.snapshot.activeTasks.map((t: { id: string }) => t.id)).toEqual(['t1', 't3']);
  });

  it('Phase 6: includes commitmentsDueSoon from GET /commitments/nudges', async () => {
    const due = { id: 'c1', description: 'Send deck to Sarah', deadline: '2026-10-03T00:00:00Z', status: 'OPEN' };
    const late = { id: 'c2', description: 'Invoice Acme', deadline: '2026-09-30T00:00:00Z', status: 'OPEN' };
    const client = makeClient(undefined, { dueSoon: [due], overdue: [late] });
    const result = await statusGetTool(client, ctx).execute({ userId: 'u-1' });
    expect(result.commitmentsDueSoon).toEqual({ dueSoon: [due], overdue: [late] });
    expect(client.getCommitmentNudges).toHaveBeenCalledWith('u-1');
  });

  it('Phase 6: a failing nudges endpoint degrades to empty lists + error, not a failed snapshot', async () => {
    const client = makeClient(undefined, new Error('OmniMind GET /commitments/nudges → 404'));
    const result = await statusGetTool(client, ctx).execute({ userId: 'u-1' });
    expect(result.counts.decisions).toBe(0);
    expect(result.commitmentsDueSoon.dueSoon).toEqual([]);
    expect(result.commitmentsDueSoon.error).toContain('404');
  });

  describe('RD-12 delegations', () => {
    afterEach(() => { vi.useRealTimers(); });

    const DEADLINE_LATE = '2026-11-07T23:59:59.999Z';
    const mine = { id: 'c1', description: 'Book the hall', deadline: '2026-11-07T12:00:00.000Z', status: 'OPEN', owedBy: 'USER', stakeholderId: null, stakeholderName: null };
    const legacy = { id: 'c2', description: 'Invoice the caterer', deadline: '2026-11-09T12:00:00.000Z', status: 'OPEN' };
    const lateDelegation = { id: 'c3', description: 'Send the volunteer rota', deadline: DEADLINE_LATE, status: 'OPEN', owedBy: 'STAKEHOLDER', stakeholderId: 'p1', stakeholderName: 'Sam Rivera' };
    const soonDelegation = { id: 'c4', description: 'Return the projector', deadline: '2026-11-09T23:59:59.999Z', status: 'OPEN', owedBy: 'STAKEHOLDER', stakeholderId: 'p2', stakeholderName: null };

    it('partitions one nudges result: STAKEHOLDER only in delegations, USER/missing only in commitmentsDueSoon', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
      const client = makeClient(undefined, { overdue: [mine, lateDelegation], dueSoon: [legacy, soonDelegation] });
      const result = await statusGetTool(client, ctx).execute({ userId: 'u-1' });

      expect(client.getCommitmentNudges).toHaveBeenCalledTimes(1);
      expect(result.commitmentsDueSoon).toEqual({ overdue: [mine], dueSoon: [legacy] });
      expect(result.delegations).toEqual({
        overdue: [{ id: 'c3', description: 'Send the volunteer rota', personId: 'p1', personName: 'Sam Rivera', deadline: DEADLINE_LATE, daysOverdue: 1 }],
        dueSoon: [{ id: 'c4', description: 'Return the projector', personId: 'p2', personName: null, deadline: '2026-11-09T23:59:59.999Z', daysOverdue: 0 }],
      });
      expect(StatusGetOutputSchema.safeParse(result).success).toBe(true);
    });

    it('a nudges failure sets the same error on both blocks', async () => {
      const client = makeClient(undefined, new Error('OmniMind GET /commitments/nudges → 503'));
      const result = await statusGetTool(client, ctx).execute({ userId: 'u-1' });
      expect(result.delegations).toEqual({ overdue: [], dueSoon: [], error: result.commitmentsDueSoon.error });
      expect(result.delegations.error).toContain('503');
      expect(StatusGetOutputSchema.safeParse(result).success).toBe(true);
    });

    it('audit row keeps delegation ids / deadlines / daysOverdue, drops description, personName and personId', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
      const client = makeClient(undefined, { overdue: [lateDelegation], dueSoon: [] });
      await statusGetTool(client, ctx).execute({ userId: 'u-1' });
      const entry = vi.mocked(client.logAudit).mock.calls[0][0] as { outputJson: Record<string, any> };
      expect(entry.outputJson.delegations).toEqual({ overdue: [{ id: 'c3', deadline: DEADLINE_LATE, daysOverdue: 1 }], dueSoon: [] });
      expect(JSON.stringify(entry.outputJson)).not.toContain('Sam Rivera');
      expect(JSON.stringify(entry.outputJson)).not.toContain('volunteer rota');
    });
  });

  it('throws ScopeDeniedError without read scope', async () => {
    const client = makeClient();
    const noReadCtx: AgentContext = { ...ctx, scopes: [] };
    await expect(statusGetTool(client, noReadCtx).execute({ userId: 'u' })).rejects.toThrow(ScopeDeniedError);
  });
});
