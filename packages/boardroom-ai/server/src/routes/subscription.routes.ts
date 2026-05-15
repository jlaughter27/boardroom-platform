import { Router } from 'express';
import type { IRouter } from 'express';
import type { AuthRequest } from '../middleware/auth';
import * as stripeService from '../services/stripe.service';

// NOTE: POST /subscription/webhook is intentionally NOT registered here.
// It is mounted at the top of server/src/index.ts ahead of express.json()
// and the auth wall so that (a) Stripe's signature can verify against the
// raw body and (b) Stripe's POSTs (which carry no cookie) don't 401 at the
// auth middleware. See SUB-01 / MID-01 in the launch audit.

const router: IRouter = Router();

// GET /subscription — get current user's subscription
router.get('/', async (req: AuthRequest, res, next) => {
  try {
    if (!stripeService.isConfigured()) { res.json(null); return; }
    const sub = await stripeService.getSubscription(req.auth!.userId);
    res.json(sub);
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

// POST /subscription/cancel — cancel subscription
router.post('/cancel', async (req: AuthRequest, res, next) => {
  try {
    if (!stripeService.isConfigured()) { res.json(null); return; }
    const result = await stripeService.cancelSubscription(req.auth!.userId);
    res.json(result);
  } catch (err) { next(err); }
});

export const subscriptionRouter = router;
