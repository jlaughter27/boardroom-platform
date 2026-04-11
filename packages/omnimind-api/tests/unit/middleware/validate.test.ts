import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validateBody } from '../../../src/middleware/validate';

describe('validateBody middleware', () => {
  const testSchema = z.object({
    title: z.string().min(1),
    content: z.string().min(1),
    tags: z.array(z.string()).optional(),
  });

  it('should validate and pass valid body', () => {
    const mockReq = {
      body: { title: 'Test', content: 'Content' },
    };
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const mockNext = vi.fn();

    const middleware = validateBody(testSchema);
    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
    expect(mockReq.body).toEqual({ title: 'Test', content: 'Content' });
  });

  it('should validate and pass valid body with optional fields', () => {
    const mockReq = {
      body: { title: 'Test', content: 'Content', tags: ['tag1', 'tag2'] },
    };
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const mockNext = vi.fn();

    const middleware = validateBody(testSchema);
    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
    expect(mockReq.body).toEqual({ title: 'Test', content: 'Content', tags: ['tag1', 'tag2'] });
  });

  it('should reject invalid body with 422', () => {
    const mockReq = {
      body: { title: '', content: 'Content' }, // title empty
    };
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const mockNext = vi.fn();

    const middleware = validateBody(testSchema);
    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(422);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'validation_failed',
      details: expect.arrayContaining([
        expect.objectContaining({ field: 'title', message: expect.any(String) }),
      ]),
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should reject missing required fields', () => {
    const mockReq = {
      body: { title: 'Test' }, // missing content
    };
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const mockNext = vi.fn();

    const middleware = validateBody(testSchema);
    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(422);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'validation_failed',
      details: expect.arrayContaining([
        expect.objectContaining({ field: 'content' }),
      ]),
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should handle nested error paths', () => {
    const nestedSchema = z.object({
      data: z.object({
        attributes: z.object({
          name: z.string().min(1),
        }),
      }),
    });

    const mockReq = {
      body: { data: { attributes: { name: '' } } }, // empty name
    };
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const mockNext = vi.fn();

    const middleware = validateBody(nestedSchema);
    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(422);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'validation_failed',
      details: expect.arrayContaining([
        expect.objectContaining({ field: 'data.attributes.name' }),
      ]),
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should propagate non-ZodError exceptions', () => {
    const mockReq = {
      body: {},
    };
    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const mockNext = vi.fn();

    // Create a schema that throws a non-ZodError
    const throwingSchema = {
      parse: () => { throw new Error('Custom error'); },
    } as any;

    const middleware = validateBody(throwingSchema);
    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    expect(mockRes.status).not.toHaveBeenCalled();
  });
});
