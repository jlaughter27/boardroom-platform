# Observability Suite

> Constraints reminder: Respect ADRs 001-013. See [`../01-foundations/CONSTRAINTS.md`](../01-foundations/CONSTRAINTS.md).

---

## Problem

Today, OmniMind and BoardRoom emit Pino logs to stdout. Railway captures them, but there's no aggregation, no search beyond the Railway dashboard scrollback, no metrics, no traces, no alerting. Correlation IDs (`x-request-id`) propagate across the BoardRoom→OmniMind seam (since 2026-04-15), but nothing receives them on the other end. When a user reports "the Critic gave me a weird answer at 3pm," our diagnostic loop is "ask them to repro and watch logs live."

That's fine at 50 users. At 500 it's catastrophic — by the time you spot a problem, the logs have rolled. At 2,000 it's negligence. We need:

- **Logs aggregated and searchable** for ≥ 7 days
- **Metrics** for queue depth, embedding throughput, LLM error rate, retrieval latency
- **Traces** so a single user request can be followed across BoardRoom → OmniMind → Anthropic → OpenAI → Postgres
- **Alerts** so we hear about queue lag at 2am instead of from a customer at 9am
- **Dashboards** so we know per-user spend, per-domain memory volume, and retrieval p99 without writing SQL by hand

All of this on a solo-founder budget.

## Approach

Open-standard pipeline, vendor-portable. **Pino → OpenTelemetry → Axiom (free tier) for logs**, with metrics and traces routed to **Grafana Cloud free tier** (50GB logs, 10k metrics, 50GB traces). Both are reasonable defaults; both have escape hatches.

### Logs

- Keep Pino as the in-process logger (already there).
- Add `pino-opentelemetry-transport` to ship structured logs as OTLP.
- Axiom free tier: 0.5 TB/mo free, then ~$25/100GB. Generous enough for ≤ 1,000 users.
- Every log line carries `request_id`, `user_id`, `route`, `latency_ms`, plus event-specific fields.

### Metrics

- `@opentelemetry/instrumentation-express`, `@opentelemetry/instrumentation-prisma`, `@opentelemetry/instrumentation-http` cover the seam automatically.
- Custom metrics for the things the auto-instrumentation can't see:
  - `omnimind.embedding.queue.depth` (gauge)
  - `omnimind.embedding.batch.duration` (histogram)
  - `omnimind.embedding.failure.count` (counter)
  - `omnimind.llm.tokens.input` / `omnimind.llm.tokens.output` (counter, tagged by model + tenant)
  - `omnimind.llm.cost.cents` (counter, tagged by tenant)
  - `omnimind.cortex.job.duration` (histogram, tagged by job name)
  - `omnimind.retrieval.latency` (histogram, tagged by signal mix)
  - `omnimind.retrieval.candidates` (histogram)
  - `omnimind.webhook.delivery.success` / `.failure` (counter, tagged by endpoint)
  - `omnimind.outbox.lag.seconds` (gauge)
- Ship to Grafana Cloud Mimir or Honeycomb free tier (20M events/mo).

### Traces

- Correlation IDs already propagate across the seam. Wire the OpenTelemetry context propagator to use the same `x-request-id` header so traces join on it natively.
- Span hierarchy per user request:

```
HTTP POST /api/sessions/:id/messages          [BoardRoom]
  └─ persona.dispatch                          [BoardRoom]
      ├─ omnimind.context.assemble             [HTTP → OmniMind]
      │   ├─ retrieval.semantic                [Postgres]
      │   ├─ retrieval.fts                     [Postgres]
      │   ├─ retrieval.trigram                 [Postgres]
      │   └─ retrieval.rerank                  [in-process]
      ├─ anthropic.messages.create             [HTTP → Anthropic]
      └─ omnimind.memory.extract               [HTTP → OmniMind → Anthropic]
```

- Ship to Honeycomb free tier; tracing is its strength.

### Alerts

Wire to whatever the user already pages on (PagerDuty, Slack webhook, email). Initial rule set:

