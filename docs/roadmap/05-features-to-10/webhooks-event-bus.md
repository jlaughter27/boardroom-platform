# Webhooks + Event Bus

> Constraints reminder: Respect ADRs 001-013. See [`../01-foundations/CONSTRAINTS.md`](../01-foundations/CONSTRAINTS.md).

---

## Problem

When OmniMind writes a memory, who needs to know? Today: nobody but the BoardRoom session that triggered it. As soon as we have third-party integrators (the SDK consumers, MCP clients, marketplace personas) plus user-built automations on Zapier / n8n / Make, that answer expands fast: a calendar app wants to know when a `commitment.completed` fires, an analytics pipeline wants every `decision.synthesized`, the user's task manager wants `task.created` events.

Without a webhook layer, every consumer reduces to **polite polling against the SDK** — wasteful, slow, and impossible to scale. With it, OmniMind becomes "the brain, every other tool the hands" with no in-house glue code per integration. Stripe, GitHub, and Linear all built their platforms around webhooks for the same reason.

## Approach

Two surfaces, one source of truth:

1. **Webhooks** for individual integrations. HTTP POST to user-registered endpoints. HMAC-signed payloads. At-least-once delivery. Exponential backoff. Dead-letter after N failures. Per-endpoint secrets. Replay UI.
2. **Event bus** (internal) for fanout. Postgres `LISTEN/NOTIFY` works to a few hundred subscribers and is enough through Phase 16. Beyond that, Redis Streams or NATS JetStream — but defer until measured pressure.

### Outbox pattern

Every event write happens **inside the same transaction as the domain write**:

```ts
await prisma.$transaction([
  prisma.memoryEntry.create({ data: memoryRow }),
  prisma.eventOutbox.create({
    data: {
      type: 'memory.created',
      payload: { id: memoryRow.id, /* ... */ },
      tenantId: userId,
    },
  }),
])
```

A `graphile-worker` job (see [observability-suite.md](observability-suite.md)) drains the outbox to webhook endpoints and the internal event bus. This is the pattern every payments system eventually builds; we build it on day one.

### Event taxonomy

Noun-verb past-tense, version-prefixed envelope:

| Event | Fired when |
|---|---|
| `memory.created` | new MemoryEntry passes validation |
| `memory.updated` | content/confidence/links change |
| `memory.deleted` | soft-delete |
| `decision.synthesized` | CEO persona finishes synthesis |
| `decision.assumption.flagged` | cortex contradicts an assumption |
| `entity.created` | Person/Goal/Project/Task created |
| `entity.linked` | a new MemoryEntityLink or GoalProjectLink row |
| `commitment.created` / `.completed` / `.deferred` | commitment lifecycle |
| `weekly.memo.published` | cortex weekly memo job finishes |
| `pattern.detected` | cortex thinking-pattern job finishes |
| `contradiction.alert.created` | cortex contradiction job finishes |
| `vault.exported` | markdown export completes |

Envelope:

```json
{
  "event": "memory.created",
  "envelope_version": "v1",
  "data_schema_version": "2026-04-18",
  "tenant_id": "user_01HX...",
  "occurred_at": "2026-04-18T14:32:00Z",
  "request_id": "req_01HX...",
  "data": { /* event-specific payload */ }
}
```

Filter consumer-side, not producer. Server emits everything; consumers subscribe to event-name patterns.

## Schema impact

