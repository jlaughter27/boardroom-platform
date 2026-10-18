/**
 * `OMNIMIND_MCP_WRITE_EXTRACT=async` — memory_write returns once the raw row
 * exists; fact extraction runs after the response and supersedes the raw row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memoryWriteTool, resolveWriteExtractMode, memoryWriteReplayCache } from '../src/tools/memory.tool';
import type { OmniMindClient } from '../src/lib/client';
import type { AgentContext } from '../src/types';

const ctx: AgentContext = { agentId: 'agent', agentName: 'agent', tenantId: 'josh-business', scopes: ['memory:write'], sourceWeight: 1 };

vi.mock('../src/lib/fact-extractor', () => ({
  extractAndDedup: vi.fn().mockResolvedValue([
    { text: 'Fact one', type: 'decision', action: 'create' },
    { text: 'Fact two', type: 'context', action: 'update', supersedes: 'old-7' },
  ]),
}));

function mockClient(): OmniMindClient {
  let n = 0;
  return {
    createMemory: vi.fn().mockImplementation(async () => ({ id: `mem-${++n}`, status: 'created' })),
    updateMemory: vi.fn().mockImplementation(async (id: string) => ({ id })),
    logAudit: vi.fn().mockResolvedValue(undefined),
  } as unknown as OmniMindClient;
}

describe('resolveWriteExtractMode', () => {
  it('defaults to sync; only an explicit async flips it', () => {
    expect(resolveWriteExtractMode({} as NodeJS.ProcessEnv)).toBe('sync');
    expect(resolveWriteExtractMode({ OMNIMIND_MCP_WRITE_EXTRACT: 'ASYNC ' } as NodeJS.ProcessEnv)).toBe('async');
    expect(resolveWriteExtractMode({ OMNIMIND_MCP_WRITE_EXTRACT: 'later' } as NodeJS.ProcessEnv)).toBe('sync');
  });
});

describe('memory_write in async mode', () => {
  beforeEach(() => memoryWriteReplayCache.clear());

  it('returns the raw row immediately (extraction: async), then writes facts and supersedes the raw row', async () => {
    const client = mockClient();
    let deferred: Promise<void> | undefined;
    const tool = memoryWriteTool(client, ctx, { extractMode: 'async', onDeferred: p => { deferred = p; } });
    const { extractAndDedup } = await import('../src/lib/fact-extractor');
    const before = vi.mocked(extractAndDedup).mock.calls.length;

    const result = await tool.execute({ content: 'Josh chose Railway. Sarah is CTO.', userId: 'u', idempotencyKey: 'k1' });
    expect(result).toEqual({ ok: true, created: ['mem-1'], updated: [], skipped: 0, extraction: 'async' });
    // The response did not wait for extraction to finish writing.
    expect(vi.mocked(client.createMemory).mock.calls[0][0]).toMatchObject({ content: 'Josh chose Railway. Sarah is CTO.', title: 'Josh chose Railway. Sarah is CTO.' });
    expect(vi.mocked(client.createMemory).mock.calls[0][2]).toEqual({ idempotencyKey: 'k1' });

    expect(deferred).toBeDefined();
    await deferred;
    expect(vi.mocked(extractAndDedup).mock.calls.length - before).toBe(1);
    // Fact one created (derived key), fact two superseded old-7, then the raw row superseded by fact one.
    expect(client.createMemory).toHaveBeenCalledTimes(2);
    expect(vi.mocked(client.createMemory).mock.calls[1][0]).toMatchObject({ content: 'Fact one', tags: ['decision'] });
    expect((vi.mocked(client.createMemory).mock.calls[1][2] as { idempotencyKey: string }).idempotencyKey).toMatch(/^k1:[0-9a-f]{64}$/);
    expect(client.updateMemory).toHaveBeenCalledWith('old-7', expect.objectContaining({ content: 'Fact two' }), 'u', expect.anything());
    expect(client.updateMemory).toHaveBeenCalledWith('mem-2', { supersedes: 'mem-1', agentId: 'agent' }, 'u');
    const audits = vi.mocked(client.logAudit).mock.calls.map(c => c[0].toolName);
    expect(audits).toEqual(['memory_write', 'memory_write:extract']);
    expect(vi.mocked(client.logAudit).mock.calls[1][0].outputJson).toMatchObject({ ok: true, created: ['mem-2'], updated: ['old-7'] });

    // A retry with the same key replays the immediate result and schedules nothing.
    deferred = undefined;
    const replay = await tool.execute({ content: 'Josh chose Railway. Sarah is CTO.', userId: 'u', idempotencyKey: 'k1' });
    expect(replay).toEqual(result);
    expect(deferred).toBeUndefined();
  });

  it('a failing deferred extraction is logged, never thrown, and the raw row stays', async () => {
    const client = mockClient();
    const { extractAndDedup } = await import('../src/lib/fact-extractor');
    vi.mocked(extractAndDedup).mockRejectedValueOnce(Object.assign(new Error('Haiku down'), { code: 'FACT_EXTRACTOR_UNAVAILABLE' }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let deferred: Promise<void> | undefined;
    const result = await memoryWriteTool(client, ctx, { extractMode: 'async', onDeferred: p => { deferred = p; } }).execute({ content: 'x', userId: 'u' });
    expect(result).toMatchObject({ ok: true, created: ['mem-1'], extraction: 'async' });
    await expect(deferred).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('deferred extraction failed (raw row mem-1 kept)'), 'Haiku down');
    expect(client.updateMemory).not.toHaveBeenCalled();
    expect(vi.mocked(client.logAudit).mock.calls[1][0]).toMatchObject({ toolName: 'memory_write:extract', errorMessage: 'Haiku down' });
    errorSpy.mockRestore();
  });

  it('skipExtraction and sync mode are unchanged by the flag', async () => {
    const client = mockClient();
    let deferred: Promise<void> | undefined;
    const asyncTool = memoryWriteTool(client, ctx, { extractMode: 'async', onDeferred: p => { deferred = p; } });
    const skipped = await asyncTool.execute({ content: 'x', userId: 'u', skipExtraction: true });
    expect(skipped).toEqual({ ok: true, created: ['mem-1'], updated: [], skipped: 0 });
    expect(deferred).toBeUndefined();

    const syncClient = mockClient();
    const sync = await memoryWriteTool(syncClient, ctx, { extractMode: 'sync' }).execute({ content: 'y', userId: 'u' });
    expect(sync).toEqual({ ok: true, created: ['mem-1'], updated: ['old-7'], skipped: 0 });
    expect(sync).not.toHaveProperty('extraction');
  });
});
