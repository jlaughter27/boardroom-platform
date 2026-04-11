import { describe, it, expect, vi } from 'vitest';
import { validateBody } from '../../src/middleware/validate';
import { z } from 'zod';
import type { Response, NextFunction } from 'express';

describe('validate', () => {
  describe('validateBody()', () => {
    it('validates and parses request body', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number().min(0),
      });
      
      const validate = validateBody(schema);
      
      const mockReq = {
        body: { name: 'John', age: 25 },
      };
      
      const mockRes: Partial<Response> = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      
      const next = vi.fn();
      
      validate(mockReq as any, mockRes as Response, next);
      
      expect(next).toHaveBeenCalled();
      expect(mockReq.body).toEqual({ name: 'John', age: 25 });
      expect(mockRes.status).not.toHaveBeenCalled();
    });
    
    it('returns 422 with validation errors', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number().min(0),
      });
      
      const validate = validateBody(schema);
      
      const mockReq = {
        body: { name: 123, age: -5 }, // Invalid types and values
      };
      
      const mockRes: Partial<Response> = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      
      const next = vi.fn();
      
      validate(mockReq as any, mockRes as Response, next);
      
      expect(next).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(422);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'validation_failed',
        details: expect.arrayContaining([
          expect.objectContaining({ field: 'name', message: expect.any(String) }),
          expect.objectContaining({ field: 'age', message: expect.any(String) }),
        ]),
      });
    });
    
    it('handles nested validation errors', () => {
      const schema = z.object({
        user: z.object({
          email: z.string().email(),
          profile: z.object({
            age: z.number().min(18),
          }),
        }),
      });
      
      const validate = validateBody(schema);
      
      const mockReq = {
        body: {
          user: {
            email: 'invalid-email',
            profile: { age: 16 },
          },
        },
      };
      
      const mockRes: Partial<Response> = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      
      const next = vi.fn();
      
      validate(mockReq as any, mockRes as Response, next);
      
      expect(next).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(422);
      const jsonCall = (mockRes.json as any).mock.calls[0][0];
      expect(jsonCall.error).toBe('validation_failed');
      expect(jsonCall.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'user.email', message: expect.any(String) }),
          expect.objectContaining({ field: 'user.profile.age', message: expect.any(String) }),
        ])
      );
    });
    
    it('passes non-ZodError to next middleware', () => {
      const schema = z.object({});
      const validate = validateBody(schema);
      
      const mockReq = {
        body: {},
      };
      
      const mockRes: Partial<Response> = {};
      
      const next = vi.fn();
      
      // Mock ZodSchema.parse to throw non-ZodError
      const mockError = new Error('Some other error');
      schema.parse = vi.fn().mockImplementation(() => {
        throw mockError;
      });
      
      validate(mockReq as any, mockRes as Response, next);
      
      expect(next).toHaveBeenCalledWith(mockError);
    });
  });
});
