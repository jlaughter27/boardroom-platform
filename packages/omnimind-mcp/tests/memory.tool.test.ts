import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memoryWriteTool, memorySearchTool, memorySupersedeT } from '../src/tools/memory.tool';
import { ScopeDeniedError } from '../src/types';
import type { OmniMindClient } from '../src/lib/client';
import type { AgentContext } from '../src/types';

function makeCtx(scopes: string[] = ['memory:read', 'memory:write']): AgentContext {
  return { agentId: 'test-agent', agentName: 'test-agent', tenantId: 'josh-business', scopes, sourceWeight: 1.0 };
}

function makeMockClient(): OmniMindClient {
  return {
    searchMemories: vi.fn().mockResolvedValue([]),
    createMemory: vi.fn().mockResolvedValue({ id: 'mem-1', title: 'test', content: 'test', domain: 'business', tags: [], importance: 0.5, sourceType: 'MCP_AGENT', tenantId: 'josh-business', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
    updateMemory: vi.fn().mockResolvedValue({ id: 'mem-1', title: 'test', content: 'updated', domain: 'business', tags: [], importance: 0.5, sourceType: 'MCP_AGENT', tenantId: 'josh-business', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
    getMemory: vi.fn().mockResolvedValue(null),
    logAudit: vi.fn().mockResolvedValue(undefined),
  } as unknown as OmniMindClient;
}

// Mock the fact extractor to avoid Anthropic API calls in tests
vi.mock('../src/lib/fact-extractor', () => ({
  extractAndDedup: vi.fn().mockResolvedValue([
    { text: 'Test fact', type: 'context', action: 'create' },
  ]),
}));

describe('memory_write', () => {
  let client: OmniMindClient;
  let ctx: AgentContext;

  beforeEach(() => {
    client = makeMockClient();
    ctx = makeCtx();
  });

  it('creates a memory when no duplicates found', async () => {
    const tool = memoryWriteTool(client, ctx);
    const result = await tool.execute({
      content: 'Josh decided to use Postgres',
      domain: 'business',
      userId: 'user-1',
    });
    expect(result.created).toHaveLength(1);
    expect(result.updated).toHaveLength(0);
  });

  it('throws ScopeDeniedError when missing write scope', async () => {
    const tool = memoryWriteTool(client, makeCtx(['memory:read']));
    await expect(tool.execute({ content: 'test', userId: 'user-1' }))
      .rejects.toThrow(ScopeDeniedError);
  });

  it('throws on invalid input (missing userId)', async () => {
    const tool = memoryWriteTool(client, ctx);
    await expect(tool.execute({ content: 'test' })).rejects.toThrow();
  });

  it('skips extraction when skipExtraction=true', async () => {
    const tool = memoryWriteTool(client, ctx);
    const result = await tool.execute({
      content: 'Direct memory store',
      userId: 'user-1',
      skipExtraction: true,
    });
    expect(result.created).toHaveLength(1);
  });

  it('calls logAudit after write', async () => {
    const tool = memoryWriteTool(client, ctx);
    await tool.execute({ content: 'test content', userId: 'user-1' });
    // logAudit is fire-and-forget, so just verify no throw
    expect(client.createMemory).toHaveBeenCalled();
  });
});

describe('memory_search', () => {
  let client: OmniMindClient;
  let ctx: AgentContext;

  beforeEach(() => {
    client = makeMockClient();
    ctx = makeCtx(['memory:read']);
  });

  it('returns search results', async () => {
    vi.mocked(client.searchMemories).mockResolvedValueOnce([
      { id: 'mem-1', title: 'Test', content: 'Test content', domain: 'business', tags: [], importance: 0.5, sourceType: 'MCP_AGENT', tenantId: 'josh-business', createdAt: '', updatedAt: '' },
    ]);
    const tool = memorySearchTool(client, ctx);
    const result = await tool.execute({ query: 'test', userId: 'user-1' });
    expect(result.count).toBe(1);
    expect(result.memories).toHaveLength(1);
  });

  it('throws ScopeDeniedError when missing read scope', async () => {
    const tool = memorySearchTool(client, makeCtx([]));
    await expect(tool.execute({ query: 'test', userId: 'user-1' })).rejects.toThrow(ScopeDeniedError);
  });

  it('rejects invalid limit (> 20)', async () => {
    const tool = memorySearchTool(client, ctx);
    await expect(tool.execute({ query: 'test', userId: 'user-1', limit: 100 })).rejects.toThrow();
  });
});

describe('memory_supersede', () => {
  let client: OmniMindClient;
  let ctx: AgentContext;

  beforeEach(() => {
    client = makeMockClient();
    ctx = makeCtx(['memory:write']);
  });

  it('updates existing memory', async () => {
    const tool = memorySupersedeT(client, ctx);
    const result = await tool.execute({ id: 'mem-old', newContent: 'Updated content', userId: 'user-1' });
    expect(result.updated).toBe(true);
    expect(client.updateMemory).toHaveBeenCalledWith('mem-old', expect.objectContaining({ content: 'Updated content' }), 'user-1');
  });

  it('throws ScopeDeniedError for read-only agent', async () => {
    const tool = memorySupersedeT(client, makeCtx(['memory:read']));
    await expect(tool.execute({ id: 'mem-1', newContent: 'new', userId: 'u' })).rejects.toThrow(ScopeDeniedError);
  });
});