```prisma
model EventOutbox {
  id          String   @id @default(cuid())
  type        String   // event taxonomy name
  payload     Json
  tenantId    String   // userId today; teamId in multi-tenant
  status      String   @default("pending") // pending | delivered | failed | dead
  attempts    Int      @default(0)
  nextAttempt DateTime @default(now())
  lastError   String?
  createdAt   DateTime @default(now())
  deliveredAt DateTime?

  @@index([status, nextAttempt])
  @@index([tenantId, createdAt])
}

model WebhookEndpoint {
  id          String   @id @default(cuid())
  userId      String
  url         String
  description String?
  secret      String   // per-endpoint HMAC secret (encrypted)
  eventTypes  String[] // glob patterns: ["memory.*", "decision.synthesized"]
  enabled     Boolean  @default(true)
  createdAt   DateTime @default(now())
  user        User     @relation(fields: [userId], references: [id])
}

model WebhookDelivery {
  id           String   @id @default(cuid())
  endpointId   String
  outboxId     String
  status       String   // succeeded | failed
  statusCode   Int?
  responseBody String?  // truncated to 4KB
  attemptedAt  DateTime @default(now())
  endpoint     WebhookEndpoint @relation(fields: [endpointId], references: [id])
  outbox       EventOutbox     @relation(fields: [outboxId], references: [id])

  @@index([endpointId, attemptedAt])
}
```

## API surface

- `POST /v1/webhooks/endpoints` — register a webhook URL + event filters
- `GET /v1/webhooks/endpoints` — list endpoints
- `DELETE /v1/webhooks/endpoints/:id` — remove
- `POST /v1/webhooks/endpoints/:id/test` — send a synthetic event
- `GET /v1/webhooks/deliveries?endpointId=...` — paginated delivery log
- `POST /v1/webhooks/deliveries/:id/replay` — re-send a failed delivery

Outgoing webhook headers:

```
X-Omnimind-Event: memory.created
X-Omnimind-Event-Id: evt_01HX...
X-Omnimind-Signature: t=1713451920,v1=hex_hmac_sha256(secret, "{ts}.{body}")
X-Omnimind-Delivery: dlv_01HX...
User-Agent: Omnimind-Webhooks/1
```

Signature scheme mirrors Stripe's. Verification helper shipped in the SDK.

## Phases

- [`../04-roadmap/PHASE-12-webhooks-event-bus/`](../04-roadmap/PHASE-12-webhooks-event-bus/) — primary phase (canonical numbering; webhooks now have their own dedicated phase). The `graphile-worker` foundation is shared with the durable embedding queue (Phase 1) and the future observability work (Phase 14).
- **Sequence note: webhooks ship BEFORE the SDK (Phase 12 → Phase 13).** Without webhooks, the SDK is polite polling.

Estimated effort: ~2 weeks if hand-rolled (outbox + delivery worker + UI). ~1 week if we adopt **Svix** as the delivery layer.

## Risks

- **At-least-once delivery means consumers must be idempotent.** Mitigation: include `X-Omnimind-Event-Id` in every payload; document the idempotency requirement loudly.
- **HMAC secret rotation.** Endpoints need a way to rotate without dropping events. Mitigation: support two secrets per endpoint during a rotation window.
- **Slow consumers blocking the delivery worker.** Mitigation: per-endpoint timeout (10s default), exponential backoff, dead-letter after 24 attempts over ~3 days.
- **PII in payloads to user-controlled URLs.** Mitigation: payload schemas reviewed for sensitivity; sensitive fields redacted by default with opt-in expansion.
- **Outbox table growth.** Mitigation: scheduled purge of `delivered` rows older than 30 days.

## Success metrics

- p99 outbox-write-to-first-delivery-attempt latency < 5s
- ≥ 99.5% successful delivery rate to non-failing endpoints (5xx-ignoring)
- Zero events lost (every outbox row reaches `delivered` or `dead`)
- ≥ 10 third-party integrations registered within 90 days of launch
- Replay UI used at least once per week (proxy for "users trust the audit trail")

## Dependencies on other features

- **Observability suite** (Phase 13) — webhook delivery metrics + alerts on delivery failure rate
- **Public SDK** (Phase 12) — must ship signature-verification helper
- **Memory MCP server** (Phase 10) — MCP-origin writes also fire `memory.created` events
- **Markdown export** (Phase 11) — `vault.exported` event consumer for downstream backup automation
- **Per-tenant cost controls** (Phase 14) — webhook delivery is an outbound cost; per-tenant rate limits prevent runaway loops
