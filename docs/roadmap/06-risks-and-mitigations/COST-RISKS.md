# Cost Risks — Detailed Catalog

**Wave 2 Builder 4 · Risks & Mitigations**
**Date:** 2026-04-18 (Wave 4 reconciliation note: phase numbers in body text use the older Builder 4 scheme; canonical mapping is in `RISK-REGISTER.md` Section 6)
**Sources:** `wave1-audit/scalability-audit.md`[3], `wave1-research/01-ops-scaling.md`[6], `wave1-research/02-security-best-practices.md`[5]
**Cross-reference:** `RISK-REGISTER.md` for the master table (canonical phase numbers); `OPERATIONAL-RISKS.md` for hosting reliability concerns.

> **Phase-number translation key (canonical):**
> - "Phase 11 (Cost controls / quick wins)" → Phase 0.25 (initial token cap + p-limit + connection_limit) + Phase 18 (full per-tenant enforcement)
> - "Phase 13 (Observability / cron worker)" → Phase 14 (observability) + Phase 16 (cortex isolation)
> - "Phase 14 (HNSW / multi-instance)" → Phase 3 (HNSW) + Phase 19 (horizontal scale)

This catalog tracks four cost-runaway dimensions: LLM spend, embedding spend, Railway hosting, and Stripe billing leakage. Each risk includes scenario, current state, breaking metric, fix phase, and what happens if we don't act.

---

## A. LLM cost runaway — the single biggest pre-PMF risk

### A.1 SEC-006 / SCL-006 — Per-tenant LLM token budget does not exist

**Severity:** 2/5 (escalates to 1/5 with growth experiment)
**Probability:** **High** the moment the platform sees any traffic spike (Product Hunt, viral X post, paid ads).
**Files:** No file — feature absent. Anthropic billing API does not support per-user attribution out-of-the-box; the responsibility is application-level.

**Scenario:** Today's request limiter caps at 60 req/min, 30 writes/min — a *request* count, not a *token* count. One bad actor (or one curious power user) can:
- Hit Cortex `/scan` endpoints in a loop (SEC-014). 100 scans/day = $5–15 per account.
- Register 50 trial accounts, run cortex on each = $250–750/day.
- Submit a 50,000-token document to memory ingest, trigger 7-persona analysis, repeat = potentially $50/day per account.

**Current rate-limit-only protection:**

| Endpoint | Rate limit | Token-cost limit |
|---|---|---|
| `/sessions` (decide-mode, 7 personas + CEO) | 50 sessions/user/day | **none** |
| `/cortex/contradictions/scan` | global 60/min | **none** |
| `/cortex/patterns/scan` | global 60/min | **none** |
| `/cortex/memo/generate` | global 60/min | **none** |
| `/cortex/simulate` | global 60/min | **none** |
| `/memories` create | 30 writes/min | **none** (compounds w/ embedding spend, SCL-009) |

**Per scalability audit §C, baseline cost-per-active-user-day:**
> 5 sessions × 7 personas × (3k input + 800 output tok) × 0.4 cache weighting = ~84k input + 22k output = **$0.17/day = $5.10/user/mo at Sonnet 4.6 list prices.**

A bad actor with 100× the activity = **$510/user/mo**. Twenty bad actors × $500/mo = **$10,000/mo unexpected Anthropic bill**. At a 75% gross margin on $20/mo plans, this consumes the margin from 670 paying users.

**Mitigation phase:** **11** (highest priority — runway-extinction risk per research[5 §10]).

**Fix:**

1. **Per-tenant `LlmUsage` table** tracking input/output tokens × current price. Anthropic responses include `usage.input_tokens` and `usage.output_tokens` — accurate per-request accounting is trivial.
   ```sql
   CREATE TABLE llm_usage (
     id text primary key,
     user_id text not null,
     model text not null,
     input_tokens int not null,
     output_tokens int not null,
     cost_cents int not null,
     created_at timestamptz default now()
   );
   CREATE INDEX idx_llm_usage_user_day ON llm_usage (user_id, date_trunc('day', created_at));
   ```
