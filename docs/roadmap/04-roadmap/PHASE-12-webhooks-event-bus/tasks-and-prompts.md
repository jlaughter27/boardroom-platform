# PHASE 12 — Tasks & Prompts

---

## Task 12.1 — Lock the event taxonomy + envelope schema

**Scope:** Documentation-first. Lock event names, envelope shape, per-event `data` schemas before any code.

**Prompt:**
> Read `docs/research/omnimind-roadmap-2026/wave1-research/04-external-interfaces.md` §9. Write `docs/contracts/webhook-events.contract.md` defining: (1) the canonical envelope shape (id, type, data_schema_version, occurred_at, user_id, data, previous_attributes), (2) the event taxonomy convention (noun.verb past-tense, dot-separated, lowercase), (3) v1 event list with one paragraph rationale each: `memory.created`, `memory.updated`, `memory.deleted`, `decision.synthesized`, `commitment.completed`, `persona.invoked`, `entity.linked`, `cortex.weekly_memo.published`, (4) for each event, the Zod schema of its `data` payload (refer to existing types in `packages/shared/src/types/`), (5) signature header format `X-Omnimind-Signature: t={ts},v1={hmac}`, (6) retry policy (1s, 5s, 25s, 2m, 10m, 1h, 6h; dead at 24h), (7) ordering guarantee (per-user FIFO by `occurred_at`; cross-user no guarantee). No code. Get my approval before Task 12.2.

**Verification:** Contract doc exists; reviewed and approved.

---

## Task 12.2 — Schema migration: outbox + endpoints + deliveries

**Scope:** Add three tables to `prisma/schema.prisma`.

**Prompt:**
> In `packages/omnimind-api/prisma/schema.prisma`: add three models. (1) `OutboxEvent { id String @id @default(cuid()), type String, dataSchemaVersion Int @default(1), occurredAt DateTime @default(now()), userId String, data Json, previousAttributes Json?, createdAt DateTime @default(now()), processedAt DateTime?, @@index([processedAt]), @@index([userId, occurredAt]) }`. (2) `WebhookEndpoint { id, userId, url String, secret String (encrypted via existing ENCRYPTION_KEY mechanism), events String[] (PG array), isActive Boolean @default(true), createdAt, updatedAt, @@index([userId, isActive]) }`. (3) `WebhookDelivery { id, endpointId, eventId, attemptCount Int @default(0), status enum('pending'|'succeeded'|'failed'|'dead'), nextAttemptAt DateTime, lastAttemptedAt DateTime?, lastResponseStatus Int?, lastResponseBody String?, lastError String?, createdAt, @@index([status, nextAttemptAt]) }`. Encrypt secrets at rest using the same pattern as `OAuthToken`. Generate Zod schemas in `packages/shared/src/validation/`.

**Verification:** `pnpm prisma generate && pnpm typecheck` clean; new tables visible via `prisma db push` to local Postgres.

---

## Task 12.3 — Outbox writer helper + integrate into write paths

**Scope:** Single helper `emitEvent(tx, eventType, userId, data, previousAttributes?)` callable inside any Prisma transaction. Wire into every relevant write path.

**Prompt:**
> In `packages/omnimind-api/src/events/`: create `outbox.ts` exporting `emitEvent(tx: Prisma.TransactionClient, type: string, userId: string, data: unknown, previousAttributes?: unknown): Promise<void>`. Validates `type` against the registered taxonomy (Zod enum from contract); validates `data` against the per-event schema; writes the row using the passed transaction client (NOT a new connection). Then go to every write path that should emit and add a call: `packages/omnimind-api/src/memory/validation/pipeline.ts` (memory.created/updated/deleted), `packages/omnimind-api/src/services/decision.service.ts` (decision.synthesized), `packages/omnimind-api/src/services/commitment.service.ts` (commitment.completed), agent orchestrator in BoardRoom (persona.invoked — but this is in the BoardRoom package; emit from OmniMind side via the existing post-session memory write path), entity link services (entity.linked), weekly memo service (cortex.weekly_memo.published). EVERY add must be inside the same `prisma.$transaction` block as the entity write — verify by reading each call site. Add integration test `tests/integration/events/transactional-emit.test.ts` that forces a memory write to fail and verifies no outbox event was emitted.

**Verification:** Integration test green; manual code review confirms every emit is transactional.

---

## Task 12.4 — Webhook endpoint CRUD routes

**Scope:** User-facing API for registering/listing/updating/deleting webhook endpoints.

