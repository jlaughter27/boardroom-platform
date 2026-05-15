// require-verified-email middleware (Wave 3 Track E, UX-1.4).
//
// Hard-mode gate: when REQUIRE_VERIFIED_EMAIL=true is set in env, this middleware
// rejects requests from users whose emailVerifiedAt is null.
//
// Default (REQUIRE_VERIFIED_EMAIL unset or 'false') is SOFT mode — no
// blocking; the client renders a banner urging verification. Soft mode is
// the default so dogfooding/launch doesn't pause for SMTP issues.
//
// Apply selectively to cost-bearing routes (e.g., persona dispatch) when
// hard mode is desired.

import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth';
import { omnimindClient } from '../services/omnimind-client';
import { logger } from '../lib/logger';

interface VerifyEntry { verified: boolean; cachedAt: number }
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, VerifyEntry>();

export function __resetVerifiedCacheForTest(): void {
  cache.clear();
}

function isEnforced(): boolean {
  return process.env.REQUIRE_VERIFIED_EMAIL === 'true';
}

async function isVerified(userId: string): Promise<boolean> {
  const cached = cache.get(userId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.verified;
  try {
    const r = await omnimindClient.getEmailVerifiedAt(userId);
    const v = !!r.emailVerifiedAt;
    cache.set(userId, { verified: v, cachedAt: Date.now() });
    return v;
  } catch (err) {
    // Fail-open — don't lock people out for a downstream blip.
    logger.warn('emailVerifiedAt lookup failed', { userId, error: (err as Error).message });
    return true;
  }
}

export function requireVerifiedEmail(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!isEnforced()) { next(); return; }
  const userId = req.auth?.userId;
  if (!userId) { res.status(401).json({ error: 'unauthorized' }); return; }
  isVerified(userId)
    .then((verified) => {
      if (verified) { next(); return; }
      res.status(403).json({
        error: 'email_unverified',
        message: 'Please verify your email address before continuing.',
      });
    })
    .catch(() => next());
}
