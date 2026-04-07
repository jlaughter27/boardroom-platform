// Subscription Zod schemas — matches packages/shared/src/types/subscription.types.ts

import { z } from 'zod';
import { SubscriptionStatus } from '../types/subscription.types';

// ── Enum Schema ──

export const SubscriptionStatusSchema = z.nativeEnum(SubscriptionStatus)
  .describe('Current subscription status');

// ── Subscription Schema ──

export const SubscriptionSchema = z.object({
  id: z.string().describe('Unique subscription identifier (cuid)'),
  userId: z.string().describe('Owner user identifier'),
  stripeCustomerId: z.string().describe('Stripe customer identifier'),
  stripeSubscriptionId: z.string().describe('Stripe subscription identifier'),
  status: SubscriptionStatusSchema.describe('Current subscription status'),
  plan: z.literal('pro').describe('Subscription plan'),
  priceMonthly: z.number().describe('Monthly price in cents'),
  trialEndsAt: z.coerce.date().nullable().describe('Trial end date'),
  currentPeriodEnd: z.coerce.date().describe('Current billing period end date'),
  canceledAt: z.coerce.date().nullable().describe('When subscription was canceled'),
  createdAt: z.coerce.date().describe('Creation timestamp'),
  updatedAt: z.coerce.date().describe('Last update timestamp'),
});

export type SubscriptionInput = z.infer<typeof SubscriptionSchema>;
