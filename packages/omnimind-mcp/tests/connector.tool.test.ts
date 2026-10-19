/**
 * Front door — ChatGPT connector pair: `search` → `{results:[{id,title,url}]}`,
 * `fetch` → one document with metadata; both read-only, memory:read, and
 * `fetch` refuses anything that is not a memory id.
 */
import { describe, it, expect, vi } from 'vitest';
import { searchTool, fetchTool, parseMemoryId, memoryUrl, resolveAppUrl, SearchOutputSchema, FetchOutputSchema } from '../src/tools/connector.tool';
import { ScopeDeniedError, McpValidationError } from '../src/types';
import type { OmniMindClient } from '../src/lib/client';
import type { AgentContext } from '../src/types';

const ctx: AgentContext = { agentId: 'a', agentName: 'a', tenantId: 'josh-business', scopes: ['memory:read'], sourceWeight: 1, defaultUserId: 'user-1' };
const record = { id: 'm1', title: 'Railway decision', content: 'Chose Railway over Render', domain: 'business', tags: ['decision'], createdAt: '2026-10-01T00:00:00Z', validAt: '2026-10-01T00:00:00Z', invalidAt: null, status: 'CONFIRMED', sourceType: 'MCP_AGENT', agentId: 'claude-code-josh', score: 0.9 };

function mockClient(): OmniMindClient {
  return {
    searchHybrid: vi.fn().mockResolvedValue({ items: [record, { id: 'm2', title: '', content: 'Untitled body that is long enough to be truncated to eighty characters for the title field, yes', domain: 'business', tags: [] }], nextCursor: null }),
    getMemory: vi.fn().mockResolvedValue(record),
    logAudit: vi.fn().mockResolvedValue(undefined),
  } as unknown as OmniMindClient;
}

describe('search', () => {
  it('returns {results:[{id,title,url}]} + provenance, matching its output schema, over the hybrid path', async () => {
    const client = mockClient();
    const out = await searchTool(client, ctx).execute({ query: 'railway', limit: 2 });
    expect(out).toEqual({
      results: [
        { id: 'm1', title: 'Railway decision', url: 'omnimind://josh-business/memory/m1' },
        { id: 'm2', title: 'Untitled body that is long enough to be truncated to eighty characters for the title field, yes'.slice(0, 80), url: 'omnimind://josh-business/memory/m2' },
      ],
      provenance: { source: 'omnimind', trust: 'data' },
    });
    expect(SearchOutputSchema.safeParse(out).success).toBe(true);
    expect(client.searchHybrid).toHaveBeenCalledWith({ query: 'railway', limit: 2, includeArchived: false }, 'user-1');
    expect(client.logAudit).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'search', outputJson: { results: [expect.objectContaining({ id: 'm1', url: expect.any(String) }), expect.anything()] } }));
  });

  it('uses the app url when configured, defaults limit to 10, caps at 20, and needs a bound or explicit user', async () => {
    const client = mockClient();
    const out = await searchTool(client, ctx, { appUrl: 'https://app.example.test/' .replace(/\/$/, '') }).execute({ query: 'q' });
    expect(out.results[0].url).toBe('https://app.example.test/memory/m1');
    expect(client.searchHybrid).toHaveBeenCalledWith({ query: 'q', limit: 10, includeArchived: false }, 'user-1');
    await expect(searchTool(client, ctx).execute({ query: 'q', limit: 21 })).rejects.toBeInstanceOf(McpValidationError);
    await expect(searchTool(client, { ...ctx, defaultUserId: undefined }).execute({ query: 'q' })).rejects.toThrow(/no user is bound/);
    await searchTool(client, { ...ctx, defaultUserId: undefined }).execute({ query: 'q', userId: 'explicit' });
    expect(client.searchHybrid).toHaveBeenLastCalledWith({ query: 'q', limit: 10, includeArchived: false }, 'explicit');
    expect(resolveAppUrl({ OMNIMIND_MCP_APP_URL: 'https://app.example.test//' } as NodeJS.ProcessEnv)).toBe('https://app.example.test');
    expect(resolveAppUrl({} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(memoryUrl(ctx, 'a b', undefined)).toBe('omnimind://josh-business/memory/a%20b');
  });

  it('requires memory:read', async () => {
    await expect(searchTool(mockClient(), { ...ctx, scopes: [] }).execute({ query: 'q' })).rejects.toThrow(ScopeDeniedError);
    await expect(fetchTool(mockClient(), { ...ctx, scopes: ['task:write'] }).execute({ id: 'm1' })).rejects.toThrow(ScopeDeniedError);
  });

  it('L-7: superseded / archived / invalidated rows are dropped unless includeArchived is passed', async () => {
    const stale = [
      { id: 's1', title: 'Old', content: 'c', domain: 'business', tags: [], status: 'SUPERSEDED' },
      { id: 's2', title: 'Archived', content: 'c', domain: 'business', tags: [], status: 'ARCHIVED' },
      { id: 's3', title: 'Invalidated', content: 'c', domain: 'business', tags: [], status: 'CONFIRMED', invalidAt: '2026-10-01T00:00:00Z' },
      { id: 's4', title: 'Replaced', content: 'c', domain: 'business', tags: [], status: 'CONFIRMED', supersededBy: 'm1' },
    ];
    const client = { ...mockClient(), searchHybrid: vi.fn().mockResolvedValue({ items: [record, ...stale], nextCursor: null }) } as unknown as OmniMindClient;
    const out = await searchTool(client, ctx).execute({ query: 'q' });
    expect(out.results.map(r => r.id)).toEqual(['m1']);
    expect(client.searchHybrid).toHaveBeenLastCalledWith({ query: 'q', limit: 10, includeArchived: false }, 'user-1');
    const all = await searchTool(client, ctx).execute({ query: 'q', includeArchived: true });
    expect(all.results.map(r => r.id)).toEqual(['m1', 's1', 's2', 's3', 's4']);
    expect(client.searchHybrid).toHaveBeenLastCalledWith({ query: 'q', limit: 10, includeArchived: true }, 'user-1');
    expect(vi.mocked(client.logAudit).mock.calls.at(-1)?.[0].inputJson).toMatchObject({ includeArchived: true });
  });
});

