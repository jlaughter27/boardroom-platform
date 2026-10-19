import type { ZodSchema, ZodIssue } from 'zod';
import { ZodError } from 'zod';
import type { Request, Response, NextFunction } from 'express';

/**
 * Schemas imported from `@boardroom/shared` are built with that package's copy
 * of zod, so `instanceof ZodError` can be false across the seam (it is under
 * vite-node, and would be under any bundler that duplicates zod). Detect the
 * shape instead of the class.
 */
export function isZodError(err: unknown): err is ZodError {
  if (err instanceof ZodError) return true;
  return Boolean(err)
    && typeof err === 'object'
    && (err as { name?: unknown }).name === 'ZodError'
    && Array.isArray((err as { issues?: unknown }).issues);
}

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (isZodError(err)) {
        res.status(422).json({
          error: 'validation_failed',
          details: (err.issues as ZodIssue[]).map(e => ({ field: e.path.join('.'), message: e.message })),
        });
        return;
      }
      next(err);
    }
  };
}
