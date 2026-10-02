import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decisionLogTool } from '../src/tools/decision.tool';
import { ScopeDeniedError, McpValidationError } from '../src/types';
import type { OmniMindClient } from '../src/lib/client';
import type { AgentContext } from '../src/types';

function makeCtx(scopes: string[] = ['decision:write']): AgentContext {
  return { agentId: 'test', agentName: 'test', tenantId: 'josh-business', scopes, sourceWeight: 1.0 };
}

function makeMockClient(): OmniMindClient {
  return {
    createMemory: vi.fn().mockResolvedValue({ id: 'dec-1', status: 'created' }),
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
    expect(result.action).toBe('created');
  });

  it('throws ScopeDeniedError when missing decision:write', async () => {
    const tool = decisionLogTool(client, makeCtx(['memory:read']));
    await expect(tool.execute({ title: 'test', content: 'x', userId: 'u' })).rejects.toThrow(ScopeDeniedError);
  });

  it('throws McpValidationError on empty title', async () => {
    const tool = decisionLogTool(client, makeCtx());
    await expect(tool.execute({ title: '', content: 'x', userId: 'u' })).rejects.toBeInstanceOf(McpValidationError);
  });

  it('includes decision tag in created memory', async () => {
    const tool = decisionLogTool(client, makeCtx());
    await tool.execute({ title: 'Use Redis', content: 'For session storage', userId: 'u' });
    expect(client.createMemory).toHaveBeenCalledWith(
      expect.objectContaining({ tags: expect.arrayContaining(['decision']) }),
      'u'
    );
  });

  it('F-205: normalizes domain (trim + lowercase) before sending', async () => {
    const tool = decisionLogTool(client, makeCtx());
    await tool.execute({ title: 't', content: 'c', userId: 'u', domain: '  Business ' });
    expect(client.createMemory).toHaveBeenCalledWith(expect.objectContaining({ domain: 'business' }), 'u');
  });

  it('F-205/F-212: ministry decision is refused, audited, and its content redacted', async () => {
    const tool = decisionLogTool(client, makeCtx());
    const result = await tool.execute({ title: 'Pastoral care plan', content: 'Sensitive pastoral detail', userId: 'u', domain: 'MINISTRY' });
    expect(result.logged).toBe(false);
    expect(result.error).toBe('MINISTRY_DEFERRED');
    expect(client.createMemory).not.toHaveBeenCalled();
    const entry = vi.mocked(client.logAudit).mock.calls[0][0];
    expect(entry.toolName).toBe('decision_log');
    expect(entry.errorMessage).toBe('MINISTRY_DEFERRED');
    const input = entry.inputJson as Record<string, unknown>;
    expect(input.content).toBe('[REDACTED:ministry]');
    expect(input.title).toBe('[REDACTED:ministry]');
    expect(input.domain).toBe('ministry');
    expect(input.userId).toBe('u');
  });
});