2. **Hard $-cost ceilings per user per day.** Reject when user exceeds free-tier $5/day or paid-tier $50/day. Single best control per research[5 §7].
3. **Account-level Anthropic spend cap.** Anthropic Console supports usage limits — set a hard monthly cap at 2–3× expected. Panic-button backstop.
4. **Anomaly detection** — z-score on request volume per user, alert at 3σ. New account hitting LLM endpoints within 60s of signup = quarantine.
5. **Circuit breaker on token spend** (research §10) — same shape as the existing OmniMind client breaker, but tripped by spend velocity (>5× hourly average for 5 min) → fall back to Haiku-only / no cortex / no premium personas.

**Cost of inaction:** First incident is the worst incident. A $1,500 surprise Anthropic invoice is recoverable from cash flow. The *trust* damage of "we couldn't pay our bill because a bad user blew our budget" doesn't recover.

---

### A.2 SCL-001 — Anthropic Sonnet 4.6 ITPM saturation at ~500 users

**Severity:** 2/5
**Probability:** **High by month 4–5** of growth.
**Files:** `packages/boardroom-ai/server/src/agents/agent.ts`, Anthropic client wiring.

**Scenario:** Per scalability audit §A row 8: Tier 2 limits (1k RPM, 80k ITPM, 16k OTPM single key). One concurrent decide-mode session = 7 personas × ~3 KB context = ~21k input tokens. **Four simultaneous decide sessions saturate ITPM.** At 500 users with even 1% concurrent decide rate, this is hit weekly.

**Symptom:** "Service unavailable, please retry" mid-session. Persona outputs hang. Some users see partial responses (Optimist OK, Critic times out).

**Mitigation phase:** **11** (apply for Tier 3/4 deposit early; add `p-limit(20)` around Sonnet client). **13** (split keys by workload — cortex on a separate key from interactive sessions per research[5 §3]).

**Cost of inaction:** Throttling is the user-facing symptom of "AI is broken." Refund / churn impact compounds quickly.

---

### A.3 SCL-015 — Anthropic prompt-cache savings unrealized

**Severity:** 4/5 (low-impact today, compounding savings opportunity)
**Files:** `packages/boardroom-ai/server/src/agents/agent.ts`, persona system prompts.

**Scenario:** Per Anthropic prompt caching docs (research[6 §10]): cached input tokens cost ~10% of uncached. Persona system prompts are static — they're the perfect candidate. Today: every persona invocation re-bills the full system prompt at full price.

**Per scalability audit §C: cost-per-active-user-month = $5.10. With aggressive prompt caching on the static persona prompts (~2 KB per persona), savings ≈ 30–40% on Sonnet calls.** At 2,000 users with 40% WAU, that's **$1,500 → $900/mo Anthropic spend**.

**Mitigation phase:** **13**.
**Fix:** Add `cache_control: { type: 'ephemeral' }` markers to the static system-prompt portion of every persona request. Cache hit accounting requires `LlmUsage` table to track cached vs uncached tokens separately.

**Cost of inaction:** Margins compress slowly. Not an emergency, but the easiest 30% LLM-cost reduction available.

---

## B. Embedding cost — backfill and re-embed scenarios

### B.1 SCL-009 — Embedding queue depth grows with no backpressure

**Severity:** 3/5
**Files:** `packages/omnimind-api/src/services/embedding-queue.ts:19`, `incremental-embedding.service.ts:25`

**Scenario:** Per scalability audit §A row 6: queue past ~5,000 items ≈ 80MB → 1GB RAM pressure on a 1GB Railway instance → OOM kill → queue lost (compounds DAT-002). One user uploading a 1MB document with 200 chunks blocks the worker for 80 seconds (sequential `for` loop, SCL-005). During that window, no other user's embeddings progress.

**Cost dimension:** OpenAI `text-embedding-3-small` at $0.00002/1k tokens. At an unbounded queue depth, costs scale with input volume — a malicious user posting 100 large documents = ~$2 in OpenAI spend, plus the OOM cascade.

