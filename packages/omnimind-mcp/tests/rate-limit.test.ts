/**
 * M-4 — per-IP failure budget: a token bucket that refills continuously, is
 * bounded in the number of IPs it tracks, and attributes requests to the
 * socket peer unless the operator trusts the proxy's X-Forwarded-For.
 */
import { describe, it, expect } from 'vitest';
import { AuthFailureLimiter, clientIpOf, AUTH_FAILURE_CAPACITY, AUTH_FAILURE_REFILL_PER_MINUTE } from '../src/lib/rate-limit';

describe('AuthFailureLimiter', () => {
  it('allows `capacity` failures, then limits with a Retry-After, and refills over time', () => {
    let t = 0;
    const l = new AuthFailureLimiter({ capacity: 3, refillPerMinute: 60, now: () => t }); // 1 token / s
    for (let i = 0; i < 3; i++) {
      expect(l.check('1.2.3.4').limited).toBe(false);
      l.recordFailure('1.2.3.4');
    }
    expect(l.check('1.2.3.4')).toEqual({ limited: true, retryAfterS: 1 });
    expect(l.check('5.6.7.8').limited).toBe(false); // other IPs are unaffected
    t += 999;
    expect(l.check('1.2.3.4').limited).toBe(true);
    t += 1;
    expect(l.check('1.2.3.4').limited).toBe(false); // one token back
    l.recordFailure('1.2.3.4');
    expect(l.check('1.2.3.4').limited).toBe(true);
    t += 60_000;
    expect(l.check('1.2.3.4').limited).toBe(false); // capped at capacity, never above
    for (let i = 0; i < 3; i++) l.recordFailure('1.2.3.4');
    expect(l.check('1.2.3.4').limited).toBe(true);
  });

  it('defaults to 30 failures / minute and never goes below zero tokens', () => {
    let t = 0;
    const l = new AuthFailureLimiter({ now: () => t });
    expect(AUTH_FAILURE_CAPACITY).toBe(30);
    expect(AUTH_FAILURE_REFILL_PER_MINUTE).toBe(30);
    for (let i = 0; i < 100; i++) l.recordFailure('ip'); // 70 over budget
    expect(l.check('ip')).toEqual({ limited: true, retryAfterS: 2 });
    t += 2_000; // 1 token refilled (0.5 / s)
    expect(l.check('ip').limited).toBe(false);
  });

  it('tracks a bounded number of IPs, forgetting the least recently seen', () => {
    const l = new AuthFailureLimiter({ capacity: 1, refillPerMinute: 1, maxBuckets: 2, now: () => 0 });
    l.recordFailure('a');
    l.recordFailure('b');
    expect(l.check('a').limited).toBe(true); // touching a makes b the least recently seen
    l.recordFailure('c'); // evicts b
    expect(l.size).toBe(2);
    expect(l.check('a').limited).toBe(true);
    expect(l.check('b').limited).toBe(false); // b is a fresh bucket again
    expect(() => new AuthFailureLimiter({ capacity: 0 })).toThrow();
  });
});

describe('clientIpOf', () => {
  const req = (xff: string | string[] | undefined, peer = '10.0.0.9') => ({ socket: { remoteAddress: peer }, headers: xff === undefined ? {} : { 'x-forwarded-for': xff } });

  it('uses the socket peer unless trustProxy is on; then the right-most X-Forwarded-For entry', () => {
    expect(clientIpOf(req('1.1.1.1, 2.2.2.2'), false)).toBe('10.0.0.9');
    expect(clientIpOf(req('1.1.1.1, 2.2.2.2'), true)).toBe('2.2.2.2'); // the entry the nearest proxy appended, not the spoofable first one
    expect(clientIpOf(req(['1.1.1.1', '3.3.3.3, 4.4.4.4']), true)).toBe('4.4.4.4');
    expect(clientIpOf(req(undefined), true)).toBe('10.0.0.9');
    expect(clientIpOf(req('  '), true)).toBe('10.0.0.9');
    expect(clientIpOf({ headers: {} }, false)).toBe('unknown');
  });
});
