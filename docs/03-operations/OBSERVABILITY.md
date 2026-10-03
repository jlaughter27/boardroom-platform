# Observability — one backend, five alerts

Scope for a one-person operation: OpenTelemetry traces from both services into
**one** hosted backend, pino logs where they already go (Railway), and exactly
five alerts. Nothing self-hosted (no Grafana/Loki/Tempo stack, no Sentry *and*
an OTel backend — pick one).

## What is instrumented

| Service | Where | Service name | Enabled when |
|---|---|---|---|
| BoardRoom AI | `packages/boardroom-ai/server/src/lib/otel.ts`, started first thing in `index.ts` | `boardroom-ai` | `OTEL_EXPORTER_OTLP_ENDPOINT` is set |
| OmniMind API | `packages/omnimind-api/src/lib/otel.ts`, same pattern | `omnimind-api` | `OTEL_EXPORTER_OTLP_ENDPOINT` is set |

Both use `@opentelemetry/sdk-node` + `auto-instrumentations-node` (http,
express, pg via Prisma's driver) + the OTLP **HTTP** trace exporter. Tracing is
off when the endpoint variable is empty, so local dev and CI pay nothing.

### `traceparent` across the seam
BoardRoom calls OmniMind through `omnimind-client.ts` (`fetch`). The http/undici
auto-instrumentation injects W3C `traceparent` on outbound requests and the
express instrumentation on OmniMind continues the same trace, so one session
dispatch shows as a single trace: BoardRoom span → 7 persona spans → the
`POST /context/for-persona` child spans with their SQL. `x-request-id` is still
propagated and logged (since 2026-04-15), so log lines and traces join on either.
If a trace shows OmniMind spans as separate roots, the propagator is not
running on the client — check that `otel.ts` is imported before anything that
imports `undici`/`http`.

## Environment variables

| Variable | Both services | Example |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | base URL; the exporter appends `/v1/traces` | `https://otlp-gateway-prod-us-east-0.grafana.net/otlp` |
| `OTEL_EXPORTER_OTLP_HEADERS` | comma-separated `k=v` auth headers | `authorization=Basic <base64 instance:token>` (Grafana) / `x-honeycomb-team=<key>` (Honeycomb) / `authorization=Bearer <token>,x-axiom-dataset=boardroom` (Axiom) |
| `OTEL_SERVICE_NAME` | optional override; defaults above | — |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` | optional; default always-on is fine at current volume | `parentbased_traceidratio` / `0.2` |

Set them on **both** Railway services; redeploy. Verify with one session: the
backend should show a trace whose root is `POST /sessions/:id/dispatch` with
child spans from `omnimind-api`.

## Choosing the one backend (free tiers as of research date 2026-10-02; re-check)

| Backend | Free tier | Notes |
|---|---|---|
| Grafana Cloud | 50 GB logs + traces, 14-day retention | OTLP gateway, alerting + OnCall included — the default pick |
| Honeycomb | 20M events/mo, 60-day retention | best trace UX; events = spans, persona dispatches are ~15 spans each |
| Axiom | 500 GB/mo personal, 30-day | cheapest if logs are shipped too |

Where traces land: the backend's trace explorer, filtered by
`service.name` (`boardroom-ai` / `omnimind-api`). Logs stay in Railway unless
you also ship pino → OTLP logs (not wired; optional later).

## The five alerts (no more)

| # | Alert | Signal | Threshold | Source |
|---|---|---|---|---|
| 1 | Health down | `GET /health` on either public URL | 2 consecutive failures, 1-min interval | backend synthetic check or Railway healthcheck + uptime monitor |
| 2 | Persona latency | p95 of `POST /sessions/:id/dispatch` span duration | > 20 s over 10 min | trace metrics |
| 3 | Cortex job failed | log line `Cortex job failed` / span status ERROR on `jobs.*` | any, per run | logs or span status |
| 4 | Embedding outbox depth | `SELECT count(*) FROM embedding_outbox WHERE resolved_at IS NULL` (or the admin endpoint when it exists) | > 50 for 15 min | SQL check / admin endpoint scrape |
| 5 | Daily LLM spend | `GET /usage/llm/summary?days=1` `totalUsd` | > `LLM_DAILY_BUDGET_USD` (set it; start at 10) | scheduled check |
| — | Backup missed (dead-man) | `BACKUP_HEALTHCHECK_URL` ping | no ping in 26 h | healthchecks.io / OnCall heartbeat — counted under "ops", see BACKUPS.md |

Route all of them to the same channel (phone push + email). If an alert fires
weekly without action, delete it or fix the threshold; alert debt is worse
than no alert.

## Local check without a backend
Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` and run any OTLP
collector (`docker run -p 4318:4318 otel/opentelemetry-collector` with the
default logging exporter) to see spans printed. Leave the variable unset in
`.env` otherwise.
