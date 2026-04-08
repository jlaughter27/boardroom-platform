import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { logger } from '../lib/logger';

let _apiKey: string | undefined;
function getApiKey(): string {
  if (!_apiKey) {
    _apiKey = process.env.OMNIMIND_API_KEY;
    if (!_apiKey) throw new Error('FATAL: OMNIMIND_API_KEY environment variable is not set. Server cannot start.');
  }
  return _apiKey;
}

export const apiKeyAuth = (req: Request, res: Response, next: NextFunction): void => {
  // Skip auth for health endpoint
  if (req.path === '/health') {
    next();
    return;
  }

  const apiKey = req.headers['x-api-key'] as string | undefined;
  const expected = getApiKey();
  const isValid = apiKey != null
    && apiKey.length === expected.length
    && timingSafeEqual(Buffer.from(apiKey), Buffer.from(expected));

  if (!isValid) {
    logger.warn('Unauthorized request', { path: req.path, ip: req.ip });
    res.status(401).json({ error: 'unauthorized', message: 'Invalid or missing API key' });
    return;
  }

  next();
};
