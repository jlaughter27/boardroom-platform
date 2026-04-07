import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth';
import { omnimindClient } from '../services/omnimind-client';

const STRIPE_CONFIGURED = !!process.env.STRIPE_SECRET_KEY;

export async function requireSubscription(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  // Dev mode — no Stripe configured, all features unlocked
  if (!STRIPE_CONFIGURED) { next(); return; }

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
  } catch {
    // If subscription check fails, let the request through (don't block on billing service errors)
    next();
  }
}