describe('fetch', () => {
  it('returns {id,title,text,url,metadata} + provenance for a memory id, matching its output schema', async () => {
    const client = mockClient();
    const out = await fetchTool(client, ctx).execute({ id: 'm1' });
    expect(out).toEqual({
      id: 'm1',
      title: 'Railway decision',
      text: 'Chose Railway over Render',
      url: 'omnimind://josh-business/memory/m1',
      metadata: { domain: 'business', tags: ['decision'], createdAt: '2026-10-01T00:00:00Z', validAt: '2026-10-01T00:00:00Z', invalidAt: null, status: 'CONFIRMED', sourceType: 'MCP_AGENT', agentId: 'claude-code-josh' },
      provenance: { source: 'omnimind', trust: 'data' },
    });
    expect(FetchOutputSchema.safeParse(out).success).toBe(true);
    expect(client.getMemory).toHaveBeenCalledWith('m1', 'user-1');
    // Audit never carries the body.
    const audit = vi.mocked(client.logAudit).mock.calls[0][0];
    expect(JSON.stringify(audit.outputJson)).not.toContain('Chose Railway');
    expect(audit.inputJson).toEqual({ id: 'm1', userId: 'user-1' });
  });

  it('accepts the url / node-id forms it hands out and rejects non-memory ids with VALIDATION_ERROR', async () => {
    const client = mockClient();
    for (const id of ['m1', 'memory:m1', 'omnimind://josh-business/memory/m1']) {
      await fetchTool(client, ctx).execute({ id });
      expect(client.getMemory).toHaveBeenLastCalledWith('m1', 'user-1');
    }
    await fetchTool(client, ctx, { appUrl: 'https://app.example.test' }).execute({ id: 'https://app.example.test/memory/m1?utm=x' });
    expect(client.getMemory).toHaveBeenLastCalledWith('m1', 'user-1');
    for (const bad of ['goal:g1', 'person:p1', 'task:t1', 'omnimind://tgfc-ministry/memory/m1', 'https://evil.example.test/memory/m1', 'm1/../x', 'm 1', '']) {
      await expect(fetchTool(client, ctx).execute({ id: bad }), bad).rejects.toBeInstanceOf(McpValidationError);
    }
    expect(() => parseMemoryId('decision:d1', ctx, undefined)).toThrow(/not memories/);
    expect(vi.mocked(client.getMemory).mock.calls).toHaveLength(4);
  });

  it('L-1: malformed percent-encoding in a resource / app url id is a VALIDATION_ERROR, never a URIError', () => {
    for (const bad of ['omnimind://josh-business/memory/%E0%A4%A', 'omnimind://%zz/memory/m1', 'https://app.example.test/memory/%zz']) {
      let err: unknown;
      try { parseMemoryId(bad, ctx, 'https://app.example.test'); } catch (e) { err = e; }
      expect(err, bad).toBeInstanceOf(McpValidationError);
      expect((err as Error).message, bad).toMatch(/not a memory id/);
    }
  });

  it('L-7: fetch of a superseded row returns it as stored with metadata.status / invalidAt set', async () => {
    const client = { ...mockClient(), getMemory: vi.fn().mockResolvedValue({ ...record, status: 'SUPERSEDED', invalidAt: '2026-10-05T00:00:00Z', supersededBy: 'm9' }) } as unknown as OmniMindClient;
    const out = await fetchTool(client, ctx).execute({ id: 'm1' });
    expect(out.metadata).toMatchObject({ status: 'SUPERSEDED', invalidAt: '2026-10-05T00:00:00Z' });
    expect(FetchOutputSchema.safeParse(out).success).toBe(true);
  });
});
