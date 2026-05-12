import type { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly body: { code: string; message: string },
  ) {
    super(body.message);
    this.name = 'HttpError';
  }
}

export const errorHandler = (err: Error, req: Request, res: Response, _next: NextFunction): void => {
  const requestId = req.headers['x-request-id'] as string | undefined;

  if (err instanceof HttpError) {
    res.status(err.statusCode).json({
      ...err.body,
      ...(requestId && { requestId }),
    });
    return;
  }

  logger.error('Unhandled error', {
    message: err.message,
    path: req.path,
    method: req.method,
    requestId,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  });

  res.status(500).json({
    error: 'internal_error',
    message: process.env.NODE_ENV === 'production' ? 'An internal error occurred' : err.message,
    ...(requestId && { requestId }),
  });
};
