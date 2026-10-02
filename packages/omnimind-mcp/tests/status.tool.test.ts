import { describe, it, expect, vi } from 'vitest';
import { statusGetTool } from '../src/tools/status.tool';
import { ScopeDeniedError } from '../src/types';
import type { OmniMindClient } from '../src/lib/client';
import type { AgentContext } from '../src/types';

const ctx: AgentContext = { agentId: 'ag', agentName: 'ag', tenantId: 'josh-business', scopes: ['memory:read'], sourceWeight: 1.0 };

function makeClient(impl?: (p: { tags?: string[] }) => unknown[]): OmniMindClient {
  return {
    searchMemories: vi.fn().mockImplementation(async (p: { tags?: string[] }) => (impl ? impl(p) : [])),
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

  it('throws ScopeDeniedError without read scope', async () => {
    const client = makeClient();
    const noReadCtx: AgentContext = { ...ctx, scopes: [] };
    await expect(statusGetTool(client, noReadCtx).execute({ userId: 'u' })).rejects.toThrow(ScopeDeniedError);
  });
});
