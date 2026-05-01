# Operational Scaling for AI Memory Backends (2025–2026)

**Research wave:** 1 of N — omnimind/BoardRoom AI roadmap
**Author:** Wave-1 research agent (Claude Opus 4.7, 1M context)
**Date:** 2026-04-18
**Scope:** Horizontal scaling, connection pooling, queues, replicas, embeddings, cron isolation, backups, observability, rate-limiting, and LLM cost containment for a TypeScript + PostgreSQL + Anthropic stack on Railway.

> Note on sourcing: live web access was unavailable for this pass. Claims drawn from training-cutoff knowledge are tagged `[unverified, training cutoff]`. Where I can cite a primary doc URL with high confidence, I do.

---

## 1. Horizontal scaling patterns for stateful Express + Postgres in 2026

The honest answer for most TypeScript SaaS teams: **vertical-scale your single Railway instance until it hurts, then split work types onto separate services before you split the same service across instances.** Sticky-session multi-instance Express is the *third* move, not the second.

A modern Node 22 / Express 4 process on a 4-vCPU / 8 GB Railway plan can comfortably serve **400–800 active concurrent users** for a workload like omnimind's (mostly LLM-bound, with short bursts of pgvector queries). The bottleneck is rarely Express; it is (a) Postgres connections, (b) embedding/LLM API throughput, and (c) the event loop blocking on JSON serialization of large memory payloads. Vertical scaling fixes (a) and (c); it does nothing for (b), which is where horizontal helps least anyway since rate-limits are per-API-key, not per-instance.

Sticky sessions become *necessary* when you adopt server-side SSE and have non-trivial in-memory state per connection — which BoardRoom AI does today (the SSE stream lives on the instance that started it). With two instances behind a load balancer, the user's reconnect must land on the same node. Railway's built-in load balancer supports session affinity via cookie [unverified, training cutoff — Railway docs evolved through 2025]. The downside is uneven load and cold-cache penalties on failover.

**Pay-off threshold:** Above roughly **1,500 concurrent active users**, or before that if your p95 event-loop lag exceeds ~50ms, horizontal scaling pays off. Below that, vertical + workload separation (cortex into its own service, embeddings into a worker) is cheaper to operate and debug. The Discord engineering posts from 2023–2024 made the same point at much larger scale: split by *workload* before splitting by *replica* [unverified, training cutoff].

**Recommendation for omnimind:** Stay single-instance through Phase 13. Plan workload separation (cortex → its own service) for Phase 14 once you cross ~500 active users.

---

## 2. PgBouncer vs. Supabase Pooler vs. RDS Proxy with Prisma 6 on Railway

Prisma 6 still has the same connection-handling fundamentals: each `PrismaClient` instance maintains its own connection pool (default `connection_limit = num_physical_cpus * 2 + 1`), and Prisma issues prepared statements that do **not** play well with PgBouncer in transaction-pooling mode without `pgbouncer=true` in the connection string ([Prisma docs: PgBouncer](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer)).

Three credible topologies for omnimind:

1. **Direct connection (status quo)** — fine up to ~100 active users with one Railway instance. Uses Postgres' own per-process connection model. No pooler hop, simpler tracing. Breaks the moment you go multi-instance because each instance opens its own pool and you exhaust Postgres' `max_connections` (Railway Postgres default is ~100 [unverified, training cutoff]).
2. **PgBouncer in transaction-pooling mode** — the workhorse. Add `?pgbouncer=true&connection_limit=1` to `DATABASE_URL`, run PgBouncer as a sidecar service on Railway. Loses session-level features (advisory locks, `SET LOCAL`, `LISTEN/NOTIFY`). Prisma's interactive transactions still work but with caveats — verify against [Prisma's connection management docs](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections).
3. **Supabase-style Supavisor / Neon Pooler** — managed transaction pooler with better statement-cache handling than vanilla PgBouncer. Worth considering only if you migrate Postgres provider [unverified, training cutoff].

