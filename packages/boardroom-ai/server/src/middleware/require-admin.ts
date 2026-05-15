// Admin role guard for /admin/* routes.
//
// Launch-day approach (ADM-01 / SEC-01 / F-003):
// The User model does not yet carry an `isAdmin` flag, so we gate admin
// access on an explicit `ADMIN_USER_IDS` env-var allowlist (comma-separated
// user IDs). This is a deliberately conservative posture — anything not on
// the list is denied. The list is read fresh on every request so that
// rotating an admin out only requires a Railway env change + restart.
//
// TODO(post-launch): replace with an `isAdmin` claim on the JWT, sourced
// from `User.role`. See `docs/_audits/2026-05-15-launch-prep/track-a-followups.md`.

import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth';
import { logger } from '../lib/logger';

function getAdminAllowlist(): Set<string> {
  const raw = process.env.ADMIN_USER_IDS;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

export function isAdminUser(userId: string | undefined): boolean {
  if (!userId) return false;
  return getAdminAllowlist().has(userId);
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  const userId = req.auth?.userId;
  if (!isAdminUser(userId)) {
    logger.warn('Admin route access denied', {
      userId: userId ?? 'anonymous',
      path: req.path,
      method: req.method,
    });
    res.status(403).json({ error: 'forbidden', message: 'Admin access required' });
    return;
  }
  next();
}
