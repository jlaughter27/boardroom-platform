import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';

const CUID_REGEX = /^c[a-z0-9]{24}$/;

/**
 * Validates that the x-user-id header:
 * 1. Is present
 * 2. Is a valid CUID format
 * 3. Corresponds to an existing user in the database
 */
export async function validateUserExists(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.headers['x-user-id'] as string | undefined;

  // Check presence
  if (!userId) {
    logger.warn('Missing x-user-id header', {
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    res.status(400).json({
      error: 'validation_failed',
      details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }],
    });
    return;
  }

  // Validate CUID format (prevents NoSQL injection)
  if (!CUID_REGEX.test(userId)) {
    logger.warn('Invalid x-user-id format', {
      path: req.path,
      method: req.method,
      userId: userId.substring(0, 10) + '...', // Partial for logging, not full PII
    });
    res.status(400).json({
      error: 'invalid_user_id',
      message: 'Invalid user ID format',
    });
    return;
  }

  try {
    // Verify user exists in database
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      logger.warn('User not found', {
        path: req.path,
        method: req.method,
        userId: userId.substring(0, 10) + '...',
      });
      res.status(401).json({
        error: 'user_not_found',
        message: 'User not found or inactive',
      });
      return;
    }

    // Attach user info to request for downstream use
    (req as Request & { user?: { id: string } }).user = user;

    next();
  } catch (err) {
    logger.error('Database error during user validation', {
      path: req.path,
      method: req.method,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
    res.status(500).json({
      error: 'internal_error',
      message: 'Failed to validate user',
    });
  }
}
