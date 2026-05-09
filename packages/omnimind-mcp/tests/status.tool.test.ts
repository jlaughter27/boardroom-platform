import { describe, it, expect, vi } from 'vitest';
import { statusGetTool } from '../src/tools/status.tool';
import { ScopeDeniedError } from '../src/types';
import type { OmniMindClient } from '../src/lib/client';
import type { AgentContext } from '../src/types';

const ctx: AgentContext = { agentId: 'ag', agentName: 'ag', tenantId: 'josh-business', scopes: ['memory:read'], sourceWeight: 1.0 };

function makeClient(): OmniMindClient {
  return {
    searchMemories: vi.fn().mockResolvedValue([]),
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

  it('calls searchMemories 4 times for 4 categories', async () => {
    const client = makeClient();
    await statusGetTool(client, ctx).execute({ userId: 'u-1' });
    expect(client.searchMemories).toHaveBeenCalledTimes(4);
  });

  it('throws ScopeDeniedError without read scope', async () => {
    const client = makeClient();
    const noReadCtx: AgentContext = { ...ctx, scopes: [] };
    await expect(statusGetTool(client, noReadCtx).execute({ userId: 'u' })).rejects.toThrow(ScopeDeniedError);
  });
});
