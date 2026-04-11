import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireSubscription } from '../../src/middleware/subscription.middleware';
import { omnimindClient } from '../../src/services/omnimind-client';
import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../../src/middleware/auth';

vi.mock('../../src/services/omnimind-client', () => ({
  omnimindClient: {
    getSubscription: vi.fn(),
  },
}));

describe('subscription.middleware', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('requireSubscription()', () => {
    it('allows request when Stripe not configured (dev mode)', async () => {
      process.env.STRIPE_SECRET_KEY = '';
      
      const mockReq: Partial<AuthRequest> = {
        auth: { userId: 'user-123', email: 'test@test.com', teamId: 'team-123' },
      };
      
      const mockRes: Partial<Response> = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      
      const next = vi.fn();

      await requireSubscription(mockReq as AuthRequest, mockRes as Response, next);

      expect(next).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(omnimindClient.getSubscription).not.toHaveBeenCalled();
    });

    it('allows request with active subscription', async () => {
      process.env.STRIPE_SECRET_KEY = 'test-secret';
      (omnimindClient.getSubscription as any).mockResolvedValue({
        status: 'ACTIVE',
      });
      
      const mockReq: Partial<AuthRequest> = {
        auth: { userId: 'user-123', email: 'test@test.com', teamId: 'team-123' },
      };
      
      const mockRes: Partial<Response> = {};
      const next = vi.fn();

      await requireSubscription(mockReq as AuthRequest, mockRes as Response, next);

      expect(omnimindClient.getSubscription).toHaveBeenCalledWith('user-123');
      expect(next).toHaveBeenCalled();
    });

    it('allows request with trialing subscription', async () => {
      process.env.STRIPE_SECRET_KEY = 'test-secret';
      (omnimindClient.getSubscription as any).mockResolvedValue({
        status: 'TRIALING',
      });
      
      const mockReq: Partial<AuthRequest> = {
        auth: { userId: 'user-123', email: 'test@test.com', teamId: 'team-123' },
      };
      
      const mockRes: Partial<Response> = {};
      const next = vi.fn();

      await requireSubscription(mockReq as AuthRequest, mockRes as Response, next);

      expect(omnimindClient.getSubscription).toHaveBeenCalledWith('user-123');
      expect(next).toHaveBeenCalled();
    });

    it('allows request with past due subscription but sets warning header', async () => {
      process.env.STRIPE_SECRET_KEY = 'test-secret';
      (omnimindClient.getSubscription as any).mockResolvedValue({
        status: 'PAST_DUE',
      });
      
      const mockReq: Partial<AuthRequest> = {
        auth: { userId: 'user-123', email: 'test@test.com', teamId: 'team-123' },
      };
      
      const mockRes: Partial<Response> = {
        setHeader: vi.fn(),
      };
      const next = vi.fn();

      await requireSubscription(mockReq as AuthRequest, mockRes as Response, next);

      expect(omnimindClient.getSubscription).toHaveBeenCalledWith('user-123');
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Subscription-Warning', 'payment_past_due');
      expect(next).toHaveBeenCalled();
    });

    it('returns 402 when subscription is canceled', async () => {
      process.env.STRIPE_SECRET_KEY = 'test-secret';
      (omnimindClient.getSubscription as any).mockResolvedValue({
        status: 'CANCELED',
      });
      
      const mockReq: Partial<AuthRequest> = {
        auth: { userId: 'user-123', email: 'test@test.com', teamId: 'team-123' },
      };
      
      const mockRes: Partial<Response> = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      const next = vi.fn();

      await requireSubscription(mockReq as AuthRequest, mockRes as Response, next);

      expect(omnimindClient.getSubscription).toHaveBeenCalledWith('user-123');
      expect(mockRes.status).toHaveBeenCalledWith(402);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'subscription_expired',
        message: 'Your subscription has expired',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 402 when subscription is expired', async () => {
      process.env.STRIPE_SECRET_KEY = 'test-secret';
      (omnimindClient.getSubscription as any).mockResolvedValue({
        status: 'EXPIRED',
      });
      
      const mockReq: Partial<AuthRequest> = {
        auth: { userId: 'user-123', email: 'test@test.com', teamId: 'team-123' },
      };
      
      const mockRes: Partial<Response> = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      const next = vi.fn();

      await requireSubscription(mockReq as AuthRequest, mockRes as Response, next);

      expect(omnimindClient.getSubscription).toHaveBeenCalledWith('user-123');
      expect(mockRes.status).toHaveBeenCalledWith(402);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'subscription_expired',
        message: 'Your subscription has expired',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 402 when no subscription exists', async () => {
      process.env.STRIPE_SECRET_KEY = 'test-secret';
      (omnimindClient.getSubscription as any).mockResolvedValue(null);
      
      const mockReq: Partial<AuthRequest> = {
        auth: { userId: 'user-123', email: 'test@test.com', teamId: 'team-123' },
      };
      
      const mockRes: Partial<Response> = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      const next = vi.fn();

      await requireSubscription(mockReq as AuthRequest, mockRes as Response, next);

      expect(omnimindClient.getSubscription).toHaveBeenCalledWith('user-123');
      expect(mockRes.status).toHaveBeenCalledWith(402);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'subscription_required',
        message: 'Please subscribe to continue',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('allows request when subscription check fails (graceful degradation)', async () => {
      process.env.STRIPE_SECRET_KEY = 'test-secret';
      (omnimindClient.getSubscription as any).mockRejectedValue(new Error('Service unavailable'));
      
      const mockReq: Partial<AuthRequest> = {
        auth: { userId: 'user-123', email: 'test@test.com', teamId: 'team-123' },
      };
      
      const mockRes: Partial<Response> = {};
      const next = vi.fn();

      await requireSubscription(mockReq as AuthRequest, mockRes as Response, next);

      expect(omnimindClient.getSubscription).toHaveBeenCalledWith('user-123');
      expect(next).toHaveBeenCalled();
    });
  });
});
