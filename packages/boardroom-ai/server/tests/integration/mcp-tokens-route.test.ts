/**
 * Lane C — /mcp/tokens proxy (Settings → Connected AI tools).
 *
 * Boots the REAL app factory so the auth wall, the /api prefix strip, the
 * subscription gate and the shared error handler all apply, with the OmniMind
 * client mocked. Asserts:
 *   * the auth wall rejects cookie-less calls (401) before any upstream call
 *   * userId is pinned to the JWT user — a client-supplied userId is dropped
 *   * upstream 403 tenant_not_owned / 409 token_limit surface with the same
 *     status + error code (not 502); a 5xx still maps to 502 upstream_error
 *   * connect-info reads BoardRoom env and falls back to the request origin
 *
 * No supertest dependency — plain app.listen(0) + global fetch.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

vi.mock('../../src/services/omnimind-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/omnimind-client')>();
  return {
    ...actual,
    omnimindClient: {
      listMcpTokens: vi.fn(),
      createMcpToken: vi.fn(),
      revokeMcpToken: vi.fn(),
      getMcpTokenOptions: vi.fn(),
      getSubscription: vi.fn(async () => null),
    },
  };
});

import { omnimindClient } from '../../src/services/omnimind-client';

const client = omnimindClient as unknown as {
  listMcpTokens: ReturnType<typeof vi.fn>;
  createMcpToken: ReturnType<typeof vi.fn>;
  revokeMcpToken: ReturnType<typeof vi.fn>;
  getMcpTokenOptions: ReturnType<typeof vi.fn>;
  getSubscription: ReturnType<typeof vi.fn>;
};

let server: Server;
let base = '';
let cookie = '';
const prevEnv: Record<string, string | undefined> = {};
function setEnv(k: string, v: string | undefined) {
  if (!(k in prevEnv)) prevEnv[k] = process.env[k];
  if (v === undefined) delete process.env[k]; else process.env[k] = v;
}

const record = {
  id: 'tok_1', userId: 'jwt-user-1', tenantId: 'josh-business', name: 'Claude Code', agentName: 'claude-code-jwt-user-1',
  prefix: 'omt_abcd1234', scopes: ['memory:read'], sourceWeight: 1, createdAt: '2026-10-18T00:00:00.000Z',
  lastUsedAt: null, expiresAt: null, revokedAt: null,
};

function upstreamError(status: number, body: Record<string, unknown>) {
  return Object.assign(new Error(`OmniMind request: ${status}`), { status, upstream: body });
}

beforeAll(async () => {
  setEnv('NODE_ENV', 'test');
  setEnv('JWT_SECRET', 'mcp-tokens-test-secret');
  setEnv('OMNIMIND_API_KEY', 'mcp-tokens-test-key');
  setEnv('OMNIMIND_API_URL', 'http://127.0.0.1:1');
  setEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  setEnv('STRIPE_SECRET_KEY', undefined); // dev mode → requireSubscription passes through
  setEnv('OMNIMIND_MCP_PUBLIC_URL', undefined);
  setEnv('APP_PUBLIC_URL', undefined);
  setEnv('OMNIMIND_MCP_OAUTH_ISSUER', undefined);

  const { __resetJwtSecretForTest, createToken } = await import('../../src/middleware/auth');
  __resetJwtSecretForTest();
  cookie = `boardroom_token=${createToken({ userId: 'jwt-user-1', email: 'u@b.co', teamId: 't1' })}`;

  const { createApp } = await import('../../src/app');
  const app = createApp();
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

beforeEach(() => {
  client.listMcpTokens.mockReset().mockResolvedValue({ tokens: [record] });
  client.createMcpToken.mockReset().mockResolvedValue({ token: 'omt_abcd1234_rawsecret', record });
  client.revokeMcpToken.mockReset().mockResolvedValue(undefined);
  client.getMcpTokenOptions.mockReset().mockResolvedValue({
    tenants: [{ id: 'josh-business', name: 'Business' }],
    scopes: [{ id: 'memory:read', description: 'Read', write: false }, { id: 'memory:write', description: 'Write', write: true }],
  });
  setEnv('OMNIMIND_MCP_PUBLIC_URL', undefined);
  setEnv('APP_PUBLIC_URL', undefined);
  setEnv('OMNIMIND_MCP_OAUTH_ISSUER', undefined);
});

const authed = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { Accept: 'application/json', 'Content-Type': 'application/json', Cookie: cookie, ...(init.headers ?? {}) },
});

describe('/mcp/tokens — auth wall', () => {
  it('401 without a cookie and never calls OmniMind (both bare and /api-prefixed)', async () => {
    for (const path of ['/mcp/tokens', '/api/mcp/tokens', '/api/mcp/tokens/connect-info']) {
      const res = await fetch(`${base}${path}`, { headers: { Accept: 'application/json' } });
      expect(res.status, path).toBe(401);
      expect(await res.json()).toMatchObject({ error: 'unauthorized' });
    }
    expect(client.listMcpTokens).not.toHaveBeenCalled();
  });

  it('401 with a garbage cookie', async () => {
    const res = await fetch(`${base}/api/mcp/tokens`, { headers: { Accept: 'application/json', Cookie: 'boardroom_token=nope' } });
    expect(res.status).toBe(401);
  });
});

describe('GET /mcp/tokens', () => {
  it('lists tokens for the JWT user', async () => {
    const res = await fetch(`${base}/api/mcp/tokens`, authed());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tokens: [record] });
    expect(client.listMcpTokens).toHaveBeenCalledWith('jwt-user-1');
  });

  it('GET /options proxies with the JWT user', async () => {
    const res = await fetch(`${base}/api/mcp/tokens/options`, authed());
    expect(res.status).toBe(200);
    expect((await res.json()).tenants).toHaveLength(1);
    expect(client.getMcpTokenOptions).toHaveBeenCalledWith('jwt-user-1');
  });
});

describe('POST /mcp/tokens — userId pinning', () => {
  it('forwards the body with userId = JWT user and returns 201 {token, record}', async () => {
    const res = await fetch(`${base}/api/mcp/tokens`, authed({
      method: 'POST',
      body: JSON.stringify({ tenantId: 'josh-business', name: 'Claude Code', scopes: ['memory:read'], expiresInDays: 90 }),
    }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ token: 'omt_abcd1234_rawsecret', record: { id: 'tok_1' } });
    expect(client.createMcpToken).toHaveBeenCalledTimes(1);
    const [userId, payload] = client.createMcpToken.mock.calls[0];
    expect(userId).toBe('jwt-user-1');
    expect(payload).toEqual({ userId: 'jwt-user-1', tenantId: 'josh-business', name: 'Claude Code', scopes: ['memory:read'], expiresInDays: 90 });
  });

  it('drops a client-supplied userId — the JWT user always wins', async () => {
    const res = await fetch(`${base}/api/mcp/tokens`, authed({
      method: 'POST',
      body: JSON.stringify({ userId: 'attacker', tenantId: 'josh-business', name: 'Evil', scopes: ['memory:read'] }),
    }));
    expect(res.status).toBe(201);
    const [userId, payload] = client.createMcpToken.mock.calls[0];
    expect(userId).toBe('jwt-user-1');
    expect(payload.userId).toBe('jwt-user-1');
  });

  it('422 validation_failed on a bad body without calling OmniMind', async () => {
    const cases = [
      { tenantId: 'josh-business', scopes: ['memory:read'] }, // no name
      { tenantId: 'josh-business', name: '', scopes: ['memory:read'] },
      { tenantId: 'josh-business', name: 'x'.repeat(61), scopes: ['memory:read'] },
      { tenantId: 'josh-business', name: 'ok', scopes: [] },
      { tenantId: 'josh-business', name: 'ok', scopes: ['memory:read'], expiresInDays: 0 },
      { tenantId: 'josh-business', name: 'ok', scopes: ['memory:read'], sourceWeight: 3 },
    ];
    for (const body of cases) {
      const res = await fetch(`${base}/api/mcp/tokens`, authed({ method: 'POST', body: JSON.stringify(body) }));
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(await res.json()).toMatchObject({ error: 'validation_failed' });
    }
    expect(client.createMcpToken).not.toHaveBeenCalled();
  });
});

describe('upstream error mapping', () => {
  const body = JSON.stringify({ tenantId: 'other-tenant', name: 'Claude Code', scopes: ['memory:read'] });

  it('403 tenant_not_owned passes through with status + error code', async () => {
    client.createMcpToken.mockRejectedValueOnce(upstreamError(403, { error: 'tenant_not_owned', message: 'not yours' }));
    const res = await fetch(`${base}/api/mcp/tokens`, authed({ method: 'POST', body }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'tenant_not_owned', message: 'not yours' });
  });

  it('409 token_limit passes through with status + error code', async () => {
    client.createMcpToken.mockRejectedValueOnce(upstreamError(409, { error: 'token_limit', message: 'max 10' }));
    const res = await fetch(`${base}/api/mcp/tokens`, authed({ method: 'POST', body }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'token_limit', message: 'max 10' });
  });

  it('upstream 400 validation passes through as 400', async () => {
    client.createMcpToken.mockRejectedValueOnce(upstreamError(400, { error: 'validation_failed', details: [] }));
    const res = await fetch(`${base}/api/mcp/tokens`, authed({ method: 'POST', body }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'validation_failed' });
  });

  it('upstream 5xx becomes 502 upstream_error', async () => {
    client.listMcpTokens.mockRejectedValueOnce(upstreamError(503, { error: 'db_down' }));
    const res = await fetch(`${base}/api/mcp/tokens`, authed());
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'upstream_error', service: 'omnimind' });
  });
});

describe('DELETE /mcp/tokens/:id', () => {
  it('204 and revokes with the JWT user + id', async () => {
    const res = await fetch(`${base}/api/mcp/tokens/tok_1`, authed({ method: 'DELETE' }));
    expect(res.status).toBe(204);
    expect(client.revokeMcpToken).toHaveBeenCalledWith('jwt-user-1', 'tok_1');
  });

  it('404 from OmniMind (someone else\'s token) passes through', async () => {
    client.revokeMcpToken.mockRejectedValueOnce(upstreamError(404, { error: 'not_found' }));
    const res = await fetch(`${base}/api/mcp/tokens/tok_other`, authed({ method: 'DELETE' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'not_found' });
  });
});

describe('GET /mcp/tokens/connect-info', () => {
  it('env unset → mcpUrl null, appUrl = request origin, oauthEnabled false; no upstream call', async () => {
    const res = await fetch(`${base}/api/mcp/tokens/connect-info`, authed());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mcpUrl: null, appUrl: base, oauthEnabled: false });
    expect(client.listMcpTokens).not.toHaveBeenCalled();
    expect(client.getMcpTokenOptions).not.toHaveBeenCalled();
  });

  it('env set → values are read live (trimmed) and oauthEnabled reflects the issuer', async () => {
    setEnv('OMNIMIND_MCP_PUBLIC_URL', ' https://omnimind-mcp-production.up.railway.app/mcp ');
    setEnv('APP_PUBLIC_URL', 'https://app.boardroom.example');
    setEnv('OMNIMIND_MCP_OAUTH_ISSUER', 'https://auth.example');
    const res = await fetch(`${base}/api/mcp/tokens/connect-info`, authed());
    expect(await res.json()).toEqual({
      mcpUrl: 'https://omnimind-mcp-production.up.railway.app/mcp',
      appUrl: 'https://app.boardroom.example',
      oauthEnabled: true,
    });
  });

  it('a blank OAuth issuer counts as disabled', async () => {
    setEnv('OMNIMIND_MCP_OAUTH_ISSUER', '   ');
    const res = await fetch(`${base}/api/mcp/tokens/connect-info`, authed());
    expect((await res.json()).oauthEnabled).toBe(false);
  });
});

describe('mount', () => {
  it('app.ts mounts /mcp/tokens behind requireSubscription', async () => {
    const { createApp } = await import('../../src/app');
    const app = createApp();
    const layer = (app as unknown as { _router: { stack: Array<{ regexp: RegExp; handle: { name?: string; stack?: unknown[] } }> } })._router.stack
      .find((l) => l.regexp.test('/mcp/tokens') && l.handle.name === 'requireSubscription');
    expect(layer).toBeDefined();
  });
});
