import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { apiKeyAuth } from '../../../src/middleware/auth';

describe('apiKeyAuth middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let originalEnv: string | undefined;

  beforeEach(() => {
    mockReq = {
      path: '/memories',
      headers: {},
      ip: '127.0.0.1',
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
    originalEnv = process.env.OMNIMIND_API_KEY;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.OMNIMIND_API_KEY = originalEnv;
    } else {
      delete process.env.OMNIMIND_API_KEY;
    }
  });

  it('should allow health endpoint without API key', () => {
    mockReq.path = '/health';
    apiKeyAuth(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('should reject request without API key', () => {
    process.env.OMNIMIND_API_KEY = 'test-key';
    apiKeyAuth(mockReq as Request, mockRes as Response, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'unauthorized',
      message: 'Invalid or missing API key',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should reject request with incorrect API key', () => {
    process.env.OMNIMIND_API_KEY = 'correct-key';
    mockReq.headers = { 'x-api-key': 'wrong-key' };
    apiKeyAuth(mockReq as Request, mockRes as Response, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should allow request with correct API key', () => {
    process.env.OMNIMIND_API_KEY = 'test-key-123';
    mockReq.headers = { 'x-api-key': 'test-key-123' };
    apiKeyAuth(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('should handle timing-safe comparison with different length keys', () => {
    process.env.OMNIMIND_API_KEY = 'short';
    mockReq.headers = { 'x-api-key': 'longer-key' };
    apiKeyAuth(mockReq as Request, mockRes as Response, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(401);
  });

  it('should reject all requests when API key is not configured', () => {
    delete process.env.OMNIMIND_API_KEY;
    // Should throw during initialization
    expect(() => {
      apiKeyAuth(mockReq as Request, mockRes as Response, mockNext);
    }).toThrow('FATAL: OMNIMIND_API_KEY environment variable is not set.');
  });
});
