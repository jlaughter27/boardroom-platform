// Stripe webhook handler.
//
// Mounted at the TOP of server/src/index.ts (before express.json() and the
// auth wall) because:
//   1. Signature verification requires the raw request body.
//   2. Stripe's POST has no cookie — the auth wall would 401 it.
//
// See SUB-01 / SUB-02 / SUB-03 / SUB-09 / MID-01 in the launch audit.

import type { Request, Response } from 'express';
import * as stripeService from '../services/stripe.service';
import { logger } from '../lib/logger';

export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  const signature = req.headers['stripe-signature'] as string | undefined;
  if (!signature) {
    res.status(400).json({ error: 'missing_signature' });
    return;
  }

  try {
    // req.body is a Buffer here because express.raw() was applied at the
    // mount site (see index.ts).
    await stripeService.handleWebhook(req.body as Buffer, signature);
    res.json({ received: true });
  } catch (err) {
    if (err instanceof stripeService.StripeSignatureError) {
      // Bad signature — do NOT retry. 400 keeps Stripe quiet.
      logger.warn('Stripe webhook signature verification failed', { message: err.message });
      res.status(400).json({ error: 'signature_verification_failed' });
      return;
    }
    // Internal failure (OmniMind down, schema mismatch, etc.) — return 5xx
    // so Stripe retries (SUB-09). Do NOT leak the underlying message.
    logger.error('Stripe webhook handler failed — Stripe will retry', {
      message: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'webhook_handler_failed' });
  }
}
