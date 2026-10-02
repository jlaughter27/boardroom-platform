import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memoryWriteTool, memorySearchTool, memorySupersedeT } from '../src/tools/memory.tool';
import { ScopeDeniedError, McpValidationError } from '../src/types';
import type { OmniMindClient } from '../src/lib/client';
import type { AgentContext } from '../src/types';

function makeCtx(scopes: string[] = ['memory:read', 'memory:write']): AgentContext {
  return { agentId: 'test-agent', agentName: 'test-agent', tenantId: 'josh-business', scopes, sourceWeight: 1.0 };
}

function makeMockClient(): OmniMindClient {
  return {
    searchMemories: vi.fn().mockResolvedValue([]),
    // M-107: POST /memories returns { id, status, validation } — not a MemoryRecord.
    createMemory: vi.fn().mockResolvedValue({ id: 'mem-1', status: 'created', validation: { syncPassed: true, errors: [] } }),
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
    expect(result.ok).toBe(true);
    expect(result.created).toHaveLength(1);
    expect(result.updated).toHaveLength(0);
  });

  it('M-107: reports ids the server auto-superseded under `updated`, not `created`', async () => {
    vi.mocked(client.createMemory).mockResolvedValueOnce({ id: 'dupe-9', status: 'updated' });
    const tool = memoryWriteTool(client, ctx);
    const result = await tool.execute({ content: 'Already known fact', userId: 'user-1', skipExtraction: true });
    expect(result.ok).toBe(true);
    expect(result.created).toEqual([]);
    expect(result.updated).toEqual(['dupe-9']);
  });

  it('M-107: never sends `supersedes` on the create payload', async () => {
    const tool = memoryWriteTool(client, ctx);
    await tool.execute({ content: 'x', userId: 'user-1', skipExtraction: true });
    const payload = vi.mocked(client.createMemory).mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('supersedes');
  });

  it('throws ScopeDeniedError when missing write scope', async () => {
    const tool = memoryWriteTool(client, makeCtx(['memory:read']));
    await expect(tool.execute({ content: 'test', userId: 'user-1' }))
      .rejects.toThrow(ScopeDeniedError);
  });

  it('M-109: throws McpValidationError on invalid input (missing userId)', async () => {
    const tool = memoryWriteTool(client, ctx);
    await expect(tool.execute({ content: 'test' })).rejects.toBeInstanceOf(McpValidationError);
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

  it('calls logAudit after write with sanitized output', async () => {
    const tool = memoryWriteTool(client, ctx);
    await tool.execute({ content: 'test content', userId: 'user-1' });
    expect(client.createMemory).toHaveBeenCalled();
    expect(client.logAudit).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'memory_write',
      outputJson: expect.objectContaining({ ok: true, created: ['mem-1'] }),
    }));
  });

  it('F-212: ministry refusal is typed, audited, redacted and never reaches the API', async () => {
    const tool = memoryWriteTool(client, ctx);
    const result = await tool.execute({ content: 'Pastoral note about a member', domain: ' Ministry ', userId: 'user-1' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toBe('MINISTRY_DEFERRED');
    expect(result.created).toEqual([]);
    expect(client.createMemory).not.toHaveBeenCalled();
    expect(client.logAudit).toHaveBeenCalledTimes(1);
    const entry = vi.mocked(client.logAudit).mock.calls[0][0];
    expect(entry.toolName).toBe('memory_write');
    expect(entry.errorMessage).toBe('MINISTRY_DEFERRED');
    expect(entry.outputJson).toEqual({ success: false, reason: 'MINISTRY_DEFERRED' });
    expect((entry.inputJson as Record<string, unknown>).content).toBe('[REDACTED:ministry]');
    expect((entry.inputJson as Record<string, unknown>).domain).toBe('ministry');
  });

  it('surfaces FACT_EXTRACTOR_UNAVAILABLE as a typed refusal', async () => {
    const { extractAndDedup } = await import('../src/lib/fact-extractor');
    const err = Object.assign(new Error('Haiku down'), { code: 'FACT_EXTRACTOR_UNAVAILABLE' });
    vi.mocked(extractAndDedup).mockRejectedValueOnce(err);
    const tool = memoryWriteTool(client, ctx);
    const result = await tool.execute({ content: 'something', userId: 'user-1' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toBe('FACT_EXTRACTOR_UNAVAILABLE');
    expect(client.logAudit).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: expect.stringContaining('Haiku down') }));
  });
});