RDS Proxy is a non-starter on Railway since you're not on AWS-managed Postgres.

**Recommendation:** Add PgBouncer (Phase 14) when you hit either (a) two Railway instances, or (b) >50 sustained active connections per instance. Keep `connection_limit=1` per Prisma instance, set PgBouncer `default_pool_size` to ~80% of Postgres `max_connections` divided by replica count.

---

## 3. Durable job queues without Redis (Postgres-native)

Three serious options, all good fits for the "no new infra" constraint:

| Library | License | Maturity | Killer feature | Caveat |
|---|---|---|---|---|
| **[graphile-worker](https://github.com/graphile/worker)** | MIT | Mature (5+ years) | `LISTEN/NOTIFY`-based wakeup → sub-100ms latency; cron syntax built-in | Schema lives in `graphile_worker` namespace, slightly opinionated |
| **[pg-boss](https://github.com/timgit/pg-boss)** | MIT | Very mature | Rich job state machine (retry, backoff, dead-letter, throttle, cron, queues) | Polling-based by default (more DB chatter than graphile-worker) |
| **[river-queue](https://riverqueue.com/)** | MPL-2.0 | Newer (2024+) | Best-in-class type-safety, originally Go but has a JS port [unverified] | Smaller ecosystem; verify Node maturity before committing |

All three give you **at-least-once delivery, durable retries, dead-letter queues, and visibility into in-flight jobs** — the things `node-cron` cannot give you. The `node-cron + intent-log` pattern omnimind uses today is fine for fire-and-forget reminders but loses jobs on a deploy mid-execution. Any production AI memory pipeline above ~500 users needs durable queueing, full stop, because re-running an embedding or weekly-memo job after a crash costs real money and produces duplicate writes.

**Recommendation:** Adopt **graphile-worker** in Phase 13 for the embedding and cortex pipelines. Reasons: `LISTEN/NOTIFY` keeps latency low without polling, cron is built-in (replaces `node-cron` entirely), it works with the same Postgres you already run, and it's been battle-tested by [PostGraphile](https://www.graphile.org/postgraphile/) since 2019.

---

## 4. Read replicas with Prisma — when does it pay off?

Prisma supports read replicas via the [`@prisma/extension-read-replicas`](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/read-replicas) extension. Operationally it's a one-line config: pass replica URLs in an array. The extension routes `findMany`/`findUnique`/`$queryRaw` to a randomly-chosen replica and writes to the primary.

The catch is **replication lag and routing rules**. PostgreSQL streaming replication on Railway typically lags 50–500ms under normal load [unverified, training cutoff]. For an AI memory app that runs read-then-write patterns (e.g., "fetch user's recent memories, generate response, write new memory"), reading from a replica and writing to the primary will sometimes mean writes don't appear in the next read. You need explicit routing rules or "read your own writes" logic.

**Pay-off threshold:** Read replicas pay off when (a) read traffic is >5x write traffic, AND (b) the primary is hitting 60%+ CPU sustained. For omnimind, the heaviest reads are the hybrid retrieval queries (semantic + FTS + trigram), each touching `MemoryEntry`. If you're under ~80 hybrid retrievals/second sustained, you don't need replicas — you need **better indexes and query plans on the primary**, plus an in-process LRU cache for the hot 5% of memory entries.

**Recommendation:** Defer read replicas until Phase 16 or beyond. Earlier wins: HNSW index for pgvector (replaces IVFFlat, better recall at scale), partial indexes filtering `deletedAt IS NULL`, and a query-result cache keyed by `(userId, queryHash, retrievalParams)`.

---

## 5. Embedding queue at scale — batching, backpressure, OpenAI tier limits

OpenAI's Embeddings API supports up to **2,048 inputs per request** for `text-embedding-3-small` ([OpenAI Embeddings docs](https://platform.openai.com/docs/api-reference/embeddings/create), values verified to early 2025; 2026 limits unverified). Per-input token limit is 8,192. The economic and latency wins from batching are large: a single batched call of 100 inputs is ~10× cheaper *and* faster than 100 sequential calls because you pay one round-trip's TLS and per-request overhead once.

Tier limits in 2026 [unverified, training cutoff but directionally stable]:
- Tier 1 (≤$5 spent): ~3,000 RPM, ~1M TPM for `text-embedding-3-small`
- Tier 4 ($1,000+ spent over 30+ days): ~10,000 RPM, ~5M TPM
- Tier 5: higher, contact sales

For 2,000 active users producing ~5 memory writes/day each, that's ~10k embeddings/day — trivially within Tier 2. The risk isn't volume; it's **bursty backpressure** when a user uploads a large document or transcript. Without a queue, that burst blocks the request thread.

**Pattern:** Producer enqueues `{memoryId, text}` jobs. A single worker process drains the queue in 50-item batches with a 1-second window (whichever fills first). Use exponential backoff on 429 responses with jitter (start 1s, max 30s). Track per-tenant token spend and emit a metric for the cost-cap circuit breaker (see §10).

**Recommendation:** Phase 13 implementation: graphile-worker job named `embedding.batch` with a 50-input batch window, OpenAI client with `max_retries=5` and a `Retry-After`-aware backoff (the SDK handles this, but verify against the version in use).

---

## 6. Cron isolation — separating scheduled work from API processes

Running `node-cron` inside the API process has two failure modes you'll definitely hit:

1. **A long-running cortex job blocks the event loop**, spiking p99 API latency. Even with `setImmediate` yielding, large LLM calls and bulk Prisma writes hold the loop.
2. **Auto-deploys mid-job** kill the job halfway. With `node-cron` there's no resume, no retry — the work is lost.

Four credible isolation patterns for Railway:

| Pattern | Cost (monthly, ~est.) | Operational complexity |
|---|---|---|
| **Separate Railway service for cron** (just `node dist/cron.js`) | +$5–20 | Lowest. Same codebase, separate Dockerfile entry. Best fit. |
| **Inngest** ([inngest.com](https://www.inngest.com/)) | Free tier generous; paid from ~$25/mo | Step functions, retries, fan-out built in. Vendor lock-in is real but the API is portable. |
| **Trigger.dev** ([trigger.dev](https://trigger.dev/)) | Similar to Inngest | Good DX, "Tasks" model maps well to the cortex jobs |
| **AWS Lambda + EventBridge** | <$5 if usage is low | Highest complexity (separate deploy pipeline, IAM, VPC for DB access) |

**Recommendation:** Phase 14 — create `omnimind-cron` as a second Railway service deploying the same monorepo, with `CMD ["node", "dist/cron.js"]`. Combined with graphile-worker (§3), the cron service becomes a thin process that wakes the queue. Defer Inngest/Trigger.dev unless you need step-function semantics for fan-out (e.g., "run cortex pattern detection on each user in parallel with rate limiting").

---

## 7. Backup + PITR for Postgres on Railway

Railway's managed Postgres provides **daily automated snapshots** and **point-in-time recovery within a 7-day window** on the Pro plan [unverified, training cutoff — Railway docs evolved 2025]. The free/hobby tier has only daily snapshots without PITR. RPO with PITR is ~1 minute (WAL replay granularity); RTO depends on database size — for a sub-50GB DB, restore typically completes in 15–60 minutes.

**The gap most teams miss:** snapshots living in the same provider account as the live DB don't protect against credential compromise or account loss. Production-grade PITR means **shipping WAL to off-provider storage** (S3 / Backblaze B2) using a tool like [pgBackRest](https://pgbackrest.org/) or [WAL-G](https://github.com/wal-g/wal-g). Realistically, for omnimind at the current scale, a weekly `pg_dump` via a GitHub Action that uploads to S3-compatible storage is the 80/20 move.

**Restore drill cadence:** Quarterly minimum. Without a tested restore, your "backups" are theoretical. The drill should produce a fresh staging DB from a backup and run the test suite against it.

**Recommendation:** Phase 13 — add a weekly GitHub Action that runs `pg_dump` and pushes encrypted output to Backblaze B2 (cheap, S3-compatible). Phase 14 — implement quarterly restore drills as part of the release checklist. Phase 15+ — consider WAL-G if RPO needs to drop below 1 hour.

---

## 8. Observability stack on a solo-founder budget

Concrete options ranked by cost-to-value at the omnimind scale:

| Tier | Tool | Pricing model (2025) | Strength | Weakness |
|---|---|---|---|---|
| Free | **[Better Stack](https://betterstack.com/)** Logs free tier | 1 GB/mo, 3-day retention free | Beautiful UI, easy Heroku-style setup | Limited retention |
| Free → cheap | **[Axiom](https://axiom.co/)** | 0.5 TB/mo free, then ~$25/100GB | APL query language, generous free tier | Smaller community |
| Cheap | **[Grafana Cloud](https://grafana.com/products/cloud/) free tier** | 50GB logs, 10k metrics, 50GB traces free | Industry-standard tooling | More setup work |
| Mid | **[Honeycomb](https://www.honeycomb.io/) free tier** | 20M events/mo free | Best-in-class for distributed tracing | Tracing-focused, weaker on metrics |
| Premium | **Datadog** | ~$31/host/mo + log volume | Polished, all-in-one | Bills surprise you fast |

For a Pino-based stack (which omnimind uses), the cleanest path is **Pino → OpenTelemetry → Grafana Cloud or Axiom**. Use [pino-opentelemetry-transport](https://github.com/Vunovati/pino-opentelemetry-transport) [unverified, training cutoff] to ship structured logs as OTLP, and `@opentelemetry/instrumentation-express` + `@opentelemetry/instrumentation-prisma` for traces. The whole thing is open-standard and vendor-portable.

**Cost projection** [rough, training-cutoff pricing]:
- 100 users: free tiers comfortably cover everything. ~$0/mo.
- 500 users: ~5–20 GB logs/mo. Axiom free tier or Better Stack ~$25/mo.
- 2,000 users: ~50–100 GB logs/mo. Grafana Cloud Pro ~$49/mo or Axiom paid ~$50–100/mo.

**Recommendation:** Phase 13 — add OpenTelemetry SDK, ship to Axiom free tier. Phase 14 — add request-ID correlation across BoardRoom→OmniMind seam (already done per CLAUDE.md as of 2026-04-15) into the trace context propagator. Phase 15 — add a weekly "expensive endpoint" report to inform optimization priorities.

---

## 9. Rate-limiting at scale without Redis

The current `_disabled/` Redis-backed rate limiter exists for a reason: in-memory limiters reset on restart and don't coordinate across instances. The cheapest durable alternative on a single-Postgres stack is a **Postgres-backed sliding-window or token-bucket counter** in a dedicated table.

Postgres-native pattern (sketch):
- One row per `{tenantId, bucket}` containing `tokens INT, last_refill TIMESTAMPTZ`
- Atomic update via `UPDATE ... RETURNING` with `SELECT ... FOR UPDATE SKIP LOCKED` to avoid contention
- Clean up old buckets via a graphile-worker cron job

This works fine up to ~1,000 RPS *for the rate-limiter itself*. Above that, the table becomes a hot-spot. Two libraries to evaluate before rolling your own:

- **[rate-limiter-flexible](https://github.com/animir/node-rate-limiter-flexible)** — supports multiple stores including Postgres, redis-less mode, sliding-window, leaky-bucket. Mature, battle-tested.
- **[unkey](https://unkey.dev/)** — managed rate-limiting with edge replication; pay-as-you-go. Worth it if you're already using their API key management.

The other angle: **enforce limits at two layers** — a coarse, generous limit at the edge (e.g., Cloudflare's free WAF rate-limit rules) plus a precise per-tenant limit in-application. The edge layer absorbs DDoS and obvious abuse for free; the app layer enforces business limits ("this plan gets 100 LLM calls/day").

**Recommendation:** Phase 14 — adopt `rate-limiter-flexible` with Postgres store. Phase 15 — front Railway with Cloudflare for free WAF + DDoS layer. Defer Redis until you cross ~3 instances or 1,000 sustained RPS.

---

## 10. LLM API cost containment — caps, breakers, batching

Three layers, all worth implementing:

**Per-tenant spend caps** — Track token usage per `{userId, dayBucket}` in a Postgres table; reject requests when daily spend > plan limit. Anthropic's responses include `usage.input_tokens` and `usage.output_tokens` in the response body, which makes accurate per-request accounting trivial. Track in a `LlmUsage(userId, model, inputTokens, outputTokens, costCents, createdAt)` table. The hard part is *prompt-cache hit accounting*, since cached tokens cost ~10% of uncached ([Anthropic prompt caching docs](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)).

**Circuit breaker on token spend** — Same pattern as the existing OmniMind client circuit breaker, but tripped by *spend velocity* rather than network failure. If a tenant's burn rate exceeds 5× their hourly average for 5 minutes, open the circuit and fall back to a degraded mode (no cortex, no premium personas, Haiku-only). This catches both runaway loops and abuse.

**Anthropic Message Batches API** ([docs](https://docs.anthropic.com/en/docs/build-with-claude/message-batches)) gives **50% cost reduction** for jobs that can tolerate up to 24 hours of latency. Perfect fit for cortex jobs (weekly memos, pattern detection, contradiction sweeps) — none of those are user-facing. Submit a batch of all weekly-memo jobs Sunday morning, poll for completion Sunday evening. Implementation cost is low; savings at 2,000 users with weekly cortex jobs are non-trivial.

**Recommendation:**
- Phase 13: add `LlmUsage` table + per-request accounting in the Anthropic client wrapper.
- Phase 14: implement spend circuit breaker and per-plan daily caps (free, pro, team tiers).
- Phase 15: migrate all cortex jobs to Anthropic Batches API for 50% savings.

---

## Implications for omnimind roadmap

Concrete, threshold-tagged recommendations for upcoming phases:

- **Phase 13 (≤500 users) — adopt `graphile-worker`** because the existing `node-cron + in-process` pattern loses jobs on every Railway deploy and cannot retry failed embeddings. graphile-worker rides on the same Postgres, supports cron, and uses `LISTEN/NOTIFY` for sub-100ms wakeup. Migrate the embedding pipeline first (highest cost-of-failure), then cortex jobs.
- **Phase 13 — add `LlmUsage` accounting and Pino → Axiom OTLP shipping.** Both are foundational. Without per-request token tracking you can't build the circuit breaker; without trace correlation across BoardRoom→OmniMind you can't debug seam-level issues.
- **Phase 13 — implement weekly off-provider `pg_dump` to Backblaze B2.** Cheap insurance against Railway-side credential compromise.
- **Phase 14 (~500–1,000 users) — isolate cortex into a separate Railway service** because cortex LLM calls block the API event loop and cause p99 spikes on the user-facing request path. Same monorepo, separate Dockerfile entry, drains the same graphile-worker queues.
- **Phase 14 — add PgBouncer in front of Postgres** the moment you run two Railway service replicas (cortex + api), since per-instance Prisma pools will exhaust Railway Postgres' default 100 connection cap fast.
- **Phase 14 — adopt `rate-limiter-flexible` with Postgres store**, replacing the in-memory limiter. Front with Cloudflare for free WAF.
- **Phase 15 (~1,000–2,000 users) — migrate cortex to Anthropic Message Batches API** for 50% LLM cost reduction. Implement per-tenant spend circuit breaker.
- **Phase 16+ (2,000+ users) — evaluate read replicas and horizontal API scaling** with sticky-session SSE. Not before. Vertical scaling and workload separation will carry you further than most teams expect.

The recurring theme: **separate workloads before separating replicas**, prefer Postgres-native solutions over new infra, and instrument cost early so you can detect abuse before it shows up on the bill.

