import type { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

export const errorHandler = (err: Error, req: Request, res: Response, _next: NextFunction): void => {
  logger.error('Unhandled error', {
    message: err.message,
    path: req.path,
    method: req.method,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  });

  res.status(500).json({
    error: 'internal_error',
    message: process.env.NODE_ENV === 'production' ? 'An internal error occurred' : err.message,
  });
};
