# PHASE 14 — Tasks & Prompts

---

## Task 14.1 — Vendor decision + provisioning

**Scope:** 1-day spike. Choose Axiom or Grafana Cloud, provision account, capture credentials.

**Prompt:**
> Read `docs/research/omnimind-roadmap-2026/wave1-research/01-ops-scaling.md` §8. Write `docs/DECISIONS.md` ADR-015 picking Axiom or Grafana Cloud as the observability vendor. Cover: monthly cost projections at 100/500/2000 users, OTLP support quality, alert ergonomics, dashboard authoring experience, vendor portability if we want to leave. Default recommendation: Axiom for v1 (free tier covers 100→500 users; simpler setup). Then provision the account, generate an API key, document the setup in `docs/DEPLOYMENT-RUNBOOK.md` with step-by-step screenshots/instructions. Add env vars to `.env.example`: `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`, `OBSERVABILITY_ENABLED`.

**Verification:** ADR exists, account provisioned, env vars documented.

---

## Task 14.2 — Install OTel SDK + instrumentation packages

**Scope:** Wire `@opentelemetry/sdk-node` into both services. Init at the very top of `index.ts` files, before any other imports execute side effects.

**Prompt:**
> In both `packages/omnimind-api/` and `packages/boardroom-ai/server/`: install `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/exporter-metrics-otlp-http`, `@opentelemetry/exporter-logs-otlp-http`. Create `src/observability/init.ts` that initializes the SDK with: service name from env, resource attributes (env, region, version), OTLP exporters configured from env, sampling (parent-based, traces 10% in prod, 100% on errors). Init MUST be required at the very top of `src/index.ts` BEFORE any other application imports — OTel auto-instrumentation works by patching imports, so order matters. Wrap init in `if (process.env.OBSERVABILITY_ENABLED === 'true')` so dev work is unaffected. Add a graceful shutdown hook to flush spans before `process.exit`.

**Verification:** `npm run dev` starts cleanly; with `OBSERVABILITY_ENABLED=true` and a valid OTLP endpoint, traces appear in the vendor UI within 30s.

---

## Task 14.3 — Pino → OTLP log shipping

**Scope:** Ship Pino logs as OTLP via `pino-opentelemetry-transport`. Keep Railway console output intact.

**Prompt:**
> In both services: update `src/lib/logger.ts` to add a second Pino transport using `pino-opentelemetry-transport`. The console transport stays as-is (Railway captures stdout). The OTLP transport ships to the configured endpoint. Add a redaction config to Pino: redact paths `*.email`, `*.apiKey`, `*.accessToken`, `*.secret`, `*.password`, `*.authorization`, `req.headers.authorization`, `req.headers.cookie`. Test: emit a log with `{ user: { email: 'test@example.com', name: 'Test' } }`, assert console shows `email: '[REDACTED]'` and OTLP-shipped record also redacted. Add a unit test in `tests/unit/logger.test.ts` that loads the redaction config and asserts the regex behavior.

**Verification:** Unit test green; manual: emit a log with PII, observe redaction in both console and shipped log.

---

## Task 14.4 — Metrics instrumentation

**Scope:** Add custom metrics where auto-instrumentation doesn't reach: Anthropic token counts, embedding queue depth, outbox depth, cortex job duration, webhook delivery success rate.

**Prompt:**
> In `packages/omnimind-api/src/observability/metrics.ts`: define meters using `@opentelemetry/api-metrics`. Counters: `omnimind.anthropic.tokens.input`, `omnimind.anthropic.tokens.output`, `omnimind.anthropic.tokens.cached`, `omnimind.openai.embeddings.count`, `omnimind.outbox.events.emitted`, `omnimind.outbox.events.delivered`, `omnimind.webhooks.deliveries.succeeded`, `omnimind.webhooks.deliveries.failed`, `omnimind.webhooks.deliveries.dead`. Histograms: `omnimind.anthropic.request.duration`, `omnimind.openai.embedding.duration`, `omnimind.cortex.job.duration` (with `job_type` attribute). Gauges (observable): `omnimind.outbox.depth`, `omnimind.embedding.queue.depth`. Wire counters into the existing services — wrap Anthropic SDK calls, OpenAI calls, etc. Use the request's user/tenant attributes where appropriate without leaking PII (tenant ID is fine; email is not).

