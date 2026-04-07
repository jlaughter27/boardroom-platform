import { describe, it, expect, beforeEach } from 'vitest';
import { checkSessionLimit } from '../../src/middleware/session-rate-limiter';

// Use unique user IDs per test to avoid shared state
let userCounter = 0;

function uniqueUserId(): string {
  return `test-user-${++userCounter}-${Date.now()}`;
}

const mockReq = (userId: string, method: string, path: string) => ({
  auth: { userId, email: 'test@test.com', teamId: 'team1' },
  method,
  path,
} as any);

const mockRes = () => {
  const res: any = {};
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: unknown) => { res.body = body; return res; };
  return res;
};

describe('session-rate-limiter', () => {
  it('first dispatch passes', () => {
    const userId = uniqueUserId();
    const req = mockReq(userId, 'POST', '/session1/dispatch');
    const res = mockRes();
    let nextCalled = false;

    checkSessionLimit(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBeUndefined();
  });

  it('11th dispatch returns 429 (limit is 10)', () => {
    const userId = uniqueUserId();

    // Fire 10 dispatches (all should pass)
    for (let i = 0; i < 10; i++) {
      const req = mockReq(userId, 'POST', `/session1/dispatch`);
      const res = mockRes();
      let nextCalled = false;
      checkSessionLimit(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
    }

    // 11th should be rate limited
    const req = mockReq(userId, 'POST', '/session1/dispatch');
    const res = mockRes();
    let nextCalled = false;
    checkSessionLimit(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(429);
    expect(res.body.error).toBe('rate_limited');
    expect(res.body.message).toContain('10');
  });

  it('new session resets dispatch count', () => {
    const userId = uniqueUserId();

    // Fire 10 dispatches
    for (let i = 0; i < 10; i++) {
      const req = mockReq(userId, 'POST', '/session1/dispatch');
      const res = mockRes();
      checkSessionLimit(req, res, () => {});
    }

    // Create a new session (POST /) - resets dispatch count
    const createReq = mockReq(userId, 'POST', '/');
    const createRes = mockRes();
    let createNextCalled = false;
    checkSessionLimit(createReq, createRes, () => { createNextCalled = true; });
    expect(createNextCalled).toBe(true);

    // Now dispatch should work again
    const req = mockReq(userId, 'POST', '/session2/dispatch');
    const res = mockRes();
    let nextCalled = false;
    checkSessionLimit(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it('6th session creation returns 429 (limit is 5)', () => {
    const userId = uniqueUserId();

    // Create 5 sessions (all should pass)
    for (let i = 0; i < 5; i++) {
      const req = mockReq(userId, 'POST', '/');
      const res = mockRes();
      let nextCalled = false;
      checkSessionLimit(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
    }

    // 6th should be rate limited
    const req = mockReq(userId, 'POST', '/');
    const res = mockRes();
    let nextCalled = false;
    checkSessionLimit(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(429);
    expect(res.body.error).toBe('rate_limited');
    expect(res.body.message).toContain('5');
    expect(res.body.retryAfter).toBeGreaterThan(0);
  });
});
