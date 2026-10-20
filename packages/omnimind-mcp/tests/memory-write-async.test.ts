/**
 * `OMNIMIND_MCP_WRITE_EXTRACT=async` — memory_write returns once the raw row
 * exists; fact extraction runs after the response and supersedes the raw row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memoryWriteTool, resolveWriteExtractMode, memoryWriteReplayCache, deriveSupersedeIdempotencyKey, RAW_ROW_KEPT_UPDATES_ONLY, RAW_ROW_KEPT_NO_FACTS } from '../src/tools/memory.tool';
import type { OmniMindClient } from '../src/lib/client';
import type { AgentContext } from '../src/types';

const ctx: AgentContext = { agentId: 'agent', agentName: 'agent', tenantId: 'josh-business', scopes: ['memory:write'], sourceWeight: 1 };

vi.mock('../src/lib/fact-extractor', () => ({
  extractAndDedup: vi.fn().mockResolvedValue([
    { text: 'Fact one', type: 'decision', action: 'create' },
    { text: 'Fact two', type: 'context', action: 'update', supersedes: 'old-7' },
  ]),
}));

function mockClient(prefix = 'mem'): OmniMindClient {
  let n = 0;
  return {
    createMemory: vi.fn().mockImplementation(async () => ({ id: `${prefix}-${++n}`, status: 'created' })),
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
    // L-8 — the supersede PATCH is replay-safe across a restart: its key derives from the raw row id alone.
    expect(client.updateMemory).toHaveBeenCalledWith('mem-2', { supersedes: 'mem-1', agentId: 'agent' }, 'u', { idempotencyKey: deriveSupersedeIdempotencyKey('mem-1') });
    expect(deriveSupersedeIdempotencyKey('mem-1')).toMatch(/^supersedes:[0-9a-f]{64}$/);
    expect(deriveSupersedeIdempotencyKey('mem-1').length).toBeLessThanOrEqual(100);
    expect(deriveSupersedeIdempotencyKey('mem-1')).toBe(deriveSupersedeIdempotencyKey('mem-1'));
    expect(deriveSupersedeIdempotencyKey('mem-1')).not.toBe(deriveSupersedeIdempotencyKey('mem-2'));
    const audits = vi.mocked(client.logAudit).mock.calls.map(c => c[0].toolName);
    expect(audits).toEqual(['memory_write', 'memory_write:extract']);
    expect(vi.mocked(client.logAudit).mock.calls[1][0].outputJson).toMatchObject({ ok: true, created: ['mem-2'], updated: ['old-7'], rawId: 'mem-1', rawRowKept: false });

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

  it('L-8: when every fact updates an existing row the raw row is kept and the audit entry says so', async () => {
    const client = mockClient();
    const { extractAndDedup } = await import('../src/lib/fact-extractor');
    vi.mocked(extractAndDedup).mockResolvedValueOnce([
      { text: 'Fact two', type: 'context', action: 'update', supersedes: 'old-7' },
      { text: 'Fact three', type: 'status', action: 'update', supersedes: 'old-8' },
    ]);
    let deferred: Promise<void> | undefined;
    const result = await memoryWriteTool(client, ctx, { extractMode: 'async', onDeferred: p => { deferred = p; } }).execute({ content: 'x', userId: 'u' });
    expect(result).toMatchObject({ ok: true, created: ['mem-1'], extraction: 'async' });
    await deferred;
    expect(client.createMemory).toHaveBeenCalledTimes(1); // only the raw row
    expect(vi.mocked(client.updateMemory).mock.calls.map(c => c[0])).toEqual(['old-7', 'old-8']); // no supersede of mem-1
    const extractAudit = vi.mocked(client.logAudit).mock.calls[1][0];
    expect(extractAudit.toolName).toBe('memory_write:extract');
    expect(extractAudit.outputJson).toMatchObject({ ok: true, created: [], updated: ['old-7', 'old-8'], rawId: 'mem-1', rawRowKept: true, reason: RAW_ROW_KEPT_UPDATES_ONLY });

    // No facts at all → also kept, with its own reason.
    vi.mocked(extractAndDedup).mockResolvedValueOnce([]);
    const c2 = mockClient();
    await memoryWriteTool(c2, ctx, { extractMode: 'async', onDeferred: p => { deferred = p; } }).execute({ content: 'y', userId: 'u' });
    await deferred;
    expect(vi.mocked(c2.logAudit).mock.calls[1][0].outputJson).toMatchObject({ rawRowKept: true, reason: RAW_ROW_KEPT_NO_FACTS });
  });

  it('M-2: the deferred tail runs on `deferredClient`, so closing the session client mid-extraction loses nothing', async () => {
    const sessionClient = mockClient();
    const deferredClient = mockClient('fact');
    const { extractAndDedup } = await import('../src/lib/fact-extractor');
    vi.mocked(extractAndDedup).mockImplementationOnce(async () => {
      await new Promise(r => setTimeout(r, 10));
      return [{ text: 'Fact one', type: 'decision', action: 'create' }];
    });
    let deferred: Promise<void> | undefined;
    const tool = memoryWriteTool(sessionClient, ctx, { extractMode: 'async', deferredClient, onDeferred: p => { deferred = p; } });
    const result = await tool.execute({ content: 'Josh chose Railway.', userId: 'u' });
    expect(result).toMatchObject({ ok: true, created: ['mem-1'], extraction: 'async' });
    // What http.ts does on DELETE / idle sweep / eviction: the session client is closed at once.
    (sessionClient as unknown as { createMemory: ReturnType<typeof vi.fn> }).createMemory.mockRejectedValue(new Error('client closed (session ended)'));
    (sessionClient as unknown as { logAudit: ReturnType<typeof vi.fn> }).logAudit.mockRejectedValue(new Error('client closed (session ended)'));
    await deferred;
    // The raw row went through the session client; the fact row, supersede and extract audit through the deferred one.
    expect(sessionClient.createMemory).toHaveBeenCalledTimes(1);
    expect(deferredClient.createMemory).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deferredClient.createMemory).mock.calls[0][0]).toMatchObject({ content: 'Fact one' });
    expect(deferredClient.updateMemory).toHaveBeenCalledWith('fact-1', { supersedes: 'mem-1', agentId: 'agent' }, 'u', expect.anything());
    expect(vi.mocked(deferredClient.logAudit).mock.calls.map(c => c[0].toolName)).toEqual(['memory_write:extract']);
    // extractAndDedup (dedup lookups) also used the deferred client.
    expect(vi.mocked(extractAndDedup).mock.calls.at(-1)?.[2]).toBe(deferredClient);
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
