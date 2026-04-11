import { vi } from 'vitest';

export interface MockStripeCheckoutSession {
  id: string;
  url: string;
  customer_email?: string;
  subscription?: string;
  metadata?: Record<string, string>;
}

export interface MockStripeSubscription {
  id: string;
  status: string;
  trial_end?: number;
  current_period_end: number;
  metadata?: Record<string, string>;
}

export interface MockStripeInvoice {
  id: string;
  subscription?: string;
  paid: boolean;
}

export class StripeMock {
  private checkoutSessions: Map<string, MockStripeCheckoutSession> = new Map();
  private subscriptions: Map<string, MockStripeSubscription> = new Map();
  private invoices: Map<string, MockStripeInvoice> = new Map();
  private webhookEvents: any[] = [];

  // Mock Stripe client methods
  checkout = {
    sessions: {
      create: vi.fn().mockImplementation(async (params: any) => {
        const sessionId = `cs_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const session: MockStripeCheckoutSession = {
          id: sessionId,
          url: `https://checkout.stripe.com/pay/${sessionId}`,
          customer_email: params.customer_email,
          subscription: params.subscription_data?.metadata?.userId ? 
            `sub_${params.subscription_data.metadata.userId}` : undefined,
          metadata: params.metadata,
        };
        this.checkoutSessions.set(sessionId, session);
        return session;
      }),
      retrieve: vi.fn().mockImplementation(async (id: string) => {
        return this.checkoutSessions.get(id) || null;
      }),
    },
  };

  subscriptions = {
    retrieve: vi.fn().mockImplementation(async (id: string) => {
      return this.subscriptions.get(id) || null;
    }),
    update: vi.fn().mockImplementation(async (id: string, params: any) => {
      const sub = this.subscriptions.get(id);
      if (!sub) throw new Error('Subscription not found');
      
      const updatedSub = { ...sub, ...params };
      this.subscriptions.set(id, updatedSub);
      return updatedSub;
    }),
  };

  webhooks = {
    constructEvent: vi.fn().mockImplementation((payload: Buffer, signature: string, secret: string) => {
      if (secret !== process.env.STRIPE_WEBHOOK_SECRET) {
        throw new Error('Invalid webhook secret');
      }
      
      // Parse payload as JSON
      const payloadStr = payload.toString();
      const data = JSON.parse(payloadStr);
      
      const event = {
        id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: data.type || 'checkout.session.completed',
        data: { object: data.object || {} },
        created: Math.floor(Date.now() / 1000),
      };
      
      this.webhookEvents.push(event);
      return event;
    }),
  };

  // Helper methods for test setup
  createSubscription(userId: string, status: string = 'trialing') {
    const subId = `sub_${userId}`;
    const subscription: MockStripeSubscription = {
      id: subId,
      status,
      trial_end: status === 'trialing' ? Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60 : undefined,
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      metadata: { userId },
    };
    this.subscriptions.set(subId, subscription);
    return subscription;
  }

  createCheckoutSession(userId: string, email: string) {
    return this.checkout.sessions.create({
      customer_email: email,
      metadata: { userId },
      subscription_data: { metadata: { userId } },
    });
  }

  // Test assertion helpers
  assertCheckoutSessionCreated(userId: string) {
    expect(this.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ userId }),
      })
    );
  }

  assertSubscriptionRetrieved(subscriptionId: string) {
    expect(this.subscriptions.retrieve).toHaveBeenCalledWith(subscriptionId);
  }

  clearMocks() {
    this.checkoutSessions.clear();
    this.subscriptions.clear();
    this.invoices.clear();
    this.webhookEvents = [];
    vi.resetAllMocks();
  }
}

export const stripeMock = new StripeMock();

export default stripeMock;
