import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { logger } from '../lib/logger';

// Move API key validation to module load time
let apiKey: string | null = null;
let apiKeyInitialized = false;
function getApiKey(): string {
  if (!apiKeyInitialized) {
    const value = process.env.OMNIMIND_API_KEY;
    if (!value) {
      throw new Error('FATAL: OMNIMIND_API_KEY environment variable is not set. Server cannot start.');
    }
    apiKey = value;
    apiKeyInitialized = true;
  }
  return apiKey!;
}

// Test helper: resets the cached API key so tests can mutate process.env
// between cases. Not exported from any barrel — only imported by test files.
export function __resetApiKeyForTest(): void {
  apiKey = null;
  apiKeyInitialized = false;
}

export const apiKeyAuth = (req: Request, res: Response, next: NextFunction): void => {
  // Skip auth for health endpoint
  if (req.path === '/health') {
    next();
    return;
  }

  const apiKey = req.headers['x-api-key'] as string | undefined;
  let isValid = false;
  
  // Handle missing env var gracefully
  try {
    const expected = getApiKey();
    isValid = apiKey != null
      && apiKey.length === expected.length
      && timingSafeEqual(Buffer.from(apiKey), Buffer.from(expected));
  } catch (err) {
    // Log and return 500 instead of crashing
    logger.error('API key not configured', { err });
    res.status(500).json({ error: 'internal_error', message: 'Server configuration error' });
    return;
  }

  if (!isValid) {
    logger.warn('Unauthorized request', { path: req.path, ip: req.ip });
    res.status(401).json({ error: 'unauthorized', message: 'Invalid or missing API key' });
    return;
  }

  next();
};
