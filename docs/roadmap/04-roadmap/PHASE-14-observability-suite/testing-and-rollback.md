# PHASE 14 — Testing & Rollback

## Verification

1. **Logs ship:** within 30s of a request, the log line appears in the vendor UI with all expected fields.
2. **PII redacted:** integration test in `tests/integration/observability/redaction.test.ts` emits logs with email, API key, accessToken, secret; asserts both console and shipped logs have them redacted.
3. **Metrics flow:** trigger each instrumented operation, observe metric increment in vendor UI within 1 min.
4. **Traces complete:** end-to-end trace from BoardRoom → OmniMind → Anthropic visible as one trace tree. Capture screenshot to `docs/observability/sample-trace.md`.
5. **Alerts fire:** induced-failure test for at least 4 of the 8 alerts (the other 4 — health checks, spend caps — exercise naturally over time).
6. **Sampling honored:** generate 1000 info logs, observe ~10% in vendor (sampling 10%); generate 1000 errors, observe 100%.
7. **Performance:** load test before and after observability enable; CPU overhead <5%, p99 latency overhead <2ms.
8. **Cost dashboard:** Sunday 9am UTC, weekly summary posted to Slack.
9. **No regressions:** `pnpm typecheck && pnpm test && npm run eval:all` all green.

## Rollback

**Soft rollback:**
- Set `OBSERVABILITY_ENABLED=false`. The OTel SDK init guard skips initialization. Console logging continues unchanged. Vendor stops receiving data immediately.
- Existing alerts in the vendor stop firing because no data; silence them in vendor to avoid false alarms.

**Hard rollback (revert):**
- Revert the merge. Both services remove OTel imports and init code.
- Vendor account stays provisioned (no harm; bills $0 if no data).
- Pino logger reverts to single-transport (console only).

**Cost emergency:**
- If logs/traces volume balloons unexpectedly (e.g., a debug log accidentally enabled at info level on a hot path), the vendor's free tier or paid budget can be exceeded fast. Mitigation: every transport has a per-second rate limit configured (`pino-opentelemetry-transport` supports this); errors get queued in-memory up to 10MB then dropped with a warning log. Document the cost-runaway recovery in the runbook.

**Failure modes to watch:**
- **OTel SDK swallows errors during init.** Mitigation: keep console transport always active; observe `process.exit` reasons in Railway logs.
- **PII in unstructured log strings.** Redaction works on field paths, not content. A `logger.error('user signed up: alice@example.com')` would leak. Code-review rule: never interpolate user data into log message strings; always pass as a structured field.
- **Trace cardinality explosion.** Adding tenant ID as a span attribute is fine; adding session ID multiplies cardinality and hurts vendor billing. Use as event/log attribute, not span attribute.
- **Vendor outage.** OTLP exporter retries internally. If vendor is down for >5 min, in-memory buffers fill; sampler drops debug/info first, errors last. Document in runbook.
- **Auto-instrumentation duplicates.** `@opentelemetry/instrumentation-http` and `@opentelemetry/instrumentation-express` can both create a span for the same request. Verify; disable one if duplicates appear.
