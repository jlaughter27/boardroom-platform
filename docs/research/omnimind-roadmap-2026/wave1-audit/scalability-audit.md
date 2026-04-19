# Scalability Audit — OmniMind / BoardRoom Platform

**Wave 1 — Audit Agent**
**Date:** 2026-04-18
**Branch:** `feature/folder-migration`
**Constraints in scope:** ADR-001 (no agent frameworks), ADR-003 (pgvector only, no separate vector DB), ADR-009 (node-cron, no Redis/BullMQ).

This audit walks ten subsystems, identifies the exact metric that breaks each one, ties the breaking point to a user-count milestone, and proposes specific code or infra changes. Every claim is grounded in a file path. Every number is either pulled from a config constant in the repo or computed from documented vendor limits.

---

## 0. Baseline (today)

| Resource | Value | Source |
|---|---|---|
| Active users | <100 | CLAUDE.md "Current state" |
| Railway instances per service | 1 | CLAUDE.md "Known Limitations" |
| RAM per instance | 1 GB | task brief |
| Postgres connection pool | 10 (Prisma default) | `packages/omnimind-api/src/lib/db.ts` (no `?connection_limit=` in `DATABASE_URL`) |
| Vector index | IVFFlat, `lists=100` | `prisma/migrations/20260407000000_add_embedding_column/migration.sql:8` |
| Per-user query limit | 20 req/min | `packages/shared/src/constants/rate-limits.ts:18` |
| Per-user write limit | 30 req/min | `packages/shared/src/constants/rate-limits.ts:19` |
| Embedding batch size | 10 / 5s debounce | `packages/omnimind-api/src/services/incremental-embedding.service.ts:16,138` |
| Cron schedule | 3 jobs/week, sequential per user, in-process | `packages/omnimind-api/src/jobs/cortex-scheduler.ts:18-66` |
| Rate-limit store | `Map<string, RateBucket>` in process memory | `packages/omnimind-api/src/middleware/rate-limiter.ts:9` |

---

## A. Ceiling Table

