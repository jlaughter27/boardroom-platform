# PHASE 12 — Webhooks & Event Bus

**Time budget:** 2 weeks
**Sequence:** Ships BEFORE the SDK (Phase 13). The SDK references the webhook envelope shape, so locking the schema here de-risks Phase 13.
**Owner:** dev
**Confidence:** HIGH (well-trodden pattern; outbox + delivery worker is textbook)

---

## What this is

Make OmniMind a **platform** by emitting durable events when memories are written, decisions are synthesized, commitments are completed, etc. Without webhooks, the SDK is "polite polling." With them, OmniMind becomes the brain and every other tool (Zapier, n8n, Make, the user's task manager) is a hand.

Concretely:

- **Outbox pattern.** Every state-changing operation writes an `OutboxEvent` row in the same Postgres transaction as the entity write. A worker drains the outbox to subscribed webhooks.
- **Event taxonomy.** Noun-verb past-tense, dot-separated, lowercase: `memory.created`, `memory.updated`, `memory.deleted`, `decision.synthesized`, `commitment.completed`, `persona.invoked`, `entity.linked`, `cortex.weekly_memo.published`. Versioned via `data_schema_version` field inside the envelope (NOT in the event name).
- **Envelope shape (locked here, referenced by Phase 13 SDK):**
  ```json
  {
    "id": "evt_01HXYZ...",
    "type": "memory.created",
    "data_schema_version": 1,
    "occurred_at": "2026-04-18T14:32:00.123Z",
    "user_id": "usr_...",
    "data": { ... },
    "previous_attributes": { ... }    // for *.updated only
  }
  ```
- **Signed delivery.** `X-Omnimind-Signature: t={ts},v1={hmac-sha256(body, secret)}` per Stripe's pattern. Per-endpoint secret stored encrypted in `WebhookEndpoint.secret`.
- **Retry policy.** Exponential backoff: 1s, 5s, 25s, 2m, 10m, 1h, 6h. After 6h failure, mark `delivery_failed`; after 24h, mark `dead`.
- **Dead-letter queue + replay UI.** Failed deliveries persist in `WebhookDelivery` table; admin endpoint to replay individual events or bulk replay an endpoint's failures.
- **Per-endpoint event filtering.** Subscriber declares `events: string[]` on registration; we deliver only matched events.
- **Hand-rolled, not Svix.** At this scale (likely <1k events/day in v1), the outbox + worker is ~500 lines. Svix is gold-standard but adds a vendor dependency we don't yet need.

---

## Why now (before the SDK)

1. **Schema lock.** The SDK's webhook helper types and event-handler ergonomics depend on the envelope shape. Ship webhooks first, lock the shape, then the SDK consumes it.
2. **Distribution leverage.** Zapier/n8n/Make integrations require webhooks; without them, OmniMind is a closed loop.
3. **Observability dividend.** The outbox table is itself an event log; useful for debugging "where did this output come from" without building a full audit table (DEF-009).

## Prerequisites

- Phase 0-9 complete
- `MemoryEntry`, `Decision`, `Commitment` write paths identified — every service that mutates these gets an outbox write added in the same transaction
- Decision: hand-roll vs Svix (default: hand-roll; revisit at 100+ subscribed endpoints)

## Exit criteria

- [ ] `OutboxEvent`, `WebhookEndpoint`, `WebhookDelivery` tables in `prisma/schema.prisma`
- [ ] At least 8 event types emitted: `memory.{created,updated,deleted}`, `decision.synthesized`, `commitment.completed`, `persona.invoked`, `entity.linked`, `cortex.weekly_memo.published`
- [ ] Outbox writes happen in the same transaction as the entity write (verified by integration test)
- [ ] Delivery worker drains outbox with the documented retry policy
- [ ] HMAC signature verification example in `docs/USER-WEBHOOKS-GUIDE.md` for both Node and curl
- [ ] Admin replay endpoint: `POST /admin/webhooks/{deliveryId}/replay`
- [ ] Per-tenant: a user can register up to 5 endpoints; events delivered per endpoint filter
- [ ] Dead-letter table populated for unreachable endpoints; eval scenario covers a 24h-failing endpoint becomes `dead`
- [ ] `docs/contracts/webhook-events.contract.md` documents envelope + every event type's `data` schema (Zod)

## Dependencies

- **Upstream:** none beyond mem0 core
- **Downstream blocks:** Phase 13 SDK (envelope shape lock); Phase 17 Persona Marketplace (personas may want to subscribe to memory events for context)
- **Concurrency:** Sequential before Phase 13. Cannot ship in parallel — schema lock is the whole point.

## Blast radius

- **Touches every write path** in OmniMind. Adds an outbox write to: memory creation, decision synthesis, commitment completion, persona invocation, entity link creation, weekly memo publication. Each addition is a 2-3 line edit inside an existing transaction block.
- **New worker process.** In v1, runs in-process (node-cron polling the outbox every 5s). Phase 18 moves it to graphile-worker.
- **Risk:** an outbox write that fails INSIDE the entity transaction rolls back the entity write. Mitigation: outbox writes use the same transaction, AFTER the entity write, so the entity write succeeds OR both fail together. Never silently drop events.
- **Rollback:** `WEBHOOKS_ENABLED=false` env flag stops the delivery worker; outbox keeps accumulating (cheap) and resumes on re-enable.

---

**Constraints reminder:** Respect ADR-001 (no frameworks), ADR-002 (Anthropic only), ADR-003 (pgvector only), ADR-009 (node-cron only). All prompts in `docs/prompts/*.system.md`. All LLM tool outputs Zod-validated. CLAUDE.md service-boundary rules apply.