**Mitigation phase:** **11**.
**Fix:** Backpressure at 1,000-job queue depth. Per-user write quota at 200 memories/day (SEC-020). Phase 13 swap to durable Postgres-backed queue with `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 50` batching.

---

### B.2 SCL-011 — OpenAI embedding model deprecation forces full re-embed

**Severity:** 3/5
**Files:** `packages/omnimind-api/prisma/schema.prisma` (no `embedding_model` column today)

**Scenario:** OpenAI's typical deprecation cycle is ~24 months. `text-embedding-3-small` shipped Jan 2024. Plausible deprecation announcement: late 2026 or 2027. Replacement model may have different dimensions (1024 vs 1536) → existing pgvector column incompatible. Without per-row `embedding_model` and `embedding_dimensions` tracking, migration is **all-or-nothing**: re-embed every memory in a single window.

**Cost dimension:** At 2,000 users × 200 memories × ~200 tokens × $0.00002/1k tok = **~$1.60 to re-embed the universe.** Cheap on cost. Expensive on **time** — serial OpenAI calls at Tier 2 (3,000 RPM) take ~4 hours during which semantic search is degraded for everyone.

**Mitigation phase:** **13** (Embedding versioning).
**Fix:** Add `embedding_model`, `embedding_dimensions`, `embedded_at` columns. Track per-row provenance. When migration time comes, re-embed in trickle mode (lowest priority queue, single worker, no live traffic impact).

**Cost of inaction:** Discovery happens when the OpenAI deprecation email arrives — typical 6-month notice. The first 5 months are spent realizing the schema doesn't support partial re-embed. Migration becomes a panic-mode 4-hour outage.

---

## C. Railway hosting cost projections

Per scalability audit §C:

| Tier | Plan | Hosting cost | LLM cost | Total $/user/mo | GM @ $20/mo |
|---|---|---|---|---|---|
| **100 users (today)** | 2× Hobby + Postgres | $20/mo | $50/mo | $0.70 | **96%** |
| **500 users (~6mo)** | 2× Pro + Postgres Pro + 1 worker | $100/mo | ~$760/mo | $1.70 | **91%** |
| **2,000 users (~12mo)** | 3× API + 2× cortex worker + Postgres 4GB + PgBouncer | $255/mo | ~$4,100/mo | $2.13 | **89%** |
| **10,000 users (~24mo)** | 6× API + 4× worker + Postgres 16GB + read replica + PgBouncer | $1,050/mo | ~$25,500/mo | $2.66 | **87%** |

**Margins look healthy at every milestone — but they assume the per-user token budget exists.** Without SEC-006 / A.1, a single growth experiment can collapse the 91% margin at 500 users into negative territory for that month.

### C.1 OPS-001 derivative — Railway plan upgrade cost surprises

**Scenario:** Crossing each tier boundary requires manual Railway plan upgrade. The tier boundaries are not always loud (RAM creep, connection-pool saturation are gradual). Without alerting (OPS-002), the founder discovers the upgrade need from a paying user's complaint, not from a metric.

**Mitigation phase:** **11** (observability — Pino → Axiom OTLP per ops research §8) gives the metrics. Phase 13 (cortex worker isolation) defers the next tier boundary by ~3× by removing cortex from the API instance budget.

---

## D. Stripe billing drift — revenue leakage

### D.1 DAT-004 / SEC-002 — Webhook unreachable + signature broken = silent revenue leak

**Severity:** 2/5
**Cost dimension:** Direct revenue.

**Scenario:** Two compounding bugs (audit §A2 + §A4):
1. `app.use(express.json())` consumed the raw body before the webhook handler runs → `stripe.webhooks.constructEvent` throws every time.
2. Webhook is mounted **after** the auth wall → Stripe's no-cookie POST gets 401.

**Result:** Subscriptions never transition `TRIALING → ACTIVE`. Payment failures never propagate. Users stay on free trial forever, OR paying users get cut off when `currentPeriodEnd` lapses without a renewal write.

