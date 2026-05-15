/**
 * Stripe webhook handler — signature path tests (SUB-01/02/09).
 *
 * Track A landed the implementation:
 *   - Handler moved out of subscription.routes.ts into routes/stripe-webhook.ts
 *   - express.raw() applied at mount in index.ts so req.body is a Buffer
 *   - Missing signature short-circuits to 400 (SUB-01)
 *   - StripeSignatureError -> 400 (Stripe should NOT retry)
 *   - Any other thrown error -> 500 (Stripe SHOULD retry)
 *   - In-memory idempotency dedup inside stripe.service.handleWebhook (SUB-09)
 *
 * Audit IDs: SUB-01 / SUB-02 / SUB-09 in
 *   docs/_audits/2026-05-15-launch-prep/02-backend-routes.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Application } from 'express';
import request from 'supertest';

// Mock the stripe service, but re-export the real StripeSignatureError class
// so the route handler's `instanceof` check works.
vi.mock('../../src/services/stripe.service', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/services/stripe.service')>(
      '../../src/services/stripe.service',
    );
  return {
    ...actual,
    handleWebhook: vi.fn(),
  };
});

describe('POST /webhook (stripe-webhook handler) — signature path', () => {
  let app: Application;
  let stripeService: typeof import('../../src/services/stripe.service');

  beforeEach(async () => {
    vi.clearAllMocks();
    const { stripeWebhookHandler } = await import('../../src/routes/stripe-webhook');
    stripeService = await import('../../src/services/stripe.service');

    app = express();
    // Mirror the production mount: raw body parser, then the handler.
    app.post('/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);
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

  it('returns 400 when handleWebhook rejects with StripeSignatureError (invalid sig)', async () => {
    (stripeService.handleWebhook as ReturnType<typeof vi.fn>).mockRejectedValue(
      new stripeService.StripeSignatureError('bad sig'),
    );

    const res = await request(app)
      .post('/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', 'bogus')
      .send(Buffer.from(JSON.stringify({ id: 'evt_2', type: 'checkout.session.completed' })));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'signature_verification_failed' });
  });

  it('returns 400 with missing_signature when stripe-signature header is absent (SUB-01)', async () => {
    const res = await request(app)
      .post('/webhook')
      .set('content-type', 'application/json')
      .send(Buffer.from(JSON.stringify({ id: 'evt_3' })));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'missing_signature' });
    // Short-circuits before invoking the service.
    expect(stripeService.handleWebhook).not.toHaveBeenCalled();
  });

  it('returns 500 when handleWebhook rejects with a non-signature error (Stripe should retry)', async () => {
    (stripeService.handleWebhook as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('OmniMind unreachable'),
    );

    const res = await request(app)
      .post('/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', 't=1,v1=valid')
      .send(Buffer.from(JSON.stringify({ id: 'evt_4', type: 'invoice.paid' })));

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'webhook_handler_failed' });
  });

  // Idempotency lives inside stripe.service.handleWebhook (in-memory Map keyed
  // by event.id, 24h TTL). Because we mock handleWebhook at the route boundary
  // here, dedup cannot be exercised in this unit. It belongs in a
  // stripe.service unit test or an integration test that exercises the real
  // service against a fixture-signed payload.
  it.skip('SUB-09 idempotency (covered by service-level test — see follow-ups)', () => {
    expect(true).toBe(true);
  });
});
