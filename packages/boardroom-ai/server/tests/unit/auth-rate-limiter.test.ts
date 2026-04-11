import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loginLimiter, registerLimiter } from '../../src/middleware/auth-rate-limiter';
import type { Response, NextFunction } from 'express';

describe('auth-rate-limiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('loginLimiter', () => {
    it('allows requests within rate limit', () => {
      const mockReq = {
        ip: '192.168.1.1',
        socket: { remoteAddress: '192.168.1.1' },
      };
      
      const mockRes: Partial<Response> = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      
      const next = vi.fn();
      
      // First 5 requests should pass
      for (let i = 0; i < 5; i++) {
        loginLimiter(mockReq as any, mockRes as Response, next);
        expect(next).toHaveBeenCalledTimes(i + 1);
        expect(mockRes.status).not.toHaveBeenCalled();
      }
    });

    it('blocks 6th request within 15 minutes', () => {
      const mockReq = {
        ip: '192.168.1.2',
        socket: { remoteAddress: '192.168.1.2' },
      };
      
      const mockRes: Partial<Response> = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      
      const next = vi.fn();
      
      // First 5 requests pass
      for (let i = 0; i < 5; i++) {
        loginLimiter(mockReq as any, mockRes as Response, next);
      }
      
      // Reset next mock count
      next.mockClear();
      
      // 6th request should be blocked
      loginLimiter(mockReq as any, mockRes as Response, next);
      
      expect(next).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'rate_limited',
        message: 'Too many attempts. Please try again later.',
        retryAfter: expect.any(Number),
      });
    });

    it('resets after 15 minutes', () => {
      const mockReq = {
        ip: '192.168.1.3',
        socket: { remoteAddress: '192.168.1.3' },
      };
      
      const mockRes: Partial<Response> = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      
      const next = vi.fn();
      
      // Exhaust limit
      for (let i = 0; i < 5; i++) {
        loginLimiter(mockReq as any, mockRes as Response, next);
      }
      
      // Fast-forward 16 minutes (just over the 15-minute window)
      vi.advanceTimersByTime(16 * 60 * 1000);
      
      // Reset mocks
      next.mockClear();
      mockRes.status.mockClear();
      mockRes.json.mockClear();
      
      // Should allow request now
      loginLimiter(mockReq as any, mockRes as Response, next);
      
      expect(next).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('handles missing IP address', () => {
      const mockReq = {
        ip: undefined,
        socket: { remoteAddress: undefined },
      };
      
      const mockRes: Partial<Response> = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      
      const next = vi.fn();
      
      // Should still work with unknown IP (all unknown IPs share same bucket)
      loginLimiter(mockReq as any, mockRes as Response, next);
      
      expect(next).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });

  describe('registerLimiter', () => {
    it('allows requests within rate limit', () => {
      const mockReq = {
        ip: '192.168.1.4',
        socket: { remoteAddress: '192.168.1.4' },
      };
      
      const mockRes: Partial<Response> = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      
      const next = vi.fn();
      
      // First 3 requests should pass
      for (let i = 0; i < 3; i++) {
        registerLimiter(mockReq as any, mockRes as Response, next);
        expect(next).toHaveBeenCalledTimes(i + 1);
        expect(mockRes.status).not.toHaveBeenCalled();
      }
    });

    it('blocks 4th request within hour', () => {
      const mockReq = {
        ip: '192.168.1.5',
        socket: { remoteAddress: '192.168.1.5' },
      };
      
      const mockRes: Partial<Response> = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      
      const next = vi.fn();
      
      // First 3 requests pass
      for (let i = 0; i < 3; i++) {
        registerLimiter(mockReq as any, mockRes as Response, next);
      }
      
      // Reset next mock count
      next.mockClear();
      
      // 4th request should be blocked
      registerLimiter(mockReq as any, mockRes as Response, next);
      
      expect(next).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'rate_limited',
        message: 'Too many attempts. Please try again later.',
        retryAfter: expect.any(Number),
      });
    });

    it('has different buckets for login and register', () => {
      const mockReq = {
        ip: '192.168.1.6',
        socket: { remoteAddress: '192.168.1.6' },
      };
      
      const mockRes: Partial<Response> = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      
      const next = vi.fn();
      
      // Exhaust login limit
      for (let i = 0; i < 5; i++) {
        loginLimiter(mockReq as any, mockRes as Response, next);
      }
      
      // Register should still work
      registerLimiter(mockReq as any, mockRes as Response, next);
      
      expect(next).toHaveBeenCalledTimes(6); // 5 login + 1 register
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('cleans expired buckets via interval', () => {
      const mockReq = {
        ip: '192.168.1.7',
        socket: { remoteAddress: '192.168.1.7' },
      };
      
      const mockRes: Partial<Response> = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      
      const next = vi.fn();
      
      // Make one request
      loginLimiter(mockReq as any, mockRes as Response, next);
      
      // Fast-forward 6 minutes (past the 5-minute cleanup interval)
      vi.advanceTimersByTime(6 * 60 * 1000);
      
      // Cleanup should have run, but bucket still valid (15 min window)
      loginLimiter(mockReq as any, mockRes as Response, next);
      
      expect(next).toHaveBeenCalledTimes(2);
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });
});
