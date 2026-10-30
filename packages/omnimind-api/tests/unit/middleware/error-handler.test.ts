import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { errorHandler, HttpError, mapClientError } from '../../../src/middleware/error-handler';
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
      headers: {},
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn().mockReturnThis(),
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
      requestId: undefined,
      stack: error.stack,
    });
    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'internal_error',
      message: 'Test error',
    });
  });

  it('should propagate x-request-id when present', () => {
    mockReq.headers = { 'x-request-id': 'req-abc-123' };
    const error = new Error('Test error');

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

    expect(logger.error).toHaveBeenCalledWith(
      'Unhandled error',
      expect.objectContaining({ requestId: 'req-abc-123' }),
    );
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'internal_error',
      message: 'Test error',
      requestId: 'req-abc-123',
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
      requestId: undefined,
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

  // Lane F — deliberate 5xx refusals carry `x-omnimind-refusal: 1` so BoardRoom's
  // shared circuit breaker neither retries nor counts them.
  it('marks a refusal HttpError (503 MINISTRY_DEFERRED) with x-omnimind-refusal: 1', () => {
    const err = new HttpError(503, { code: 'MINISTRY_DEFERRED', message: 'deferred' }, { refusal: true });
    errorHandler(err, mockReq as Request, mockRes as Response, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(503);
    expect(mockRes.setHeader).toHaveBeenCalledWith('x-omnimind-refusal', '1');
    expect(mockRes.json).toHaveBeenCalledWith({ code: 'MINISTRY_DEFERRED', message: 'deferred' });
  });

  it('does not mark a plain HttpError or an unhandled 500 as a refusal', () => {
    errorHandler(new HttpError(409, { code: 'conflict', message: 'dup' }), mockReq as Request, mockRes as Response, mockNext);
    errorHandler(new Error('boom'), mockReq as Request, mockRes as Response, mockNext);
    expect(mockRes.setHeader).not.toHaveBeenCalled();
  });

  // Lane F — a near-1 MB note whose lexemes exceed Postgres' 1 MB tsvector
  // limit (the GIN index on to_tsvector(content), or a raw FTS query) raised
  // 54000 "string is too long for tsvector" and answered 500. Both shapes
  // below were captured from Prisma 6 against Postgres 16.
  describe('Postgres 54000 (program limit) → 413 payload_too_large', () => {
    const tsvMsg = 'string is too long for tsvector (2003738 bytes, max 1048575 bytes)';
    const unknownErr = Object.assign(
      new Error(
        'Invalid `prisma.memoryEntry.create()` invocation:\n\nError occurred during query execution:\n' +
        `ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "54000", message: "${tsvMsg}", severity: "ERROR", detail: None, column: None, hint: None }), transient: false })`,
      ),
      { name: 'PrismaClientUnknownRequestError' },
    );
    const rawErr = Object.assign(new Error(`Raw query failed. Code: \`54000\`. Message: \`ERROR: ${tsvMsg}\``), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2010',
      meta: { code: '54000', message: `ERROR: ${tsvMsg}` },
    });

    it.each([
      ['PrismaClientUnknownRequestError (model create/update)', unknownErr],
      ['PrismaClientKnownRequestError P2010 (raw query)', rawErr],
    ])('maps %s', (_label, err) => {
      const mapped = mapClientError(err);
      expect(mapped).toMatchObject({ status: 413, error: 'payload_too_large' });
      expect(mapped!.message).toMatch(/too large to index/i);
    });

    it('answers 413 (not 500) through the error handler and logs nothing as unhandled', () => {
      errorHandler(unknownErr, mockReq as Request, mockRes as Response, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(413);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'payload_too_large' }));
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('does not map other unknown Prisma errors or other raw-query codes', () => {
      expect(mapClientError(Object.assign(new Error('Error occurred during query execution: code: "57014"'), { name: 'PrismaClientUnknownRequestError' }))).toBeNull();
      expect(mapClientError(Object.assign(new Error('x'), { name: 'PrismaClientKnownRequestError', code: 'P2010', meta: { code: '42601' } }))).toBeNull();
    });
  });
});
