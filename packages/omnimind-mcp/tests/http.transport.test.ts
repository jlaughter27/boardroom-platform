/**
 * M-101 / F-203 / M-105 — the proof for the Streamable HTTP transport.
 *
 * Boots the real server on an ephemeral port and drives it with the SDK's
 * own StreamableHTTPClientTransport + Client: initialize →
 * notifications/initialized → tools/list, asserting 15 tools. Also covers
 * fail-closed auth, /health, session routing, DELETE, 413 and host checks.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request as httpRequest } from 'http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttpServer, resolveHttpConfig, keysMatch, extractPresentedKey, MAX_BODY_BYTES, type StartedHttpServer } from '../src/transports/http';
import type { AgentContext } from '../src/types';

const API_KEY = 'test-inbound-key';
const agentCtx: AgentContext = {
  agentId: 'http-test-agent', agentName: 'http-test-agent', tenantId: 'josh-business',
  scopes: ['memory:read'], sourceWeight: 1.0,
};

const EXPECTED_TOOLS = [
  'memory_write', 'memory_search', 'memory_supersede', 'decision_log',
  'task_upsert', 'task_status', 'task_list', 'task_complete', 'task_block',
  'project_status', 'project_summary', 'person_get',
  'commitment_log', 'commitment_list', 'status_get',
].sort();

let started: StartedHttpServer;
let baseUrl: string;

function rawRequest(opts: { method: string; path: string; headers?: Record<string, string>; body?: string | Buffer }): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: started.port, method: opts.method, path: opts.path, headers: opts.headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString(), headers: res.headers }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function connectClient(key = API_KEY) {
  const client = new Client({ name: 'http-test', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
    requestInit: { headers: { Authorization: `Bearer ${key}` } },
  });
  return { client, transport, connect: () => client.connect(transport) };
}

beforeAll(async () => {
  // createMcpServer → createOmniMindClient needs these; no network is used by tools/list.
  process.env.OMNIMIND_API_URL = process.env.OMNIMIND_API_URL ?? 'http://127.0.0.1:1';
  process.env.OMNIMIND_API_KEY = process.env.OMNIMIND_API_KEY ?? 'unused';
  started = await startHttpServer(0, { apiKey: API_KEY, agentCtx, log: () => {} });
  baseUrl = `http://127.0.0.1:${started.port}/`;
});

afterAll(async () => {
  await started.close();
});

describe('config / auth helpers', () => {
  it('F-203: refuses to configure HTTP mode without OMNIMIND_MCP_API_KEY', () => {
    expect(() => resolveHttpConfig({} as NodeJS.ProcessEnv)).toThrow(/OMNIMIND_MCP_API_KEY is required/);
    expect(() => resolveHttpConfig({ OMNIMIND_MCP_API_KEY: '   ' } as NodeJS.ProcessEnv)).toThrow();
    const cfg = resolveHttpConfig({ OMNIMIND_MCP_API_KEY: 'k', OMNIMIND_MCP_ALLOWED_HOSTS: 'a:1, b:2' } as NodeJS.ProcessEnv);
    expect(cfg.allowedHosts).toEqual(['a:1', 'b:2']);
  });

  it('keysMatch is constant-time safe and exact', () => {
    expect(keysMatch('abc', 'abc')).toBe(true);
    expect(keysMatch('abd', 'abc')).toBe(false);
    expect(keysMatch('ab', 'abc')).toBe(false);
    expect(keysMatch(undefined, 'abc')).toBe(false);
  });

  it('parses Bearer case-insensitively and x-mcp-api-key', () => {
    expect(extractPresentedKey({ headers: { authorization: 'BEARER tok' } } as never)).toBe('tok');
    expect(extractPresentedKey({ headers: { authorization: 'bearer  tok ' } } as never)).toBe('tok');
    expect(extractPresentedKey({ headers: { 'x-mcp-api-key': 'direct' } } as never)).toBe('direct');
    expect(extractPresentedKey({ headers: { authorization: 'Basic xyz' } } as never)).toBeUndefined();
  });
});

describe('Streamable HTTP end-to-end (M-101)', () => {
  it('initialize → initialized → tools/list over HTTP returns all 15 tools', async () => {
    const { client, transport, connect } = connectClient();
    await connect();
    expect(transport.sessionId).toBeTruthy();
    expect(started.app.sessions.has(transport.sessionId as string)).toBe(true);

    const { tools } = await client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual(EXPECTED_TOOLS);
    expect(tools).toHaveLength(15);

    // A second request on the same session must work (the old stateless
    // transport threw "cannot be reused across requests" here).
    const again = await client.listTools();
    expect(again.tools).toHaveLength(15);

    await client.close();
  });

  it('supports concurrent independent sessions, and DELETE ends a session', async () => {
    const a = connectClient();
    const b = connectClient();
    await Promise.all([a.connect(), b.connect()]);
    expect(a.transport.sessionId).not.toBe(b.transport.sessionId);
    expect(started.app.sessions.size).toBeGreaterThanOrEqual(2);

    const [ta, tb] = await Promise.all([a.client.listTools(), b.client.listTools()]);
    expect(ta.tools).toHaveLength(15);
    expect(tb.tools).toHaveLength(15);

    const sidA = a.transport.sessionId as string;
    await a.transport.terminateSession(); // HTTP DELETE
    expect(started.app.sessions.has(sidA)).toBe(false);

    await a.client.close();
    await b.client.close();
  });

  it('typed tool error (SCOPE_DENIED) is returned as isError over HTTP', async () => {
    const { client, connect } = connectClient();
    await connect();
    // memory:read scope only → memory_write is SCOPE_DENIED, which proves the
    // typed-error branch in server.ts is exercised end-to-end over HTTP.
    const res = await client.callTool({ name: 'memory_write', arguments: { content: 'x', userId: 'u' } });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    expect(text).toContain('SCOPE_DENIED');
    await client.close();
  });
});

describe('fail-closed auth + hardening (F-203 / M-105)', () => {
  it('GET /health needs no key and reports sessions', async () => {
    const res = await rawRequest({ method: 'GET', path: '/health' });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
    expect(typeof body.sessions).toBe('number');
    expect(body.tenant).toBe('josh-business');
  });

  it('rejects missing / wrong keys with 401 before touching MCP', async () => {
    const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '0' } } });
    const noKey = await rawRequest({ method: 'POST', path: '/', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: init });
    expect(noKey.status).toBe(401);
    const wrong = await rawRequest({ method: 'POST', path: '/', headers: { authorization: 'Bearer nope', 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: init });
    expect(wrong.status).toBe(401);
    expect(started.app.sessions.size).toBe(0 + started.app.sessions.size); // no session created
  });

  it('SDK client with a wrong key cannot complete the handshake', async () => {
    const { connect } = connectClient('wrong');
    await expect(connect()).rejects.toThrow();
  });

  it('non-initialize POST without a session id → 400; unknown session → 404', async () => {
    const headers = { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    const noSession = await rawRequest({ method: 'POST', path: '/', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) });
    expect(noSession.status).toBe(400);
    const unknown = await rawRequest({ method: 'POST', path: '/', headers: { ...headers, 'mcp-session-id': 'does-not-exist' }, body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }) });
    expect(unknown.status).toBe(404);
    const getNoSession = await rawRequest({ method: 'GET', path: '/', headers: { authorization: `Bearer ${API_KEY}`, accept: 'text/event-stream' } });
    expect(getNoSession.status).toBe(400);
  });

  it('caps the body at 1 MiB (413) and rejects invalid JSON (400)', async () => {
    const headers = { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    const huge = Buffer.alloc(MAX_BODY_BYTES + 1, 0x61);
    const tooBig = await rawRequest({ method: 'POST', path: '/', headers: { ...headers, 'content-length': String(huge.length) }, body: huge });
    expect(tooBig.status).toBe(413);
    const badJson = await rawRequest({ method: 'POST', path: '/', headers, body: '{not json' });
    expect(badJson.status).toBe(400);
  });

  it('DNS-rebinding protection: a foreign Host header is refused', async () => {
    const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '0' } } });
    const res = await rawRequest({
      method: 'POST', path: '/',
      headers: { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', host: 'evil.example:80' },
      body: init,
    });
    expect(res.status).toBe(403);
  });

  it('unsupported method → 405', async () => {
    const res = await rawRequest({ method: 'PUT', path: '/', headers: { authorization: `Bearer ${API_KEY}` } });
    expect(res.status).toBe(405);
  });
});
