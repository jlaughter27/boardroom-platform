import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decisionLogTool } from '../src/tools/decision.tool';
import { ScopeDeniedError } from '../src/types';
import type { OmniMindClient } from '../src/lib/client';
import type { AgentContext } from '../src/types';

function makeCtx(scopes: string[] = ['decision:write']): AgentContext {
  return { agentId: 'test', agentName: 'test', tenantId: 'josh-business', scopes, sourceWeight: 1.0 };
}

function makeMockClient(): OmniMindClient {
  return {
    createMemory: vi.fn().mockResolvedValue({ id: 'dec-1' }),
    logAudit: vi.fn().mockResolvedValue(undefined),
  } as unknown as OmniMindClient;
}

describe('decision_log', () => {
  let client: OmniMindClient;

  beforeEach(() => { client = makeMockClient(); });

  it('creates decision memory', async () => {
    const tool = decisionLogTool(client, makeCtx());
    const result = await tool.execute({ title: 'Use Postgres', content: 'Decided Postgres over Mongo', userId: 'u-1' });
    expect(result.logged).toBe(true);
    expect(result.id).toBe('dec-1');
  });

  it('throws ScopeDeniedError when missing decision:write', async () => {
    const tool = decisionLogTool(client, makeCtx(['memory:read']));
    await expect(tool.execute({ title: 'test', content: 'x', userId: 'u' })).rejects.toThrow(ScopeDeniedError);
  });

  it('throws on empty title', async () => {
    const tool = decisionLogTool(client, makeCtx());
    await expect(tool.execute({ title: '', content: 'x', userId: 'u' })).rejects.toThrow();
  });

  it('includes decision tag in created memory', async () => {
    const tool = decisionLogTool(client, makeCtx());
    await tool.execute({ title: 'Use Redis', content: 'For session storage', userId: 'u' });
    expect(client.createMemory).toHaveBeenCalledWith(
      expect.objectContaining({ tags: expect.arrayContaining(['decision']) }),
      'u'
    );
  });
});
