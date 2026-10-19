/**
 * Front door — the HTTP transport as a multi-user endpoint, end to end:
 * a fake OmniMind API (introspection, identity resolution, memory search,
 * audit) and a fake OAuth issuer (discovery + JWKS) on loopback, the real
 * MCP HTTP server in front of them, and the SDK client driving it.
 *
 * Covers: PRM endpoint present / absent, 401 header shapes, static key,
 * omt_ tokens, JWTs via discovery, session ↔ principal binding, delegated
 * headers on outbound calls, userId defaulting, 503 on upstream outage.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttpServer, createHttpApp, resolveHttpConfig, resolveStaticAgentKey, scopeDigestOf, type ClientPurpose, type StartedHttpServer } from '../src/transports/http';
import { createMcpServer } from '../src/server';
import { OmniMindClient } from '../src/lib/client';
import { PRM_PATH, MCP_SCOPES, TOKEN_RANDOM_CHARS, PRINCIPAL_CACHE_POSITIVE_MS } from '../src/lib/principal';
import type { AgentContext } from '../src/types';

const STATIC_KEY = 'legacy-static-key';
const GATEWAY_KEY = 'omk_gateway';
const STATIC_AGENT_KEY = 'omk_env_agent';
const PUBLIC_URL = 'https://mcp.example.test/mcp';

/** Well-formed `omt_` tokens (prefix + 43 base64url chars) — anything shorter is refused before introspection (M-4). */
const omt = (name: string) => `omt_${createHash('sha256').update(name).digest('base64url').slice(0, TOKEN_RANDOM_CHARS)}`;
const OMT = { alice: omt('alice'), bob: omt('bob'), dave: omt('dave'), expired: omt('expired'), outage: omt('outage'), nope: omt('nope') };

const staticCtx: AgentContext = { agentId: 'env-agent', agentName: 'env-agent', tenantId: 'josh-business', scopes: ['memory:read'], sourceWeight: 1.0 };
const alice = { kind: 'token', id: 'tok_alice', userId: 'user-alice', tenantId: 'josh-business', agentName: 'claude-ai-alice', scopes: ['memory:read', 'memory:write'], sourceWeight: 0.8 };
const bob = { kind: 'token', id: 'tok_bob', userId: 'user-bob', tenantId: 'josh-personal', agentName: 'cursor-bob', scopes: ['memory:read'], sourceWeight: 1 };
const carol = { kind: 'oauth', id: 'oid_carol', userId: 'user-carol', tenantId: 'josh-business', agentName: 'chatgpt-carol', scopes: ['*'], sourceWeight: 1 };
/** Revoked mid-session in the revocation tests; nobody else uses dave. */
const dave = { kind: 'token', id: 'tok_dave', userId: 'user-dave', tenantId: 'josh-business', agentName: 'claude-code-dave', scopes: ['memory:read', 'memory:write'], sourceWeight: 1 };

interface Seen { method: string; path: string; headers: Record<string, string | string[] | undefined>; body: unknown }
const seen: Seen[] = [];
let introspections = 0;
/**
 * `kind:id` principals BoardRoom has revoked. The real API evicts its delegation
 * cache synchronously on revoke, so from that moment introspection says
 * `revoked` and every delegated call is `401 principal_invalid`.
 */
const revokedPrincipals = new Set<string>();
/** Defence-in-depth scenario: data calls already refuse the principal while introspection still says active. */
let introspectionLagsBehindRevoke = false;

function listen(server: Server): Promise<number> {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)));
}

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

// ── fake OmniMind API ──
const api = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const body = await readJson(req);
  seen.push({ method: req.method ?? '', path: url.pathname, headers: req.headers, body });
  if (req.headers['x-api-key'] !== 'svc-key') return json(res, 401, { error: 'bad api key' });
  if (url.pathname === '/mcp/tokens/introspect') {
    introspections++;
    if (req.headers['x-agent-key'] !== GATEWAY_KEY) return json(res, 403, { error: 'gateway key required' });
    const token = (body as { token: string }).token;
    if (token === OMT.alice) return json(res, 200, { active: true, principal: alice });
    if (token === OMT.bob) return json(res, 200, { active: true, principal: bob });
    if (token === OMT.dave) return json(res, 200, revokedPrincipals.has('token:tok_dave') && !introspectionLagsBehindRevoke ? { active: false, reason: 'revoked' } : { active: true, principal: dave });
    if (token === OMT.expired) return json(res, 200, { active: false, reason: 'expired' });
    if (token === OMT.outage) return json(res, 500, { error: 'db down' });
    return json(res, 200, { active: false, reason: 'invalid' });
  }
  if (url.pathname === '/mcp/identities/resolve') {
    // What the real API does: a known (issuer, subject) link, else auto-link by VERIFIED e-mail, else unlinked.
    const claims = body as { subject: string; email?: string; emailVerified?: boolean };
    const linked = claims.subject === 'sub-carol' || (claims.email === 'carol@example.test' && claims.emailVerified === true);
    return json(res, 200, linked ? { active: true, principal: carol } : { active: false, reason: 'unlinked' });
  }
  // M-5 — what the real agent-context middleware does: a verified key whose agent
  // row disagrees with the legacy identity triple is refused outright.
  if (req.headers['x-agent-key'] === GATEWAY_KEY && req.headers['x-agent-id'] !== undefined) {
    return json(res, 403, { error: 'agent_header_mismatch', message: 'x-agent-id does not match the verified agent row' });
  }
  // agent-context.ts: a revoked / expired / unknown principal is 401 principal_invalid (never 403, never 503).
  const principalRef = req.headers['x-mcp-principal'];
  if (typeof principalRef === 'string' && revokedPrincipals.has(principalRef)) {
    return json(res, 401, { error: 'principal_invalid', message: 'x-mcp-principal is revoked', reason: 'revoked' });
  }
  // L-6 — the API intersects delegated scopes with the gateway ceiling.
  if (url.pathname === '/context/reflect') return json(res, 403, { error: 'insufficient_scope', required: 'memory:write' });
  if (url.pathname === '/memories/search') return json(res, 200, { items: [{ id: 'm1', title: 'Railway decision', content: 'Chose Railway', domain: 'business', tags: ['decision'] }], nextCursor: null });
  if (url.pathname.startsWith('/memories/')) return json(res, 200, { id: 'm1', title: 'Railway decision', content: 'Chose Railway', domain: 'business', tags: ['decision'], createdAt: '2026-10-01T00:00:00Z', validAt: '2026-10-01T00:00:00Z', invalidAt: null, status: 'CONFIRMED', sourceType: 'MCP_AGENT', agentId: 'claude-code-josh' });
  if (url.pathname === '/memories' && req.method === 'POST') return json(res, 200, { id: 'new-1', status: 'created' });
  if (url.pathname === '/mcp/audit') return json(res, 200, { ok: true });
  if (url.pathname === '/mcp/audit/stats') return json(res, 200, { tool: url.searchParams.get('tool'), sinceHours: Number(url.searchParams.get('sinceHours')), count: 12, p50Ms: 900, p95Ms: 4100, errorRate: 0 });
  return json(res, 404, { error: 'not found' });
});

