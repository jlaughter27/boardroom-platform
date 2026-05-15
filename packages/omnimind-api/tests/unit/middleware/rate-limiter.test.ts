import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { rateLimiter } from '../../../src/middleware/rate-limiter';
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

  it('should block requests over the rate limit', () => {
    // Make 61 requests (one over limit)
    for (let i = 0; i < RATE_LIMITS.MAX_QUERIES_PER_MINUTE + 1; i++) {
      rateLimiter(mockReq as Request, mockRes as Response, mockNext);
    }
    
    // Should have called next for first 60, then status 429 for 61st
    expect(mockNext).toHaveBeenCalledTimes(RATE_LIMITS.MAX_QUERIES_PER_MINUTE);
    expect(mockRes.status).toHaveBeenCalledWith(429);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'rate_limited',
      message: expect.stringContaining('Rate limit exceeded'),
      retryAfter: expect.any(Number),
    });
  });

  it('should reset bucket after window expires', () => {
    // Make 60 requests (at limit)
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

  it('should track rate limits per method per user', () => {
    // WS-7: unique per-test IDs so buckets are fresh.
    const userA = `user-a-${testCounter}-${Date.now()}`;
    const userB = `user-b-${testCounter}-${Date.now()}`;
    
    // User A makes 60 GET requests
    mockReq.headers = { 'x-user-id': userA };
    mockReq.method = 'GET';
    for (let i = 0; i < RATE_LIMITS.MAX_QUERIES_PER_MINUTE; i++) {
      rateLimiter(mockReq as Request, mockRes as Response, mockNext);
    }
    
    // User B should still be able to make requests
    mockReq.headers = { 'x-user-id': userB };
    rateLimiter(mockReq as Request, mockRes as Response, mockNext);
    
    // User A POST requests should be separate bucket
    mockReq.headers = { 'x-user-id': userA };
    mockReq.method = 'POST';
    rateLimiter(mockReq as Request, mockRes as Response, mockNext);
    
    expect(mockNext).toHaveBeenCalledTimes(RATE_LIMITS.MAX_QUERIES_PER_MINUTE + 2);
    expect(mockRes.status).not.toHaveBeenCalled();
  });
});
