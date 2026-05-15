import StripeConstructor from 'stripe';
import { omnimindClient } from './omnimind-client';
import { logger } from '../lib/logger';

type StripeClient = ReturnType<typeof StripeConstructor>;

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;

export function isConfigured(): boolean {
  return !!(STRIPE_SECRET && STRIPE_PRICE_ID);
}

function getStripe(): StripeClient | null {
  if (!STRIPE_SECRET) return null;
  return StripeConstructor(STRIPE_SECRET);
}

// Helper to access Stripe response fields that changed in v22
// Stripe v22 wraps retrieve/update responses and restructured some fields.
// We use Record<string, unknown> to access fields that may have moved.
function asRecord(obj: unknown): Record<string, unknown> {
  return obj as Record<string, unknown>;
}

export async function createCheckout(userId: string, email: string): Promise<{ checkoutUrl: string } | null> {
  const stripe = getStripe();
  if (!stripe || !STRIPE_PRICE_ID) return null;

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    customer_email: email,
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    subscription_data: { trial_period_days: 14, metadata: { userId } },
    success_url: `${process.env.APP_URL ?? 'http://localhost:5173'}/settings?payment=success`,
    cancel_url: `${process.env.APP_URL ?? 'http://localhost:5173'}/settings?payment=canceled`,
    metadata: { userId },
  });

  return { checkoutUrl: session.url! };
}

/**
 * Distinguishable error class so the route handler can decide between a 4xx
 * (signature failure — Stripe should NOT retry) and a 5xx (internal failure
 * — Stripe SHOULD retry).
 */
export class StripeSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeSignatureError';
  }
}

// In-memory idempotency cache: Stripe event.id -> expires-at (epoch ms).
// Stripe guarantees at-least-once delivery; we want at-most-once processing.
// 24h TTL covers the worst-case Stripe retry window.
// SUB-09 follow-up: replace with Redis once we scale beyond 1 instance.
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const processedEvents = new Map<string, number>();

function isDuplicateEvent(eventId: string): boolean {
  const now = Date.now();
  // Lazy GC
  for (const [id, expiresAt] of processedEvents) {
    if (expiresAt <= now) processedEvents.delete(id);
  }
  if (processedEvents.has(eventId)) return true;
  processedEvents.set(eventId, now + IDEMPOTENCY_TTL_MS);
  return false;
}

export async function handleWebhook(payload: Buffer, signature: string): Promise<void> {
  const stripe = getStripe();
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    // Misconfiguration — surface to caller as a 5xx so Stripe retries until
    // the env is correct (SUB-09).
    throw new Error('Stripe webhook secret not configured');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    throw new StripeSignatureError(err instanceof Error ? err.message : 'signature verification failed');
  }

  // Idempotency: drop replays silently with 200 OK semantics.
  if (isDuplicateEvent(event.id)) {
    logger.info('Stripe webhook duplicate event ignored', { eventId: event.id, type: event.type });
    return;
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = asRecord(event.data.object);
      const userId = (session.metadata as Record<string, string> | undefined)?.userId;
      if (!userId) break;

      const subscription = asRecord(await stripe.subscriptions.retrieve(session.subscription as string));
      try {
        await omnimindClient.createSubscription(userId, {
          stripeCustomerId: session.customer as string,
          stripeSubscriptionId: subscription.id as string,
          status: 'TRIALING',
          plan: 'pro',
          priceMonthly: 2900,
          trialEndsAt: subscription.trial_end ? new Date((subscription.trial_end as number) * 1000).toISOString() : null,
          currentPeriodEnd: new Date((subscription.current_period_end as number) * 1000).toISOString(),
        });
      } catch (err) {
        logger.error('Failed to sync subscription to OmniMind — will rely on Stripe retry', {
          userId,
          stripeSubscriptionId: subscription.id as string,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      break;
    }

    case 'invoice.paid': {
      const invoice = asRecord(event.data.object);
      const subId = invoice.subscription as string;
      if (!subId) break;
      const stripeSub = asRecord(await stripe.subscriptions.retrieve(subId));
      const userId = (stripeSub.metadata as Record<string, string> | undefined)?.userId;
      if (userId) {
        try {
          await omnimindClient.updateSubscription(userId, {
            status: 'ACTIVE',
            currentPeriodEnd: new Date((stripeSub.current_period_end as number) * 1000).toISOString(),
          });
        } catch (err) {
          logger.error('Failed to sync subscription to OmniMind — will rely on Stripe retry', {
            userId,
            stripeSubscriptionId: subId,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = asRecord(event.data.object);
      const subId = invoice.subscription as string;
      if (!subId) break;
      const stripeSub = asRecord(await stripe.subscriptions.retrieve(subId));
      const userId = (stripeSub.metadata as Record<string, string> | undefined)?.userId;
      if (userId) {
        try {
          await omnimindClient.updateSubscription(userId, { status: 'PAST_DUE' });
        } catch (err) {
          logger.error('Failed to sync subscription to OmniMind — will rely on Stripe retry', {
            userId,
            stripeSubscriptionId: subId,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = asRecord(event.data.object);
      const userId = (sub.metadata as Record<string, string> | undefined)?.userId;
      if (userId) {
        try {
          await omnimindClient.updateSubscription(userId, {
            status: 'CANCELED',
            canceledAt: new Date().toISOString(),
          });
        } catch (err) {
          logger.error('Failed to sync subscription to OmniMind — will rely on Stripe retry', {
            userId,
            stripeSubscriptionId: sub.id as string,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
      }
      break;
    }
  }
}

export async function cancelSubscription(userId: string): Promise<{ canceledAt: Date; activeUntil: Date } | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  const sub = await omnimindClient.getSubscription(userId) as Record<string, unknown> | null;
  if (!sub?.stripeSubscriptionId) return null;

  const canceled = asRecord(await stripe.subscriptions.update(sub.stripeSubscriptionId as string, {
    cancel_at_period_end: true,
  }));

  const canceledAt = new Date();
  const activeUntil = new Date((canceled.current_period_end as number) * 1000);

  await omnimindClient.updateSubscription(userId, {
    status: 'CANCELED',
    canceledAt: canceledAt.toISOString(),
  });

  return { canceledAt, activeUntil };
}

export async function getSubscription(userId: string): Promise<unknown> {
  return omnimindClient.getSubscription(userId);
}