describe('memory_search', () => {
  let client: OmniMindClient;
  let ctx: AgentContext;

  beforeEach(() => {
    client = makeMockClient();
    ctx = makeCtx(['memory:read']);
  });

  it('returns search results and passes tags/status through (no fake params)', async () => {
    vi.mocked(client.searchMemories).mockResolvedValueOnce([
      { id: 'mem-1', title: 'Test', content: 'Test content', domain: 'business', tags: [], importance: 0.5, sourceType: 'MCP_AGENT', tenantId: 'josh-business', createdAt: '', updatedAt: '' } as never,
    ]);
    const tool = memorySearchTool(client, ctx);
    const result = await tool.execute({ query: 'test', userId: 'user-1', tags: ['decision'], status: 'CONFIRMED' });
    expect(result.count).toBe(1);
    expect(result.memories).toHaveLength(1);
    const params = vi.mocked(client.searchMemories).mock.calls[0][0] as Record<string, unknown>;
    expect(params).toMatchObject({ query: 'test', tags: ['decision'], status: 'CONFIRMED', tenantId: 'josh-business' });
    expect(params).not.toHaveProperty('similarityThreshold');
    expect(params).not.toHaveProperty('includeArchived');
  });

  it('M-104: audit output carries ids/titles only, never content; ministry rows redacted', async () => {
    vi.mocked(client.searchMemories).mockResolvedValueOnce([
      { id: 'mem-1', title: 'Plain', content: 'SECRET BODY', domain: 'business', tags: ['x'] } as never,
      { id: 'mem-2', title: 'Pastoral', content: 'PASTORAL BODY', domain: 'ministry', tags: [] } as never,
    ]);
    await memorySearchTool(client, ctx).execute({ query: 'x', userId: 'user-1' });
    const entry = vi.mocked(client.logAudit).mock.calls[0][0];
    const serialized = JSON.stringify(entry.outputJson);
    expect(serialized).not.toContain('SECRET BODY');
    expect(serialized).not.toContain('PASTORAL BODY');
    expect(serialized).not.toContain('Pastoral');
    expect(entry.outputJson).toEqual({
      memories: [
        { id: 'mem-1', title: 'Plain', domain: 'business', tags: ['x'] },
        { id: 'mem-2', domain: 'ministry', title: '[REDACTED:ministry]' },
      ],
      count: 2,
    });
  });

  it('throws ScopeDeniedError when missing read scope', async () => {
    const tool = memorySearchTool(client, makeCtx([]));
    await expect(tool.execute({ query: 'test', userId: 'user-1' })).rejects.toThrow(ScopeDeniedError);
  });

  it('rejects invalid limit (> 20) with McpValidationError', async () => {
    const tool = memorySearchTool(client, ctx);
    await expect(tool.execute({ query: 'test', userId: 'user-1', limit: 100 })).rejects.toBeInstanceOf(McpValidationError);
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

  it('redacts newContent in the audit row when the existing memory is ministry', async () => {
    vi.mocked(client.getMemory).mockResolvedValueOnce({ id: 'mem-old', domain: 'MINISTRY' } as never);
    await memorySupersedeT(client, ctx).execute({ id: 'mem-old', newContent: 'pastoral update', userId: 'user-1' });
    const entry = vi.mocked(client.logAudit).mock.calls[0][0];
    expect((entry.inputJson as Record<string, unknown>).newContent).toBe('[REDACTED:ministry]');
  });

  it('throws ScopeDeniedError for read-only agent', async () => {
    const tool = memorySupersedeT(client, makeCtx(['memory:read']));
    await expect(tool.execute({ id: 'mem-1', newContent: 'new', userId: 'u' })).rejects.toThrow(ScopeDeniedError);
  });
});
