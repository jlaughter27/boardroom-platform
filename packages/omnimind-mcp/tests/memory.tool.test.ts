import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memoryWriteTool, memorySearchTool, memorySupersedeT, memoryReflectTool, memoryConsolidateTool, chooseKeep } from '../src/tools/memory.tool';
import { ScopeDeniedError, McpValidationError } from '../src/types';
import type { OmniMindClient } from '../src/lib/client';
import type { AgentContext } from '../src/types';

function makeCtx(scopes: string[] = ['memory:read', 'memory:write']): AgentContext {
  return { agentId: 'test-agent', agentName: 'test-agent', tenantId: 'josh-business', scopes, sourceWeight: 1.0 };
}

function makeMockClient(): OmniMindClient {
  return {
    searchMemories: vi.fn().mockResolvedValue([]),
    searchHybrid: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    searchSimilar: vi.fn().mockResolvedValue([]),
    reflect: vi.fn().mockResolvedValue({ id: 'cap-1', entityType: 'project', entityId: 'p-1', summary: 'Summary', openRisks: [], unresolvedQuestions: [], activeStakeholders: [], recentChanges: [], version: 2 }),
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

  it('Phase 6: idempotencyKey is forwarded as a write option (and derived per extracted fact)', async () => {
    const tool = memoryWriteTool(client, ctx);
    await tool.execute({ content: 'x', userId: 'user-1', skipExtraction: true, idempotencyKey: 'req-42' });
    expect(vi.mocked(client.createMemory).mock.calls[0][2]).toEqual({ idempotencyKey: 'req-42' });
    await tool.execute({ content: 'Josh decided X', userId: 'user-1', idempotencyKey: 'req-43' });
    expect(vi.mocked(client.createMemory).mock.calls[1][2]).toEqual({ idempotencyKey: 'req-43:0' });
  });

  it('Phase 6: rejects an idempotencyKey longer than 128 chars', async () => {
    const tool = memoryWriteTool(client, ctx);
    await expect(tool.execute({ content: 'x', userId: 'u', idempotencyKey: 'k'.repeat(129) })).rejects.toBeInstanceOf(McpValidationError);
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

  it('Phase 6: routes through POST /memories/search (hybrid) and returns nextCursor', async () => {
    vi.mocked(client.searchHybrid).mockResolvedValueOnce({
      items: [{ id: 'mem-1', title: 'Test', content: 'Test content', domain: 'business', tags: [], score: 0.81 } as never],
      nextCursor: 'eyJvZmZzZXQiOjV9',
    });
    const tool = memorySearchTool(client, ctx);
    const result = await tool.execute({ query: 'test', userId: 'user-1', tags: ['decision'], status: 'CONFIRMED', asOf: '2026-10-01T00:00:00Z', cursor: 'eyJvZmZzZXQiOjB9' });
    expect(result.count).toBe(1);
    expect(result.memories).toHaveLength(1);
    expect(result.nextCursor).toBe('eyJvZmZzZXQiOjV9');
    expect(client.searchMemories).not.toHaveBeenCalled();
    const [params, userId] = vi.mocked(client.searchHybrid).mock.calls[0];
    expect(userId).toBe('user-1');
    expect(params).toEqual({ query: 'test', limit: 5, domain: undefined, tags: ['decision'], status: 'CONFIRMED', includeArchived: false, asOf: '2026-10-01T00:00:00Z', cursor: 'eyJvZmZzZXQiOjB9' });
  });

  it('M-104: audit output carries ids/titles only, never content; ministry rows redacted', async () => {
    vi.mocked(client.searchHybrid).mockResolvedValueOnce({ items: [
      { id: 'mem-1', title: 'Plain', content: 'SECRET BODY', domain: 'business', tags: ['x'] } as never,
      { id: 'mem-2', title: 'Pastoral', content: 'PASTORAL BODY', domain: 'ministry', tags: [] } as never,
    ], nextCursor: null });
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
      nextCursor: null,
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

describe('memory_reflect (Phase 6)', () => {
  it('requires memory:write and returns the capsule from POST /context/reflect', async () => {
    const client = makeMockClient();
    const result = await memoryReflectTool(client, makeCtx(['memory:write'])).execute({ entityType: 'project', entityId: 'p-1', userId: 'u' });
    expect(result.capsule.id).toBe('cap-1');
    expect(result.entityType).toBe('project');
    expect(client.reflect).toHaveBeenCalledWith({ entityType: 'project', entityId: 'p-1' }, 'u');
    expect(client.logAudit).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'memory_reflect' }));
    await expect(memoryReflectTool(client, makeCtx(['memory:read'])).execute({ entityType: 'goal', entityId: 'g', userId: 'u' })).rejects.toThrow(ScopeDeniedError);
  });

  it('rejects unknown entity types', async () => {
    await expect(memoryReflectTool(makeMockClient(), makeCtx(['memory:write'])).execute({ entityType: 'task', entityId: 'x', userId: 'u' })).rejects.toBeInstanceOf(McpValidationError);
  });
});

describe('memory_consolidate (Phase 6)', () => {
  const A = { id: 'a', title: 'A', content: 'Josh prefers TypeScript strict mode', domain: 'business', tags: [], importance: 0.5, createdAt: '2026-10-01T00:00:00Z' };
  const B = { id: 'b', title: 'B', content: 'Josh likes TS strict', domain: 'business', tags: [], importance: 0.5, createdAt: '2026-09-01T00:00:00Z' };
  const C = { id: 'c', title: 'C', content: 'Unrelated', domain: 'business', tags: [], importance: 0.9, createdAt: '2026-08-01T00:00:00Z' };

  function setup() {
    const client = makeMockClient();
    vi.mocked(client.searchMemories).mockResolvedValue([A, B, C] as never);
    vi.mocked(client.searchSimilar).mockImplementation(async ({ query }) => {
      if (query === A.content) return [{ ...A, similarity: 1 }, { ...B, similarity: 0.95 }] as never;
      if (query === B.content) return [{ ...B, similarity: 1 }, { ...A, similarity: 0.95 }] as never;
      return [{ ...C, similarity: 1 }, { ...A, similarity: 0.5 }] as never;
    });
    return client;
  }

  it('chooseKeep prefers higher importance, then newer', () => {
    expect(chooseKeep(A, B)).toEqual({ keepId: 'a', archiveId: 'b' });
    expect(chooseKeep(B, { ...A, importance: 0.1 })).toEqual({ keepId: 'b', archiveId: 'a' });
    expect(chooseKeep({ ...B, importance: 0.9 }, A)).toEqual({ keepId: 'b', archiveId: 'a' });
  });

  it('dryRun (default) proposes de-duplicated pairs ≥0.92 and writes nothing', async () => {
    const client = setup();
    const result = await memoryConsolidateTool(client, makeCtx(['memory:write'])).execute({ userId: 'u' });
    expect(result).toEqual({ dryRun: true, scanned: 3, pairs: [{ keepId: 'a', archiveId: 'b', similarity: 0.95 }], applied: 0, errors: [] });
    expect(client.updateMemory).not.toHaveBeenCalled();
    const listParams = vi.mocked(client.searchMemories).mock.calls[0][0];
    expect(listParams).toMatchObject({ sortBy: 'createdAt', sortOrder: 'desc', limit: 20, tenantId: 'josh-business' });
    expect(vi.mocked(client.searchSimilar).mock.calls[0][0]).toMatchObject({ threshold: 0.92 });
  });

  it('dryRun=false applies PATCH /memories/:keepId { supersedes: archiveId } and counts failures', async () => {
    const client = setup();
    const result = await memoryConsolidateTool(client, makeCtx(['memory:write'])).execute({ userId: 'u', dryRun: false });
    expect(result.applied).toBe(1);
    expect(client.updateMemory).toHaveBeenCalledWith('a', expect.objectContaining({ supersedes: 'b' }), 'u');

    const failing = setup();
    vi.mocked(failing.updateMemory).mockRejectedValueOnce(new Error('409 conflict'));
    const r2 = await memoryConsolidateTool(failing, makeCtx(['memory:write'])).execute({ userId: 'u', dryRun: false });
    expect(r2.applied).toBe(0);
    expect(r2.errors).toEqual([{ keepId: 'a', archiveId: 'b', message: '409 conflict' }]);
  });

  it('never touches ministry rows and requires memory:write', async () => {
    const client = setup();
    vi.mocked(client.searchMemories).mockResolvedValue([{ ...A, domain: 'ministry' }, B] as never);
    const result = await memoryConsolidateTool(client, makeCtx(['memory:write'])).execute({ userId: 'u' });
    expect(result.scanned).toBe(1);
    expect(result.pairs).toEqual([]);
    await expect(memoryConsolidateTool(client, makeCtx(['memory:read'])).execute({ userId: 'u' })).rejects.toThrow(ScopeDeniedError);
    await expect(memoryConsolidateTool(client, makeCtx(['memory:write'])).execute({ userId: 'u', limit: 51 })).rejects.toBeInstanceOf(McpValidationError);
  });
});
