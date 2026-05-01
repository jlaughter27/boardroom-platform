import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { apiKeyAuth, __resetApiKeyForTest } from '../../../src/middleware/auth';

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
    // Reset the cached API key so each test reads a fresh process.env.
    __resetApiKeyForTest();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.OMNIMIND_API_KEY = originalEnv;
    } else {
      delete process.env.OMNIMIND_API_KEY;
    }
    __resetApiKeyForTest();
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

  it('should return 500 when API key is not configured', () => {
    delete process.env.OMNIMIND_API_KEY;
    __resetApiKeyForTest();
    mockReq.headers = { 'x-api-key': 'any-key' };

    // The middleware catches the FATAL error from getApiKey() and responds
    // with a 500 instead of crashing the process.
    apiKeyAuth(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'internal_error',
      message: 'Server configuration error',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });
});
