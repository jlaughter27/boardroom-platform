# Operational Risks — Detailed Catalog

**Wave 2 Builder 4 · Risks & Mitigations**
**Date:** 2026-04-18 (Wave 4 reconciliation note: phase numbers in body text use the older Builder 4 scheme; canonical mapping is in `RISK-REGISTER.md` Section 6)
**Sources:** `wave1-audit/scalability-audit.md`[3], `wave1-research/01-ops-scaling.md`[6], `wave1-audit/data-integrity-audit.md` §F[2], `CONSTRAINTS.md`
**Cross-reference:** `RISK-REGISTER.md` for the master table (canonical phase numbers); `SECURITY-RISKS.md` for auth-flavored ops items; `DATA-RISKS.md` for backup-strategy detail.

> **Phase-number translation key (canonical):**
> - "Phase 11 (Foundations / Observability / CI)" → Phase 14 (observability) + Phase 0.5 (backup drill) + Phase 18 (CI gate as part of operational hardening)
> - "Phase 13 (Cron worker isolation / RLS)" → Phase 16 (cortex isolation) + Phase 18 (RLS)
> - "Phase 14 (multi-instance enablers)" → Phase 19 (horizontal API scale)
> - "beyond 14" → DEFERRED (named trigger)

This catalog tracks the risks that fall outside the security/data/cost frames: hosting topology, alerting blindness, rotation procedures, restore-drill discipline, third-party dependencies, and the operational tooling gap that compounds every other risk's recovery time.

---

## A. Hosting topology — single-instance failure modes

### A.1 OPS-001 — Single Railway instance per service (no failover)

**Severity:** 2/5
**Files:** `docs/roadmap/01-foundations/CONSTRAINTS.md` ("Known limitations to accept"), `CLAUDE.md` ("Single Railway instance per service").

**Scenario:** Both BoardRoom AI and OmniMind API run as **one container each** on Railway. Failure modes:
- Railway region outage → both services down for the duration. Per Railway's published incident history (vendor-side), expect 1–3 short outages per year (15min–2hr each).
- Single container OOM kill → ~30 second cold-start window during which all users see errors.
- Deploy-in-progress → brief 5–10 second gap where the old container drains and the new one warms.

**Per ADR-002 (Anthropic-only), there is no LLM fallback either.** Anthropic outage = product down. Per Anthropic's published incident history, ~2–4 hours of degraded service per year is realistic.

**Compounding:** OPS-005 (OpenAI embedding outage) doesn't take the product down (writes succeed; embeddings just queue), but combined with DAT-002 (in-process queue), every Anthropic-or-Railway outage that causes a restart loses queued embeddings.

**Mitigation phase:** Beyond 14 — accepted. Per scalability audit §F: single-instance is the right call until **>1,500 concurrent active users**, and workload separation (Phase 13 cortex worker) buys most of the headroom horizontal scaling would.

