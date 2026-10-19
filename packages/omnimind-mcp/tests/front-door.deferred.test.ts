/**
 * M-2 end to end — `OMNIMIND_MCP_WRITE_EXTRACT=async` over the HTTP front
 * door: the client writes and immediately DELETEs its session (the dogfooding
 * "end of session" flow); the deferred extraction must still land the fact
 * rows, the supersede and the `memory_write:extract` audit row, all carrying
 * the same delegation headers. `app.close()` drains in-flight work first.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttpServer, type ClientPurpose, type StartedHttpServer } from '../src/transports/http';
import { OmniMindClient } from '../src/lib/client';
import { TOKEN_RANDOM_CHARS } from '../src/lib/principal';
import { memoryWriteReplayCache } from '../src/tools/memory.tool';
import type { AgentContext } from '../src/types';

const EXTRACT_DELAY_MS = 60;
vi.mock('../src/lib/fact-extractor', () => ({
  extractAndDedup: vi.fn(async () => {
    await new Promise(r => setTimeout(r, EXTRACT_DELAY_MS));
    return [{ text: 'Josh chose Railway', type: 'decision', action: 'create' }];
  }),
}));

const GATEWAY_KEY = 'omk_gateway';
const STATIC_KEY = 'legacy-static-key';
const OMT_ALICE = `omt_${createHash('sha256').update('alice').digest('base64url').slice(0, TOKEN_RANDOM_CHARS)}`;
const alice = { kind: 'token', id: 'tok_alice', userId: 'user-alice', tenantId: 'josh-business', agentName: 'claude-ai-alice', scopes: ['memory:read', 'memory:write'], sourceWeight: 0.8 };
const staticCtx: AgentContext = { agentId: 'env-agent', agentName: 'env-agent', tenantId: 'josh-business', scopes: ['memory:write'], sourceWeight: 1 };

interface Seen { method: string; path: string; headers: Record<string, string | string[] | undefined>; body: unknown }
const seen: Seen[] = [];
let memoryIds = 0;

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { const raw = Buffer.concat(chunks).toString(); resolve(raw ? JSON.parse(raw) : undefined); });
  });
}
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const api: Server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const body = await readJson(req);
  seen.push({ method: req.method ?? '', path: url.pathname, headers: req.headers, body });
  if (url.pathname === '/mcp/tokens/introspect') {
    return json(res, 200, (body as { token: string }).token === OMT_ALICE ? { active: true, principal: alice } : { active: false, reason: 'invalid' });
  }
  if (url.pathname === '/memories' && req.method === 'POST') return json(res, 200, { id: `mem-${++memoryIds}`, status: 'created' });
  if (url.pathname.startsWith('/memories/') && req.method === 'PATCH') return json(res, 200, { id: url.pathname.split('/').pop() });
  if (url.pathname === '/memories/search-similar') return json(res, 200, { memories: [] });
  if (url.pathname === '/mcp/audit') return json(res, 200, { ok: true });
  if (url.pathname === '/usage/llm') return json(res, 200, { ok: true });
  return json(res, 404, { error: 'not found' });
});

let apiUrl = '';
let mcp: StartedHttpServer;
const createClientFn = ({ agentKey }: ClientPurpose) => new OmniMindClient({ baseUrl: apiUrl, apiKey: 'svc-key', agentKey });

beforeAll(async () => {
  await new Promise<void>(r => api.listen(0, '127.0.0.1', () => r()));
  apiUrl = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
  mcp = await startHttpServer(0, {
    apiKey: STATIC_KEY, agentCtx: staticCtx,
    auth: { tokenAuth: true, agentKey: GATEWAY_KEY },
    createClientFn, serverOptions: { writeExtractMode: 'async' }, log: () => {},
  });
});

afterAll(async () => {
  await mcp.close();
  await new Promise(r => api.close(r));
});

function connect(bearer: string, port = mcp.port) {
  const client = new Client({ name: 'deferred-test', version: '0' });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/`), { requestInit: { headers: { Authorization: `Bearer ${bearer}` } } });
  return { client, transport, connect: () => client.connect(transport) };
}

const calls = (method: string, path: string) => seen.filter(s => s.method === method && s.path === path);

describe('async extraction survives the session', () => {
  it('DELETE right after memory_write: facts, supersede and the extract audit row still land with the delegated identity', async () => {
    memoryWriteReplayCache.clear();
    seen.length = 0;
    const { client, transport, connect: go } = connect(OMT_ALICE);
    await go();
    const sid = transport.sessionId as string;
    const session = mcp.app.sessions.get(sid)!;
    expect(session.deferredClient).toBeDefined();
    expect(session.deferredClient).not.toBe(session.client);

    const res = await client.callTool({ name: 'memory_write', arguments: { content: 'Josh chose Railway over Render for the API.', idempotencyKey: 'k-deferred-1' } });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ ok: true, created: ['mem-1'], extraction: 'async' });
    expect(mcp.app.deferred.size).toBe(1);

    // The dogfooding flow: write, then hang up at once — well inside the extraction delay.
    await transport.terminateSession();
    expect(mcp.app.sessions.has(sid)).toBe(false);
    expect(session.client!.isClosed).toBe(true);
    expect(session.deferredClient!.isClosed).toBe(false); // kept alive for the tail
    await client.close();

    await mcp.app.deferred.drain(5_000);
    expect(mcp.app.deferred.size).toBe(0);
    expect(session.deferredClient!.isClosed).toBe(true); // released session + idle → closed

    const posts = calls('POST', '/memories');
    expect(posts.map(p => (p.body as { content: string }).content)).toEqual(['Josh chose Railway over Render for the API.', 'Josh chose Railway']);
    const patch = calls('PATCH', '/memories/mem-2');
    expect(patch).toHaveLength(1);
    expect(patch[0].body).toEqual({ supersedes: 'mem-1', agentId: 'claude-ai-alice' });
    expect(patch[0].headers['idempotency-key']).toMatch(/^supersedes:[0-9a-f]{64}$/);
    await new Promise(r => setTimeout(r, 20)); // audit rows are fire-and-forget
    const audits = calls('POST', '/mcp/audit').map(a => (a.body as { toolName: string }).toolName);
    expect(audits).toEqual(['memory_write', 'memory_write:extract']);
    // Everything the tail did carried the principal's delegation headers, never the legacy triple.
    for (const s of seen.filter(s => s.path !== '/mcp/tokens/introspect')) {
      expect(s.headers['x-mcp-principal'], `${s.method} ${s.path}`).toBe('token:tok_alice');
      expect(s.headers['x-agent-key'], `${s.method} ${s.path}`).toBe(GATEWAY_KEY);
      expect(s.headers, `${s.method} ${s.path}`).not.toHaveProperty('x-agent-id');
    }
  });

  it('a static-key session gets the same guarantee (and its deferred twin never carries the gateway key)', async () => {
    memoryWriteReplayCache.clear();
    seen.length = 0;
    const { client, transport, connect: go } = connect(STATIC_KEY);
    await go();
    const res = await client.callTool({ name: 'memory_write', arguments: { content: 'Static write.', userId: 'user-s' } });
    expect(res.structuredContent).toMatchObject({ ok: true, extraction: 'async' });
    await transport.terminateSession();
    await client.close();
    await mcp.app.deferred.drain(5_000);
    expect(calls('POST', '/memories')).toHaveLength(2);
    for (const s of seen.filter(s => s.path.startsWith('/memories') || s.path === '/mcp/audit')) {
      expect(s.headers['x-agent-id'], s.path).toBe('env-agent');
      expect(s.headers, s.path).not.toHaveProperty('x-agent-key');
    }
  });

  it('app.close() drains in-flight extraction before returning (bounded by drainTimeoutMs)', async () => {
    memoryWriteReplayCache.clear();
    const own = await startHttpServer(0, {
      apiKey: STATIC_KEY, agentCtx: staticCtx, auth: { tokenAuth: true, agentKey: GATEWAY_KEY },
      createClientFn, serverOptions: { writeExtractMode: 'async' }, drainTimeoutMs: 5_000, log: () => {},
    });
    const { client, connect: go } = connect(OMT_ALICE, own.port);
    await go();
    seen.length = 0;
    await client.callTool({ name: 'memory_write', arguments: { content: 'Written just before shutdown.' } });
    expect(own.app.deferred.size).toBe(1);
    await client.close();
    await own.close(); // must wait for the extraction, not abandon it
    expect(own.app.deferred.size).toBe(0);
    expect(calls('POST', '/memories').map(p => (p.body as { content: string }).content)).toEqual(['Written just before shutdown.', 'Josh chose Railway']);

    // With a timeout shorter than the extraction, close() returns anyway and the raw row is kept.
    memoryWriteReplayCache.clear();
    const impatient = await startHttpServer(0, {
      apiKey: STATIC_KEY, agentCtx: staticCtx, auth: { tokenAuth: true, agentKey: GATEWAY_KEY },
      createClientFn, serverOptions: { writeExtractMode: 'async' }, drainTimeoutMs: 5, log: () => {},
    });
    const i = connect(OMT_ALICE, impatient.port);
    await i.connect();
    seen.length = 0;
    await i.client.callTool({ name: 'memory_write', arguments: { content: 'Racing shutdown.' } });
    await i.client.close();
    const started = Date.now();
    await impatient.app.close(); // the app-level drain gives up after 5 ms (the socket teardown below is separate)
    expect(Date.now() - started).toBeLessThan(EXTRACT_DELAY_MS);
    await impatient.close();
    await new Promise(r => setTimeout(r, EXTRACT_DELAY_MS + 40));
    expect(calls('POST', '/memories')).toHaveLength(1); // the tail's client was closed by the abandon path
  });
});