// ── fake OAuth issuer ──
let issuer = '';
let jwk: JWK;
let signingKey: CryptoKey;
/** Every userinfo GET the fake issuer saw: who asked (JWT sub) and how. */
const userinfoCalls: Array<{ sub: string; authorization: string | undefined; accept: string | undefined }> = [];
const authServer = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  // `issuer` is advertised WITH a trailing slash on purpose: the server must treat it as the same issuer.
  if (url.pathname === '/.well-known/openid-configuration') return json(res, 200, { issuer: `${issuer}/`, jwks_uri: `${issuer}/jwks`, userinfo_endpoint: `${issuer}/userinfo` });
  if (url.pathname === '/jwks') return json(res, 200, { keys: [jwk] });
  if (url.pathname === '/userinfo') {
    // Behaviour keyed on the token's own sub: a WorkOS-style IdP that answers for the presented token.
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
    const sub = (() => { try { return JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString()).sub as string; } catch { return ''; } })();
    userinfoCalls.push({ sub, authorization: req.headers.authorization, accept: req.headers.accept });
    if (sub === 'sub-userinfo-500') return json(res, 500, { error: 'server_error' });
    if (sub === 'sub-userinfo-mismatch') return json(res, 200, { sub: 'somebody-else', email: 'carol@example.test', email_verified: true });
    // `email_verified` as a STRING — several IdPs do this; it must count as verified.
    return json(res, 200, { sub, email: 'carol@example.test', email_verified: 'true' });
  }
  return json(res, 404, {});
});

async function mintJwt(opts: { aud?: string; sub?: string; expInS?: number; scope?: string; noEmail?: boolean; email?: string; jti?: string } = {}) {
  const nowS = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...(opts.noEmail ? {} : { email: opts.email ?? 'carol@example.test', email_verified: true }), azp: 'chatgpt', ...(opts.scope ? { scope: opts.scope } : {}), ...(opts.jti ? { jti: opts.jti } : {}) })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(issuer)
    .setAudience(opts.aud ?? PUBLIC_URL)
    .setSubject(opts.sub ?? 'sub-carol')
    .setIssuedAt(nowS)
    .setExpirationTime(nowS + (opts.expInS ?? 300))
    .sign(signingKey);
}

let apiUrl = '';
let mcp: StartedHttpServer;
let staticOnly: StartedHttpServer;
let verifiedStatic: StartedHttpServer;

function raw(port: number, opts: { method: string; path: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: opts.method, path: opts.path, headers: opts.headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString(), headers: res.headers }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

const INIT = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '0' } } });
const LIST = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
const mcpHeaders = (bearer?: string, extra: Record<string, string> = {}) => ({
  'content-type': 'application/json', accept: 'application/json, text/event-stream',
  ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...extra,
});

function connect(bearer: string, port = mcp.port) {
  const client = new Client({ name: 'front-door-test', version: '0' });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/`), { requestInit: { headers: { Authorization: `Bearer ${bearer}` } } });
  return { client, transport, connect: () => client.connect(transport) };
}

function lastCall(path: string): Seen {
  const hit = [...seen].reverse().find(s => s.path === path);
  if (!hit) throw new Error(`fake API never saw ${path}`);
  return hit;
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  signingKey = pair.privateKey as CryptoKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const [apiPort, authPort] = await Promise.all([listen(api), listen(authServer)]);
  apiUrl = `http://127.0.0.1:${apiPort}`;
  issuer = `http://127.0.0.1:${authPort}`;
  // The factory honours the purpose the app hands it (M-5): gateway / delegated
  // clients get the gateway key, static sessions get OMNIMIND_MCP_STATIC_AGENT_KEY or nothing.
  const createClientFn = ({ agentKey }: ClientPurpose) => new OmniMindClient({ baseUrl: apiUrl, apiKey: 'svc-key', agentKey });
  mcp = await startHttpServer(0, {
    apiKey: STATIC_KEY,
    agentCtx: staticCtx,
    auth: { tokenAuth: true, oauth: { issuer, audience: PUBLIC_URL }, publicUrl: PUBLIC_URL, agentKey: GATEWAY_KEY },
    createClientFn,
    log: () => {},
  });
  staticOnly = await startHttpServer(0, { apiKey: STATIC_KEY, agentCtx: staticCtx, createClientFn, log: () => {} });
  verifiedStatic = await startHttpServer(0, {
    apiKey: STATIC_KEY, agentCtx: staticCtx, staticAgentKey: STATIC_AGENT_KEY,
    auth: { tokenAuth: true, agentKey: GATEWAY_KEY },
    createClientFn, log: () => {},
  });
});

afterAll(async () => {
  await mcp.close();
  await staticOnly.close();
  await verifiedStatic.close();
  await new Promise(r => api.close(r));
  await new Promise(r => authServer.close(r));
});

describe('configuration', () => {
  it('createHttpApp refuses a config with no auth mode; resolveHttpConfig accepts token-only and OAuth env', () => {
    expect(() => createHttpApp({ log: () => {} })).toThrow(/at least one inbound auth mode/);
    const tokenOnly = resolveHttpConfig({ OMNIMIND_MCP_TOKEN_AUTH: 'true', OMNIMIND_MCP_AGENT_KEY: 'omk_x' } as NodeJS.ProcessEnv);
    expect(tokenOnly.apiKey).toBeUndefined();
    expect(tokenOnly.auth).toEqual({ tokenAuth: true, agentKey: 'omk_x' });
    expect(() => resolveHttpConfig({ OMNIMIND_MCP_TOKEN_AUTH: 'true' } as NodeJS.ProcessEnv)).toThrow(/OMNIMIND_MCP_AGENT_KEY/);
    const withOauth = resolveHttpConfig({ OMNIMIND_MCP_OAUTH_ISSUER: 'https://a.test', OMNIMIND_MCP_PUBLIC_URL: PUBLIC_URL, OMNIMIND_MCP_AGENT_KEY: 'omk_x' } as NodeJS.ProcessEnv);
    expect(withOauth.auth.oauth).toEqual({ issuer: 'https://a.test', audience: PUBLIC_URL });
  });

  it('M-5: static sessions use OMNIMIND_MCP_STATIC_AGENT_KEY; the gateway key only when no gateway mode is enabled', () => {
    const mixed = { tokenAuth: true };
    const legacy = { tokenAuth: false };
    expect(resolveStaticAgentKey(mixed, { OMNIMIND_MCP_AGENT_KEY: 'omk_gw' } as NodeJS.ProcessEnv)).toEqual({ key: undefined, source: 'none' });
    expect(resolveStaticAgentKey(mixed, { OMNIMIND_MCP_AGENT_KEY: 'omk_gw', OMNIMIND_MCP_STATIC_AGENT_KEY: 'omk_me' } as NodeJS.ProcessEnv)).toEqual({ key: 'omk_me', source: 'OMNIMIND_MCP_STATIC_AGENT_KEY' });
    expect(resolveStaticAgentKey(legacy, { OMNIMIND_MCP_AGENT_KEY: 'omk_gw' } as NodeJS.ProcessEnv)).toEqual({ key: 'omk_gw', source: 'OMNIMIND_MCP_AGENT_KEY' });
    expect(resolveStaticAgentKey(legacy, {} as NodeJS.ProcessEnv)).toEqual({ key: undefined, source: 'none' });
    const cfg = resolveHttpConfig({ OMNIMIND_MCP_API_KEY: 'k', OMNIMIND_MCP_TOKEN_AUTH: 'true', OMNIMIND_MCP_AGENT_KEY: 'omk_gw', OMNIMIND_MCP_TRUST_PROXY: 'true' } as NodeJS.ProcessEnv);
    expect(cfg.staticAgentKey).toEqual({ key: undefined, source: 'none' });
    expect(cfg.trustProxy).toBe(true);
    expect(mcp.app.staticAgentKeySource).toBe('none');
    expect(verifiedStatic.app.staticAgentKeySource).toBe('OMNIMIND_MCP_STATIC_AGENT_KEY');
  });
});

