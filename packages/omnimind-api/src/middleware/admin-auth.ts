import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { logger } from '../lib/logger';

/**
 * F-104 — admin surface requires its own secret, separate from the shared
 * service key every MCP agent and BoardRoom hold.
 *
 *   OMNIMIND_ADMIN_KEY set      → `x-admin-key` must match (timing-safe) → else 401
 *   unset, NODE_ENV=production  → 503 with a clear message (admin disabled)
 *   unset, non-production       → pass through (dev convenience), warn once
 */

let warnedUnset = false;

export function __resetAdminAuthForTest(): void {
  warnedUnset = false;
}

/** True when the request carries a valid x-admin-key. False when no admin key is configured. */
export function isAdminRequest(req: Request): boolean {
  const expected = process.env.OMNIMIND_ADMIN_KEY;
  if (!expected) return false;
  const provided = req.headers['x-admin-key'];
  if (typeof provided !== 'string') return false;
  return (
    provided.length === expected.length &&
    timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  );
}

export const requireAdminKey = (req: Request, res: Response, next: NextFunction): void => {
  const expected = process.env.OMNIMIND_ADMIN_KEY;

  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      res.status(503).json({
        error: 'admin_disabled',
        message:
          'Admin routes are disabled: OMNIMIND_ADMIN_KEY is not configured on this service. ' +
          'Set it (and send it as x-admin-key) to enable /admin/* and agent registration.',
      });
      return;
    }
    if (!warnedUnset) {
      warnedUnset = true;
      logger.warn('OMNIMIND_ADMIN_KEY is not set — admin routes are protected only by OMNIMIND_API_KEY (non-production)');
    }
    next();
    return;
  }

  if (!isAdminRequest(req)) {
    logger.warn('Admin request rejected: invalid or missing x-admin-key', { path: req.path, ip: req.ip });
    res.status(401).json({ error: 'admin_unauthorized', message: 'Invalid or missing x-admin-key header' });
    return;
  }

  next();
};