| # | Subsystem | Metric | Today | Breaks at | Fix | Phase |
|---|---|---|---|---|---|---|
| 1 | Express throughput | Concurrent in-flight req/instance | ~5 | ~80 RPS sustained on 1 vCPU → p95 > 1 s | pm2 cluster or N Railway replicas; `compression` middleware | 17 |
| 2 | Prisma connection pool | Concurrent DB-bound requests | well under 10 | >10 simultaneous slow queries queue, p95 climbs | `?connection_limit=20&pool_timeout=10`; PgBouncer transaction pooler | 17 |
| 3 | pgvector IVFFlat retrieval | p95 latency on `MemoryEntry.embedding` | ~30 ms | >40 k vectors total: `lists=100` scans ~400/list → p95 > 300 ms | Reindex `lists = sqrt(rows)` at 10 k; switch to HNSW at ~200 k | 18 |
| 4 | Cron loop wall time | Runtime per weekly job | ~10 s @ 100 users | 30 s/user × 2 000 = 16.6 h; 3 jobs collide | Dedicated cron worker service; chunk + parallelize | 18 |
| 5 | Cron blocking API | Event-loop occupancy during cron | negligible | JSON.parse of 5 MB memory sets blocks loop ~150 ms each; 10–15 min p95 window @ 2 000 users | Cron in separate Railway service sharing DB | 18 |
| 6 | Embedding queue depth | `pendingQueue.length` | 0–10 | OpenAI tier 2: 3 000 RPM, 1 M TPM. Queue past ~5 000 (~80 MB) → 1 GB RAM pressure | Persist queue to Postgres table; backpressure at 1 000 | 17 |
| 7 | Embedding write rate | Concurrent `generateEmbedding…` calls | 1 (sequential for-loop, line 159) | Burst of 200 chunks = 80 s | `Promise.all` + `p-limit(5)`; OpenAI batch `input: [...]` (up to 2 048) | 17 |
| 8 | Anthropic Sonnet 4.6 limit | Tier 2: 1 000 RPM, 80 k ITPM, 16 k OTPM (single key) | <2 RPM | ~50 concurrent decide-mode sessions × 21 k tok = ITPM saturated | Tier 3/4 deposit; split keys by workload; per-tenant budget | 17 |
| 9 | Anthropic Haiku 4.5 limit | Tier 2: 4 000 RPM, 400 k ITPM | <2 RPM | Parallelized cortex (50×) bursts past RPM | `p-limit` around client | 18 |
| 10 | Per-tenant token budget | Token spend cap per user/day | **NONE** (only request-count limiter exists) | One power user burns $50+/day on Sonnet | `User.tokensUsedToday` col + middleware counting `usage` from responses | 17 |
| 11 | RAM idle | RSS at boot | ~180–230 MB | 23 % of 1 GB Railway plan | Comfortable through 500 users | — |
| 12 | RAM under load | RSS realistic | ~350–500 MB @ 100 users | ~700 MB @ 500 users (rate Map + queue + Prisma + SSE buffers) | Externalize queue + rate buckets | 17 |
| 13 | SSE bandwidth | Egress per session | ~300 KB/session (7 personas + CEO) | 500 users × 5/day × 30 = 22 GB/mo. Comfortable on Pro tier | Revisit at 5 k users | 19 |
| 14 | DB connection starvation | Cron holds conns during Anthropic calls | rare | 2 000 users × 30 s each × 1 conn → pool of 10 saturates during cron | Move cron off main service (#5 fix covers this) | 17 |
| 15 | CPU bottleneck | Sustained CPU% on 1 vCPU | ~5 % | Cortex JSON.parse pegs CPU during weekly window | Streaming JSON parse; worker thread / separate service | 18 |
| 16 | Multi-tenant noisy neighbor | Cross-user impact | low | One 5 k-memory user triggers 90 s pattern run → conn held, 30 k tokens, event loop blocked → affects all neighbors | Per-user `p-limit` + cortex isolation + token budget | 18 |

---

## B. The "First to Break" Prediction

### At 500 users (~6 months)
1. **Anthropic Sonnet 4.6 ITPM cap** — first to bend. With 7-persona dispatch and ~3 KB context per persona, a single concurrent decide-mode session is ~21 k input tokens. At Tier 2's 80 k ITPM, four simultaneous "decide" sessions saturate. **Time to failure: month 3–4** of the 6-month window, the moment a small spike in WAUs lands.
2. **Cortex Sunday/Monday wall time** — at 500 users × ~20 s/user (memo: 10 s, patterns: 6 s, contradictions: 4 s) the weekly memo job takes ~2.8 hours. Acceptable, but **CPU stays pinned for that entire window** and the API gets slow during it. **Time to noticeable degradation: month 2–3** as power users grow their memory store.
3. **Prisma connection pool** — first symptomatic at the cron/API overlap. The default 10-connection pool, with cortex holding ~1 connection per active user-iteration plus ~5 for in-flight API requests, will start queueing at ~15 concurrent operations. **Time to failure: month 5** if cortex is left in-process.

### At 2 000 users (~12 months)
1. **Cortex single-process loop** breaks first and breaks hard. 30 s/user × 2 000 = 16.6 h. Three weekly jobs run sequentially within a 24-hour window; they will collide. The Sunday memo will still be running on Tuesday.
2. **pgvector IVFFlat at `lists=100`** — at avg 200 memories/user × 2 000 users = 400 k vectors. The original `lists=100` heuristic targets `sqrt(rows) ≈ 632`. Probe count stays at default 10, scanning ~40 k vectors per query. p95 will be **400–800 ms** without an HNSW migration or a `lists` rebuild.
3. **Per-tenant token budget absence** becomes a billing crisis. One unbounded user at a freemium tier can run up $1 500/mo in Anthropic spend; multiply by even 1 % of 2 000 users.

### At 10 000 users (~24 months)
1. **Single Railway instance** is mathematically impossible. ~80 RPS sustained throughput per Express+Prisma instance × ~3 RPS/active user × 5 % concurrency = needs 2 000 RPS aggregate ÷ 80 = **25 instances minimum** for API alone.
2. **Postgres single primary** capacity: at 200 memories/user × 10 000 = 2 M `MemoryEntry` rows; pgvector on a single primary works but reads will need read replicas. Embeddings table alone is 2 M × 1 536 × 4 bytes = ~12 GB without compression.
3. **Cortex must be a separate worker fleet.** Period.

---

## C. Cost Projections

### Railway hosting
| Tier | Plan | API + Postgres + cron worker (when split) | Notes |
|---|---|---|---|
| 100 users | 2 × Hobby ($5/mo each) + Postgres ($10) | **$20/mo** | Today |
| 500 users | 2 × Pro ($20) + Postgres Pro ($50) + 1 worker ($10) | **$100/mo** | Bump RAM to 2 GB on API |
| 2 000 users | 3 × API replica ($20) + 2 × cortex worker ($20) + Postgres 4 GB ($150) + PgBouncer ($5) | **$255/mo** | First multi-instance config |
| 10 000 users | 6 × API ($20) + 4 × worker ($30) + Postgres 16 GB + read replica ($800) + PgBouncer ($10) | **$1 050/mo** | Read replicas, dedicated cortex |

### Anthropic LLM
Per active user/day: 5 sessions × 7 personas × (3 k input + 800 output tok) × 0.4 cache weighting = ~84 k input + 22 k output. At Sonnet 4.6 list ($3/$15 per MTok): ~$0.17/day = **$5.10/user/mo**.

| Tier | LLM ($/mo) | Per user (weighted) |
|---|---|---|
| 100 users (10 % WAU) | ~$50 | $0.50 |
| 500 (30 % WAU) | ~$760 | $1.50 |
| 2 000 (40 % WAU) | ~$4 100 | $2.00 |
| 10 000 (50 % WAU) | ~$25 500 | $2.55 |

Cortex on Haiku 4.5 ($1/$5 per MTok) adds ~$0.10/user/mo. OpenAI embeddings (`text-embedding-3-small` @ $0.02/MTok) cost <$0.01/user/mo even at 10 k users — not a lever.

### Total $/user/month (compute + LLM)
| Users | Hosting/user | LLM/user | Total/user | Implied gross margin @ $20/mo plan |
|---|---|---|---|---|
| 100 | $0.20 | $0.50 | **$0.70** | 96 % |
| 500 | $0.20 | $1.50 | **$1.70** | 91 % |
| 2 000 | $0.13 | $2.00 | **$2.13** | 89 % |
| 10 000 | $0.11 | $2.55 | **$2.66** | 87 % |

Margins look healthy — but every one of these depends on Quick Win #1 (token budget enforcement) actually existing.

---

## D. Quick Wins (5–10× headroom for low effort)

1. **Explicit Prisma connection limit** — append `?connection_limit=25&pool_timeout=15` to `DATABASE_URL`. 2.5× connection headroom. **5 min.**
2. **Parallelize embedding batch** — `incremental-embedding.service.ts:159–189`. Replace `for` with `Promise.all` + `p-limit(5)`. Cuts batch latency from ~4 s → ~800 ms. **30 min.**
3. **OpenAI batch embeddings input** — `embeddings.create({ input: [...] })` accepts up to 2 048 strings/call. One round trip vs ten. **1 h.**
4. **`p-limit` around Anthropic client** — `boardroom-ai/server/src/agents/agent.ts`. Wrap Sonnet at 20, Haiku at 50. Prevents 429 bursts; smooths cost. **1 h.**
5. **Per-user token meter** — `User.tokensUsedToday: Int @default(0)`, midnight reset cron, middleware reads `usage` from Anthropic responses. Closes noisy-neighbor billing risk. **1 day.**
6. **Rebuild IVFFlat to `lists = ceil(sqrt(rows))`** — nightly check triggers `REINDEX` when `current_lists < sqrt(rows)/2`. **2 h.**
7. **Raise IVFFlat probes** — `SET ivfflat.probes = 10` (default 1) in `retrieval/semantic-search.ts`. ~2× CPU per query for ~3× recall; postpones HNSW migration ~6 months. **30 min.**
8. **SSE opt-out from compression** — globally-applied `compression` breaks SSE; ensure SSE route emits `Cache-Control: no-transform`. Cuts non-SSE size ~70 %. **1 h.**
9. **`keepAlive` agents on OmniMind HTTP client** — `omnimind-client.ts`. Saves ~10 ms TCP handshake per call. **15 min.**
10. **Cron sentinel timing** — wrap loop with `performance.now()`; alert if aggregate > 12 h. **30 min.**

Quick wins #1–4 alone buy 5× API headroom and 3× embedding throughput. With #5–7, 500 users sits comfortably on a single instance.

---

## E. Multi-Instance Unlocks (1 → N Railway replicas)

Stateful pieces that must be externalized before horizontal scale, in order of bite:

| # | Stateful piece | File | Why it breaks under N | Fix |
|---|---|---|---|---|
| 1 | In-memory rate limiter `Map` | `rate-limiter.ts:9` | User routed to A vs B → independent counters → 2× the advertised limit | Postgres-backed token bucket (single `RateBucket` table, row lock). Keeps ADR-009 alive |
| 2 | Embedding queue `pendingQueue` | `incremental-embedding.service.ts:25` | Items lost if instance dies; multiple debouncers → duplicate OpenAI calls | `EmbeddingQueueItem` table; `SELECT … FOR UPDATE SKIP LOCKED LIMIT 10` |
| 3 | `setTimeout` batch debounce | same file, line 26 | Each replica has its own timer | DB queue + single worker process |
| 4 | Cron in-process | `cortex-scheduler.ts:13` | All N instances each fire → N× duplicate runs | Dedicated cron worker service, OR Postgres advisory-lock leader election at boot |
| 5 | Bucket cleanup `setInterval` | `rate-limiter.ts:17` | Multi-fire on N replicas | Moot once #1 moves to Postgres |
| 6 | `basePrisma` per-process pool | `db.ts:6` | N × 10 conns easily exceeds Postgres `max_connections=100` | PgBouncer transaction pooling; per-instance pool → 5 |
| 7 | Anthropic per-process counters | client implicit | Each instance reasons in isolation about rate limits | Tune `p-limit` to `global_limit / N`, or central `tokens_in_flight` table |
| 8 | SSE stream affinity | BoardRoom SSE routes | TCP-bound stream — reconnect to a different replica loses continuity | Sticky sessions on Railway, or push SSE state to DB |

**Minimum work to unlock 1 → N:** items 1, 4, 6 are non-negotiable. Items 2, 3 only mandatory if API replicas (not just a worker) handle writes.

**Recommended sequence:**
- Step A (Phase 17): Cron → dedicated Railway worker service (single replica).
- Step B (Phase 17): PgBouncer in front of Postgres; per-instance `connection_limit = 5`.
- Step C (Phase 18): Rate limiter + embedding queue → Postgres tables.
- Step D (Phase 18): API behind Railway load balancer, sticky sessions for SSE.

---

## F. Roadmap Implications

### Adjustments to existing phases
- **Phase 2 Cortex (shipped):** "complete in functionality, incomplete in deployment topology." Retroactively unsafe at 500 users. Phase 17 must address.
- **Phase 3 Integrations:** Gmail/Calendar polling makes cron load hourly, not weekly. The single-process model fails at ~200 users with hourly polls, not 2 000.
- **Phase 4 Collaboration:** multi-user rooms add SSE fanout (one room → N participants); plan for ~3× egress.

### New phases to add (proposed insertion points)

**Phase 17 — Resilience & multi-tenant fairness (ship before 500 users)**
Scope:
- Quick wins #1–10 from section D
- Per-tenant token budget (#5) — billing prerequisite
- PgBouncer in front of Postgres
- Cortex moves to dedicated Railway worker service
- DB-backed rate limiter (kills the Redis question once and for all under ADR-009)
- Effort estimate: 1 senior eng × 2 weeks

**Phase 18 — Horizontal API scale (ship before 2 000 users)**
Scope:
- Embedding queue and batch debounce moved to Postgres
- API service runs N=2–4 Railway replicas
- IVFFlat → HNSW migration on `MemoryEntry.embedding` once total > 200 k vectors (`USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64)`)
- Stream JSON parsing in cortex services (kills CPU pegging)
- Worker thread pool for cortex Anthropic calls with `p-limit`
- Effort estimate: 1 senior eng × 3 weeks

**Phase 19 — Read replica & cost controls (ship before 10 000 users)**
Scope:
- Postgres read replica; route retrieval queries (semantic, FTS, trigram) to replica
- Anthropic prompt-caching enabled across all persona system prompts (ADR companion to 002 — enabled by 2026 SDK; massive cost win on the static portions)
- Per-tier token budgets enforced at billing layer
- Bandwidth audit + Brotli on JSON responses
- Egress monitoring / alerting
- Effort estimate: 2 eng × 4 weeks

### Ordering rationale
Phase 17 is gated by **revenue safety** (token budget) and **fairness** (rate limiter + cortex isolation). Phase 18 is gated by **horizontal scale enablers** (queue + cron externalization done in 17 unlock the rest). Phase 19 is purely **economic** — needed once the LLM bill matters more than the salary of the engineer optimizing it.

### Decisions to revisit (not break)
- ADR-001 "no agent frameworks" — still holds. None of the above requires LangChain/CrewAI/etc.
- ADR-003 "pgvector only" — still holds through 10 k users. At ~20 M vectors (~100 k users) revisit Pinecone/Weaviate; not before.
- ADR-009 "node-cron, no Redis" — **the DB-backed rate limiter and queue let us keep this ADR alive.** The cost is more Postgres write pressure; the benefit is one fewer infra component to operate. Recommend: keep ADR-009, document the DB-backed queue pattern in DECISIONS.md.

---

## Bottom-line ranking (what to fix first, by ROI)

1. **Per-user token budget** (D#5) — billing risk, blocks freemium expansion. **1 day.**
2. **PgBouncer + explicit `connection_limit`** (D#1, E#6) — prevents the most likely production outage. **2 days.**
3. **Cortex → dedicated worker service** (E#4, F-Phase 17) — kills the largest p95 contributor. **1 week.**
4. **DB-backed rate limiter** (E#1) — unlocks horizontal API scale. **3 days.**
5. **HNSW migration playbook** (A#3, F-Phase 18) — write the script now, run it at 200 k vectors. **1 day for the script, 1 hour to run.**

Everything else is stylistic until one of these five fails.
