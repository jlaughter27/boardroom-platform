import StripeConstructor from 'stripe';
import { omnimindClient } from './omnimind-client';

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

export async function handleWebhook(payload: Buffer, signature: string): Promise<void> {
  const stripe = getStripe();
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return;

  const event = stripe.webhooks.constructEvent(payload, signature, STRIPE_WEBHOOK_SECRET);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = asRecord(event.data.object);
      const userId = (session.metadata as Record<string, string> | undefined)?.userId;
      if (!userId) break;

      const subscription = asRecord(await stripe.subscriptions.retrieve(session.subscription as string));
      await omnimindClient.createSubscription(userId, {
        stripeCustomerId: session.customer as string,
        stripeSubscriptionId: subscription.id as string,
        status: 'TRIALING',
        plan: 'pro',
        priceMonthly: 2900,
        trialEndsAt: subscription.trial_end ? new Date((subscription.trial_end as number) * 1000).toISOString() : null,
        currentPeriodEnd: new Date((subscription.current_period_end as number) * 1000).toISOString(),
      });
      break;
    }

    case 'invoice.paid': {
      const invoice = asRecord(event.data.object);
      const subId = invoice.subscription as string;
      if (!subId) break;
      const stripeSub = asRecord(await stripe.subscriptions.retrieve(subId));
      const userId = (stripeSub.metadata as Record<string, string> | undefined)?.userId;
      if (userId) {
        await omnimindClient.updateSubscription(userId, {
          status: 'ACTIVE',
          currentPeriodEnd: new Date((stripeSub.current_period_end as number) * 1000).toISOString(),
        });
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
        await omnimindClient.updateSubscription(userId, { status: 'PAST_DUE' });
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = asRecord(event.data.object);
      const userId = (sub.metadata as Record<string, string> | undefined)?.userId;
      if (userId) {
        await omnimindClient.updateSubscription(userId, {
          status: 'CANCELED',
          canceledAt: new Date().toISOString(),
        });
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
