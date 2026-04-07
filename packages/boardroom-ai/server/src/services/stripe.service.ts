import Stripe from 'stripe';
import { omnimindClient } from './omnimind-client';

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;

export function isConfigured(): boolean {
  return !!(STRIPE_SECRET && STRIPE_PRICE_ID);
}

function getStripe(): Stripe | null {
  if (!STRIPE_SECRET) return null;
  return new Stripe(STRIPE_SECRET);
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
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      if (!userId) break;

      const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
      await omnimindClient.createSubscription(userId, {
        stripeCustomerId: session.customer as string,
        stripeSubscriptionId: subscription.id,
        status: 'TRIALING',
        plan: 'pro',
        priceMonthly: 2900,
        trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
      });
      break;
    }

    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = invoice.subscription as string;
      if (!subId) break;
      // Retrieve the Stripe subscription to get the userId from metadata
      const stripeSub = await stripe.subscriptions.retrieve(subId);
      const userId = stripeSub.metadata?.userId;
      if (userId) {
        await omnimindClient.updateSubscription(userId, {
          status: 'ACTIVE',
          currentPeriodEnd: new Date(stripeSub.current_period_end * 1000).toISOString(),
        });
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = invoice.subscription as string;
      if (!subId) break;
      const stripeSub = await stripe.subscriptions.retrieve(subId);
      const userId = stripeSub.metadata?.userId;
      if (userId) {
        await omnimindClient.updateSubscription(userId, { status: 'PAST_DUE' });
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const userId = sub.metadata?.userId;
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

  const canceled = await stripe.subscriptions.update(sub.stripeSubscriptionId as string, {
    cancel_at_period_end: true,
  });

  const canceledAt = new Date();
  const activeUntil = new Date(canceled.current_period_end * 1000);

  await omnimindClient.updateSubscription(userId, {
    status: 'CANCELED',
    canceledAt: canceledAt.toISOString(),
  });

  return { canceledAt, activeUntil };
}

export async function getSubscription(userId: string): Promise<unknown> {
  return omnimindClient.getSubscription(userId);
}
