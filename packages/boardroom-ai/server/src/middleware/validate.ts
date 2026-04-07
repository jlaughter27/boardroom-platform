import type { ZodSchema } from 'zod';
import { ZodError } from 'zod';
import type { Request, Response, NextFunction } from 'express';

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(422).json({
          error: 'validation_failed',
          details: err.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
        });
        return;
      }
      next(err);
    }
  };
}
