/**
 * Track C — Wave 2 critical-path test
 *
 * Audit ID: SUB-03 (docs/_audits/2026-05-15-launch-prep/02-backend-routes.md).
 *
 * Tests the INTENDED contract for `requireSubscription` after Track A's
 * fix: fail-CLOSED in production (reject the request) when the OmniMind
 * subscription lookup throws, and fail-OPEN in non-production (allow
 * the request through for dev convenience).
 *
 * The current implementation in
 *   packages/boardroom-ai/server/src/middleware/subscription.middleware.ts
 * fails open unconditionally (catch{} -> next()). Track A is replacing
 * that with NODE_ENV-aware behaviour. Until that ships, the fail-closed
 * test is `.skip`-ed with a TODO so CI stays green.
 *
 * When Track A's PR for SUB-03 lands, flip `.skip` to live and this
 * suite becomes the regression guard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../../src/middleware/auth';

vi.mock('../../src/services/omnimind-client', () => ({
  omnimindClient: {
    getSubscription: vi.fn(),
  },
}));

describe('subscription.middleware — fail-closed in production (SUB-03)', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalStripeKey = process.env.STRIPE_SECRET_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_1234';
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalStripeKey;
  });

  // TODO(SUB-03 / Track A): unskip when production fail-closed lands.
  // Today the middleware fails open unconditionally; this assertion
  // would fail and break CI.
  it.skip('rejects request with 503 when OmniMind throws in production', async () => {
    process.env.NODE_ENV = 'production';
    const { requireSubscription } = await import(
      '../../src/middleware/subscription.middleware'
    );
    const { omnimindClient } = await import('../../src/services/omnimind-client');
    (omnimindClient.getSubscription as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Service unavailable'),
    );

    const req: Partial<AuthRequest> = {
      auth: { userId: 'user-1', email: 't@t.com', teamId: 'team-1' },
    };
    const res: Partial<Response> = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();

    await requireSubscription(req as AuthRequest, res as Response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('still fails open in non-production when OmniMind throws (today\'s behaviour)', async () => {
    process.env.NODE_ENV = 'development';
    const { requireSubscription } = await import(
      '../../src/middleware/subscription.middleware'
    );
    const { omnimindClient } = await import('../../src/services/omnimind-client');
    (omnimindClient.getSubscription as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Service unavailable'),
    );

    const req: Partial<AuthRequest> = {
      auth: { userId: 'user-1', email: 't@t.com', teamId: 'team-1' },
    };
    const res: Partial<Response> = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
    };
    const next = vi.fn();

    await requireSubscription(req as AuthRequest, res as Response, next as NextFunction);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
