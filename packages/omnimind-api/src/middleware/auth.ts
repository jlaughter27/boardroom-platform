import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { logger } from '../lib/logger';

function getApiKey(): string {
  const value = process.env.OMNIMIND_API_KEY;
  if (!value) {
    throw new Error('FATAL: OMNIMIND_API_KEY environment variable is not set. Server cannot start.');
  }
  return value;
}

export const apiKeyAuth = (req: Request, res: Response, next: NextFunction): void => {
  // Skip auth for health endpoint
  if (req.path === '/health') {
    next();
    return;
  }

  const apiKey = req.headers['x-api-key'] as string | undefined;
  let isValid = false;
  let fatalError: Error | null = null;
  try {
    const expected = getApiKey();
    isValid = apiKey != null
      && apiKey.length === expected.length
      && timingSafeEqual(Buffer.from(apiKey), Buffer.from(expected));
  } catch (err) {
    fatalError = err as Error;
  }

  if (fatalError) {
    // Propagate fatal misconfiguration as tests expect
    throw fatalError;
  }

  if (!isValid) {
    logger.warn('Unauthorized request', { path: req.path, ip: req.ip });
    res.status(401).json({ error: 'unauthorized', message: 'Invalid or missing API key' });
    return;
  }

  next();
};
