/**
 * Phase 6 — spec conformance of the registered surface, driven through the
 * SDK's own in-memory transport: 18 tools with annotations + outputSchema,
 * structuredContent on success, isError on typed failures, 4 resource
 * templates with tenant pinning, 3 prompts encoding the dogfooding rules.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AgentContext } from '../src/types';

const mockClient = {
  setAgentHeaders: vi.fn(),
  searchMemories: vi.fn().mockResolvedValue([]),
  searchHybrid: vi.fn().mockResolvedValue({ items: [{ id: 'm1', title: 'T', content: 'C', domain: 'business', tags: [] }], nextCursor: null }),
  searchSimilar: vi.fn().mockResolvedValue([]),
  getCommitmentNudges: vi.fn().mockResolvedValue({ dueSoon: [{ id: 'c1', description: 'd', deadline: null, status: 'OPEN' }], overdue: [] }),
  getBacklinks: vi.fn().mockResolvedValue({ node: { id: 'goal:g1', type: 'goal', refId: 'g1', label: 'G', domain: null, status: null, importance: null, createdAt: '', meta: {} }, backlinks: [] }),
  getGoal: vi.fn().mockResolvedValue({ id: 'g1', title: 'Goal' }),
  getPerson: vi.fn().mockResolvedValue({ id: 'p1', name: 'Sarah' }),
  getCapsules: vi.fn().mockResolvedValue([{ id: 'cap', entityType: 'goal', entityId: 'g1', summary: 's' }]),
  createMemory: vi.fn().mockResolvedValue({ id: 'mem-1', status: 'created' }),
  updateMemory: vi.fn().mockResolvedValue({ id: 'mem-1' }),
  getMemory: vi.fn().mockResolvedValue(null),
  reflect: vi.fn().mockResolvedValue({ id: 'cap', entityType: 'goal', entityId: 'g1', summary: 's' }),
  logAudit: vi.fn().mockResolvedValue(undefined),
  recordLlmUsage: vi.fn().mockResolvedValue(undefined),
};
vi.mock('../src/lib/client', () => ({ createOmniMindClient: () => mockClient }));
vi.mock('../src/lib/fact-extractor', () => ({ extractAndDedup: vi.fn().mockResolvedValue([]) }));

const READ_TOOLS = ['memory_search', 'task_status', 'task_list', 'project_status', 'project_summary', 'person_get', 'commitment_list', 'status_get', 'graph_neighborhood'];
const DESTRUCTIVE_TOOLS = ['memory_supersede', 'memory_consolidate'];
const ALL_TOOLS = [
  'memory_write', 'memory_search', 'memory_supersede', 'decision_log',
  'task_upsert', 'task_status', 'task_list', 'task_complete', 'task_block',
  'project_status', 'project_summary', 'person_get',
  'commitment_log', 'commitment_list', 'status_get',
  'memory_reflect', 'memory_consolidate', 'graph_neighborhood',
].sort();

async function connect(ctx: AgentContext) {
  const { createMcpServer } = await import('../src/server');
  const { server } = createMcpServer(ctx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'registry-test', version: '0' });
  await client.connect(b);
  return client;
}

const fullCtx: AgentContext = { agentId: 't', agentName: 't', tenantId: 'josh-business', scopes: ['*'], sourceWeight: 1, defaultUserId: 'user-1' };

describe('tool registry (registerTool)', () => {
  let client: Client;
  beforeAll(async () => { client = await connect(fullCtx); });

  it('registers exactly 18 tools, each with title, annotations and outputSchema', async () => {
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual(ALL_TOOLS);
    for (const t of tools) {
      expect(t.title, t.name).toBeTruthy();
      expect(t.outputSchema?.type, t.name).toBe('object');
      expect(t.annotations?.openWorldHint, t.name).toBe(false);
      expect(typeof t.annotations?.readOnlyHint, t.name).toBe('boolean');
      expect(typeof t.annotations?.destructiveHint, t.name).toBe('boolean');
      expect(typeof t.annotations?.idempotentHint, t.name).toBe('boolean');
    }
  });

  it('annotation matrix: 9 read-only tools, destructive only for memory_supersede + memory_consolidate', async () => {
    const { tools } = await client.listTools();
    const readOnly = tools.filter(t => t.annotations?.readOnlyHint).map(t => t.name).sort();
    expect(readOnly).toEqual([...READ_TOOLS].sort());
    const destructive = tools.filter(t => t.annotations?.destructiveHint).map(t => t.name).sort();
    expect(destructive).toEqual([...DESTRUCTIVE_TOOLS].sort());
    for (const t of tools) if (t.annotations?.readOnlyHint) expect(t.annotations.destructiveHint, t.name).toBe(false);
    const idempotent = tools.filter(t => t.annotations?.idempotentHint).map(t => t.name);
    expect(idempotent).toEqual(expect.arrayContaining(['task_upsert', 'task_complete', 'task_block', 'memory_reflect', ...READ_TOOLS]));
    expect(idempotent).not.toContain('memory_write');
  });

  it('write tools advertise idempotencyKey (≤128) in their input schema', async () => {
    const { tools } = await client.listTools();
    for (const name of ['memory_write', 'task_upsert', 'decision_log', 'commitment_log']) {
      const t = tools.find(x => x.name === name)!;
      const prop = (t.inputSchema.properties as Record<string, { maxLength?: number }>).idempotencyKey;
      expect(prop, name).toBeDefined();
      expect(prop.maxLength, name).toBe(128);
    }
    for (const name of ['memory_search', 'task_list', 'commitment_list']) {
      const t = tools.find(x => x.name === name)!;
      expect((t.inputSchema.properties as Record<string, unknown>).cursor, name).toBeDefined();
      expect((t.outputSchema!.properties as Record<string, unknown>).nextCursor, name).toBeDefined();
    }
  });

  it('a successful call returns text + structuredContent that passes the output schema', async () => {
    const res = await client.callTool({ name: 'memory_search', arguments: { query: 'q', userId: 'u' } });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ count: 1, nextCursor: null, memories: [{ id: 'm1' }] });
    expect(JSON.parse((res.content as Array<{ text: string }>)[0].text)).toEqual(res.structuredContent);

    const status = await client.callTool({ name: 'status_get', arguments: { userId: 'u' } });
    expect((status.structuredContent as { commitmentsDueSoon: { dueSoon: unknown[] } }).commitmentsDueSoon.dueSoon).toHaveLength(1);

    const graph = await client.callTool({ name: 'graph_neighborhood', arguments: { nodeId: 'goal:g1', userId: 'u', hops: 2 } });
    expect(graph.isError).toBeFalsy();
    expect((graph.structuredContent as { nodes: unknown[] }).nodes).toHaveLength(1);

    const consolidate = await client.callTool({ name: 'memory_consolidate', arguments: { userId: 'u' } });
    expect(consolidate.structuredContent).toEqual({ dryRun: true, scanned: 0, pairs: [], applied: 0, errors: [] });
  });

  it('typed failures come back as isError without structuredContent', async () => {
    const ro = await connect({ ...fullCtx, scopes: ['memory:read'] });
    const denied = await ro.callTool({ name: 'memory_reflect', arguments: { entityType: 'goal', entityId: 'g', userId: 'u' } });
    expect(denied.isError).toBe(true);
    expect((denied.content as Array<{ text: string }>)[0].text).toContain('SCOPE_DENIED');
    const denied2 = await ro.callTool({ name: 'memory_consolidate', arguments: { userId: 'u', dryRun: false } });
    expect(denied2.isError).toBe(true);
    // graph_neighborhood is a read tool → allowed with memory:read
    const ok = await ro.callTool({ name: 'graph_neighborhood', arguments: { nodeId: 'goal:g1', userId: 'u' } });
    expect(ok.isError).toBeFalsy();
  });
});

describe('resources (registerResource + ResourceTemplate)', () => {
  it('lists 4 templates + the bound tenant status resource', async () => {
    const client = await connect(fullCtx);
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map(t => t.uriTemplate).sort()).toEqual([
      'omnimind://{tenant}/goal/{id}', 'omnimind://{tenant}/graph/{nodeId}', 'omnimind://{tenant}/person/{id}', 'omnimind://{tenant}/status',
    ]);
    for (const t of resourceTemplates) expect(t.mimeType).toBe('application/json');
    const { resources } = await client.listResources();
    expect(resources.map(r => r.uri)).toEqual(['omnimind://josh-business/status']);
  });

  it('reads status / goal / person / graph as JSON for the bound tenant', async () => {
    const client = await connect(fullCtx);
    const status = await client.readResource({ uri: 'omnimind://josh-business/status' });
    expect(status.contents[0].mimeType).toBe('application/json');
    expect(JSON.parse(status.contents[0].text as string)).toHaveProperty('snapshot');

    const goal = JSON.parse((await client.readResource({ uri: 'omnimind://josh-business/goal/g1' })).contents[0].text as string);
    expect(goal).toEqual({ goal: { id: 'g1', title: 'Goal' }, capsule: expect.objectContaining({ entityId: 'g1' }) });
    expect(mockClient.getCapsules).toHaveBeenCalledWith(['goal:g1'], 'user-1');

    const person = JSON.parse((await client.readResource({ uri: 'omnimind://josh-business/person/p1' })).contents[0].text as string);
    expect(person.person).toEqual({ id: 'p1', name: 'Sarah' });

    const graph = JSON.parse((await client.readResource({ uri: 'omnimind://josh-business/graph/goal:g1' })).contents[0].text as string);
    expect(graph).toMatchObject({ root: 'goal:g1', hops: 2, truncated: false });
  });

  it('refuses any other tenant in the URI', async () => {
    const client = await connect(fullCtx);
    await expect(client.readResource({ uri: 'omnimind://tgfc-ministry/status' })).rejects.toThrow(/does not match this server's bound tenant/);
    await expect(client.readResource({ uri: 'omnimind://josh-personal/goal/g1' })).rejects.toThrow(/bound tenant/);
  });

  it('returns NO_USER_BOUND when OMNIMIND_MCP_USER_ID is not set', async () => {
    const client = await connect({ ...fullCtx, defaultUserId: undefined });
    const res = await client.readResource({ uri: 'omnimind://josh-business/status' });
    expect(JSON.parse(res.contents[0].text as string).error).toBe('NO_USER_BOUND');
  });
});

describe('prompts (registerPrompt)', () => {
  it('serves session_start / decision_review / session_end encoding the dogfooding rules', async () => {
    const client = await connect(fullCtx);
    const { prompts } = await client.listPrompts();
    expect(prompts.map(p => p.name).sort()).toEqual(['decision_review', 'session_end', 'session_start']);
    expect(prompts.find(p => p.name === 'decision_review')?.arguments?.[0]).toMatchObject({ name: 'decisionTitle', required: true });

    const start = await client.getPrompt({ name: 'session_start', arguments: { domain: 'railway deploy' } });
    const startText = (start.messages[0].content as { text: string }).text;
    expect(startText.indexOf('status_get')).toBeGreaterThan(-1);
    expect(startText.indexOf('status_get')).toBeLessThan(startText.indexOf('memory_search'));
    expect(startText).toContain('railway deploy');

    const review = await client.getPrompt({ name: 'decision_review', arguments: { decisionTitle: 'Use Railway private networking' } });
    expect((review.messages[0].content as { text: string }).text).toContain('Use Railway private networking');

    const end = await client.getPrompt({ name: 'session_end' });
    const endText = (end.messages[0].content as { text: string }).text;
    expect(endText).toContain('memory_write');
    expect(endText).toMatch(/what was done/i);
    expect(endText).toMatch(/next/i);
  });
});
