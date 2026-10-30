/**
 * Lane G item 4 — a non-gateway `omk_` agent key acts only for its tenant's
 * owner.
 *
 * Before: a verified agent key (x-agent-key) could send any `x-user-id` /
 * `?userId=` / `body.userId` and read or write that user's data. The Agent
 * row has no user column, but it is bound to exactly one Tenant, and
 * `Tenant.ownerUserId` names the user that tenant belongs to. Now:
 *
 *   - non-gateway agent (no `mcp:delegate`), tenant has an owner → the context
 *     is pinned to that user (`userId`, `ownerBound: true`) and
 *     delegatedUserIsolation refuses any other user (403 `user_mismatch`)
 *   - tenant without an owner → unbound (warned once) — solo setups that never
 *     set an owner keep working; the runbook's operator step 2 sets one
 *   - gateway agents (`mcp:delegate`) are untouched: delegated principals are
 *     pinned by x-mcp-principal as before, and a bare gateway acts for no user
 *
 * The route allow-list stays delegated-only: an owner-bound agent keeps the
 * same routes it had, only the user is pinned.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHash } from 'crypto';

const mockPrisma = vi.hoisted(() => ({
  agent: { findFirst: vi.fn(), update: vi.fn() },
  tenant: { findUnique: vi.fn() },
  mcpToken: { findUnique: vi.fn(), update: vi.fn() },
  mcpOauthIdentity: { findUnique: vi.fn(), update: vi.fn() },
}));
const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('../../../src/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('../../../src/lib/logger', () => ({ logger: mockLogger }));

import { agentContextMiddleware, __resetAgentContextStateForTest } from '../../../src/middleware/agent-context';
import { delegatedUserIsolation } from '../../../src/middleware/delegated-user-isolation';
import { __resetMcpTokenStateForTest } from '../../../src/services/mcp-token.service';

const OWNER = 'user-synthetic-owner';
const OTHER = 'user-synthetic-other';

const AGENT_KEY = 'omk_synthetic_agent_key';
const AGENT = {
  id: 'cagent_synthetic_000000001',
  name: 'synthetic-code-agent',
  apiKeyHash: createHash('sha256').update(AGENT_KEY).digest('hex'),
  tenantId: 'synthetic-business',
  scopes: ['memory:read', 'memory:write'],
  sourceWeight: 1.0,
  createdAt: new Date(),
  lastSeenAt: null,
};
const GATEWAY_KEY = 'omk_synthetic_gateway_key';
const GATEWAY = {
  ...AGENT,
  id: 'cgateway_synthetic_0000001',
  name: 'synthetic-gateway',
  apiKeyHash: createHash('sha256').update(GATEWAY_KEY).digest('hex'),
  tenantId: 'synthetic-gateway-tenant',
  scopes: ['mcp:delegate', 'memory:read', 'memory:write'],
};
const TOKEN = {
  id: 'ctoken_synthetic_000000001',
  userId: OWNER,
  tenantId: 'synthetic-business',
  name: 'Synthetic Desktop',
  agentName: 'mcp-token:synthetic-desktop-000001',
  prefix: 'omt_synthetic',
  tokenHash: 'h'.repeat(64),
  scopes: ['memory:read'],
  sourceWeight: 0.8,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
};

function app() {
  const a = express();
  a.use(express.json());
  a.use(agentContextMiddleware);
  a.use(delegatedUserIsolation);
  const echo = (req: express.Request, res: express.Response) => {
    res.json({
      xUserId: req.headers['x-user-id'] ?? null,
      queryUserId: (req.query as Record<string, unknown>).userId ?? null,
      bodyUserId: (req.body as Record<string, unknown> | undefined)?.userId ?? null,
      ctx: req.agentContext ?? null,
    });
  };
  a.get('/memories', echo);
  a.post('/memories', echo);
  a.get('/user-profile', echo);
  return a;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetAgentContextStateForTest();
  __resetMcpTokenStateForTest();
  mockPrisma.agent.update.mockResolvedValue({});
  mockPrisma.mcpToken.update.mockResolvedValue({});
  mockPrisma.agent.findFirst.mockImplementation(async ({ where }: { where: { apiKeyHash: string } }) =>
    [AGENT, GATEWAY].find(a => a.apiKeyHash === where.apiKeyHash) ?? null);
  mockPrisma.tenant.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id === 'synthetic-business' ? { ownerUserId: OWNER } : { ownerUserId: null });
});

describe('agent key → tenant owner binding (lane G item 4)', () => {
  it('a non-gateway agent key may NOT act for another user (x-user-id) → 403 user_mismatch', async () => {
    const res = await request(app()).get('/memories').set('x-agent-key', AGENT_KEY).set('x-user-id', OTHER);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'user_mismatch', field: 'x-user-id' });
  });

  it('…nor via ?userId= or body.userId', async () => {
    const q = await request(app()).get(`/memories?userId=${OTHER}`).set('x-agent-key', AGENT_KEY);
    expect(q.status).toBe(403);
    const b = await request(app()).post('/memories').set('x-agent-key', AGENT_KEY).send({ userId: OTHER, content: 'x' });
    expect(b.status).toBe(403);
  });

  it('acting for the tenant owner works, and a missing userId is filled in from the owner', async () => {
    const same = await request(app()).get('/memories').set('x-agent-key', AGENT_KEY).set('x-user-id', OWNER);
    expect(same.status).toBe(200);
    expect(same.body.ctx).toMatchObject({ verified: true, userId: OWNER, ownerBound: true });
    expect(same.body.ctx.delegated).toBeUndefined();

    const filled = await request(app()).post('/memories').set('x-agent-key', AGENT_KEY).send({ content: 'x' });
    expect(filled.status).toBe(200);
    expect(filled.body).toMatchObject({ xUserId: OWNER, queryUserId: OWNER, bodyUserId: OWNER });
  });

  it('an owner-bound agent is NOT subject to the delegated route allow-list (same routes as before)', async () => {
    const res = await request(app()).get('/user-profile').set('x-agent-key', AGENT_KEY).set('x-user-id', OWNER);
    expect(res.status).toBe(200);
  });

  it('tenant without an owner → unbound (solo setups keep working), warned once', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ ownerUserId: null });
    const res = await request(app()).get('/memories').set('x-agent-key', AGENT_KEY).set('x-user-id', OTHER);
    expect(res.status).toBe(200);
    expect(res.body.ctx.ownerBound).toBeUndefined();
    await request(app()).get('/memories').set('x-agent-key', AGENT_KEY).set('x-user-id', OTHER);
    const warns = mockLogger.warn.mock.calls.filter(c => String(c[0]).includes('no owner'));
    expect(warns).toHaveLength(1);
  });

  it('the tenant owner lookup is cached (one query for repeated calls)', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app()).get('/memories').set('x-agent-key', AGENT_KEY).set('x-user-id', OWNER);
    }
    expect(mockPrisma.tenant.findUnique).toHaveBeenCalledTimes(1);
  });

  it('tenant lookup failure fails CLOSED (503), never unbound', async () => {
    mockPrisma.tenant.findUnique.mockRejectedValue(new Error('db down'));
    const res = await request(app()).get('/memories').set('x-agent-key', AGENT_KEY).set('x-user-id', OTHER);
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'agent_lookup_failed' });
  });

  it('gateway agents are untouched: a bare gateway does not look up a tenant owner and is unbound', async () => {
    const res = await request(app()).get('/memories').set('x-agent-key', GATEWAY_KEY).set('x-user-id', OTHER);
    expect(res.status).toBe(200);
    expect(res.body.ctx.ownerBound).toBeUndefined();
    expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('gateway + x-mcp-principal: still pinned to the principal\'s user (unchanged)', async () => {
    mockPrisma.mcpToken.findUnique.mockResolvedValue(TOKEN);
    const bad = await request(app()).get('/memories').set('x-agent-key', GATEWAY_KEY).set('x-mcp-principal', `token:${TOKEN.id}`).set('x-user-id', OTHER);
    expect(bad.status).toBe(403);
    expect(bad.body).toMatchObject({ error: 'user_mismatch' });
    const ok = await request(app()).get('/memories').set('x-agent-key', GATEWAY_KEY).set('x-mcp-principal', `token:${TOKEN.id}`);
    expect(ok.status).toBe(200);
    expect(ok.body.ctx).toMatchObject({ delegated: true, userId: OWNER });
    expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('no agent headers (BoardRoom, service key only) → untouched', async () => {
    const res = await request(app()).get('/memories').set('x-user-id', OTHER);
    expect(res.status).toBe(200);
    expect(res.body.ctx).toBeNull();
  });
});
