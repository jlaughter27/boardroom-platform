/**
 * WS-7.3 regression — memory_search response shape, plus M-102 / M-103 / F-217
 * request-shape assertions for OmniMindClient.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn();

vi.mock('undici', () => ({
  fetch: (...args: unknown[]) => fetchMock(...args),
}));

// Import AFTER the vi.mock so the client picks up the mocked fetch.
// eslint-disable-next-line import/first
import { OmniMindClient, createOmniMindClient } from '../src/lib/client';

const okJson = (body: unknown) => ({ ok: true, json: async () => body, text: async () => '' });

describe('OmniMindClient.searchMemories — response shape', () => {
  let client: OmniMindClient;

  beforeEach(() => {
    fetchMock.mockReset();
    client = new OmniMindClient({ baseUrl: 'http://test.local', apiKey: 'test-key' });
    client.setAgentHeaders({ agentId: 'test-agent', tenantId: 'josh-business', sourceWeight: 1.0 });
  });

  it('extracts memories from the `items` field returned by GET /memories', async () => {
    fetchMock.mockResolvedValue(okJson({ items: [{ id: 'mem-1' }], total: 1, offset: 0, limit: 5 }));
    const result = await client.searchMemories({ query: 'anything', tenantId: 'josh-business', userId: 'user-1' });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('mem-1');
  });

  it('falls back to `memories` key for any legacy responses', async () => {
    fetchMock.mockResolvedValue(okJson({ memories: [{ id: 'mem-legacy' }] }));
    const result = await client.searchMemories({ query: 'anything', tenantId: 'josh-business', userId: 'user-1' });
    expect(result[0]?.id).toBe('mem-legacy');
  });

  it('returns an empty array when neither key is present', async () => {
    fetchMock.mockResolvedValue(okJson({ unrelated: 'shape' }));
    const result = await client.searchMemories({ query: 'anything', tenantId: 'josh-business', userId: 'user-1' });
    expect(result).toEqual([]);
  });
});

describe('OmniMindClient.searchMemories — request shape (M-102)', () => {
  it('sends tags= comma-joined and omits q when no query is given', () => {
    const qs = OmniMindClient.buildSearchQuery({ tags: ['task', 'task:todo'], tenantId: 'josh-business', limit: 10 });
    expect(qs.get('tags')).toBe('task,task:todo');
    expect(qs.get('q')).toBeNull();
    expect(qs.get('tenantId')).toBe('josh-business');
    expect(qs.get('limit')).toBe('10');
    // The route ignores these — they must never be sent.
    expect(qs.has('threshold')).toBe(false);
    expect(qs.has('includeArchived')).toBe(false);
  });

  it('sends q + tags + status together', () => {
    const qs = OmniMindClient.buildSearchQuery({ query: 'Build MCP', tags: ['task'], status: 'ARCHIVED', tenantId: 't' });
    expect(qs.get('q')).toBe('Build MCP');
    expect(qs.get('tags')).toBe('task');
    expect(qs.get('status')).toBe('ARCHIVED');
  });

  it('puts the query string on the wire', async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(okJson({ items: [] }));
    const client = new OmniMindClient({ baseUrl: 'http://test.local', apiKey: 'k' });
    await client.searchMemories({ tags: ['commitment', 'commitment:pending'], tenantId: 't', userId: 'u' });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('tags=commitment%2Ccommitment%3Apending');
    expect(url).not.toContain('q=');
  });
});

describe('OmniMindClient headers (M-103 / F-217)', () => {
  beforeEach(() => { fetchMock.mockReset(); fetchMock.mockResolvedValue(okJson({ items: [] })); });

  it('sends x-agent-key when OMNIMIND_MCP_AGENT_KEY is configured', async () => {
    const client = createOmniMindClient({
      OMNIMIND_API_URL: 'http://test.local',
      OMNIMIND_API_KEY: 'service-key',
      OMNIMIND_MCP_AGENT_KEY: 'omk_abc',
    } as NodeJS.ProcessEnv);
    await client.searchMemories({ tenantId: 't', userId: 'u' });
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers['x-agent-key']).toBe('omk_abc');
    expect(init.headers['x-api-key']).toBe('service-key');
    expect(init.headers['x-user-id']).toBe('u');
  });

  it('omits x-agent-key when not configured', async () => {
    const client = createOmniMindClient({ OMNIMIND_API_URL: 'http://test.local', OMNIMIND_API_KEY: 'k' } as NodeJS.ProcessEnv);
    await client.searchMemories({ tenantId: 't' });
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers).not.toHaveProperty('x-agent-key');
  });

  it('F-217: rejects a non-finite or out-of-range source weight before anything is sent', () => {
    const client = new OmniMindClient({ baseUrl: 'http://test.local', apiKey: 'k' });
    expect(() => client.setAgentHeaders({ agentId: 'a', tenantId: 't', sourceWeight: 3 })).toThrow(/between 0 and 2/);
    expect(() => client.setAgentHeaders({ agentId: 'a', tenantId: 't', sourceWeight: Number.NaN })).toThrow();
    expect(() => client.setAgentHeaders({ agentId: 'a', tenantId: 't', sourceWeight: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => client.setAgentHeaders({ agentId: 'a', tenantId: 't', sourceWeight: -0.1 })).toThrow();
    expect(() => client.setAgentHeaders({ agentId: 'a', tenantId: 't', sourceWeight: 2 })).not.toThrow();
  });
});
