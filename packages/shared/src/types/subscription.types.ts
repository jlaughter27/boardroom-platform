// Subscription types — Phase 3 (Claude)
// Stripe subscription management

export enum SubscriptionStatus {
  TRIALING = 'TRIALING',
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  CANCELED = 'CANCELED',
  EXPIRED = 'EXPIRED',
}

// Client-facing subscription data (serialized dates as strings)
export interface SubscriptionData {
  id: string;
  status: SubscriptionStatus;
  plan: string;
  priceMonthly: number;
  trialEndsAt: string | null;
  currentPeriodEnd: string;
  canceledAt: string | null;
  /**
   * Derived by BoardRoom's `GET /subscription`: a cancellation was requested
   * (`canceledAt` set) but the row stays ACTIVE until `currentPeriodEnd`.
   */
  cancelAtPeriodEnd?: boolean;
}

export interface Subscription {
  id: string;
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: SubscriptionStatus;
  plan: 'pro';
  priceMonthly: number;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date;
  canceledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
