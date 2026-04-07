import type { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

const API_KEY = process.env.OMNIMIND_API_KEY;
if (!API_KEY) throw new Error('FATAL: OMNIMIND_API_KEY environment variable is not set. Server cannot start.');

export const apiKeyAuth = (req: Request, res: Response, next: NextFunction): void => {
  // Skip auth for health endpoint
  if (req.path === '/health') {
    next();
    return;
  }

  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (!apiKey || apiKey !== API_KEY) {
    logger.warn('Unauthorized request', { path: req.path, ip: req.ip });
    res.status(401).json({ error: 'unauthorized', message: 'Invalid or missing API key' });
    return;
  }

  next();
};
