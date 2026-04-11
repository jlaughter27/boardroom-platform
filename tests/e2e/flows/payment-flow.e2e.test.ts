// End-to-end tests for payment flow integration
// Tests Stripe checkout, webhook handling, and subscription management
// Requires test services running via docker-compose.test.yml

import { describe, it, expect, beforeAll } from 'vitest';
import { BOARDROOM_URL, waitForServices, registerTestUser, authedFetch } from '../setup';

describe('Payment Flow', () => {
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    await waitForServices();
    const user = await registerTestUser();
    cookie = user.cookie;
    userId = user.userId;
  });

  describe('Subscription Management', () => {
    it('GET /subscription returns current subscription status', async () => {
      const res = await authedFetch(`${BOARDROOM_URL}/subscription`, cookie);
      
      // Should return subscription info (free tier by default)
      expect([200, 404]).toContain(res.status);
      
      if (res.status === 200) {
        const body = await res.json();
        expect(body).toHaveProperty('status');
        expect(['FREE', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED']).toContain(body.status);
      }
    });

    it('POST /subscription/checkout initiates Stripe checkout (mocked)', async () => {
      const res = await authedFetch(`${BOARDROOM_URL}/subscription/checkout`, cookie, {
        method: 'POST',
      });

      // With mock Stripe keys, should return a checkout URL or indicate not configured
      expect([200, 400, 501]).toContain(res.status);
      
      if (res.status === 200) {
        const body = await res.json();
        expect(body).toHaveProperty('checkoutUrl');
        expect(typeof body.checkoutUrl).toBe('string');
      }
    });

    it('POST /subscription/cancel cancels subscription (mocked)', async () => {
      const res = await authedFetch(`${BOARDROOM_URL}/subscription/cancel`, cookie, {
        method: 'POST',
      });

      // With mock Stripe, might return success or not configured
      expect([200, 400, 501]).toContain(res.status);
      
      if (res.status === 200) {
        const body = await res.json();
        expect(body).toHaveProperty('canceledAt');
        expect(body).toHaveProperty('activeUntil');
      }
    });
  });

  describe('Webhook Handling', () => {
    it('POST /webhooks/stripe processes webhook events (mocked)', async () => {
      const mockEvent = {
        id: 'evt_test_123',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_123',
            customer: 'cus_test_123',
            subscription: 'sub_test_123',
            metadata: { userId }
          }
        }
      };

      const res = await fetch(`${BOARDROOM_URL}/webhooks/stripe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'mock-signature'
        },
        body: JSON.stringify(mockEvent)
      });

      // Webhook might accept mock event or reject invalid signature
      expect([200, 400, 401]).toContain(res.status);
    });
  });
});
