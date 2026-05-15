/**
 * WS-7.3 regression — memory_search response shape
 *
 * The OmniMind API GET /memories route returns the standard listing
 * envelope `{ items, total, offset, limit }`. The MCP client previously
 * read `result.memories` from that response, which is always undefined,
 * so `OmniMindClient.searchMemories` silently returned `[]` for every
 * tenant-isolated query.
 *
 * This regression test stubs `undici.fetch` to return the real envelope
 * shape and asserts the client extracts the `items` array correctly.
 *
 * Related: WS-5 E2E-2-tenant-isolation.test.ts had to route around this
 * bug; with the fix in place it no longer needs to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn();

vi.mock('undici', () => ({
  fetch: (...args: unknown[]) => fetchMock(...args),
}));

// Import AFTER the vi.mock so the client picks up the mocked fetch.
// eslint-disable-next-line import/first
import { OmniMindClient } from '../src/lib/client';

describe('OmniMindClient.searchMemories — response shape', () => {
  let client: OmniMindClient;

  beforeEach(() => {
    fetchMock.mockReset();
    client = new OmniMindClient({
      baseUrl: 'http://test.local',
      apiKey: 'test-key',
    });
    client.setAgentHeaders({
      agentId: 'test-agent',
      tenantId: 'josh-business',
      sourceWeight: 1.0,
    });
  });

  it('extracts memories from the `items` field returned by GET /memories', async () => {
    const memory = {
      id: 'mem-1',
      title: 'Test memory',
      content: 'body',
      domain: 'business',
      tags: ['x'],
      importance: 0.5,
      sourceType: 'MCP_AGENT',
      agentId: 'test-agent',
      tenantId: 'josh-business',
      createdAt: '2026-05-15T00:00:00Z',
      updatedAt: '2026-05-15T00:00:00Z',
    };

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [memory], total: 1, offset: 0, limit: 5 }),
      text: async () => '',
    });

    const result = await client.searchMemories({
      query: 'anything',
      tenantId: 'josh-business',
      userId: 'user-1',
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('mem-1');
  });

  it('falls back to `memories` key for any legacy responses', async () => {
    // Defensive: if a route variant returns the older envelope, the
    // client should still pick it up rather than returning [].
    const memory = {
      id: 'mem-legacy',
      title: 'legacy shape',
      content: 'body',
      domain: 'business',
      tags: [],
      importance: 0.5,
      sourceType: 'MCP_AGENT',
      tenantId: 'josh-business',
      createdAt: '2026-05-15T00:00:00Z',
      updatedAt: '2026-05-15T00:00:00Z',
    };

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ memories: [memory] }),
      text: async () => '',
    });

    const result = await client.searchMemories({
      query: 'anything',
      tenantId: 'josh-business',
      userId: 'user-1',
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('mem-legacy');
  });

  it('returns an empty array when neither key is present', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ unrelated: 'shape' }),
      text: async () => '',
    });

    const result = await client.searchMemories({
      query: 'anything',
      tenantId: 'josh-business',
      userId: 'user-1',
    });

    expect(result).toEqual([]);
  });
});
