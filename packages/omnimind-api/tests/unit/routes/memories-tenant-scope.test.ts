/**
 * O-105 / F-206 / F-104 — route-level tenant-scoping checks, run against the
 * real Express app with the Prisma client mocked (no database needed).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

const mockPrisma = vi.hoisted(() => ({
  memoryEntry: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), findFirst: vi.fn() },
  mcpAuditLog: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), create: vi.fn() },
  agent: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), update: vi.fn() },
  tenant: { count: vi.fn().mockResolvedValue(0) },
  contradictionAlert: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
  user: { findUnique: vi.fn() },
  $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
  $disconnect: vi.fn(),
}));
vi.mock('../../../src/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import app from '../../../src/index';
import { __resetApiKeyForTest } from '../../../src/middleware/auth';
import { __resetAdminAuthForTest } from '../../../src/middleware/admin-auth';

const API_KEY = 'test-api-key';
const legacyAgent = { 'x-agent-id': 'agent-a', 'x-tenant-id': 'josh-business', 'x-source-weight': '1.0' };

beforeAll(() => {
  process.env.OMNIMIND_API_KEY = API_KEY;
  __resetApiKeyForTest();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.memoryEntry.findMany.mockResolvedValue([]);
  mockPrisma.memoryEntry.count.mockResolvedValue(0);
  __resetAdminAuthForTest();
});

describe('GET /memories tenant override (O-105)', () => {
  it('403 when an agent passes ?tenantId= for a different tenant', async () => {
    const res = await request(app).get('/memories?tenantId=tgfc-ministry')
      .set('x-api-key', API_KEY).set('x-user-id', 'cuser00000000000000000001').set(legacyAgent);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('tenant_mismatch');
    expect(mockPrisma.memoryEntry.findMany).not.toHaveBeenCalled();
  });

  it('200 when ?tenantId= equals the agent tenant', async () => {
    const res = await request(app).get('/memories?tenantId=josh-business')
      .set('x-api-key', API_KEY).set('x-user-id', 'cuser00000000000000000001').set(legacyAgent);
    expect(res.status).toBe(200);
    expect(mockPrisma.memoryEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: 'josh-business' }),
    }));
  });

  it('?includeAllTenants=true is ignored for a non-admin agent (still 403)', async () => {
    delete process.env.OMNIMIND_ADMIN_KEY;
    const res = await request(app).get('/memories?tenantId=tgfc-ministry&includeAllTenants=true')
      .set('x-api-key', API_KEY).set('x-user-id', 'cuser00000000000000000001').set(legacyAgent);
    expect(res.status).toBe(403);
  });

  it('admin (x-admin-key) + includeAllTenants=true may cross tenants', async () => {
    process.env.OMNIMIND_ADMIN_KEY = 'adm';
    const res = await request(app).get('/memories?tenantId=tgfc-ministry&includeAllTenants=true')
      .set('x-api-key', API_KEY).set('x-admin-key', 'adm').set('x-user-id', 'cuser00000000000000000001').set(legacyAgent);
    expect(res.status).toBe(200);
    expect(mockPrisma.memoryEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: 'tgfc-ministry' }),
    }));
    delete process.env.OMNIMIND_ADMIN_KEY;
  });
});

describe('GET /mcp/audit + /mcp/agents default scope (F-206)', () => {
  it('scopes to the agent tenant and ignores nothing silently', async () => {
    const res = await request(app).get('/mcp/audit').set('x-api-key', API_KEY).set(legacyAgent);
    expect(res.status).toBe(200);
    expect(mockPrisma.mcpAuditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'josh-business' } }));
  });

  it('403 when an agent asks for another tenant', async () => {
    const res = await request(app).get('/mcp/agents?tenantId=tgfc-ministry').set('x-api-key', API_KEY).set(legacyAgent);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('tenant_mismatch');
  });

  it('400 with no agent context and no explicit opt-in (never a silent all-tenants default)', async () => {
    const res = await request(app).get('/mcp/audit').set('x-api-key', API_KEY);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('tenant_scope_required');
  });

  it('explicit ?includeAllTenants=true without context lists everything', async () => {
    const res = await request(app).get('/mcp/agents?includeAllTenants=true').set('x-api-key', API_KEY);
    expect(res.status).toBe(200);
    expect(mockPrisma.agent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});

describe('/admin requires x-admin-key (F-104) and never defaults to all tenants', () => {
  it('401 without x-admin-key when the key is configured', async () => {
    process.env.OMNIMIND_ADMIN_KEY = 'adm';
    const res = await request(app).get('/admin/stats').set('x-api-key', API_KEY);
    expect(res.status).toBe(401);
    delete process.env.OMNIMIND_ADMIN_KEY;
  });

  it('400 tenant_scope_required with a valid admin key but no context and no opt-in', async () => {
    process.env.OMNIMIND_ADMIN_KEY = 'adm';
    const res = await request(app).get('/admin/stats').set('x-api-key', API_KEY).set('x-admin-key', 'adm');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('tenant_scope_required');
    delete process.env.OMNIMIND_ADMIN_KEY;
  });

  it('/admin/contradictions (F-210) scopes to x-user-id', async () => {
    process.env.OMNIMIND_ADMIN_KEY = 'adm';
    const res = await request(app).get('/admin/contradictions').set('x-api-key', API_KEY).set('x-admin-key', 'adm').set('x-user-id', 'cuser00000000000000000001');
    expect(res.status).toBe(200);
    expect(mockPrisma.contradictionAlert.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { resolvedAt: null, userId: 'cuser00000000000000000001' },
    }));
    delete process.env.OMNIMIND_ADMIN_KEY;
  });

  it('POST /mcp/agents is admin-gated', async () => {
    process.env.OMNIMIND_ADMIN_KEY = 'adm';
    const res = await request(app).post('/mcp/agents').set('x-api-key', API_KEY)
      .send({ name: 'x', apiKeyHash: 'a'.repeat(64), tenantId: 't' });
    expect(res.status).toBe(401);
    delete process.env.OMNIMIND_ADMIN_KEY;
  });
});
