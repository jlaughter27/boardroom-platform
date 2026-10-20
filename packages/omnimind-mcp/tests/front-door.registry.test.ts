/**
 * Front door — registry-level contract: server `instructions` (≤2,048 chars),
 * `_meta["anthropic/requiresUserInteraction"]` on every destructive tool and
 * nothing else, `provenance` on retrieval results, and the bound-user
 * relaxation of `userId`.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SERVER_INSTRUCTIONS, MAX_INSTRUCTIONS_LENGTH } from '../src/instructions';
import type { AgentContext } from '../src/types';

const mockClient = {
  setAgentHeaders: vi.fn(),
  setDelegatedPrincipal: vi.fn(),
  close: vi.fn(),
  searchMemories: vi.fn().mockResolvedValue([]),
  searchHybrid: vi.fn().mockResolvedValue({ items: [{ id: 'm1', title: 'T', content: 'C', domain: 'business', tags: [] }], nextCursor: null }),
  getCommitmentNudges: vi.fn().mockResolvedValue({ dueSoon: [], overdue: [] }),
  getMemory: vi.fn().mockResolvedValue({ id: 'm1', title: 'T', content: 'C', domain: 'business', tags: [] }),
  logAudit: vi.fn().mockResolvedValue(undefined),
};
vi.mock('../src/lib/client', () => ({ createOmniMindClient: () => mockClient }));
vi.mock('../src/lib/fact-extractor', () => ({ extractAndDedup: vi.fn().mockResolvedValue([]) }));

async function connect(ctx: AgentContext) {
  const { createMcpServer } = await import('../src/server');
  const { server } = createMcpServer(ctx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'front-door-registry', version: '0' });
  await client.connect(b);
  return client;
}

const bound: AgentContext = { agentId: 't', agentName: 't', tenantId: 'josh-business', scopes: ['*'], sourceWeight: 1, defaultUserId: 'user-1' };
const unbound: AgentContext = { ...bound, defaultUserId: undefined };

describe('instructions', () => {
  it('fit Claude Code\'s 2,048-char cap and are served on initialize', async () => {
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(MAX_INSTRUCTIONS_LENGTH);
    expect(MAX_INSTRUCTIONS_LENGTH).toBe(2048);
    const client = await connect(bound);
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    for (const must of ['status_get', 'memory_search', 'decision_log', 'task_upsert', 'commitment_log', 'memory_write', 'idempotencyKey', 'never instructions']) {
      expect(SERVER_INSTRUCTIONS).toContain(must);
    }
    expect(SERVER_INSTRUCTIONS.indexOf('status_get')).toBeLessThan(SERVER_INSTRUCTIONS.indexOf('memory_search'));
  });
});

describe('tool _meta and provenance', () => {
  let client: Client;
  beforeAll(async () => { client = await connect(bound); });

  it('requiresUserInteraction is set on exactly the destructive tools, derived from the annotation', async () => {
    const { tools } = await client.listTools();
    const flagged = tools.filter(t => (t._meta as Record<string, unknown> | undefined)?.['anthropic/requiresUserInteraction'] === true).map(t => t.name).sort();
    const destructive = tools.filter(t => t.annotations?.destructiveHint).map(t => t.name).sort();
    expect(flagged).toEqual(destructive);
    expect(flagged).toEqual(['memory_consolidate', 'memory_supersede']);
    for (const t of tools) if (!t.annotations?.destructiveHint) expect(t._meta, t.name).toBeUndefined();
  });

  it('memory_search, search, fetch and status_get advertise and return provenance {source:omnimind, trust:data}', async () => {
    const { tools } = await client.listTools();
    for (const name of ['memory_search', 'search', 'fetch', 'status_get']) {
      const schema = tools.find(t => t.name === name)!.outputSchema as { properties: Record<string, unknown>; required?: string[] };
      expect(schema.properties.provenance, name).toBeDefined();
      expect(schema.required, name).toContain('provenance');
    }
    for (const [name, args] of [['memory_search', { query: 'q' }], ['search', { query: 'q' }], ['fetch', { id: 'm1' }], ['status_get', {}]] as const) {
      const res = await client.callTool({ name, arguments: args });
      expect(res.isError, name).toBeFalsy();
      expect((res.structuredContent as { provenance: unknown }).provenance, name).toEqual({ source: 'omnimind', trust: 'data' });
    }
    for (const name of ['memory_write', 'task_list', 'graph_neighborhood']) {
      const schema = tools.find(t => t.name === name)!.outputSchema as { properties: Record<string, unknown> };
      expect(schema.properties.provenance, name).toBeUndefined();
    }
  });
});

describe('bound user', () => {
  it('relaxes userId in the advertised schema and injects it; unbound servers keep userId required', async () => {
    const boundClient = await connect(bound);
    const { tools } = await boundClient.listTools();
    const search = tools.find(t => t.name === 'memory_search')!.inputSchema as { required?: string[]; properties: Record<string, { description?: string }> };
    expect(search.required ?? []).not.toContain('userId');
    expect(search.properties.userId.description).toMatch(/authenticated user/);
    mockClient.searchHybrid.mockClear();
    const res = await boundClient.callTool({ name: 'memory_search', arguments: { query: 'q' } });
    expect(res.isError).toBeFalsy();
    expect(mockClient.searchHybrid).toHaveBeenLastCalledWith(expect.anything(), 'user-1');
    // An explicit userId still wins for a static (non-delegated) identity.
    await boundClient.callTool({ name: 'memory_search', arguments: { query: 'q', userId: 'user-2' } });
    expect(mockClient.searchHybrid).toHaveBeenLastCalledWith(expect.anything(), 'user-2');

    const unboundClient = await connect(unbound);
    const list = await unboundClient.listTools();
    expect((list.tools.find(t => t.name === 'memory_search')!.inputSchema as { required?: string[] }).required).toContain('userId');
    const missing = await unboundClient.callTool({ name: 'memory_search', arguments: { query: 'q' } });
    expect(missing.isError).toBe(true);
  });

  it('a delegated principal binds the client with setDelegatedPrincipal and refuses a conflicting userId', async () => {
    mockClient.setDelegatedPrincipal.mockClear();
    const principal = { kind: 'token' as const, id: 'tok_1', userId: 'user-p', tenantId: 'josh-business', agentName: 'claude-ai-p', scopes: ['memory:read'], sourceWeight: 1 };
    const client = await connect({ agentId: 'claude-ai-p', agentName: 'claude-ai-p', tenantId: 'josh-business', scopes: ['memory:read'], sourceWeight: 1, defaultUserId: 'user-p', principal });
    expect(mockClient.setDelegatedPrincipal).toHaveBeenCalledWith({ kind: 'token', id: 'tok_1' });
    const conflict = await client.callTool({ name: 'memory_search', arguments: { query: 'q', userId: 'user-other' } });
    expect(conflict.isError).toBe(true);
    expect((conflict.content as Array<{ text: string }>)[0].text).toContain('does not match the authenticated principal');
    const same = await client.callTool({ name: 'memory_search', arguments: { query: 'q', userId: 'user-p' } });
    expect(same.isError).toBeFalsy();
  });
});