**Per `6-MONTH-FORECAST.md` Scenario 1:** at 200 paying users by month 9, expect ~10 known-drift accounts plus 2× unknown-unknowns. At $20/mo plan × 30 affected accounts × 3 months avg = **$1,800 in direct revenue lost.** Plus chargeback fees ($25 each), Stripe enhanced-monitoring trigger if >1% chargeback rate, and the trust damage of refund cycles.

**Mitigation phase:** **12** (Hardening — webhook fix + idempotency table). **13** (reconciliation cron pulling truth from Stripe daily).

**Cost of inaction:** Revenue drift compounds. Every month of inaction = another cohort of mis-billed users. Discovery happens when the founder notices ARR doesn't match MRR × 12.

---

### D.2 SEC-011 — Subscription middleware fails open on all errors

**Severity:** 3/5
**Files:** `packages/boardroom-ai/server/src/middleware/subscription.middleware.ts:31-34`

**Scenario:** The bare `catch {}` lets the request through unconditionally. Compounding scenarios:
- API key rotation → `OmnimindAuthError` → user gets full Pro features for free.
- Circuit breaker trips → all paid features unlocked platform-wide for the breaker cooldown.
- Stripe webhook fired `customer.subscription.deleted` while OmniMind was down → user has `null` sub but `STRIPE_SECRET_KEY` is set, so the failing-open path runs.

Per pricing model ($29/mo after 14-day trial), **every hour OmniMind is unhealthy = free service for non-payers.**

**Mitigation phase:** **12**.
**Fix:** Narrow the catch to `OmnimindUnavailableError` only. Cache last-known subscription status per user (60s TTL). Fall back to cached value on error rather than blanket-allow. Distinguish "OmniMind unreachable" (legitimate fail-open) from "subscription endpoint returns 5xx" (suspicious — log loudly, alert if >1% of requests fail-open in 5-min window per research[5 §10]).

**Cost of inaction:** Probability is low per individual outage. Aggregated across 12 months × multiple outage types = real revenue leak. Detection: "I never paid for this and it works" = abuse vector.

---

## E. Cost containment infrastructure (the meta-fix)

Per ops-scaling research §10, three layers compose the durable defense:

1. **Per-tenant spend caps** (Phase 11) — closes A.1 / SEC-006.
2. **Circuit breaker on token spend** (Phase 13) — same pattern as OmniMind client breaker, tripped by *spend velocity*. Catches both runaway loops and abuse.
3. **Anthropic Message Batches API** (Phase 13/14) — 50% cost reduction for jobs that tolerate 24h latency. Perfect fit for cortex jobs (weekly memos, pattern detection, contradiction sweeps). Submit batch Sunday morning, poll Sunday evening.

**At 2,000 users, Batches API on cortex saves ~$300/mo (15% of the $2,000 cortex spend at that scale). Implementation cost: ~2 days.**

---

## F. Cost-by-phase summary

| Phase | LLM/Embedding cost work | Hosting cost work |
|---|---|---|
| **11** | `LlmUsage` table; per-tenant token budget; Anthropic Tier 3/4 deposit; backpressure on embedding queue; persistent queue (eliminates wasted re-embed cost on lost jobs) | Observability deploy (Pino → Axiom OTLP) — cost insight that informs every later optimization |
| **12** | Stripe webhook fix; subscription cache; close revenue-leak path (DAT-004, SEC-002, SEC-011) | None |
| **13** | Embedding versioning columns (defer re-embed crisis); prompt-cache adoption; cortex worker isolation (frees API budget); per-key workload split | Cortex moves to dedicated Railway worker service (~$10/mo, defers next tier upgrade) |
| **14** | Anthropic Message Batches on cortex (50% cortex savings) | PgBouncer, multi-instance API enablers |

---

## G. What we are explicitly NOT pursuing

- **Multi-model routing** (ADR-002 forbids until 5,000+ paying users). Cheaper-model fallback would help cost ceilings but introduces persona-quality variance.
- **Self-hosted embedding model.** OpenAI cost is <$0.01/user/mo even at 10k users — not a lever.
- **Cloudflare/CDN in front** for cost reasons. Will help when egress bandwidth (SCL-014) crosses 100 GB/mo, beyond the 12-month horizon.

---

**Word count: ~1,400.**
