/**
 * M-5 / follow-ups — `OmniMindClient` identity plumbing: which env var feeds
 * `x-agent-key` per role, typed HTTP errors, and the gateway-only routes a
 * delegated client must never call (the API's delegated route allow-list
 * answers 403 `delegated_route_forbidden` there).
 */
import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'http';
import { OmniMindClient, OmniMindHttpError, createOmniMindClient, resolveAgentKey } from '../src/lib/client';

describe('resolveAgentKey / createOmniMindClient', () => {
  const env = (e: Record<string, string>) => e as NodeJS.ProcessEnv;

  it('gateway → OMNIMIND_MCP_AGENT_KEY only; static → OMNIMIND_MCP_STATIC_AGENT_KEY only; single-agent → static, else legacy', () => {
    const both = env({ OMNIMIND_MCP_AGENT_KEY: 'omk_gw', OMNIMIND_MCP_STATIC_AGENT_KEY: 'omk_me' });
    expect(resolveAgentKey('gateway', both)).toEqual({ key: 'omk_gw', source: 'OMNIMIND_MCP_AGENT_KEY' });
    expect(resolveAgentKey('static', both)).toEqual({ key: 'omk_me', source: 'OMNIMIND_MCP_STATIC_AGENT_KEY' });
    expect(resolveAgentKey('single-agent', both)).toEqual({ key: 'omk_me', source: 'OMNIMIND_MCP_STATIC_AGENT_KEY' });
    const gwOnly = env({ OMNIMIND_MCP_AGENT_KEY: 'omk_gw' });
    expect(resolveAgentKey('static', gwOnly)).toEqual({ key: undefined, source: 'none' });
    expect(resolveAgentKey('single-agent', gwOnly)).toEqual({ key: 'omk_gw', source: 'OMNIMIND_MCP_AGENT_KEY' });
    expect(resolveAgentKey('gateway', env({ OMNIMIND_MCP_STATIC_AGENT_KEY: 'omk_me' }))).toEqual({ key: undefined, source: 'none' });
    expect(resolveAgentKey('single-agent', env({ OMNIMIND_MCP_AGENT_KEY: '  ' }))).toEqual({ key: undefined, source: 'none' });
  });

  it('createOmniMindClient: an explicit agentKey (even undefined) wins; without opts the single-agent role applies', async () => {
    const base = env({ OMNIMIND_API_URL: 'http://127.0.0.1:1', OMNIMIND_API_KEY: 'svc', OMNIMIND_MCP_AGENT_KEY: 'omk_gw' });
    const seen: Array<string | undefined> = [];
    const api: Server = createServer((req, res) => { seen.push(req.headers['x-agent-key'] as string | undefined); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
    await new Promise<void>(r => api.listen(0, '127.0.0.1', () => r()));
    const url = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
    try {
      await createOmniMindClient({ ...base, OMNIMIND_API_URL: url }).getGoal('g', 'u');
      await createOmniMindClient({ ...base, OMNIMIND_API_URL: url }, { agentKey: undefined }).getGoal('g', 'u');
      await createOmniMindClient({ ...base, OMNIMIND_API_URL: url }, { agentKey: 'omk_other' }).getGoal('g', 'u');
      expect(seen).toEqual(['omk_gw', undefined, 'omk_other']);
    } finally {
      await new Promise(r => api.close(r));
    }
    expect(() => createOmniMindClient(env({ OMNIMIND_API_KEY: 'k' }))).toThrow(/OMNIMIND_API_URL/);
  });
});

describe('OmniMindHttpError', () => {
  it('carries the status and keeps the historical message shape; recognises insufficient_scope', () => {
    const e = new OmniMindHttpError('POST', '/memories', 403, '{"error":"insufficient_scope","required":"memory:write"}');
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('OmniMind POST /memories → 403: {"error":"insufficient_scope","required":"memory:write"}');
    expect(e.status).toBe(403);
    expect(e.isInsufficientScope).toBe(true);
    expect(new OmniMindHttpError('GET', '/x', 403, 'agent_header_mismatch').isInsufficientScope).toBe(false);
    expect(new OmniMindHttpError('GET', '/x', 500, 'insufficient_scope').isInsufficientScope).toBe(false);
  });

  it('is what request() throws on a non-2xx answer', async () => {
    const api: Server = createServer((_req, res) => { res.writeHead(422, { 'content-type': 'application/json' }); res.end('{"error":"Validation failed"}'); });
    await new Promise<void>(r => api.listen(0, '127.0.0.1', () => r()));
    try {
      const c = new OmniMindClient({ baseUrl: `http://127.0.0.1:${(api.address() as { port: number }).port}`, apiKey: 'k' });
      await expect(c.getGoal('g', 'u')).rejects.toMatchObject({ name: 'OmniMindHttpError', status: 422, bodyText: '{"error":"Validation failed"}' });
    } finally {
      await new Promise(r => api.close(r));
    }
  });
});

describe('gateway-only routes', () => {
  it('a delegated client refuses stats / agents / introspection / resolve locally; a static client (bench, keygen) may call them', async () => {
    const paths: string[] = [];
    const api: Server = createServer((req, res) => { paths.push(`${req.headers['x-mcp-principal'] ?? 'static'} ${req.method} ${new URL(req.url ?? '/', 'http://x').pathname}`); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"tool":"memory_write","sinceHours":24,"count":0,"p50Ms":0,"p95Ms":0,"errorRate":0}'); });
    await new Promise<void>(r => api.listen(0, '127.0.0.1', () => r()));
    const baseUrl = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
    try {
      const delegated = new OmniMindClient({ baseUrl, apiKey: 'k', agentKey: 'omk_gw' });
      delegated.setDelegatedPrincipal({ kind: 'token', id: 'tok_1' });
      await expect(delegated.getAuditStats({ tool: 'memory_write' })).rejects.toThrow(/gateway-only route.*token:tok_1/);
      await expect(delegated.registerAgent({ name: 'a', apiKeyHash: 'h', tenantId: 't', scopes: [], sourceWeight: 1 })).rejects.toThrow(/gateway-only route/);
      await expect(delegated.introspectToken('omt_x')).rejects.toThrow(/gateway-only route/);
      await expect(delegated.resolveIdentity({ issuer: 'i', subject: 's' })).rejects.toThrow(/gateway-only route/);
      expect(paths).toEqual([]); // nothing reached the API

      // The bench / keygen path: createOmniMindClient() + setAgentHeaders → static identity, allowed.
      const bench = new OmniMindClient({ baseUrl, apiKey: 'k' });
      bench.setAgentHeaders({ agentId: 'a', tenantId: 't', sourceWeight: 1 });
      await bench.getAuditStats({ tool: 'memory_write', sinceHours: 6 });
      expect(paths).toEqual(['static GET /mcp/audit/stats']);
    } finally {
      await new Promise(r => api.close(r));
    }
  });
});
