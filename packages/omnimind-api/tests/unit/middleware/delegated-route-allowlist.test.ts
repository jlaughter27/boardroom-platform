/**
 * Identity review 2026-10-18 (A1 / A3 / A4) — a DELEGATED principal (gateway +
 * x-mcp-principal) may reach ONLY the routes the MCP tools call. This test
 * walks EVERY prefix mounted in src/index.ts through the real Express app
 * (Prisma mocked) with a principal that holds every grantable scope, so a
 * 403 can only come from the allow-list, never from scope enforcement:
 *
 *   - every mounted prefix must be classified below (a new `app.use('/x')`
 *     without a decision here fails the test)
 *   - forbidden prefixes → 403 delegated_route_forbidden and the handler
 *     never ran (no Prisma call beyond identity resolution)
 *   - allowed routes → anything but that 403
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const mockPrisma = vi.hoisted(() => {
  const model = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    upsert: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    aggregate: vi.fn().mockResolvedValue({}),
    groupBy: vi.fn().mockResolvedValue([]),
  });
  const models = [
    'memoryEntry', 'mcpAuditLog', 'agent', 'tenant', 'mcpToken', 'mcpOauthIdentity', 'user', 'oAuthToken', 'userProfile',
    'person', 'goal', 'project', 'task', 'decision', 'commitment', 'contradictionAlert', 'thinkingPattern', 'weeklyMemo',
    'outcomeReviewNudge', 'customPersona', 'subscription', 'contextCapsule', 'llmUsage', 'memoryEntityLink', 'goalProjectLink',
    'projectTaskLink', 'projectPersonLink', 'decisionProjectLink', 'taskDependency', 'session', 'decisionAssumption',
  ] as const;
  const p: Record<string, ReturnType<typeof model> | unknown> = {};
  for (const m of models) p[m] = model();
  p.$queryRaw = vi.fn().mockResolvedValue([]);
  p.$executeRaw = vi.fn().mockResolvedValue(0);
  p.$transaction = vi.fn(async (arg: unknown) => (typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(p) : Promise.all(arg as Promise<unknown>[])));
  p.$disconnect = vi.fn();
  return p as Record<string, ReturnType<typeof model>> & { $queryRaw: ReturnType<typeof vi.fn> };
});
vi.mock('../../../src/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import app from '../../../src/index';
import { __resetApiKeyForTest } from '../../../src/middleware/auth';
import { __resetAgentContextStateForTest } from '../../../src/middleware/agent-context';
import { __resetMcpTokenStateForTest } from '../../../src/services/mcp-token.service';
import { DELEGATED_ROUTE_FORBIDDEN } from '../../../src/middleware/delegated-user-isolation';

const API_KEY = 'test-api-key';
const USER = 'cuser00000000000000000001';
const TENANT = 'josh-business';
const GATEWAY_KEY = 'omk_gateway';
const ALL_SCOPES = ['memory:read', 'memory:write', 'decision:write', 'task:write', 'commitment:write', 'project:write', 'code:write'];
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const GATEWAY = { id: 'cgateway000000000000000001', name: 'mcp-gateway', apiKeyHash: hash(GATEWAY_KEY), tenantId: 'gw', scopes: ['mcp:delegate', ...ALL_SCOPES], sourceWeight: 1, createdAt: new Date(), lastSeenAt: null };
const TOKEN = {
  id: 'ctoken0000000000000000001', userId: USER, tenantId: TENANT, name: 'Full', agentName: 'mcp-token:full-00000001',
  prefix: 'omt_abcdefgh', tokenHash: 'h'.repeat(64), scopes: ALL_SCOPES, sourceWeight: 1,
  createdAt: new Date('2026-10-01T00:00:00Z'), lastUsedAt: null, expiresAt: null, revokedAt: null,
};

/** Mounted prefixes, read from the source so the classification can never drift. */
function mountedPrefixes(): string[] {
  const src = readFileSync(resolve(__dirname, '../../../src/index.ts'), 'utf8');
  const out = new Set<string>();
  for (const m of src.matchAll(/app\.use\(\s*'(\/[a-z-]+)'/g)) out.add(m[1]);
  return [...out].sort();
}

// ── Classification ──────────────────────────────────────────────────────────
// /ready (M0-A2) is mounted ahead of every auth middleware, like /health is exempted from them.
const PUBLIC = ['/health', '/ready'];
const ALLOWED_FAMILIES = ['/memories', '/context', '/decisions', '/tasks', '/goals', '/projects', '/people', '/commitments', '/graph'];
const FORBIDDEN_FAMILIES = ['/auth', '/oauth', '/admin', '/subscription', '/custom-personas', '/user-profile', '/outcome-reviews', '/relationships', '/cortex'];
/** Prefixes with an exact-route carve-out: everything else under them is forbidden. */
const PARTIAL: Record<string, { allowed: Array<[string, string]>; forbidden: Array<[string, string]> }> = {
  '/mcp': {
    allowed: [['POST', '/mcp/audit'], ['GET', '/mcp/audit']],
    forbidden: [
      ['GET', '/mcp/audit/stats'], ['GET', '/mcp/agents'], ['POST', '/mcp/agents'],
      ['POST', '/mcp/tokens'], ['GET', '/mcp/tokens'], ['GET', '/mcp/tokens/options'], ['DELETE', '/mcp/tokens/ctokenother000000000001'],
      ['POST', '/mcp/tokens/introspect'], ['POST', '/mcp/identities/resolve'],
      ['GET', '/mcp/identities'], ['PATCH', '/mcp/identities/cident1'], ['DELETE', '/mcp/identities/cident1'],
    ],
  },
  '/usage': {
    allowed: [['POST', '/usage/llm']],
    forbidden: [['GET', '/usage/llm/summary'], ['GET', '/usage/llm']],
  },
};

/** Representative deeper paths per forbidden family (the ones the review exploited). */
const FORBIDDEN_SAMPLES: Array<[string, string]> = [
  ['GET', '/auth/user/cuser00000000000000000002'], ['POST', '/auth/login'], ['POST', '/auth/verify'], ['POST', '/auth/register'],
  ['GET', '/oauth/token/google'], ['POST', '/oauth/token'], ['DELETE', '/oauth/token/google'],
  ['GET', '/admin/stats'], ['GET', '/admin/tenants'], ['PATCH', '/admin/tenants/josh-business'], ['POST', '/admin/summarize'],
  ['GET', '/subscription'], ['PATCH', '/subscription'], ['GET', '/user-profile'], ['PATCH', '/user-profile'],
  ['GET', '/custom-personas'], ['POST', '/custom-personas'], ['GET', '/outcome-reviews'], ['GET', '/outcome-reviews/pending'],
  ['GET', '/relationships/graph'], ['GET', '/cortex/patterns'], ['POST', '/cortex/simulate'], ['GET', '/cortex/memo/latest'],
  // carve-out inside an allowed family: operator maintenance, no MCP tool calls it
  ['POST', '/memories/backfill-embeddings'],
];

/** What the MCP gateway actually calls for a delegated session (lib/client.ts + the entity families). */
const ALLOWED_SAMPLES: Array<[string, string]> = [
  ['GET', '/memories'], ['POST', '/memories'], ['GET', '/memories/cmem1'], ['PATCH', '/memories/cmem1'],
  ['POST', '/memories/search'], ['POST', '/memories/search-similar'], ['POST', '/memories/validate'],
  ['POST', '/context/for-persona'], ['POST', '/context/reflect'], ['GET', '/context/capsules'], ['GET', '/context/core'],
  ['GET', '/decisions'], ['POST', '/decisions'], ['GET', '/tasks'], ['POST', '/tasks'], ['PATCH', '/tasks/ct1'],
  ['GET', '/goals/cg1'], ['GET', '/projects'], ['GET', '/people/cp1'], ['GET', '/people/duplicates'],
  ['GET', '/commitments'], ['GET', '/commitments/nudges'], ['POST', '/commitments'],
  ['GET', '/graph'], ['GET', '/graph/backlinks/goal:cg1'],
  ['POST', '/mcp/audit'], ['GET', '/mcp/audit'], ['POST', '/usage/llm'],
];

const IDENTITY_FNS = new Set([mockPrisma.agent.findFirst, mockPrisma.agent.update, mockPrisma.mcpToken.findUnique, mockPrisma.mcpToken.update]);
/** Prisma calls made by a route HANDLER (identity resolution excluded). */
function handlerPrismaCalls(): number {
  let n = 0;
  for (const [key, value] of Object.entries(mockPrisma)) {
    if (key.startsWith('$')) { n += (value as ReturnType<typeof vi.fn>).mock?.calls.length ?? 0; continue; }
    for (const fn of Object.values(value as Record<string, ReturnType<typeof vi.fn>>)) {
      if (IDENTITY_FNS.has(fn)) continue;
      n += fn.mock.calls.length;
    }
  }
  return n;
}

beforeAll(() => { process.env.OMNIMIND_API_KEY = API_KEY; __resetApiKeyForTest(); });
beforeEach(() => {
  vi.clearAllMocks();
  __resetAgentContextStateForTest();
  __resetMcpTokenStateForTest();
  delete process.env.OMNIMIND_ADMIN_KEY;
  mockPrisma.agent.findFirst.mockImplementation(async ({ where }: { where: { apiKeyHash: string } }) => where.apiKeyHash === GATEWAY.apiKeyHash ? GATEWAY : null);
  mockPrisma.agent.update.mockResolvedValue(GATEWAY);
  mockPrisma.mcpToken.findUnique.mockResolvedValue(TOKEN);
  mockPrisma.mcpToken.update.mockResolvedValue(TOKEN);
});

function send(method: string, path: string, headers: Record<string, string> = {}) {
  const r = request(app)[method.toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete'](path)
    .set('x-api-key', API_KEY).set('x-agent-key', GATEWAY_KEY).set('x-mcp-principal', `token:${TOKEN.id}`).set('x-admin-key', 'adm');
  for (const [k, v] of Object.entries(headers)) r.set(k, v);
  return method === 'GET' || method === 'DELETE' ? r : r.send({});
}

describe('delegated allow-list — every mounted prefix is classified', () => {
  it('src/index.ts mounts exactly the prefixes this test knows about', () => {
    const classified = [...PUBLIC, ...ALLOWED_FAMILIES, ...FORBIDDEN_FAMILIES, ...Object.keys(PARTIAL)].sort();
    expect(mountedPrefixes()).toEqual(classified);
  });
});

describe('delegated allow-list — forbidden surface (403 delegated_route_forbidden, handler never runs)', () => {
  it.each([...FORBIDDEN_FAMILIES.map(p => ['GET', p] as [string, string]), ...FORBIDDEN_SAMPLES, ...Object.values(PARTIAL).flatMap(p => p.forbidden)])(
    '%s %s',
    async (method, path) => {
      const res = await send(method, path);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: DELEGATED_ROUTE_FORBIDDEN, method, path });
      expect(handlerPrismaCalls()).toBe(0);
    }
  );

  it('holds even when the principal supplies its OWN userId everywhere (the review\'s F1/F2/F3 shape)', async () => {
    const res = await request(app).post('/mcp/tokens')
      .set('x-api-key', API_KEY).set('x-agent-key', GATEWAY_KEY).set('x-mcp-principal', `token:${TOKEN.id}`).set('x-user-id', USER)
      .query({ userId: USER })
      .send({ userId: USER, tenantId: TENANT, name: 'escalated', scopes: ['memory:write', 'decision:write', 'task:write'] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe(DELEGATED_ROUTE_FORBIDDEN);
    expect(mockPrisma.mcpToken.create).not.toHaveBeenCalled();

    const oauth = await send('GET', '/oauth/token/google', { 'x-user-id': USER });
    expect(oauth.status).toBe(403);
    expect(mockPrisma.oAuthToken.findUnique).not.toHaveBeenCalled();

    const victim = await send('GET', '/auth/user/cuser00000000000000000002');
    expect(victim.status).toBe(403);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('delegated allow-list — allowed surface (never the allow-list 403)', () => {
  it.each([...ALLOWED_FAMILIES.map(p => ['GET', p] as [string, string]), ...ALLOWED_SAMPLES, ...Object.values(PARTIAL).flatMap(p => p.allowed)])(
    '%s %s',
    async (method, path) => {
      const res = await send(method, path);
      expect(res.body?.error).not.toBe(DELEGATED_ROUTE_FORBIDDEN);
      expect(res.status).not.toBe(403);
    }
  );
});

describe('delegated allow-list — non-delegated callers are untouched', () => {
  it('BoardRoom (service key + x-user-id) and a plain verified agent can still reach the forbidden families', async () => {
    const br = await request(app).get('/user-profile').set('x-api-key', API_KEY).set('x-user-id', USER);
    expect(br.status).not.toBe(403);
    expect(br.body?.error).not.toBe(DELEGATED_ROUTE_FORBIDDEN);

    const gw = await request(app).get('/mcp/audit/stats').set('x-api-key', API_KEY).set('x-agent-key', GATEWAY_KEY);
    expect(gw.status).toBe(200);
  });
});
