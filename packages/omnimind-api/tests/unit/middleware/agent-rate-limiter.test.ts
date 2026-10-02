import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { agentRateLimiter, classifyOp, agentKeyFor, NON_AGENT_MULTIPLIER } from '../../../src/middleware/agent-rate-limiter';


const mkRes = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }) as unknown as Response;

describe('agentRateLimiter', () => {
  it('M-106: POST /mcp/audit is classified into its own audit bucket', () => {
    expect(classifyOp({ method: 'POST', path: '/mcp/audit' } as Request)).toBe('audit');
    expect(classifyOp({ method: 'POST', path: '/memories' } as Request)).toBe('write');
    expect(classifyOp({ method: 'GET', path: '/memories' } as Request)).toBe('read');
    expect(classifyOp({ method: 'POST', path: '/decisions' } as Request)).toBe('decision');
  });

  it('M-106: audit POSTs do not consume the write budget', () => {
    const agent = `agent-${Date.now()}`;
    const next = vi.fn();
    const res = mkRes();
    const audit = { method: 'POST', path: '/mcp/audit', headers: { 'x-agent-id': agent } } as unknown as Request;
    const write = { method: 'POST', path: '/memories', headers: { 'x-agent-id': agent } } as unknown as Request;
    for (let i = 0; i < 250; i++) agentRateLimiter(audit, res, next); // > WRITE_LIMIT (200)
    agentRateLimiter(write, res, next);
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(251);
  });

  it('F-105: no x-agent-id → bucketed by IP (widened budget), never skipped', () => {
    const next = vi.fn();
    const res = mkRes();
    const limit = 200 * NON_AGENT_MULTIPLIER; // WRITE_LIMIT default × multiplier
    const req = { method: 'POST', path: '/memories', headers: {}, ip: `192.0.2.${Date.now() % 250}` } as unknown as Request;
    for (let i = 0; i < limit + 1; i++) agentRateLimiter(req, res, next);
    expect(next).toHaveBeenCalledTimes(limit);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'agent_rate_limited', message: expect.stringContaining('ip:') }));
  });

  it('key precedence: agent context → x-agent-id → x-user-id → ip', () => {
    expect(agentKeyFor({ headers: { 'x-agent-id': 'h', 'x-user-id': 'u' }, agentContext: { agentId: 'ctx', tenantId: 't', sourceWeight: 1 } } as unknown as Request)).toEqual({ key: 'agent:ctx', isAgent: true });
    expect(agentKeyFor({ headers: { 'x-agent-id': 'h', 'x-user-id': 'u' } } as unknown as Request)).toEqual({ key: 'agent:h', isAgent: true });
    expect(agentKeyFor({ headers: { 'x-user-id': 'u' }, ip: '1.1.1.1' } as unknown as Request)).toEqual({ key: 'user:u', isAgent: false });
    expect(agentKeyFor({ headers: {}, ip: '1.1.1.1' } as unknown as Request)).toEqual({ key: 'ip:1.1.1.1', isAgent: false });
  });


  it('prefers the resolved agent context over the raw header', () => {
    const next = vi.fn();
    const res = mkRes();
    const ctxAgent = `ctx-${Date.now()}`;
    const req = { method: 'GET', path: '/memories', headers: { 'x-agent-id': 'spoofed' }, agentContext: { agentId: ctxAgent, tenantId: 't', sourceWeight: 1 } } as unknown as Request;
    agentRateLimiter(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
