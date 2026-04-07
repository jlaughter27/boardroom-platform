import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth';
import { RATE_LIMITS } from '@boardroom/shared';

interface UserLimits {
  ceoDispatchCount: number;
  sessionCount: number;
  sessionResetAt: number;  // daily reset
  currentSessionId: string | null;
  dispatchResetAt: number; // per-session reset
}

const userLimits = new Map<string, UserLimits>();

function getUserLimits(userId: string): UserLimits {
  const now = Date.now();
  let limits = userLimits.get(userId);

  if (!limits) {
    limits = {
      ceoDispatchCount: 0,
      sessionCount: 0,
      sessionResetAt: now + 24 * 60 * 60 * 1000,
      currentSessionId: null,
      dispatchResetAt: now,
    };
    userLimits.set(userId, limits);
    return limits;
  }

  // Reset daily session count
  if (now > limits.sessionResetAt) {
    limits.sessionCount = 0;
    limits.sessionResetAt = now + 24 * 60 * 60 * 1000;
  }

  return limits;
}

export function checkSessionLimit(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.auth) { next(); return; }
  const limits = getUserLimits(req.auth.userId);

  if (req.path.match(/^\/[^/]+\/dispatch$/) && req.method === 'POST') {
    if (limits.ceoDispatchCount >= RATE_LIMITS.CEO_MODE_PER_SESSION) {
      res.status(429).json({
        error: 'rate_limited',
        message: `CEO mode dispatch limit reached (${RATE_LIMITS.CEO_MODE_PER_SESSION} per session)`,
        retryAfter: 0,
      });
      return;
    }
    limits.ceoDispatchCount++;
  }

  if (req.path === '/' && req.method === 'POST') {
    if (limits.sessionCount >= RATE_LIMITS.SESSIONS_PER_DAY) {
      const retryAfter = Math.ceil((limits.sessionResetAt - Date.now()) / 1000);
      res.status(429).json({
        error: 'rate_limited',
        message: `Daily session limit reached (${RATE_LIMITS.SESSIONS_PER_DAY} per day)`,
        retryAfter,
      });
      return;
    }
    limits.sessionCount++;
    limits.ceoDispatchCount = 0; // Reset dispatch count for new session
  }

  next();
}
