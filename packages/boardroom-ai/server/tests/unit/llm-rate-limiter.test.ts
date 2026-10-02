import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { llmRateLimiter, __resetLlmBucketsForTest } from '../../src/middleware/llm-rate-limiter';
import type { Response } from 'express';
import type { AuthRequest } from '../../src/middleware/auth';

function mockRes(): Response {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  return res as Response;
}
const reqFor = (userId: string) => ({ auth: { userId, email: 'x@y.z', teamId: 't' } }) as AuthRequest;

describe('llmRateLimiter (B-110)', () => {
  beforeEach(() => {
    __resetLlmBucketsForTest();
    process.env.LLM_RATE_LIMIT_PER_HOUR = '3';
    process.env.LLM_RATE_LIMIT_WINDOW_MS = String(60 * 60 * 1000);
  });
  afterEach(() => {
    delete process.env.LLM_RATE_LIMIT_PER_HOUR;
    delete process.env.LLM_RATE_LIMIT_WINDOW_MS;
    vi.useRealTimers();
  });

  it('allows up to the capacity, then 429s with retryAfter, per user', () => {
    const next = vi.fn();
    for (let i = 0; i < 3; i++) llmRateLimiter(reqFor('a'), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(3);

    const res = mockRes();
    llmRateLimiter(reqFor('a'), res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect((res.json as any).mock.calls[0][0]).toMatchObject({ error: 'rate_limited', retryAfter: expect.any(Number) });
    expect(next).toHaveBeenCalledTimes(3);

    // a different user has their own bucket
    const other = vi.fn();
    llmRateLimiter(reqFor('b'), mockRes(), other);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('refills over time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T00:00:00Z'));
    const next = vi.fn();
    for (let i = 0; i < 3; i++) llmRateLimiter(reqFor('a'), mockRes(), next);
    const blocked = mockRes();
    llmRateLimiter(reqFor('a'), blocked, next);
    expect(blocked.status).toHaveBeenCalledWith(429);

    // 20 minutes = 1/3 of the window → one token back
    vi.setSystemTime(new Date('2026-10-02T00:20:01Z'));
    const ok = mockRes();
    llmRateLimiter(reqFor('a'), ok, next);
    expect(ok.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(4);
  });

  it('passes through when unauthenticated (auth wall handles it)', () => {
    const next = vi.fn();
    llmRateLimiter({} as AuthRequest, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
});
