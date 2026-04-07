import { Router, raw } from 'express';
import type { IRouter, Request, Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import * as stripeService from '../services/stripe.service';

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

// POST /subscription/webhook — Stripe webhook (MUST use raw body parser, NOT JSON)
router.post('/webhook', raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  try {
    const signature = req.headers['stripe-signature'] as string;
    await stripeService.handleWebhook(req.body as Buffer, signature);
    res.json({ received: true });
  } catch {
    res.status(400).json({ error: 'Webhook verification failed' });
  }
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
