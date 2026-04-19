# PHASE 14 — Observability Suite

**Time budget:** 2 weeks
**Sequence:** Ships after the make-it-10 stretch (Phases 10-13). First of the scale phases.
**Owner:** dev
**Confidence:** HIGH (well-trodden path; pinning to OpenTelemetry + Axiom or Grafana Cloud is low-risk)

---

## What this is

Wire **logs + metrics + traces + alerting** into a vendor-portable, OpenTelemetry-native pipeline. Today, OmniMind has Pino logs but no shipping, no metrics endpoint, no distributed tracing across the BoardRoom→OmniMind seam (correlation IDs propagate, but nothing aggregates them), and no alerts beyond "did the health check fail."

Concretely:

- **Logs:** Pino → OpenTelemetry → ship to Axiom (free tier 0.5 TB/mo) or Grafana Cloud (free tier 50 GB) via OTLP HTTP exporter. Use `pino-opentelemetry-transport`.
- **Metrics:** `@opentelemetry/api-metrics` instrumented at: API request latency (per route), DB query latency (per Prisma model), Anthropic request latency + token counts, OpenAI embedding latency + count, cron job duration, outbox event emit/deliver counts, webhook delivery success rate, queue depth (embedding queue, outbox).
- **Traces:** `@opentelemetry/instrumentation-express`, `@opentelemetry/instrumentation-prisma`, `@opentelemetry/instrumentation-http`. Spans flow from BoardRoom → OmniMind via `traceparent` header (W3C Trace Context). The existing `x-request-id` correlation ID rides as a span attribute.
- **Alerting:** define 6-8 alerts in the chosen vendor. Examples: API p95 > 1s for 5min, OmniMind health check failing for 2 consecutive checks, webhook deliveries failing > 10% over 1h, Anthropic spend exceeds daily budget, cortex job failed, outbox depth > 1000 unprocessed for >10 min.
- **Cost dashboard:** weekly report (cron job that posts to a Slack channel) summarizing Anthropic spend, OpenAI spend, Railway compute usage, by-tenant breakdown for the top 20.
- **PII handling:** structured log fields automatically redact `email`, `apiKey`, `accessToken`, `secret`. Log sampler captures 100% of errors, 10% of info, 1% of debug. Adjustable per-route.

---

## Why now

1. **Phase 12 webhooks need delivery metrics from day one.** Without observability you can't tell if your webhook system is healthy.
2. **Phase 13 SDK exposes us to third-party traffic.** Need to see what they're hitting and how it behaves.
3. **Phase 16 cortex isolation requires visibility into cron jobs.** Without traces you can't debug a cortex run that ran 2x normal duration.
4. **Cost visibility is risk reduction.** A runaway loop costs real money; a $500 surprise on the Anthropic bill is the kind of "non-emergency that becomes one fast" you want to catch on the dashboard, not the credit card statement.

## Prerequisites

- Phase 10-13 complete
- Vendor decision: Axiom vs Grafana Cloud (default: **Axiom** — generous free tier, simpler setup, OTLP-native; Grafana Cloud if you want self-hosted-portable Grafana dashboards eventually)
- Account provisioned, OTLP endpoint URL + API key in Railway env
- `.env.example` updated

## Exit criteria

- [ ] All Pino logs ship to vendor as structured JSON via OTLP
- [ ] Metrics endpoint exposed; vendor scrapes or push works
- [ ] Distributed traces visible end-to-end: a BoardRoom request → OmniMind retrieval → DB query → Anthropic call all appear in a single trace
- [ ] 6+ alerts defined, tested by induced failure
- [ ] PII redaction verified by an integration test that emits a log with a fake email and asserts the shipped log has it redacted
- [ ] Sampling configured (errors 100%, info 10%, debug 1%)
- [ ] Cost dashboard posted weekly to Slack/email
- [ ] Runbook in `docs/DEPLOYMENT-RUNBOOK.md` for: how to query logs, how to silence an alert, how to add a new metric, how to find a request by `x-request-id`
- [ ] No regressions: Pino logs still appear in Railway console (vendor shipping is additive, not replacing console output)

## Dependencies

- **Upstream:** Phases 10-13. Each surface added without observability is debt.
- **Downstream blocks:** Phase 16 cortex isolation (needs traces to debug); Phase 19 horizontal scale (needs metrics to know when to scale)
- **Concurrency:** Sequential after Phase 13.

## Blast radius

- **Touches every service entrypoint** — `packages/omnimind-api/src/index.ts` and `packages/boardroom-ai/server/src/index.ts` initialize OTel SDK before anything else.
- **Adds dependencies:** `@opentelemetry/api`, `@opentelemetry/sdk-node`, several instrumentation packages, `pino-opentelemetry-transport`. ~5MB additional install size.
- **Risk:** OTel SDK init can swallow stack traces if misconfigured. Mitigation: keep console transport active alongside OTLP. Verify every error still appears in Railway logs.
- **Performance impact:** ~3-5% CPU overhead for full instrumentation; ~1ms p99 latency overhead per request. Acceptable.
- **Rollback:** `OBSERVABILITY_ENABLED=false` env disables OTel SDK init; falls back to Pino-only logging.

---

**Constraints reminder:** Respect ADR-001 (no frameworks), ADR-002 (Anthropic only), ADR-003 (pgvector only), ADR-009 (node-cron only). All prompts in `docs/prompts/*.system.md`. All LLM tool outputs Zod-validated. CLAUDE.md service-boundary rules apply.
