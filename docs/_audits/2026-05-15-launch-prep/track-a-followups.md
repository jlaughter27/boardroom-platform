# Wave 2 Track A — Follow-up TODOs

Filed by the Track A agent on 2026-05-15. Items listed here are the
"minimum-viable now, polish later" remainders from the six P0 fixes.

## ADM-01 / SEC-01 — Admin role guard

**Shipped:** `ADMIN_USER_IDS` env-var allowlist + `requireAdmin` middleware
on every `/admin/*` route + `AdminOnlyRoute` gate in the client + Sidebar
hides the Admin nav for non-admins. Server returns `403 forbidden` when a
non-allowlisted user hits any admin route.

**Follow-up (post-launch):**
- Add `role: UserRole` (enum `USER`, `ADMIN`) to the OmniMind User model.
- Source `isAdmin` from `User.role` instead of an env var so admin status
  can be rotated without a redeploy.
- Carry an `isAdmin` claim on the JWT so the BoardRoom server doesn't need
  to re-derive it from env on every request.
- Audit migration: confirm every existing prod user is mapped to `USER`
  except the bootstrap admin.

## SUB-01..03, SUB-09, MID-01 — Stripe webhook fix

**Shipped:** Webhook route registered at the top of `index.ts` with
`express.raw({ type: 'application/json' })`, ahead of `express.json()` and
the auth wall. In-memory idempotency by Stripe `event.id` (Map with TTL).
`STRIPE_WEBHOOK_SECRET` is now required at boot when `NODE_ENV=production`.
Internal handler failures return 5xx so Stripe retries.

**Follow-up:**
- Replace the in-memory idempotency Map with Redis (or a row in
  OmniMind's DB) once we scale beyond a single Railway instance — the Map
  resets on every deploy.
- Migrate `current_period_end` accessors to the v22+ subscription
  `items.data[0].current_period_end` location (SUB-06/SUB-08). Out of
  scope for Track A.

## SEC-06 — OAuth state hardening

**Shipped:** Removed the `'fallback-dev-secret'` literal from
`google-calendar.service.ts`. State is now a short-lived signed JWT
(`{userId, nonce, exp}`, 10 min TTL). The nonce is stored in an in-memory
Map and is consumed on first verify — replay attempts fail.

**Follow-up:**
- Move the nonce store to OmniMind (or Redis) if we scale beyond one
  instance so a callback can land on a different node from the one that
  signed the state.
- Add a separate `OAUTH_STATE_SECRET` env var so a `JWT_SECRET` leak
  doesn't compromise OAuth signing (CAL-01 / P1).

## MID-02 — `trust proxy`

**Shipped:** `app.set('trust proxy', 1)` immediately after
`const app = express()`.

## COR-01 / ONB-01 / INT-01 / INT-02 — Subscription gating

**Shipped:** `requireSubscription` applied to `cortexRouter`,
`onboardingRouter`, `onboardingBootstrapRouter`, and the cost-bearing
sub-routes of `integrationsRouter` (`/gmail/extract`, `/gmail/confirm`).
Read-only / status routes are left ungated so paywall checks don't fire
on dashboard reads.

`subscription.middleware.ts` fail-closed on errors in production (`502
billing_check_failed`). Dev mode still falls through when
`STRIPE_SECRET_KEY` is unset.

**Follow-up:**
- Per-user-per-day rate limits on the most expensive endpoints
  (`/onboarding-bootstrap/doc`, `/onboarding-bootstrap/voice`) — see
  SEC-09 and ONB-01.
- Zod validation on `gmail/confirm` proposals array + length cap
  (SEC-13 / INT-01). Track A only applied the subscription gate; input
  validation is queued for Wave 3.

## AGT-04 — Streaming abort on client disconnect

**Shipped:** `streamClaudeResponse` and the orchestrator's SSE flows now
listen for `res.on('close')` and abort the in-flight Anthropic stream via
the SDK's abort signal.

**Follow-up:**
- Audit `agent.ts`'s tool-using path (`reasonWithTools`) to ensure the
  per-tool-round Anthropic call also respects the abort signal — Track A
  only wired the streaming path.
