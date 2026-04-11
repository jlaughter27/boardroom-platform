import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { errorHandler } from '../../../src/middleware/error-handler';
import { logger } from '../../../src/lib/logger';

// Mock logger
vi.mock('../../../src/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

describe('errorHandler middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  
  beforeEach(() => {
    mockReq = {
      path: '/test',
      method: 'GET',
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    mockNext = vi.fn();
    
    vi.clearAllMocks();
  });

  it('should log error and send 500 response', () => {
    const error = new Error('Test error');
    
    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);
    
    expect(logger.error).toHaveBeenCalledWith('Unhandled error', {
      message: 'Test error',
      path: '/test',
      method: 'GET',
      stack: error.stack,
    });
    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'internal_error',
      message: 'Test error',
    });
  });

  it('should hide stack trace in production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    
    const error = new Error('Production error');
    
    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);
    
    expect(logger.error).toHaveBeenCalledWith('Unhandled error', {
      message: 'Production error',
      path: '/test',
      method: 'GET',
      stack: undefined, // Should be undefined in production
    });
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'internal_error',
      message: 'An internal error occurred', // Generic message in production
    });
    
    process.env.NODE_ENV = originalEnv;
  });

  it('should send generic message in production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    
    const error = new Error('Sensitive error details');
    
    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);
    
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'internal_error',
      message: 'An internal error occurred',
    });
    
    process.env.NODE_ENV = originalEnv;
  });

  it('should send detailed message in non-production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    
    const error = new Error('Detailed error');
    
    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);
    
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'internal_error',
      message: 'Detailed error',
    });
    
    process.env.NODE_ENV = originalEnv;
  });
});