**Prompt:**
> In `packages/omnimind-api/src/routes/`: create `webhooks.routes.ts`. Routes (all auth-required): `POST /webhooks` (body: `{ url, events: string[] }`; generates a per-endpoint secret, returns the secret ONCE in the response, never again), `GET /webhooks` (lists user's endpoints, no secrets), `GET /webhooks/:id` (no secret), `PATCH /webhooks/:id` (update url/events/isActive), `DELETE /webhooks/:id` (soft-delete via isActive=false; hard-delete after 30d cron), `POST /webhooks/:id/rotate-secret` (returns new secret once). Validate inputs with Zod. Cap each user at 5 active endpoints (constant in `packages/shared/src/constants/`). Add unit + integration tests.

**Verification:** Tests green; manual: POST creates an endpoint, secret returned exactly once, subsequent GETs omit secret.

---

## Task 12.5 — Delivery worker

**Scope:** The worker that drains the outbox to webhook endpoints with retry + signing.

**Prompt:**
> In `packages/omnimind-api/src/events/`: create `delivery-worker.ts`. Loop: `SELECT … FROM "OutboxEvent" WHERE "processedAt" IS NULL ORDER BY "occurredAt" LIMIT 100 FOR UPDATE SKIP LOCKED`. For each event, find matching endpoints (`WebhookEndpoint` rows where `userId` matches AND `events` array contains the type AND `isActive`). Create a `WebhookDelivery` row per (event, endpoint) pair. Then drain the deliveries: `SELECT … FROM "WebhookDelivery" WHERE status='pending' AND "nextAttemptAt" <= now() LIMIT 100 FOR UPDATE SKIP LOCKED`. For each: build the envelope, compute `X-Omnimind-Signature: t={unix_ts},v1={hmac_sha256_hex(body, secret)}`, POST with 10s timeout, on 2xx mark succeeded, on 4xx (except 408/429) mark failed (do NOT retry — body is malformed from subscriber's perspective), on 5xx/timeout/network error compute next attempt via the documented backoff (1s, 5s, 25s, 2m, 10m, 1h, 6h), increment attemptCount, update nextAttemptAt. After 7 failed attempts (= 24h+ elapsed), mark status='dead'. Run via node-cron every 5s in v1. Add metrics (Phase 14 will scrape these): events emitted, deliveries succeeded, deliveries failed, deliveries dead, p95 delivery latency.

**Verification:** Integration test: register endpoint pointing at a local mock (use `nock` or a tiny in-test Express), emit a memory.created, observe delivery within 10s with valid signature; mock returns 500 a few times to verify backoff math; mock stays 500 to verify the dead status.

---

## Task 12.6 — User-facing webhook guide + signature verification examples

**Scope:** Docs.

**Prompt:**
> Write `docs/USER-WEBHOOKS-GUIDE.md` covering: how to register an endpoint, the envelope schema, signature verification in Node (using `crypto.createHmac`) and curl/bash, replay-attack mitigation (reject if `t` is older than 5 min), idempotency tips (use the envelope `id` as a dedupe key — at-least-once delivery means duplicates are possible), how to debug failed deliveries (`GET /webhooks/:id/deliveries?status=failed`), how to test locally (point at ngrok or webhook.site). Include a worked example for a "save to Notion when memory.created" workflow using Zapier or n8n.

**Verification:** Docs reviewed; copy-paste signature verification snippet against a known-good payload returns valid.

---

## Task 12.7 — Admin replay endpoint

**Scope:** Admin-only endpoint to replay specific deliveries (for debugging) or bulk-replay an endpoint's failures.

**Prompt:**
> In `packages/omnimind-api/src/routes/`: create `webhook-admin.routes.ts`, mounted under `/admin/` with admin-API-key auth (separate from the user JWT — use a long-lived shared secret in env `ADMIN_API_KEY`). Routes: `POST /admin/webhooks/:deliveryId/replay` (resets a single delivery to pending with `nextAttemptAt = now()`), `POST /admin/webhooks/endpoints/:id/replay-failed?since=ISO_DATE` (resets all `failed` or `dead` deliveries for that endpoint since the date). Add audit logging — every admin action writes a `AdminActionLog` row (or to the existing logger if no table exists yet). Document in `docs/DEPLOYMENT-RUNBOOK.md`.

**Verification:** Manual: simulate a dead delivery, replay via admin endpoint, observe successful delivery to a working mock endpoint.

---

## Task 12.8 — Eval scenario: 24h failure → dead

**Scope:** End-to-end eval that exercises the full retry-then-dead pipeline.

**Prompt:**
> In `eval/scenarios/`: create `webhook-dead-letter.scenario.ts`. Setup: register an endpoint pointing at a controllable mock that always returns 503. Emit a `memory.created` event. Use Vitest fake timers to advance through the retry schedule (1s, 5s, 25s, 2m, 10m, 1h, 6h). Assert: 7 attempt rows in `WebhookDelivery`, final status='dead', no further attempts after that. Then test the admin replay path: change mock to return 200, replay, observe success.

**Verification:** `npm run eval:all` includes the scenario and passes.
