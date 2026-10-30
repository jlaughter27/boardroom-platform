import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memoryWriteTool, memoryWriteReplayCache } from '../src/tools/memory.tool';
import { decisionLogTool } from '../src/tools/decision.tool';
import type { OmniMindClient } from '../src/lib/client';
import type { AgentContext } from '../src/types';

vi.mock('../src/lib/fact-extractor', () => ({
  extractAndDedup: vi.fn().mockResolvedValue([{ text: 'Test fact', type: 'context', action: 'create' }]),
}));

/**
 * H2 (adversarial e2e 2026-10-30): a tgfc-ministry token calling memory_write
 * with no domain stored pastoral text as `domain: "general"` in the ministry
 * tenant (+ an OpenAI outbox row); `ministry​` and lookalikes also got
 * through the MCP-side gate.
 */
function ctxFor(tenantId: string): AgentContext {
  return {
    agentId: `mcp-token:pastor-${tenantId}`,
    agentName: 'pastor',
    tenantId,
    scopes: ['memory:read', 'memory:write', 'decision:write'],
    sourceWeight: 1,
  };
}

function makeClient(): OmniMindClient {
  return {
    createMemory: vi.fn().mockResolvedValue({ id: 'mem-1', status: 'created', validation: { syncPassed: true, errors: [] } }),
    searchSimilar: vi.fn().mockResolvedValue([]),
    searchMemories: vi.fn().mockResolvedValue([]),
    updateMemory: vi.fn(),
    getMemory: vi.fn().mockResolvedValue(null),
    logAudit: vi.fn().mockResolvedValue(undefined),
  } as unknown as OmniMindClient;
}

describe('memory_write in the ministry tenant (H2)', () => {
  beforeEach(() => memoryWriteReplayCache.clear());

  it('refuses a write with NO domain from a tgfc-ministry token and never calls the API', async () => {
    const client = makeClient();
    const tool = memoryWriteTool(client, ctxFor('tgfc-ministry'), { extractMode: 'sync' });
    const result = await tool.execute({ content: 'invented pastoral counselling note', userId: 'u-1' });
    expect(result).toMatchObject({ ok: false, error: 'MINISTRY_DEFERRED' });
    expect(client.createMemory).not.toHaveBeenCalled();
  });

  it.each(['general', 'business', 'personal'])('refuses explicit domain %j from a tgfc-ministry token', async (domain) => {
    const client = makeClient();
    const tool = memoryWriteTool(client, ctxFor('tgfc-ministry'), { extractMode: 'async' });
    const result = await tool.execute({ content: 'invented note', domain, userId: 'u-1', skipExtraction: true });
    expect(result).toMatchObject({ ok: false, error: 'MINISTRY_DEFERRED' });
    expect(client.createMemory).not.toHaveBeenCalled();
  });

  it('audits the refusal with the content redacted and domain recorded as ministry', async () => {
    const client = makeClient();
    const tool = memoryWriteTool(client, ctxFor('tgfc-ministry'));
    await tool.execute({ content: 'PASTORAL BODY', userId: 'u-1' });
    await new Promise((r) => setTimeout(r, 0));
    const entry = vi.mocked(client.logAudit).mock.calls[0]?.[0] as { inputJson: Record<string, unknown> } | undefined;
    expect(entry?.inputJson.content).toBe('[REDACTED:ministry]');
    expect(entry?.inputJson.domain).toBe('ministry');
  });

  it.each(['ministry​', '​ministry', 'mіnistry', 'ministry/pastoral', 'ministries', 'tgfc-ministry'])(
    'refuses domain %j from a business token',
    async (domain) => {
      const client = makeClient();
      const tool = memoryWriteTool(client, ctxFor('josh-business'), { extractMode: 'sync' });
      const result = await tool.execute({ content: 'invented', domain, userId: 'u-1', skipExtraction: true });
      expect(result).toMatchObject({ ok: false, error: 'MINISTRY_DEFERRED' });
      expect(client.createMemory).not.toHaveBeenCalled();
    }
  );

  it('a business token with no domain still writes as general', async () => {
    const client = makeClient();
    const tool = memoryWriteTool(client, ctxFor('josh-business'), { extractMode: 'sync' });
    const result = await tool.execute({ content: 'Postgres chosen', userId: 'u-1', skipExtraction: true });
    expect(result.ok).toBe(true);
    expect(vi.mocked(client.createMemory).mock.calls[0][0]).toMatchObject({ domain: 'general', tenantId: 'josh-business' });
  });
});

describe('decision_log in the ministry tenant (H2)', () => {
  it('refuses a decision from a tgfc-ministry token whatever the domain', async () => {
    const client = makeClient();
    const tool = decisionLogTool(client, ctxFor('tgfc-ministry'));
    const result = await tool.execute({ title: 'Care plan', content: 'invented pastoral detail', userId: 'u-1' });
    expect(result).toMatchObject({ logged: false, error: 'MINISTRY_DEFERRED' });
    expect(client.createMemory).not.toHaveBeenCalled();
  });
});
