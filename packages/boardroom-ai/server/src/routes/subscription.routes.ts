import { Router } from 'express';
import type { IRouter, Request, Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import * as stripeService from '../services/stripe.service';

const router: IRouter = Router();

// GET /subscription — current user's subscription.
// CONTRACT (C-104): { configured: boolean, subscription: <OmniMind shape> | null }
// `configured` is false when STRIPE_SECRET_KEY is unset. When a cancellation
// has been requested (B-108) the row stays ACTIVE with canceledAt set, and we
// surface that as a derived `cancelAtPeriodEnd` flag.
router.get('/', async (req: AuthRequest, res, next) => {
  try {
    if (!stripeService.isConfigured()) { res.json({ configured: false, subscription: null }); return; }
    const sub = await stripeService.getSubscription(req.auth!.userId) as Record<string, unknown> | null;
    const subscription = sub
      ? { ...sub, cancelAtPeriodEnd: Boolean(sub.canceledAt) && sub.status !== 'CANCELED' }
      : null;
    res.json({ configured: true, subscription });
  } catch (err) { next(err); }
});

// POST /subscription/checkout — create Stripe checkout session
router.post('/checkout', async (req: AuthRequest, res, next) => {
  try {
    if (!stripeService.isConfigured()) { res.json({ checkoutUrl: null, message: 'Payments not configured' }); return; }
    const result = await stripeService.createCheckout(req.auth!.userId, req.auth!.email);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /subscription/webhook — Stripe webhook handler.
// B-103: NOT mounted on this router. index.ts registers it directly with
// `express.raw({ type: 'application/json' })` BEFORE express.json() and BEFORE
// the auth wall (Stripe has no cookie; JSON parsing would break the signature).
export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  try {
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      // Don't silently 200 an event we cannot verify — Stripe will retry once configured.
      res.status(503).json({ error: 'webhook_not_configured' });
      return;
    }
    const signature = req.headers['stripe-signature'] as string;
    if (!signature || !Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: 'Webhook verification failed' });
      return;
    }
    await stripeService.handleWebhook(req.body as Buffer, signature);
    res.json({ received: true });
  } catch {
    res.status(400).json({ error: 'Webhook verification failed' });
  }
}

// POST /subscription/cancel — cancel subscription
router.post('/cancel', async (req: AuthRequest, res, next) => {
  try {
    if (!stripeService.isConfigured()) { res.json(null); return; }
    const result = await stripeService.cancelSubscription(req.auth!.userId);
    res.json(result);
  } catch (err) { next(err); }
});

export const subscriptionRouter = router;
