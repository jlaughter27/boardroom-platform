import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';

const mockPrisma = vi.hoisted(() => ({
  agent: { findFirst: vi.fn(), update: vi.fn() },
}));
const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../../../src/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('../../../src/lib/logger', () => ({ logger: mockLogger }));

import { agentContextMiddleware, parseSourceWeight, __resetAgentContextStateForTest } from '../../../src/middleware/agent-context';

const RAW_KEY = 'omk_test_1234567890';
const HASH = createHash('sha256').update(RAW_KEY).digest('hex');
const AGENT_ROW = {
  id: 'cagent000000000000000001',
  name: 'claude-code-josh',
  apiKeyHash: HASH,
  tenantId: 'josh-business',
  scopes: ['memory:read', 'memory:write'],
  sourceWeight: 1.0,
  createdAt: new Date(),
  lastSeenAt: null,
};

function mk(headers: Record<string, string>, path = '/memories') {
  const req = { path, headers, ip: '127.0.0.1' } as unknown as Request;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

describe('parseSourceWeight (F-217)', () => {
  it('accepts plain decimals in [0,2] and treats absent/empty as null', () => {
    expect(parseSourceWeight(undefined)).toEqual({ ok: true, value: null });
    expect(parseSourceWeight('')).toEqual({ ok: true, value: null });
    expect(parseSourceWeight('1')).toEqual({ ok: true, value: 1 });
    expect(parseSourceWeight('1.5')).toEqual({ ok: true, value: 1.5 });
    expect(parseSourceWeight('0')).toEqual({ ok: true, value: 0 });
  });
  it('rejects hex, exponent, negative, out-of-range and garbage instead of clamping', () => {
    for (const bad of ['0xFF', '1e10', '1e308', '-1', '2.1', 'abc', 'Infinity', 'NaN', '1,5']) {
      expect(parseSourceWeight(bad).ok).toBe(false);
    }
  });
});

describe('agentContextMiddleware (M-103)', () => {
  const envBackup = process.env.OMNIMIND_REQUIRE_AGENT_KEY;
  beforeEach(() => {
    vi.clearAllMocks();
    __resetAgentContextStateForTest();
    delete process.env.OMNIMIND_REQUIRE_AGENT_KEY;
    mockPrisma.agent.update.mockResolvedValue(AGENT_ROW);
  });
  afterEach(() => {
    if (envBackup === undefined) delete process.env.OMNIMIND_REQUIRE_AGENT_KEY; else process.env.OMNIMIND_REQUIRE_AGENT_KEY = envBackup;
  });

  it('x-agent-key: looks up sha256(key) and builds a VERIFIED context from the agent row', async () => {
    mockPrisma.agent.findFirst.mockResolvedValue(AGENT_ROW);
    const { req, res, next } = mk({ 'x-agent-key': RAW_KEY });
    await agentContextMiddleware(req, res, next);
    expect(mockPrisma.agent.findFirst).toHaveBeenCalledWith({ where: { apiKeyHash: HASH } });
    expect(next).toHaveBeenCalledWith();
    expect(req.agentContext).toEqual({
      agentId: 'claude-code-josh',
      tenantId: 'josh-business',
      sourceWeight: 1.0,
      scopes: ['memory:read', 'memory:write'],
      verified: true,
    });
  });

  it('x-agent-key: unknown key → 401', async () => {
    mockPrisma.agent.findFirst.mockResolvedValue(null);
    const { req, res, next } = mk({ 'x-agent-key': 'omk_bogus', 'x-agent-id': 'whoever' });
    await agentContextMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_agent_key' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('x-agent-key: a disagreeing x-tenant-id / x-source-weight / x-agent-id → 403 naming the fields', async () => {
    mockPrisma.agent.findFirst.mockResolvedValue(AGENT_ROW);
    const { req, res, next } = mk({ 'x-agent-key': RAW_KEY, 'x-tenant-id': 'tgfc-ministry', 'x-source-weight': '2', 'x-agent-id': 'someone-else' });
    await agentContextMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'agent_header_mismatch',
      fields: ['x-agent-id', 'x-tenant-id', 'x-source-weight'],
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('x-agent-key: agreeing legacy headers are accepted (x-agent-id may be the name or the row id)', async () => {
    mockPrisma.agent.findFirst.mockResolvedValue(AGENT_ROW);
    const a = mk({ 'x-agent-key': RAW_KEY, 'x-agent-id': 'claude-code-josh', 'x-tenant-id': 'josh-business', 'x-source-weight': '1.0' });
    await agentContextMiddleware(a.req, a.res, a.next);
    expect(a.next).toHaveBeenCalledWith();
    const b = mk({ 'x-agent-key': RAW_KEY, 'x-agent-id': AGENT_ROW.id });
    await agentContextMiddleware(b.req, b.res, b.next);
    expect(b.next).toHaveBeenCalledWith();
  });

  it('x-agent-key: lastSeenAt is touched at most once per 5 minutes per agent', async () => {
    mockPrisma.agent.findFirst.mockResolvedValue(AGENT_ROW);
    for (let i = 0; i < 5; i++) {
      const { req, res, next } = mk({ 'x-agent-key': RAW_KEY });
      await agentContextMiddleware(req, res, next);
    }
    expect(mockPrisma.agent.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.agent.update).toHaveBeenCalledWith({ where: { id: AGENT_ROW.id }, data: { lastSeenAt: expect.any(Date) } });
  });

  it('x-agent-key: DB failure during lookup fails CLOSED (503), not unscoped', async () => {
    mockPrisma.agent.findFirst.mockRejectedValue(new Error('db down'));
    const { req, res, next } = mk({ 'x-agent-key': RAW_KEY });
    await agentContextMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('legacy: full header triple without a key is trusted (verified:false) and warned once per agent id', async () => {
    const h = { 'x-agent-id': 'legacy-agent', 'x-tenant-id': 'josh-personal', 'x-source-weight': '0.8' };
    const a = mk(h); await agentContextMiddleware(a.req, a.res, a.next);
    const b = mk(h); await agentContextMiddleware(b.req, b.res, b.next);
    expect(a.req.agentContext).toEqual({ agentId: 'legacy-agent', tenantId: 'josh-personal', sourceWeight: 0.8, verified: false });
    expect(a.req.agentContext?.scopes).toBeUndefined();
    const legacyWarns = mockLogger.warn.mock.calls.filter(c => String(c[0]).includes('unverified legacy header identity'));
    expect(legacyWarns).toHaveLength(1);
    expect(mockPrisma.agent.findFirst).not.toHaveBeenCalled(); // no x-api-key hash fallback any more
  });

  it('OMNIMIND_REQUIRE_AGENT_KEY=true: x-agent-id without x-agent-key → 401', async () => {
    process.env.OMNIMIND_REQUIRE_AGENT_KEY = 'true';
    const { req, res, next } = mk({ 'x-agent-id': 'legacy-agent', 'x-tenant-id': 'josh-personal', 'x-source-weight': '1' });
    await agentContextMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'agent_key_required' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('F-217: malformed x-source-weight → 400 (never clamped)', async () => {
    const { req, res, next } = mk({ 'x-agent-id': 'a', 'x-tenant-id': 't', 'x-source-weight': '1e308' });
    await agentContextMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_source_weight' }));
  });

  it('no agent headers at all → no context, no DB call (BoardRoom AI path)', async () => {
    const { req, res, next } = mk({ 'x-api-key': 'shared', 'x-user-id': 'u' });
    await agentContextMiddleware(req, res, next);
    expect(req.agentContext).toBeUndefined();
    expect(mockPrisma.agent.findFirst).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });
});
