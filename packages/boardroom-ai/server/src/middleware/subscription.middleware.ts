import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth';
import { omnimindClient } from '../services/omnimind-client';
import { logger } from '../lib/logger';

export async function requireSubscription(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  // Dev mode — no Stripe configured, all features unlocked.
  // Read lazily so tests and hot-reloaded envs take effect.
  if (!process.env.STRIPE_SECRET_KEY) { next(); return; }

  try {
    const sub = await omnimindClient.getSubscription(req.auth!.userId) as Record<string, unknown> | null;

    if (!sub) {
      res.status(402).json({ error: 'subscription_required', message: 'Please subscribe to continue' });
      return;
    }

    if (sub.status === 'TRIALING' || sub.status === 'ACTIVE') {
      next();
      return;
    }

    if (sub.status === 'PAST_DUE') {
      res.setHeader('X-Subscription-Warning', 'payment_past_due');
      next();
      return;
    }

    // CANCELED or EXPIRED
    res.status(402).json({ error: 'subscription_expired', message: 'Your subscription has expired' });
  } catch (err) {
    // SUB-03: fail-CLOSED in production. The previous behaviour was
    // `next()` (fail-open) which means any OmniMind outage instantly
    // unlocked every paid feature for every user. In dev we still pass
    // through so local hacking isn't blocked by a flaky OmniMind.
    logger.error('Subscription check failed', {
      userId: req.auth?.userId,
      message: err instanceof Error ? err.message : String(err),
      path: req.path,
    });

    if (process.env.NODE_ENV === 'production') {
      res.status(503).json({
        error: 'billing_check_failed',
        message: 'Unable to verify your subscription. Please retry shortly.',
      });
      return;
    }

    // Dev / test: pass through so local work isn't blocked.
    next();
  }
}