| Alert | Threshold | Severity |
|---|---|---|
| Embedding queue lag | > 60s for 5 min | warn |
| Embedding queue lag | > 5 min for 2 min | crit |
| Embedding failure rate | > 5% over 10 min | warn |
| LLM error rate (Anthropic) | > 2% over 10 min | warn |
| LLM error rate (Anthropic) | > 10% over 5 min | crit |
| Cortex job duration | > 30 min for any job | warn |
| Retrieval p95 | > 1.5s for 10 min | warn |
| Outbox lag | > 30s for 5 min | warn |
| Per-user spend rate | > 5x hourly avg for 5 min | warn (informs cost circuit breaker — see [per-tenant-cost-controls.md](per-tenant-cost-controls.md)) |
| Health check failure | 2 consecutive failures | crit |

### Dashboards

Three at minimum, all built once and snapshot-saved:

1. **Per-user spend dashboard** — top 20 users by today's LLM spend, monthly cumulative, % of plan limit. Drill-through to per-request log lines.
2. **Retrieval health** — p50/p95/p99 latency by signal mix (semantic-only / hybrid / hybrid+rerank). Candidate counts. Cache hit rate.
3. **Memory volume per domain** — memories/day per domain, embedding queue depth, validation rejection rate.

A fourth dashboard ("expensive endpoints") gets generated weekly by a cron job and posted to Slack — see [observability runbook reference in PHASE-14](../04-roadmap/PHASE-14-observability-suite/).

## Schema impact

```prisma
model LlmUsage {
  id           String   @id @default(cuid())
  userId       String
  model        String   // claude-sonnet-4-6 | claude-haiku-4-5 | text-embedding-3-small
  inputTokens  Int
  outputTokens Int
  costCents    Int
  source       String   // "boardroom" | "mcp" | "cortex" | "embedding"
  requestId    String?
  createdAt    DateTime @default(now())

  @@index([userId, createdAt])
  @@index([model, createdAt])
}
```

`LlmUsage` is foundational — it backs the cost dashboard, per-tenant caps, and the spend circuit breaker. Add it in Phase 14 (observability) even though the full cap enforcement comes later in Phase 18 (resilience + multitenant fairness). An initial cap meter ships in Phase 0.25.

## API surface

Internal only. No public endpoints. Dashboards are operator-facing; alerts route to Slack/PagerDuty.

## Phases

- [`../04-roadmap/PHASE-14-observability-suite/`](../04-roadmap/PHASE-14-observability-suite/) — primary phase (canonical numbering; was tagged "Phase 13" by Builder 4)
- Builds the foundation that webhooks (Phase 12), SDK (Phase 13), GDPR export (Phase 18), per-tenant cost controls (Phase 18), and MCP server (Phase 10) all depend on

Estimated effort: ~2 weeks (OTel SDK wiring + dashboards + alert tuning).

## Risks

- **Log volume blowback.** Pino emits a lot at default verbosity. Mitigation: structured-log discipline; sample debug-level lines at 1%; shed non-essential fields in prod.
- **Trace cardinality explosion.** Tagging every span with `user_id` blows up Honeycomb's free tier. Mitigation: tag with `tenant_bucket` (hash mod 100) for high-cardinality dashboards, full `user_id` only on error spans.
- **Vendor lock-in.** Mitigation: OpenTelemetry is the abstraction; Axiom/Honeycomb/Grafana Cloud are interchangeable. Ship to two destinations during a migration if needed.
- **Cost surprises.** Mitigation: hard cap on log shipping volume per day; alarm when 80% of monthly budget hit.
- **Alerting fatigue.** Mitigation: start with the conservative rule set above; expand only when an outage proves a new rule is needed.

## Success metrics

- 100% of requests have a correlation ID searchable across logs + traces
- Mean time to root cause (MTTR-RC) < 15 min for production incidents
- Zero "we had to wait for the user to repro" incidents post-launch
- ≥ 95% of LLM cost dashboard rows match Anthropic invoice within 2% (proxy for `LlmUsage` accounting correctness)
- Alert false-positive rate < 20% (rules tuned, not noisy)

## Dependencies on other features

- **Per-tenant cost controls** (Phase 14) — `LlmUsage` table is shared infrastructure
- **Webhooks event bus** (Phase 13) — webhook delivery metrics flow through the same pipeline
- **MCP server** (Phase 10) — operates a new public surface; observability is a hard prerequisite
- **Public SDK** (Phase 12) — `requestId` in every error needs a place to be searchable
- **Advanced cortex** (Phase 15) — `omnimind.cortex.job.duration` metric drives the "is cortex healthy" dashboard
