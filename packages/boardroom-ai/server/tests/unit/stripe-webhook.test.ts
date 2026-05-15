/**
 * Track C — Wave 2 critical-path test (Stripe webhook signature path).
 *
 * Depends on Track A: SUB-01 (signature verification), SUB-02 (raw body
 * propagation), SUB-09 (event idempotency) per
 *   docs/_audits/2026-05-15-launch-prep/02-backend-routes.md.
 *
 * Today's behaviour of POST /subscription/webhook:
 *   - calls stripeService.handleWebhook(req.body, signature)
 *   - on any throw -> 400 { error: 'Webhook verification failed' }
 *   - no explicit idempotency layer (Stripe replays => double-apply)
 *
 * These tests are written against the INTENDED post-Track A contract.
 * They are `.skip`-ed until SUB-01/02/09 land so CI stays green.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Application } from 'express';
import request from 'supertest';

// Mock the stripe service before importing the router
vi.mock('../../src/services/stripe.service', () => ({
  isConfigured: () => true,
  getSubscription: vi.fn(),
  createCheckout: vi.fn(),
  cancelSubscription: vi.fn(),
  handleWebhook: vi.fn(),
}));

describe('POST /subscription/webhook — signature path (SUB-01/02/09)', () => {
  let app: Application;
  let stripeService: typeof import('../../src/services/stripe.service');

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../src/routes/subscription.routes');
    stripeService = await import('../../src/services/stripe.service');

    app = express();
    // NOTE: The router itself uses express.raw() for /webhook — we do
    // not stack a JSON parser before it.
    app.use(mod.subscriptionRouter);
  });

  it('returns 200 when handleWebhook resolves (valid signature path)', async () => {
    (stripeService.handleWebhook as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const res = await request(app)
      .post('/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', 't=1,v1=valid-sig')
      .send(Buffer.from(JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' })));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  it('returns 400 when handleWebhook rejects (invalid signature)', async () => {
    (stripeService.handleWebhook as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('signature verification failed'),
    );

    const res = await request(app)
      .post('/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', 'bogus')
      .send(Buffer.from(JSON.stringify({ id: 'evt_2', type: 'checkout.session.completed' })));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Webhook verification failed' });
  });

  // TODO(SUB-01 / Track A): unskip when missing-signature is explicitly
  // rejected pre-service. Today the absent header is forwarded as
  // undefined and the service throws, which still 400s — the test
  // passes against today's surface, but the assertion below is stronger.
  it.skip('returns 400 when stripe-signature header is missing', async () => {
    const res = await request(app)
      .post('/webhook')
      .set('content-type', 'application/json')
      .send(Buffer.from(JSON.stringify({ id: 'evt_3' })));

    expect(res.status).toBe(400);
    // After Track A: the route should short-circuit before calling the
    // service when no signature header is present.
    expect(stripeService.handleWebhook).not.toHaveBeenCalled();
  });

  // TODO(SUB-09 / Track A): unskip when event-id idempotency lands. The
  // route should consult a processed-event store and short-circuit
  // duplicates with 200 (Stripe expects 2xx on replays).
  it.skip('returns 200 idempotently when the same event id is delivered twice', async () => {
    (stripeService.handleWebhook as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const payload = Buffer.from(
      JSON.stringify({ id: 'evt_dup', type: 'checkout.session.completed' }),
    );

    const first = await request(app)
      .post('/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', 't=1,v1=valid')
      .send(payload);
    const second = await request(app)
      .post('/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', 't=1,v1=valid')
      .send(payload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // The handler should be invoked only once across both deliveries.
    expect(stripeService.handleWebhook).toHaveBeenCalledTimes(1);
  });
});