**Verification:** Trigger each instrumented operation, observe metrics in vendor UI within 1 min; spot-check tenant attribute is the user ID, not the email.

---

## Task 14.5 — Distributed tracing across BoardRoom→OmniMind seam

**Scope:** Verify W3C Trace Context propagates from BoardRoom → OmniMind. Auto-instrumentation should handle it; verify and patch any gaps.

**Prompt:**
> Verify that `@opentelemetry/instrumentation-http` injects `traceparent` and `tracestate` headers into BoardRoom's outbound requests to OmniMind, and that `@opentelemetry/instrumentation-express` (in OmniMind) extracts them. Manually trigger a session that starts in BoardRoom, calls OmniMind retrieval, calls Anthropic, and writes a memory. Observe a single trace in the vendor UI containing all spans. The existing `x-request-id` correlation ID should appear as a span attribute on the root span. If gaps exist (e.g., a custom HTTP client that doesn't auto-instrument), patch `omnimind-client.ts` to manually inject the headers.

**Verification:** End-to-end trace screenshot in `docs/observability/sample-trace.md`.

---

## Task 14.6 — Define + test 8 alerts

**Scope:** Configure alerts in the vendor's UI; document the alert definitions in code as YAML/JSON for portability.

**Prompt:**
> In `docs/observability/alerts/`: create one YAML/JSON file per alert defining: name, description, query (PromQL or vendor-native), threshold, duration, severity, notification channel. Alerts: (1) API p95 latency > 1s for 5min, (2) OmniMind health check failing 2 consecutive, (3) webhook delivery failure rate > 10% over 1h, (4) Anthropic daily spend > configured budget, (5) cortex job failed in last 24h, (6) outbox depth > 1000 for >10min, (7) embedding queue depth > 500 for >5min, (8) any 5xx rate > 5% for 5min. Configure each in the vendor UI matching the YAML. Test each by inducing failure (e.g., temporarily set webhook endpoint URL to a 404er; verify alert fires). Document on-call runbook for each in `docs/DEPLOYMENT-RUNBOOK.md`.

**Verification:** All 8 alerts visible in vendor UI; induced-failure test for at least 4 of them.

---

## Task 14.7 — Weekly cost dashboard

**Scope:** Cron job posts weekly cost summary to Slack (or email).

**Prompt:**
> Add `packages/omnimind-api/src/jobs/cost-report.ts` running via node-cron Sunday 9am UTC. Reads from the `LlmUsage` table (added in Phase 18 if not yet present — if not present, defer this task until Phase 18 lands; document the dependency in the cost-report file's header comment). Computes: total Anthropic spend (in/out/cached tokens × pricing constants), total OpenAI spend, top 20 tenants by spend with masked IDs, Railway compute estimate (from a constant — manual entry until we have an API). Posts to a Slack webhook URL from env `COST_REPORT_SLACK_WEBHOOK`. Format: a clear summary table. If `LlmUsage` doesn't exist yet, the job logs "Phase 18 not landed; cost report skipped" and returns early.

**Verification:** Manual trigger posts to Slack; if `LlmUsage` missing, logs the deferral cleanly.

---

## Task 14.8 — Runbook + adoption docs

**Scope:** Documentation.

**Prompt:**
> Update `docs/DEPLOYMENT-RUNBOOK.md` with a new section "Observability operations" covering: how to query logs by `x-request-id` (vendor-specific syntax), how to silence an alert temporarily, how to add a new metric (link to Task 14.4 patterns), how to find the trace for a slow request, how to interpret the cost dashboard, retention policy (7 days default, 30 days for errors). Add a `docs/observability/README.md` summarizing the architecture (Pino → OTLP → vendor) and pointing at this runbook.

**Verification:** Runbook reviewed; a junior dev can follow it to find a specific trace given a request ID.