**Fix when triggered:** Phase 14 enables N=2 API replicas with sticky-session SSE (per ops research §1, Railway's load balancer supports session affinity via cookie). Phase 15+ adds read replicas if read RPS justifies.

**Residual after acceptance:** ~2–4 hours/year of product unavailability. Documented in incident-template (OPS-014) as accepted residual. **Trade-off:** the cost of multi-instance pre-Phase 14 (cron-duplication, queue-loss multiplication) exceeds the cost of an hour-long outage at <500 users.

---

### A.2 OPS-007 — `OMNIMIND_API_URL` is the public Railway domain

**Severity:** 3/5
**Files:** `CONSTRAINTS.md` ("Known limitations to accept" item 3), `packages/boardroom-ai/server/src/services/omnimind-client.ts`.

**Scenario:** Service-to-service calls between BoardRoom and OmniMind transit the public internet via Railway's public domain. Two costs:
- ~30–80ms additional round-trip latency per call (vs Railway private networking).
- Public attack surface: every BoardRoom→OmniMind call could be observed if TLS were ever misconfigured.

**Mitigation phase:** **12** (Hardening — Railway private networking config change).
**Fix:** Switch `OMNIMIND_API_URL` to Railway's internal `*.railway.internal` domain. No code changes; environment-variable-only. Combined with the API-key timing-safe compare, the surface area drops to "anyone with the API key + access to Railway internal network."

**Residual:** None for the latency / surface concern. **Residual: 5/5.**

---

### A.3 OPS-006 — In-process queue + cron sharing API event loop

**Severity:** 3/5
**Files:** `packages/omnimind-api/src/jobs/cortex-scheduler.ts:13`, `packages/omnimind-api/src/services/embedding-queue.ts`, `packages/omnimind-api/src/index.ts` (cron startup).

**Scenario:** `node-cron` runs in the API process. Long-running cortex jobs block the event loop with JSON.parse of large memory sets (~150ms per user). At 100 users this is invisible; at 500 users it's the dominant p99 contributor; at 2,000 users the API is unusable on Sunday evenings (see `12-MONTH-FORECAST.md` Scenario 1).

**Mitigation phase:** **13** (Cron worker service).
**Fix:** Per ops research §6: create `omnimind-cron` as a second Railway service deploying the same monorepo, with `CMD ["node", "dist/cron.js"]`. Same DB, same code, separate event loop. Cost: ~$10/mo. Combined with `graphile-worker` (Phase 13, replaces `node-cron`), the cron service becomes a thin wakeup process.

**Residual:** Cron service itself may need horizontal scaling at 5,000+ users — Phase 14 leader-election via Postgres advisory locks handles that.

---

## B. Alerting blindness

### B.1 OPS-002 — No alerting beyond health checks

**Severity:** 2/5
**Files:** `/health` endpoints on both services. No external monitoring.

**Scenario:** Today's "monitoring" is Railway's container-health probe and the `/health` endpoint. Failure modes that go undetected:
- Stripe webhook failures (SEC-002) — silent until users complain.
- Embedding queue dropping jobs (DAT-002) — silent until users notice missing semantic-search results.
- OAuth tokens silently expiring (DAT-015) — silent until cortex output drifts.
- Cortex jobs taking 10 hours instead of 2 — visible in Railway's CPU graph, not flagged anywhere.
- Subscription middleware fail-open spree (SEC-011) — silent until invoice-vs-MRR mismatch.

**Per CLAUDE.md:** correlation IDs (`x-request-id`) ARE propagated since 2026-04-15. No log aggregation joins them.

**Mitigation phase:** **11** (Foundations — observability is foundational because every later phase relies on metrics to validate fixes).
**Fix per ops research §8:**
1. Add OpenTelemetry SDK (Pino → OTLP). Cheap.
2. Ship to Axiom free tier (0.5 TB/mo free, then ~$25/100GB). At 100 users, well within free tier.
3. Add `@opentelemetry/instrumentation-express` + `@opentelemetry/instrumentation-prisma` for traces.
4. Configure Pino redact (per SEC-018) **before** turning observability on, not after.
5. Add ~5 alert rules to start: `error_rate > 1% over 5min`, `subscription_check_failed_open_total > 1% over 5min`, `embedding_queue_depth > 1000`, `cortex_job_duration > 30min`, `stripe_webhook_dedup_collisions > 0` (signal that webhooks are being retried — diagnostic).

**Residual after fix:** Alert fatigue requires tuning. Specific runbook links in alert payloads (OPS-014). **Residual: 4/5.**

---

## C. Rotation and incident readiness

### C.1 OPS-003 — JWT_SECRET rotation absent

**Severity:** 2/5
**Files:** `packages/boardroom-ai/server/src/middleware/auth.ts:43-53`.

**Scenario:** Single static `JWT_SECRET`. Rotation = invalidate every active session = forced "log everyone out" = the rotation is so disruptive nobody ever does it. Which means a stolen secret stays valid until manually replaced under emergency pressure.

See SEC-016 for full treatment. The operational angle: rotation procedure today is a 0-step playbook with no overlap window.

**Mitigation phase:** **13** (Hardening + JWT key rotation).
**Fix:** Per research[5 §2]:
1. Add `kid` to all newly-issued tokens, default `"v1"`.
2. Refactor verify path to look up secret by `kid` from `JWT_SECRET_V1` / `JWT_SECRET_V2`.
3. After 7-day overlap (= JWT TTL), all live tokens carry `kid`; rotation becomes config-only.

**Residual:** HS256 with shared secret remains. Asymmetric (RS256/EdDSA) is overkill until SOC 2. **Residual: 4/5.**

---

### C.2 OPS-004 — Restore-from-backup never drilled

**Severity:** 2/5
**Files:** No `scripts/backup-*.sh`, no `BACKUP-RUNBOOK.md`. Daily Railway snapshots exist; restore procedure is theoretical.

**Scenario:** First Railway-side database incident. Probability over 12 months: ~2–5%. Conditional on incident, probability the restore drill has happened: **0%** today. Compounds with DAT-001 — the restore procedure itself triggers `db push --accept-data-loss` on first boot of the restored instance and silently mutates the restored schema.

See `12-MONTH-FORECAST.md` Scenario 10 and `DATA-RISKS.md` D.3 for full treatment.

**Mitigation phase:** **11** (cannot ship paying-user growth without this).
**Fix:**
- Scripted weekly logical dump to S3-compatible storage (Backblaze B2, per ops research §7) with retention.
- Quarterly restore drill into a scratch DB. Documented runbook with explicit `--accept-data-loss=false` flag during the drill.
- DAT-001 entrypoint flip must land first OR the drill itself proves DAT-001 is dangerous (which is also valuable).

**Residual:** Drilled procedure has known failure modes; surprises in production restore are expected. **Residual: 4/5.**

---

### C.3 OPS-014 — No incident postmortem template / runbooks

**Severity:** 4/5 (escalates with incident frequency)
**Files:** No `docs/runbooks/` directory beyond the deploy runbook.

**Scenario:** When an incident happens, every responder writes their own playbook from memory. Per data-integrity audit §F, ten runbooks are needed before paying-user growth:

1. `restore-from-backup.md`
2. `embedding-queue-drain.md`
3. `schema-rollback.md`
4. `stripe-reconciliation.md`
5. `oauth-token-revoked.md`
6. `user-deletion.md`
7. `gdpr-data-export.md`
8. `incident-postmortem-template.md`
9. `cortex-job-rerun.md`
10. `db-vacuum-and-reindex.md`

**Mitigation phase:** **13** (Operational tooling — tracked alongside cron isolation and worker patterns).
**Fix:** Write the 10 runbooks. Each is 1–2 pages. Total: ~3 days of work. Linked from alert payloads (OPS-002 fix).

**Residual:** Runbooks rot. Quarterly review keeps them current. **Residual: 4/5.**

---

## D. Third-party dependencies

### D.1 OPS-005 — OpenAI embedding outage = embeddings pile up

**Severity:** 2/5
**Files:** `packages/omnimind-api/src/services/embedding.service.ts`, embedding-queue.

**Scenario:** OpenAI Embeddings API outage (historical: ~3–6 incidents/year, durations 5min–2hr). Today's pipeline:
- New memories continue to be created (writes succeed).
- Embedding generation fails → 3 retries per audit §A2 → silent drop after 3 failures (DAT-002).
- Queue grows in memory; risks RAM pressure if outage is long.
- If the API instance restarts during the outage, every queued embedding is lost.

**Mitigation phase:** **11** (persistent queue) addresses the loss path. **13** swap to `pg-boss` / `graphile-worker` adds at-least-once semantics with exponential backoff.

**Fix specifics:** `Retry-After`-aware backoff (OpenAI SDK supports this — verify version). Mark `embedding_status = 'retry'` on transient errors (4xx-not-429 = `'failed'`; 429/5xx = `'retry'`). Background sweep retries indefinitely with exponential backoff capped at 24h.

**Residual:** Long outages still queue infinitely; backpressure caps prevent unbounded growth. **Residual: 4/5.**

---

### D.2 Anthropic outage = product down (no fallback)

**Severity:** Encapsulated by OPS-001 (single-instance / single-vendor by ADR-002).

**Scenario:** Anthropic Sonnet 4.6 / Haiku 4.5 outage (historical: 2–4 hours/year). Per ADR-002, no multi-model routing. The product is degraded to "no AI" mode for the duration.

**Mitigation:** Accepted per ADR-002 until 5,000+ paying users. The cost-benefit of multi-model routing (operational complexity, persona-quality variance, prompt-tuning per provider) does not justify the rare outage protection.

**Fix when triggered:** Status-page banner ("AI features temporarily unavailable due to Anthropic outage. Your data is safe."). Disable LLM-calling endpoints with `503 Service Unavailable`. Resume on Anthropic recovery.

---

## E. Operational hygiene — the easy wins

### E.1 OPS-008 — No CI/CD gate

**Severity:** 3/5
**Files:** No `.github/workflows/` per CLAUDE.md.

**Scenario:** Manual `npm run typecheck && npm run test` before push. Auto-deploy on merge to `main`. Broken builds reach production with no machine gate. Compounds SEC-012 (rate-limiter resets on every redeploy — broken builds = more redeploys = more reset windows).

**Mitigation phase:** **11** (CI bootstrap — foundational).
**Fix:**
1. GitHub Actions workflow: `pnpm typecheck && pnpm test && pnpm build` on PR + on push-to-main-pre-deploy.
2. Block merge on red CI.
3. Add migration-CI gate (`prisma migrate diff --from-migrations --to-schema-datamodel` must be empty) once Phase 14 lands.

**Residual:** Manual e2e test discipline still required (no e2e in CI yet). **Residual: 4/5.**

---

### E.2 OPS-009 — Subscription cache absent

**Severity:** 3/5
**Files:** `packages/boardroom-ai/server/src/middleware/subscription.middleware.ts`.

**Scenario:** Every protected request makes a synchronous `omnimindClient.getSubscription` round-trip. At 100 active users with average 30 protected requests/min, that's ~3,000 OmniMind round-trips/min just for subscription checks — a meaningful chunk of the ~80 RPS Express ceiling (SCL-008).

**Mitigation phase:** **12**.
**Fix:** 60-second cache of last-known subscription status per user. Falls back to cache on OmniMind unreachable (also closes SEC-011 fail-open broadness).

**Residual:** Cache invalidation lag = up to 60s of stale state on subscription change. Acceptable. **Residual: 5/5.**

---

### E.3 OPS-010 — Six 2025-04-12 orphan migrations create dead tables

**Severity:** 3/5
**Files:** `packages/omnimind-api/prisma/migrations/20250412*`.

**Scenario:** See DAT-010 for migration-history detail. Operational angle: tables exist (or don't) in production with no service writes. Creates ambiguity for debugging ("does this table matter?"), diff confusion in schema reviews, and a guaranteed `migrate deploy` failure if Phase 14 is attempted before quarantine.

**Mitigation phase:** **14** (rolled into migration-history work).

---

## F. Code-hygiene operational risks

### F.1 OPS-011 — `_disabled/` 13.6k LOC alongside live code

**Severity:** 4/5
**Files:** `packages/omnimind-api/src/{services,routes}/_disabled/`, `packages/shared/src/{utils,__tests__}/_disabled/`.

**Scenario:** 25+ files quarantined under `_disabled/` excluded from typecheck (per `tsconfig.json` lines 29–30). Risk: contributor accidentally re-enables one (path-only quarantine, easy to undo). The disabled mem0 pipeline has live `enqueueEmbedding` calls (`_disabled/mem0-entity-pipeline.ts:279,566`) — re-enabling triggers the queue-loss bug at ingestion.

**Mitigation phase:** **11** (Phase 9 purge — 4 hours of work).
**Fix:** `git rm -r` per code-quality audit §F checklist.

---

### F.2 OPS-012 — Active-but-dead services

**Severity:** 4/5
**Files:** Per code-quality audit §A.2: 7 files, 1,710 LOC.

**Scenario:** Services that compile but no production code path imports them. `incremental-embedding.service.ts` (311 LOC) — has a hand-rolled "hash" that's misnamed and broken (line 31–33: `content.slice(0, 100) + length`). Confuses contributors about what's the real embedding pipeline.

**Mitigation phase:** **11** (rolled into Phase 9 purge).

---

### F.3 OPS-013 — `package.json` scripts reference deleted paths

**Severity:** 4/5
**Files:** `packages/omnimind-api/package.json` lines 24–27.

**Scenario:** `test:integration`, `test:security`, `test:performance`, `test:rollback` all `tsx src/services/...` files now in `_disabled/`. Fresh contributor runs `pnpm test:integration`, gets cryptic error, loses 30 minutes.

**Mitigation phase:** **11** (5-minute fix during Phase 9 purge).

---

### F.4 OPS-015 / OPS-016 — `prompt-loader.ts` and `logger.ts` exist in two places

**Severity:** 4/5
**Files:** `packages/omnimind-api/src/lib/prompt-loader.ts` + `packages/boardroom-ai/server/src/lib/prompt-loader.ts`; same shape for `logger.ts`.

**Scenario:** Two implementations diverge silently. Logger redaction added in one not the other = inconsistent log hygiene (compounds SEC-018).

**Mitigation phase:** **12** (move both to `@boardroom/shared`).

---

## G. Roadmap implications

### G.1 Phase 11 (Foundations + observability + queue + backup)

OPS-002, OPS-004, OPS-005, OPS-008, OPS-011, OPS-012, OPS-013. Foundational because every later phase depends on metrics to validate fixes and on a CI gate to keep regressions out.

### G.2 Phase 12 (Hardening)

OPS-007, OPS-009, OPS-015, OPS-016. Mostly small targeted PRs.

### G.3 Phase 13 (Cron isolation, JWT rotation, runbooks)

OPS-003, OPS-006, OPS-014. Larger build-outs; the cron-isolation work pays back across multiple risk axes.

### G.4 Phase 14 (Migration history + multi-instance enablers)

OPS-010. Last because it requires Phase 11–13 fixes (CI gate, observability, isolated cron) to land safely.

### G.5 Beyond 14 (accepted)

OPS-001 (single instance), OPS-005 residual (Anthropic outage = product down). Accepted with documented residual.

---

## H. Operational maturity scorecard

The single best summary metric for "are we ready for paying users?" is the count of operational gaps closed:

| Capability | Today | Phase 11 | Phase 13 | Phase 14 |
|---|:---:|:---:|:---:|:---:|
| Health checks | yes | yes | yes | yes |
| Observability (logs, metrics, traces) | no | yes | yes | yes |
| Alerting | no | yes | yes | yes |
| CI gate | no | yes | yes | yes |
| Backup drill | no | yes (drilled) | yes | yes |
| Restore runbook | no | yes | yes | yes |
| JWT rotation | no | no | yes | yes |
| Cron isolation | no | no | yes | yes |
| Migration history | no | no | no | yes |
| Multi-instance ready | no | no | partial | yes |

**Phase 11 closes the alarm-and-recovery gap. Phase 13 closes the rotation gap. Phase 14 closes the topology gap.** Each phase is a discrete maturity step; skipping any one undermines the next.

---

**Word count: ~1,900.**