describe('RFC 9728 protected resource metadata', () => {
  it('is served (unauthenticated) at both well-known paths when OAuth is configured', async () => {
    for (const path of [PRM_PATH, `${PRM_PATH}/mcp`]) {
      const res = await raw(mcp.port, { method: 'GET', path });
      expect(res.status, path).toBe(200);
      expect(JSON.parse(res.body)).toEqual({
        resource: PUBLIC_URL,
        authorization_servers: [issuer],
        scopes_supported: [...MCP_SCOPES],
        bearer_methods_supported: ['header'],
        resource_documentation: expect.stringMatching(/^https:\/\//),
      });
    }
  });

  it('is also served at /mcp/ (trailing slash) directly — no redirect, no auth wall', async () => {
    const res = await raw(mcp.port, { method: 'GET', path: `${PRM_PATH}/mcp/` });
    expect(res.status).toBe(200);
    expect(res.headers.location).toBeUndefined();
    expect(res.headers['www-authenticate']).toBeUndefined();
    expect(JSON.parse(res.body).resource).toBe(PUBLIC_URL);
    const head = await raw(mcp.port, { method: 'HEAD', path: `${PRM_PATH}/mcp/` });
    expect(head.status).toBe(200);
  });

  it('is 404 on a server without OAuth, and /health stays minimal on both', async () => {
    expect((await raw(staticOnly.port, { method: 'GET', path: PRM_PATH })).status).toBe(404);
    for (const s of [mcp, staticOnly]) {
      const health = JSON.parse((await raw(s.port, { method: 'GET', path: '/health' })).body);
      expect(Object.keys(health).sort()).toEqual(['sessions', 'status', 'uptime']);
    }
  });
});

describe('no-redirect guarantee', () => {
  // Claude drops `Authorization` on a cross-host redirect; ChatGPT reports "Session
  // terminated" when `/mcp` 307s to `/mcp/`. Every spelling must be the MCP handler itself.
  const PATHS = ['/mcp', '/mcp/', '/'] as const;

  it('POST /mcp, /mcp/ and / all open a session directly (200 + mcp-session-id, no 3xx, no Location)', async () => {
    for (const path of PATHS) {
      const res = await raw(mcp.port, { method: 'POST', path, headers: mcpHeaders(STATIC_KEY), body: INIT });
      expect(res.status, path).toBe(200);
      expect(res.headers.location, path).toBeUndefined();
      expect(typeof res.headers['mcp-session-id'], path).toBe('string');
      const sid = res.headers['mcp-session-id'] as string;
      expect(mcp.app.sessions.has(sid), path).toBe(true);
      // The session opened on one spelling is driven on any other.
      for (const other of PATHS) {
        const list = await raw(mcp.port, { method: 'POST', path: other, headers: mcpHeaders(STATIC_KEY, { 'mcp-session-id': sid }), body: LIST });
        expect(list.status, `${path} → ${other}`).toBe(200);
        expect(list.headers.location, `${path} → ${other}`).toBeUndefined();
      }
      const del = await raw(mcp.port, { method: 'DELETE', path, headers: { authorization: `Bearer ${STATIC_KEY}`, 'mcp-session-id': sid } });
      expect(del.status, path).toBeLessThan(300);
      expect(mcp.app.sessions.has(sid), path).toBe(false);
    }
  });

  it('unauthenticated and session-less requests on every spelling are answered in place (401 / 400), never redirected or 404ed by path', async () => {
    for (const path of PATHS) {
      const anon = await raw(mcp.port, { method: 'POST', path, headers: mcpHeaders(), body: INIT });
      expect(anon.status, path).toBe(401);
      expect(anon.headers.location, path).toBeUndefined();
      const get = await raw(mcp.port, { method: 'GET', path, headers: { authorization: `Bearer ${STATIC_KEY}`, accept: 'text/event-stream' } });
      expect(get.status, path).toBe(400); // mcp-session-id required — the handler, not a router, answered
      expect(get.headers.location, path).toBeUndefined();
    }
    // The SDK client itself, pointed at each spelling, completes the handshake (static key: no cache side effects for later tests).
    for (const path of PATHS) {
      const client = new Client({ name: 'no-redirect', version: '0' });
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcp.port}${path}`), { requestInit: { headers: { Authorization: `Bearer ${STATIC_KEY}` } } });
      await client.connect(transport);
      expect((await client.listTools()).tools.length, path).toBeGreaterThan(0);
      await client.close();
    }
  });
});

describe('401 contract', () => {
  it('no credential → no error=, resource_metadata only when OAuth is configured', async () => {
    const res = await raw(mcp.port, { method: 'POST', path: '/', headers: mcpHeaders(), body: INIT });
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe(`Bearer realm="omnimind-mcp", resource_metadata="https://mcp.example.test${PRM_PATH}"`);
    const legacy = await raw(staticOnly.port, { method: 'POST', path: '/', headers: mcpHeaders(), body: INIT });
    expect(legacy.status).toBe(401);
    expect(legacy.headers['www-authenticate']).toBe('Bearer realm="omnimind-mcp"');
  });

  it('bad / expired / unknown credentials → error="invalid_token"; the body is generic (L-4) and never carries the token', async () => {
    const before = introspections;
    for (const bearer of ['wrong-key', OMT.nope, OMT.expired, 'a.b.c', 'omt_short']) {
      const res = await raw(mcp.port, { method: 'POST', path: '/', headers: mcpHeaders(bearer), body: INIT });
      expect(res.status, bearer).toBe(401);
      expect(res.headers['www-authenticate'], bearer).toBe(`Bearer realm="omnimind-mcp", error="invalid_token", resource_metadata="https://mcp.example.test${PRM_PATH}"`);
      expect(JSON.parse(res.body), bearer).toEqual({ error: 'invalid_token' }); // no revoked / expired / unlinked oracle
      expect(res.body).not.toContain(bearer);
    }
    // Only the two well-formed unknown tokens reached introspection; `omt_short` was refused by shape (M-4).
    expect(introspections - before).toBe(2);
    const legacy = await raw(staticOnly.port, { method: 'POST', path: '/', headers: mcpHeaders(OMT.alice), body: INIT });
    expect(legacy.status).toBe(401); // token auth is not enabled there
    expect(legacy.headers['www-authenticate']).toBe('Bearer realm="omnimind-mcp", error="invalid_token"');
    const none = await raw(mcp.port, { method: 'POST', path: '/', headers: mcpHeaders(), body: INIT });
    expect(JSON.parse(none.body)).toEqual({ error: 'unauthorized' });
  });

  it('introspection outage → 503 (retryable), no WWW-Authenticate, not cached', async () => {
    const before = introspections;
    const r1 = await raw(mcp.port, { method: 'POST', path: '/', headers: mcpHeaders(OMT.outage), body: INIT });
    const r2 = await raw(mcp.port, { method: 'POST', path: '/', headers: mcpHeaders(OMT.outage), body: INIT });
    expect([r1.status, r2.status]).toEqual([503, 503]);
    expect(r1.headers['www-authenticate']).toBeUndefined();
    expect(JSON.parse(r1.body)).toEqual({ error: 'auth_unavailable', message: 'token introspection unavailable' });
    expect(introspections - before).toBe(2);
  });

  it('M-4: a per-IP failure budget answers 429 + Retry-After before introspection, while known-good credentials keep working', async () => {
    const logs: string[] = [];
    const limited = await startHttpServer(0, {
      apiKey: STATIC_KEY, agentCtx: staticCtx, auth: { tokenAuth: true, agentKey: GATEWAY_KEY },
      createClientFn: ({ agentKey }) => new OmniMindClient({ baseUrl: apiUrl, apiKey: 'svc-key', agentKey }),
      authFailureLimit: { capacity: 3, refillPerMinute: 1 }, log: l => logs.push(l),
    });
    try {
      // Warm a positive: alice is introspected once and cached.
      const { client, transport, connect: go } = connect(OMT.alice, limited.port);
      await go();
      const before = introspections;
      for (let i = 0; i < 3; i++) {
        const res = await raw(limited.port, { method: 'POST', path: '/', headers: mcpHeaders(omt(`guess-${i}`)), body: INIT });
        expect(res.status).toBe(401);
      }
      expect(introspections - before).toBe(3);
      const blocked = await raw(limited.port, { method: 'POST', path: '/', headers: mcpHeaders(omt('guess-4')), body: INIT });
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(JSON.parse(blocked.body)).toEqual({ error: 'too_many_requests', message: 'too many failed authentication attempts' });
      expect(introspections - before).toBe(3); // the 4th guess never reached OmniMind
      // Missing credentials are failures too, and also throttled now.
      expect((await raw(limited.port, { method: 'POST', path: '/', headers: mcpHeaders(), body: INIT })).status).toBe(429);
      // The cached-positive session and the static key are unaffected from the same IP.
      const list = await raw(limited.port, { method: 'POST', path: '/', headers: mcpHeaders(OMT.alice, { 'mcp-session-id': transport.sessionId as string }), body: LIST });
      expect(list.status).toBe(200);
      expect((await raw(limited.port, { method: 'POST', path: '/', headers: mcpHeaders(STATIC_KEY), body: INIT })).status).toBe(200);
      // Without OMNIMIND_MCP_TRUST_PROXY a spoofed X-Forwarded-For does not buy a fresh bucket (still the socket's
      // budget → 429) and the shared-budget situation is logged exactly once.
      for (const fakeIp of ['9.9.9.9', '8.8.8.8']) {
        expect((await raw(limited.port, { method: 'POST', path: '/', headers: mcpHeaders(omt('spoof'), { 'x-forwarded-for': fakeIp }), body: INIT })).status).toBe(429);
      }
      expect(logs.filter(l => /OMNIMIND_MCP_TRUST_PROXY is not set/.test(l))).toHaveLength(1);
      await client.close();
    } finally {
      await limited.close();
    }
    // With trustProxy on, the right-most X-Forwarded-For entry is the bucket key.
    const trusted = await startHttpServer(0, {
      apiKey: STATIC_KEY, agentCtx: staticCtx, auth: { tokenAuth: true, agentKey: GATEWAY_KEY }, trustProxy: true,
      createClientFn: ({ agentKey }) => new OmniMindClient({ baseUrl: apiUrl, apiKey: 'svc-key', agentKey }),
      authFailureLimit: { capacity: 1, refillPerMinute: 1 }, log: () => {},
    });
    try {
      const attempt = (xff: string) => raw(trusted.port, { method: 'POST', path: '/', headers: mcpHeaders(omt('spoof'), { 'x-forwarded-for': xff }), body: INIT });
      expect((await attempt('1.1.1.1, 2.2.2.2')).status).toBe(401);
      expect((await attempt('3.3.3.3, 2.2.2.2')).status).toBe(429); // same right-most entry → same bucket
      expect((await attempt('2.2.2.2, 4.4.4.4')).status).toBe(401); // a different nearest-hop address is another client
    } finally {
      await trusted.close();
    }
  });
});

describe('omt_ token principals', () => {
  it('opens a session, lists 20 tools, and outbound calls carry delegation headers only', async () => {
    const before = introspections;
    const { client, transport, connect: go } = connect(OMT.alice);
    await go();
    const sid = transport.sessionId as string;
    expect(mcp.app.sessions.get(sid)?.principalKey).toBe('token:tok_alice');
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(20);
    // One introspection for the whole handshake + list (cached under the token digest).
    expect(introspections - before).toBe(1);

    // userId is omitted: the principal's user is injected.
    const res = await client.callTool({ name: 'memory_search', arguments: { query: 'railway' } });
    expect(res.isError).toBeFalsy();
    expect((res.structuredContent as { provenance: unknown }).provenance).toEqual({ source: 'omnimind', trust: 'data' });
    const call = lastCall('/memories/search');
    expect(call.headers['x-mcp-principal']).toBe('token:tok_alice');
    expect(call.headers['x-agent-key']).toBe(GATEWAY_KEY);
    expect(call.headers['x-api-key']).toBe('svc-key');
    expect(call.headers['x-user-id']).toBe('user-alice');
    expect(call.headers).not.toHaveProperty('x-agent-id');
    expect(call.headers).not.toHaveProperty('x-tenant-id');
    expect(call.headers).not.toHaveProperty('x-source-weight');

    // The audit row is attributed to the principal's agent / tenant.
    await new Promise(r => setTimeout(r, 20));
    const audit = lastCall('/mcp/audit');
    expect(audit.body).toMatchObject({ agentId: 'claude-ai-alice', tenantId: 'josh-business', toolName: 'memory_search' });
    expect(audit.headers['x-mcp-principal']).toBe('token:tok_alice');

    // A conflicting explicit userId can never widen access.
    const conflict = await client.callTool({ name: 'memory_search', arguments: { query: 'railway', userId: 'user-bob' } });
    expect(conflict.isError).toBe(true);
    expect((conflict.content as Array<{ text: string }>)[0].text).toContain('VALIDATION_ERROR');

    // Scopes come from the principal row: alice may write, bob (below) may not.
    const write = await client.callTool({ name: 'memory_write', arguments: { content: 'x', skipExtraction: true } });
    expect(write.isError).toBeFalsy();
    expect(lastCall('/memories').headers['x-mcp-principal']).toBe('token:tok_alice');

    // DELETE closes the session and its client.
    const sessionClient = mcp.app.sessions.get(sid)?.client as OmniMindClient;
    await transport.terminateSession();
    expect(mcp.app.sessions.has(sid)).toBe(false);
    expect(sessionClient.isClosed).toBe(true);
    await client.close();
  });

  it('binds the session to its principal: another token or the static key → 404, never a leak', async () => {
    const { transport, connect: go, client } = connect(OMT.alice);
    await go();
    const sid = transport.sessionId as string;
    for (const other of [OMT.bob, STATIC_KEY]) {
      const res = await raw(mcp.port, { method: 'POST', path: '/', headers: mcpHeaders(other, { 'mcp-session-id': sid }), body: LIST });
      expect(res.status, other).toBe(404);
      const get = await raw(mcp.port, { method: 'GET', path: '/', headers: { authorization: `Bearer ${other}`, accept: 'text/event-stream', 'mcp-session-id': sid } });
      expect(get.status, other).toBe(404);
      const del = await raw(mcp.port, { method: 'DELETE', path: '/', headers: { authorization: `Bearer ${other}`, 'mcp-session-id': sid } });
      expect(del.status, other).toBe(404);
    }
    expect(mcp.app.sessions.has(sid)).toBe(true); // the foreign DELETE did nothing
    const own = await raw(mcp.port, { method: 'POST', path: '/', headers: mcpHeaders(OMT.alice, { 'mcp-session-id': sid }), body: LIST });
    expect(own.status).toBe(200);
    await client.close();
  });

  it('a read-only token is SCOPE_DENIED on writes; per-principal sessions do not share identity', async () => {
    const a = connect(OMT.alice);
    const b = connect(OMT.bob);
    await Promise.all([a.connect(), b.connect()]);
    const denied = await b.client.callTool({ name: 'memory_write', arguments: { content: 'x', skipExtraction: true } });
    expect(denied.isError).toBe(true);
    expect((denied.content as Array<{ text: string }>)[0].text).toContain('SCOPE_DENIED');
    await b.client.callTool({ name: 'memory_search', arguments: { query: 'q' } });
    expect(lastCall('/memories/search').headers['x-mcp-principal']).toBe('token:tok_bob');
    expect(lastCall('/memories/search').headers['x-user-id']).toBe('user-bob');
    await a.client.callTool({ name: 'memory_search', arguments: { query: 'q' } });
    expect(lastCall('/memories/search').headers['x-mcp-principal']).toBe('token:tok_alice');
    await Promise.all([a.client.close(), b.client.close()]);
  });
});

describe('legacy static key keeps its identity headers', () => {
  it('sends x-agent-id / x-tenant-id / x-source-weight, no x-mcp-principal and (M-5) never the gateway key', async () => {
    const { client, transport, connect: go } = connect(STATIC_KEY);
    await go();
    expect(mcp.app.sessions.get(transport.sessionId as string)?.principalKey).toBe('static:env');
    const res = await client.callTool({ name: 'memory_search', arguments: { query: 'q', userId: 'user-x' } });
    expect(res.isError).toBeFalsy(); // the fake API 403s agent_header_mismatch when the gateway key rides with the triple
    const call = lastCall('/memories/search');
    expect(call.headers['x-agent-id']).toBe('env-agent');
    expect(call.headers['x-tenant-id']).toBe('josh-business');
    expect(call.headers['x-source-weight']).toBe('1');
    expect(call.headers['x-user-id']).toBe('user-x');
    expect(call.headers).not.toHaveProperty('x-mcp-principal');
    expect(call.headers).not.toHaveProperty('x-agent-key');
    // Every outbound call of this session (audit rows included) is gateway-key-free.
    await new Promise(r => setTimeout(r, 20));
    const audit = lastCall('/mcp/audit');
    expect(audit.headers['x-agent-id']).toBe('env-agent');
    expect(audit.headers).not.toHaveProperty('x-agent-key');
    for (const s of seen.filter(s => s.headers['x-agent-id'] === 'env-agent')) expect(s.headers['x-agent-key']).toBeUndefined();
    await client.close();
  });

  it('M-5: with OMNIMIND_MCP_STATIC_AGENT_KEY the static session is verified with THAT key, still never the gateway key', async () => {
    const { client, connect: go } = connect(STATIC_KEY, verifiedStatic.port);
    await go();
    const res = await client.callTool({ name: 'memory_search', arguments: { query: 'q', userId: 'user-x' } });
    expect(res.isError).toBeFalsy();
    const call = lastCall('/memories/search');
    expect(call.headers['x-agent-key']).toBe(STATIC_AGENT_KEY);
    expect(call.headers['x-agent-id']).toBe('env-agent');
    expect(call.headers).not.toHaveProperty('x-mcp-principal');
    // Token principals on the same server still delegate with the gateway key.
    const t = connect(OMT.alice, verifiedStatic.port);
    await t.connect();
    await t.client.callTool({ name: 'memory_search', arguments: { query: 'q' } });
    expect(lastCall('/memories/search').headers['x-agent-key']).toBe(GATEWAY_KEY);
    expect(lastCall('/memories/search').headers['x-mcp-principal']).toBe('token:tok_alice');
    await Promise.all([client.close(), t.client.close()]);
  });
});

describe('session lifecycle hardening', () => {
  it('M-1: an authenticated initialize the SDK rejects (406 / bad Host) leaves no server, transport or client behind', async () => {
    let built = 0;
    const clients: OmniMindClient[] = [];
    const strict = await startHttpServer(0, {
      apiKey: STATIC_KEY, agentCtx: staticCtx, log: () => {},
      createClientFn: ({ agentKey }) => { const c = new OmniMindClient({ baseUrl: apiUrl, apiKey: 'svc-key', agentKey }); clients.push(c); return c; },
      createServerFn: (ctx, client, extras) => { built++; return createMcpServer(ctx, { client, ...extras }); },
    });
    try {
      const base = { 'content-type': 'application/json', authorization: `Bearer ${STATIC_KEY}` };
      const notAcceptable = await raw(strict.port, { method: 'POST', path: '/', headers: { ...base, accept: 'application/json' }, body: INIT });
      const badHost = await raw(strict.port, { method: 'POST', path: '/', headers: { ...base, accept: 'application/json, text/event-stream', host: 'evil.example:1' }, body: INIT });
      expect([notAcceptable.status, badHost.status]).toEqual([406, 403]);
      expect(built).toBe(2);
      expect(strict.app.sessions.size).toBe(0);
      expect(clients).toHaveLength(4); // session client + deferred twin per attempt
      expect(clients.every(c => c.isClosed)).toBe(true);
      expect(strict.app.deferred.clientCount).toBe(0);
      // A good initialize afterwards still works and is tracked.
      const ok = await raw(strict.port, { method: 'POST', path: '/', headers: { ...base, accept: 'application/json, text/event-stream' }, body: INIT });
      expect(ok.status).toBe(200);
      expect(strict.app.sessions.size).toBe(1);
    } finally {
      await strict.close();
    }
  });

  it('M-3: the same identity with a narrower scope set cannot drive a session opened with wider scopes', async () => {
    const wide = connect(await mintJwt({ scope: 'memory:read memory:write' }));
    await wide.connect();
    const sid = wide.transport.sessionId as string;
    expect(mcp.app.sessions.get(sid)?.principalKey).toBe('oauth:oid_carol');
    expect(mcp.app.sessions.get(sid)?.scopeDigest).toBe(scopeDigestOf(['memory:write', 'memory:read']));
    expect(scopeDigestOf(['memory:read', 'memory:write'])).toBe(scopeDigestOf(['memory:write', 'memory:read', 'memory:read']));
    expect(scopeDigestOf(['memory:read'])).not.toBe(scopeDigestOf(['memory:read', 'memory:write']));

    const narrow = await mintJwt({ scope: 'memory:read' });
    const res = await raw(mcp.port, { method: 'POST', path: '/', headers: mcpHeaders(narrow, { 'mcp-session-id': sid }), body: LIST });
    expect(res.status).toBe(404); // same oauth:oid_carol, different effective scopes → not this session
    expect((await raw(mcp.port, { method: 'DELETE', path: '/', headers: { authorization: `Bearer ${narrow}`, 'mcp-session-id': sid } })).status).toBe(404);
    expect(mcp.app.sessions.has(sid)).toBe(true);
    // A fresh token with the SAME scopes (different jti / exp) is the same caller.
    const sameScopes = await mintJwt({ scope: 'memory:write memory:read', expInS: 400 });
    expect((await raw(mcp.port, { method: 'POST', path: '/', headers: mcpHeaders(sameScopes, { 'mcp-session-id': sid }), body: LIST })).status).toBe(200);
    await wide.client.close();
  });

  it('L-6: an upstream 403 insufficient_scope surfaces as the typed SCOPE_DENIED error, not a raw HTTP string', async () => {
    const { client, connect: go } = connect(OMT.alice);
    await go();
    const res = await client.callTool({ name: 'memory_reflect', arguments: { entityType: 'goal', entityId: 'g1' } });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ text: string }>)[0].text;
    expect(JSON.parse(text)).toMatchObject({ error: 'SCOPE_DENIED', message: expect.stringContaining('insufficient_scope') });
    expect(text).not.toContain('→ 403');
    await client.close();
  });
});

describe('revocation is immediate end to end', () => {
  it('a token revoked mid-session: PRINCIPAL_REVOKED on the call in flight, credential evicted, 401 on the next POST / GET / DELETE, re-initialize refused by introspection', async () => {
    const logs: string[] = [];
    const server = await startHttpServer(0, {
      apiKey: STATIC_KEY, agentCtx: staticCtx, auth: { tokenAuth: true, agentKey: GATEWAY_KEY },
      createClientFn: ({ agentKey }) => new OmniMindClient({ baseUrl: apiUrl, apiKey: 'svc-key', agentKey }),
      log: l => logs.push(l),
    });
    try {
      // Two live sessions for the same principal (two clients on one token).
      const a = connect(OMT.dave, server.port);
      const b = connect(OMT.dave, server.port);
      await a.connect();
      await b.connect();
      const sidA = a.transport.sessionId as string;
      const sidB = b.transport.sessionId as string;
      expect(server.app.sessions.get(sidA)?.principalKey).toBe('token:tok_dave');
      expect(server.app.resolver.isKnownGood(OMT.dave)).toBe(true);
      const ok = await a.client.callTool({ name: 'memory_search', arguments: { query: 'railway' } });
      expect(ok.isError).toBeFalsy();
      const sessionClient = server.app.sessions.get(sidA)?.client as OmniMindClient;
      const introspectionsBefore = introspections;

      // BoardRoom revokes the token. Nothing reaches this server until the next data call.
      revokedPrincipals.add('token:tok_dave');
      const res = await a.client.callTool({ name: 'memory_search', arguments: { query: 'railway' } });
      expect(res.isError).toBe(true);
      const text = (res.content as Array<{ text: string }>)[0].text;
      expect(JSON.parse(text)).toEqual({
        error: 'PRINCIPAL_REVOKED',
        message: expect.stringMatching(/credential behind this connection has been revoked.*401 principal_invalid.*mint a new token/s),
      });
      expect(text).not.toContain('→ 401'); // typed, not a raw upstream failure string

      // (a) evicted from the positive cache at once, without any introspection round-trip
      expect(server.app.resolver.isKnownGood(OMT.dave)).toBe(false);
      expect(introspections).toBe(introspectionsBefore);
      // (b) every session of that principal is marked revoked and serves nothing more
      expect(server.app.sessions.get(sidA)?.revoked).toMatchObject({ reason: 'revoked' });
      expect(server.app.sessions.get(sidB)?.revoked).toMatchObject({ reason: 'revoked' });
      expect(logs.some(l => /principal token:tok_dave refused by OmniMind \(revoked\) on POST \/memories\/search: evicted 1 cached credential\(s\), closing 2 session\(s\)/.test(l))).toBe(true);

      // The next POST / GET / DELETE on either session re-introspects (the positive is
      // gone) and OmniMind itself refuses the credential → 401 with the normal challenge.
      const challenge = 'Bearer realm="omnimind-mcp", error="invalid_token"';
      for (const sid of [sidA, sidB]) {
        const post = await raw(server.port, { method: 'POST', path: '/', headers: mcpHeaders(OMT.dave, { 'mcp-session-id': sid }), body: LIST });
        expect(post.status, `POST ${sid}`).toBe(401);
        expect(post.headers['www-authenticate']).toBe(challenge);
        expect(JSON.parse(post.body)).toEqual({ error: 'invalid_token' });
        const get = await raw(server.port, { method: 'GET', path: '/', headers: { authorization: `Bearer ${OMT.dave}`, accept: 'text/event-stream', 'mcp-session-id': sid } });
        expect(get.status, `GET ${sid}`).toBe(401);
        expect(get.headers['www-authenticate']).toBe(challenge);
        const del = await raw(server.port, { method: 'DELETE', path: '/', headers: { authorization: `Bearer ${OMT.dave}`, 'mcp-session-id': sid } });
        expect(del.status, `DELETE ${sid}`).toBe(401);
        expect(del.headers['www-authenticate']).toBe(challenge);
      }
      expect(introspections - introspectionsBefore).toBe(1); // one re-introspection, then the negative cache answers
      // Someone else presenting a dead session id still sees plain 404, never a leak.
      expect((await raw(server.port, { method: 'POST', path: '/', headers: mcpHeaders(STATIC_KEY, { 'mcp-session-id': sidA }), body: LIST })).status).toBe(404);

      // The sessions are closed and cleaned once the in-flight error result has flushed (grace timer).
      await new Promise(r => setTimeout(r, 650));
      expect(server.app.sessions.has(sidA)).toBe(false);
      expect(server.app.sessions.has(sidB)).toBe(false);
      expect(sessionClient.isClosed).toBe(true);
      expect(server.app.deferred.clientCount).toBe(0);

      // (c) a fresh initialize with the same token goes back to introspection (once the
      // 10 s negative entry is cleared here) and is refused by OmniMind.
      server.app.resolver.clearCache();
      const before = introspections;
      const init = await raw(server.port, { method: 'POST', path: '/', headers: mcpHeaders(OMT.dave), body: INIT });
      expect(init.status).toBe(401);
      expect(init.headers['www-authenticate']).toBe(challenge);
      expect(introspections - before).toBe(1);
      expect(server.app.sessions.size).toBe(0);
      await Promise.all([a.client.close(), b.client.close()]);
    } finally {
      revokedPrincipals.delete('token:tok_dave');
      await server.close();
    }
  });

  it('defence in depth: even while introspection still says active, a session OmniMind refused is 401 on POST / GET / DELETE and closed on that request', async () => {
    const server = await startHttpServer(0, {
      apiKey: STATIC_KEY, agentCtx: staticCtx, auth: { tokenAuth: true, agentKey: GATEWAY_KEY },
      createClientFn: ({ agentKey }) => new OmniMindClient({ baseUrl: apiUrl, apiKey: 'svc-key', agentKey }),
      log: () => {},
    });
    try {
      const { client, transport, connect: go } = connect(OMT.dave, server.port);
      await go();
      const sid = transport.sessionId as string;
      // Data calls are refused, but introspection (a lagging replica, say) still answers active.
      revokedPrincipals.add('token:tok_dave');
      introspectionLagsBehindRevoke = true;
      const res = await client.callTool({ name: 'memory_search', arguments: { query: 'q' } });
      expect(JSON.parse((res.content as Array<{ text: string }>)[0].text).error).toBe('PRINCIPAL_REVOKED');
      expect(server.app.sessions.get(sid)?.revoked).toBeDefined();

      const challenge = 'Bearer realm="omnimind-mcp", error="invalid_token"';
      const post = await raw(server.port, { method: 'POST', path: '/', headers: mcpHeaders(OMT.dave, { 'mcp-session-id': sid }), body: LIST });
      expect(post.status).toBe(401);
      expect(post.headers['www-authenticate']).toBe(challenge);
      expect(JSON.parse(post.body)).toEqual({ error: 'invalid_token' });
      expect(server.app.sessions.has(sid)).toBe(false); // closed on that very request, not left to the timer
      expect(server.app.resolver.isKnownGood(OMT.dave)).toBe(true); // the (stale) positive was re-created by the re-introspection…
      // …and the dead session id stays 401 for this principal on GET and DELETE too, 404 for anyone else.
      const get = await raw(server.port, { method: 'GET', path: '/', headers: { authorization: `Bearer ${OMT.dave}`, accept: 'text/event-stream', 'mcp-session-id': sid } });
      expect(get.status).toBe(401);
      expect(get.headers['www-authenticate']).toBe(challenge);
      const del = await raw(server.port, { method: 'DELETE', path: '/', headers: { authorization: `Bearer ${OMT.dave}`, 'mcp-session-id': sid } });
      expect(del.status).toBe(401);
      expect((await raw(server.port, { method: 'DELETE', path: '/', headers: { authorization: `Bearer ${STATIC_KEY}`, 'mcp-session-id': sid } })).status).toBe(404);
      await client.close();
    } finally {
      introspectionLagsBehindRevoke = false;
      revokedPrincipals.delete('token:tok_dave');
      await server.close();
    }
  });

  it('a revoked session that makes no further request is closed by the grace timer; the sweeper also drops revoked sessions regardless of idle time', async () => {
    const server = await startHttpServer(0, {
      apiKey: STATIC_KEY, agentCtx: staticCtx, auth: { tokenAuth: true, agentKey: GATEWAY_KEY },
      createClientFn: ({ agentKey }) => new OmniMindClient({ baseUrl: apiUrl, apiKey: 'svc-key', agentKey }),
      log: () => {}, sweepIntervalMs: 60 * 60 * 1000,
    });
    try {
      const { client, transport, connect: go } = connect(OMT.dave, server.port);
      await go();
      const sid = transport.sessionId as string;
      revokedPrincipals.add('token:tok_dave');
      const res = await client.callTool({ name: 'memory_write', arguments: { content: 'x', skipExtraction: true } });
      expect(res.isError).toBe(true);
      expect((res.content as Array<{ text: string }>)[0].text).toContain('PRINCIPAL_REVOKED');
      expect(server.app.sessions.get(sid)?.revoked).toBeDefined();
      // The sweeper treats a revoked session as stale even when it was just seen.
      expect(await server.app.sweepIdle(Date.now())).toEqual([sid]);
      expect(server.app.sessions.has(sid)).toBe(false);
      // Another session: left alone, the grace timer closes it.
      revokedPrincipals.delete('token:tok_dave');
      server.app.resolver.clearCache();
      const second = connect(OMT.dave, server.port);
      await second.connect();
      const sid2 = second.transport.sessionId as string;
      revokedPrincipals.add('token:tok_dave');
      await second.client.callTool({ name: 'memory_search', arguments: { query: 'q' } });
      expect(server.app.sessions.has(sid2)).toBe(true);
      await new Promise(r => setTimeout(r, 700));
      expect(server.app.sessions.has(sid2)).toBe(false);
      await Promise.all([client.close(), second.client.close()]);
    } finally {
      revokedPrincipals.delete('token:tok_dave');
      await server.close();
    }
  });

  it('positive-cache TTL: 30 s default, overridable per app (principalCacheMs); only an idle client lives that long after revocation', async () => {
    const createClientFn = ({ agentKey }: ClientPurpose) => new OmniMindClient({ baseUrl: apiUrl, apiKey: 'svc-key', agentKey });
    expect(mcp.app.resolver.positiveTtlMs).toBe(PRINCIPAL_CACHE_POSITIVE_MS);
    expect(PRINCIPAL_CACHE_POSITIVE_MS).toBe(30_000);
    const custom = createHttpApp({ apiKey: STATIC_KEY, agentCtx: staticCtx, auth: { tokenAuth: true, agentKey: GATEWAY_KEY }, createClientFn, principalCacheMs: 7_000, log: () => {} });
    try {
      expect(custom.resolver.positiveTtlMs).toBe(7_000);
    } finally {
      await custom.close();
    }
  });
});

describe('OAuth access tokens (issuer discovery + JWKS over loopback)', () => {
  it('verifies the JWT, resolves the identity and delegates as oauth:<id>', async () => {
    const { client, transport, connect: go } = connect(await mintJwt());
    await go();
    expect(mcp.app.sessions.get(transport.sessionId as string)?.principalKey).toBe('oauth:oid_carol');
    const resolve = lastCall('/mcp/identities/resolve');
    expect(resolve.body).toEqual({ issuer, subject: 'sub-carol', email: 'carol@example.test', emailVerified: true, clientId: 'chatgpt' });
    expect(resolve.headers['x-agent-key']).toBe(GATEWAY_KEY);
    const res = await client.callTool({ name: 'search', arguments: { query: 'railway' } });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual({
      results: [{ id: 'm1', title: 'Railway decision', url: 'omnimind://josh-business/memory/m1' }],
      provenance: { source: 'omnimind', trust: 'data' },
    });
    expect(JSON.parse((res.content as Array<{ text: string }>)[0].text).results).toEqual((res.structuredContent as { results: unknown }).results);
    const call = lastCall('/memories/search');
    expect(call.headers['x-mcp-principal']).toBe('oauth:oid_carol');
    expect(call.headers['x-user-id']).toBe('user-carol');
    expect(call.headers).not.toHaveProperty('x-agent-id');
    await client.close();
  });

  it('scope claim narrows a wildcard principal', async () => {
    const { client, connect: go } = connect(await mintJwt({ scope: 'memory:read' }));
    await go();
    const denied = await client.callTool({ name: 'memory_write', arguments: { content: 'x', skipExtraction: true } });
    expect(denied.isError).toBe(true);
    expect((denied.content as Array<{ text: string }>)[0].text).toContain('SCOPE_DENIED');
    const ok = await client.callTool({ name: 'fetch', arguments: { id: 'm1' } });
    expect(ok.isError).toBeFalsy();
    expect(ok.structuredContent).toMatchObject({ id: 'm1', text: 'Chose Railway', metadata: { domain: 'business', status: 'CONFIRMED', agentId: 'claude-code-josh' } });
    await client.close();
  });

  it('issuer metadata advertised with a trailing slash still verifies (discovery normalises both sides)', async () => {
    // The fake issuer's discovery document says `issuer: "<issuer>/"` while the server is configured
    // without the slash; the JWT itself (`iss` without slash) verified above, so discovery accepted it.
    const { client, connect: go } = connect(await mintJwt());
    await go();
    await client.close();
  });

  describe('OIDC userinfo fallback (tokens without an e-mail claim)', () => {
    const callsFor = (sub: string) => userinfoCalls.filter(c => c.sub === sub);

    it('a JWT without email → userinfo (same bearer, Accept: application/json) → verified e-mail forwarded → identity resolves', async () => {
      const token = await mintJwt({ sub: 'sub-userinfo-ok', noEmail: true });
      const { client, transport, connect: go } = connect(token);
      await go();
      expect(mcp.app.sessions.get(transport.sessionId as string)?.principalKey).toBe('oauth:oid_carol');
      const calls = callsFor('sub-userinfo-ok');
      expect(calls).toHaveLength(1);
      expect(calls[0].authorization).toBe(`Bearer ${token}`);
      expect(calls[0].accept).toBe('application/json');
      // The API received the e-mail from userinfo, with the string "true" normalised to a boolean.
      expect(lastCall('/mcp/identities/resolve').body).toEqual({ issuer, subject: 'sub-userinfo-ok', email: 'carol@example.test', emailVerified: true, clientId: 'chatgpt' });
      // A second token for the same subject within the TTL: identity resolved again, userinfo NOT refetched.
      const again = connect(await mintJwt({ sub: 'sub-userinfo-ok', noEmail: true, jti: 'second' }));
      await again.connect();
      expect(callsFor('sub-userinfo-ok')).toHaveLength(1);
      await Promise.all([client.close(), again.client.close()]);
    });

    it('userinfo whose sub differs from the token sub is ignored → no e-mail → unlinked → 401', async () => {
      const token = await mintJwt({ sub: 'sub-userinfo-mismatch', noEmail: true });
      const res = await raw(mcp.port, { method: 'POST', path: '/', headers: mcpHeaders(token), body: INIT });
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toContain('error="invalid_token"');
      expect(callsFor('sub-userinfo-mismatch')).toHaveLength(1);
      const resolve = lastCall('/mcp/identities/resolve');
      expect(resolve.body).toEqual({ issuer, subject: 'sub-userinfo-mismatch', clientId: 'chatgpt' });
      expect(resolve.body).not.toHaveProperty('email');
    });

    it('userinfo 500 → 401, and only one userinfo fetch per subject within the TTL', async () => {
      const first = await raw(mcp.port, { method: 'POST', path: '/', headers: mcpHeaders(await mintJwt({ sub: 'sub-userinfo-500', noEmail: true })), body: INIT });
      expect(first.status).toBe(401);
      const second = await raw(mcp.port, { method: 'POST', path: '/', headers: mcpHeaders(await mintJwt({ sub: 'sub-userinfo-500', noEmail: true, jti: 'retry' })), body: INIT });
      expect(second.status).toBe(401);
      expect(callsFor('sub-userinfo-500')).toHaveLength(1);
    });

    it('a JWT that already carries a verified e-mail never triggers userinfo', async () => {
      const before = userinfoCalls.length;
      const { client, connect: go } = connect(await mintJwt({ jti: 'has-email' }));
      await go();
      expect(userinfoCalls.length).toBe(before);
      await client.close();
    });

    it('OMNIMIND_MCP_OAUTH_USERINFO=false: no userinfo call, the e-mail-less token stays unlinked (401)', async () => {
      const env = { OMNIMIND_MCP_OAUTH_ISSUER: 'https://a.test', OMNIMIND_MCP_PUBLIC_URL: PUBLIC_URL, OMNIMIND_MCP_AGENT_KEY: 'omk_x' } as NodeJS.ProcessEnv;
      expect(resolveHttpConfig({ ...env, OMNIMIND_MCP_OAUTH_USERINFO: 'false' }).auth.oauth).toEqual({ issuer: 'https://a.test', audience: PUBLIC_URL, userinfo: false });
      expect(resolveHttpConfig({ ...env, OMNIMIND_MCP_OAUTH_USERINFO: 'true' }).auth.oauth).toEqual({ issuer: 'https://a.test', audience: PUBLIC_URL });
      const off = await startHttpServer(0, {
        auth: { oauth: { issuer, audience: PUBLIC_URL, userinfo: false }, publicUrl: PUBLIC_URL, agentKey: GATEWAY_KEY },
        createClientFn: ({ agentKey }) => new OmniMindClient({ baseUrl: apiUrl, apiKey: 'svc-key', agentKey }),
        log: () => {},
      });
      try {
        const before = userinfoCalls.length;
        const res = await raw(off.port, { method: 'POST', path: '/', headers: mcpHeaders(await mintJwt({ sub: 'sub-userinfo-off', noEmail: true })), body: INIT });
        expect(res.status).toBe(401);
        expect(userinfoCalls.length).toBe(before);
        expect(lastCall('/mcp/identities/resolve').body).toEqual({ issuer, subject: 'sub-userinfo-off', clientId: 'chatgpt' });
        // The same server still links a token that carries its own verified e-mail.
        expect((await raw(off.port, { method: 'POST', path: '/', headers: mcpHeaders(await mintJwt({ sub: 'sub-userinfo-off-2' })), body: INIT })).status).toBe(200);
      } finally {
        await off.close();
      }
    });
  });

  it('audience mismatch, expiry and an unlinked subject are all 401 invalid_token', async () => {
    for (const [label, token] of [
      ['aud', await mintJwt({ aud: 'https://someone-else.example.test/mcp' })],
      ['exp', await mintJwt({ expInS: -120 })],
      ['unlinked', await mintJwt({ sub: 'sub-stranger', email: 'stranger@example.test' })], // unknown subject AND unknown (verified) e-mail
    ] as const) {
      const res = await raw(mcp.port, { method: 'POST', path: '/', headers: mcpHeaders(token), body: INIT });
      expect(res.status, label).toBe(401);
      expect(res.headers['www-authenticate'], label).toContain('error="invalid_token"');
      expect(res.body, label).not.toContain(token.slice(0, 40));
    }
  });
});
