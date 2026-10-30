import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { rateLimiter, rateLimitKeyFor, IP_BUCKET_MULTIPLIER, USER_READ_RATE_LIMIT_PER_MINUTE } from '../../../src/middleware/rate-limiter';
// WS-7: use the real shared constant — the test previously hardcoded 60,
// but `RATE_LIMITS.MAX_QUERIES_PER_MINUTE` is 20 in packages/shared. The
// arithmetic assertions below scale with it.
import { RATE_LIMITS } from '@boardroom/shared';

describe('rateLimiter middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let originalDateNow: () => number;
  // WS-7: the rate-limiter holds bucket state in a module-level Map that
  // outlives a single test. Use a unique user per test so buckets don't
  // collide. Tests that intentionally compare across users override this.
  let testUserId: string;
  let testCounter = 0;

  beforeEach(() => {
    testCounter += 1;
    testUserId = `user-test-${testCounter}-${Date.now()}`;
    mockReq = {
      path: '/memories',
      method: 'GET',
      headers: { 'x-user-id': testUserId },
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
    
    // Mock Date.now()
    originalDateNow = Date.now;
    let currentTime = 1000;
    Date.now = vi.fn(() => currentTime);
    
    // Mock setInterval to not actually run
    vi.spyOn(global, 'setInterval').mockImplementation(() => ({}) as any);
  });

  afterEach(() => {
    Date.now = originalDateNow;
    vi.restoreAllMocks();
  });

  it('should pass through when no user ID is provided', () => {
    mockReq.headers = {};
    rateLimiter(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('should allow requests under the rate limit', () => {
    const underLimit = Math.floor(RATE_LIMITS.MAX_QUERIES_PER_MINUTE / 2);
    for (let i = 0; i < underLimit; i++) {
      rateLimiter(mockReq as Request, mockRes as Response, mockNext);
    }
    expect(mockNext).toHaveBeenCalledTimes(underLimit);
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('should block WRITE requests over the shared rate limit', () => {
    mockReq.method = 'POST';
    // Make MAX+1 requests (one over limit)
    for (let i = 0; i < RATE_LIMITS.MAX_QUERIES_PER_MINUTE + 1; i++) {
      rateLimiter(mockReq as Request, mockRes as Response, mockNext);
    }
    
    // Should have called next for the first MAX, then status 429 for the next
    expect(mockNext).toHaveBeenCalledTimes(RATE_LIMITS.MAX_QUERIES_PER_MINUTE);
    expect(mockRes.status).toHaveBeenCalledWith(429);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'rate_limited',
      message: expect.stringContaining('Rate limit exceeded'),
      retryAfter: expect.any(Number),
    });
  });

  it('should reset bucket after window expires', () => {
    mockReq.method = 'POST';
    // Make MAX requests (at limit)
    for (let i = 0; i < RATE_LIMITS.MAX_QUERIES_PER_MINUTE; i++) {
      rateLimiter(mockReq as Request, mockRes as Response, mockNext);
    }
    
    // Advance time by 61 seconds (just over 1 minute)
    Date.now = vi.fn(() => 1000 + 61 * 1000);
    
    // Should allow new request
    rateLimiter(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalledTimes(RATE_LIMITS.MAX_QUERIES_PER_MINUTE + 1);
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('reads (GET) get the wider per-user budget: one dashboard + graph load is 20–40 GETs (2026-10-20 e2e)', () => {
    expect(USER_READ_RATE_LIMIT_PER_MINUTE).toBeGreaterThanOrEqual(120);
    mockReq.method = 'GET';
    for (let i = 0; i < USER_READ_RATE_LIMIT_PER_MINUTE; i++) {
      rateLimiter(mockReq as Request, mockRes as Response, mockNext);
    }
    expect(mockNext).toHaveBeenCalledTimes(USER_READ_RATE_LIMIT_PER_MINUTE);
    expect(mockRes.status).not.toHaveBeenCalled();
    rateLimiter(mockReq as Request, mockRes as Response, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(429);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ message: `Rate limit exceeded. Max ${USER_READ_RATE_LIMIT_PER_MINUTE} requests per minute.` }));
  });

  it('POST reads (/memories/search, /context/for-persona, …) use the read budget and never drain the write budget (2026-10-23 real-data e2e)', () => {
    mockReq.method = 'POST';
    for (const path of ['/memories/search', '/context/for-persona', '/memories/search-similar', '/memories/validate']) {
      mockReq.path = path;
      for (let i = 0; i < RATE_LIMITS.MAX_QUERIES_PER_MINUTE; i++) rateLimiter(mockReq as Request, mockRes as Response, mockNext);
    }
    expect(mockRes.status).not.toHaveBeenCalled();
    // The write budget is untouched: a full minute of writes still goes through.
    mockReq.path = '/memories';
    for (let i = 0; i < RATE_LIMITS.MAX_QUERIES_PER_MINUTE; i++) rateLimiter(mockReq as Request, mockRes as Response, mockNext);
    expect(mockRes.status).not.toHaveBeenCalled();
    rateLimiter(mockReq as Request, mockRes as Response, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(429);
  });

  it('POST reads share one read bucket with GET', () => {
    mockReq.method = 'GET';
    for (let i = 0; i < USER_READ_RATE_LIMIT_PER_MINUTE - 1; i++) rateLimiter(mockReq as Request, mockRes as Response, mockNext);
    mockReq.method = 'POST'; mockReq.path = '/memories/search';
    rateLimiter(mockReq as Request, mockRes as Response, mockNext);
    expect(mockRes.status).not.toHaveBeenCalled();
    rateLimiter(mockReq as Request, mockRes as Response, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(429);
  });

  it('the read budget never drops below the shared write budget', () => {
    expect(USER_READ_RATE_LIMIT_PER_MINUTE).toBeGreaterThanOrEqual(RATE_LIMITS.MAX_QUERIES_PER_MINUTE);
  });

  it('should track rate limits per method per user', () => {
    // WS-7: unique per-test IDs so buckets are fresh.
    const userA = `user-a-${testCounter}-${Date.now()}`;
    const userB = `user-b-${testCounter}-${Date.now()}`;
    
    // User A exhausts the GET budget
    mockReq.headers = { 'x-user-id': userA };
    mockReq.method = 'GET';
    for (let i = 0; i < USER_READ_RATE_LIMIT_PER_MINUTE; i++) {
      rateLimiter(mockReq as Request, mockRes as Response, mockNext);
    }
    
    // User B should still be able to make requests
    mockReq.headers = { 'x-user-id': userB };
    rateLimiter(mockReq as Request, mockRes as Response, mockNext);
    
    // User A POST requests should be separate bucket
    mockReq.headers = { 'x-user-id': userA };
    mockReq.method = 'POST';
    rateLimiter(mockReq as Request, mockRes as Response, mockNext);
    
    expect(mockNext).toHaveBeenCalledTimes(USER_READ_RATE_LIMIT_PER_MINUTE + 2);
    expect(mockRes.status).not.toHaveBeenCalled();
  });
});

describe('rateLimiter IP fallback (F-105 / F-207)', () => {
  // The probe below is a GET, so the IP bucket is the READ budget × multiplier.
  const IP_LIMIT = USER_READ_RATE_LIMIT_PER_MINUTE * IP_BUCKET_MULTIPLIER;

  it('never skips: requests without x-user-id are bucketed by req.ip and get limited (widened budget)', () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
    const next = vi.fn();
    const req = { path: '/admin/stats', method: 'GET', headers: {}, ip: `10.0.0.${Date.now() % 250}` } as unknown as Request;
    for (let i = 0; i < IP_LIMIT + 1; i++) {
      rateLimiter(req, res, next);
    }
    expect(next).toHaveBeenCalledTimes(IP_LIMIT);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('different IPs get different buckets', () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
    const next = vi.fn();
    const a = { path: '/x', method: 'GET', headers: {}, ip: `10.1.0.${Date.now() % 250}` } as unknown as Request;
    const b = { path: '/x', method: 'GET', headers: {}, ip: `10.2.0.${Date.now() % 250}` } as unknown as Request;
    for (let i = 0; i < IP_LIMIT; i++) rateLimiter(a, res, next);
    rateLimiter(b, res, next);
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(IP_LIMIT + 1);
  });

  it('agent identity is used before falling back to IP', () => {
    expect(rateLimitKeyFor({ headers: { 'x-agent-id': 'agent-z' }, ip: '9.9.9.9' } as unknown as Request)).toEqual({ key: 'agent:agent-z', byIp: false });
    expect(rateLimitKeyFor({ headers: { 'x-user-id': 'u1' }, ip: '9.9.9.9' } as unknown as Request)).toEqual({ key: 'user:u1', byIp: false });
    expect(rateLimitKeyFor({ headers: {}, ip: '9.9.9.9' } as unknown as Request)).toEqual({ key: 'ip:9.9.9.9', byIp: true });
  });

  it('an agent acting for a user gets its own per-user bucket (resolved identity first, then the header)', () => {
    expect(rateLimitKeyFor({ headers: { 'x-user-id': 'u1', 'x-agent-id': 'agent-z' }, ip: '9.9.9.9' } as unknown as Request)).toEqual({ key: 'user:u1:agent:agent-z', byIp: false });
    expect(rateLimitKeyFor({ headers: { 'x-user-id': 'u1', 'x-agent-id': 'spoof' }, agentContext: { agentId: 'mcp-token:claude-000001' }, ip: '9.9.9.9' } as unknown as Request))
      .toEqual({ key: 'user:u1:agent:mcp-token:claude-000001', byIp: false });
  });

  it('an MCP client reading hard never rate-limits the same user in BoardRoom (real-vault e2e 2026-10-30)', () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
    const next = vi.fn();
    const user = `u-split-${Date.now()}`;
    const mcp = { path: '/memories/search', method: 'POST', headers: { 'x-user-id': user }, agentContext: { agentId: 'mcp-token:claude-000001' }, ip: '9.9.9.9' } as unknown as Request;
    const ui = { path: '/memories', method: 'GET', headers: { 'x-user-id': user }, ip: '9.9.9.9' } as unknown as Request;
    for (let i = 0; i < USER_READ_RATE_LIMIT_PER_MINUTE + 5; i++) rateLimiter(mcp, res, next);
    expect(res.status).toHaveBeenCalledWith(429); // the agent's own bucket still throttles it
    (res.status as ReturnType<typeof vi.fn>).mockClear();
    rateLimiter(ui, res, next);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('M-106: POST /mcp/audit is left to the agent limiter audit bucket', () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
    const next = vi.fn();
    const req = { path: '/mcp/audit', method: 'POST', headers: {}, ip: `10.3.0.${Date.now() % 250}` } as unknown as Request;
    for (let i = 0; i < IP_LIMIT + 5; i++) rateLimiter(req, res, next);
    expect(res.status).not.toHaveBeenCalled();
  });
});

