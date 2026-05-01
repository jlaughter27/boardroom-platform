# PHASE 19 — Tasks & Prompts

---

## Task 19.1 — Pre-flight audit: identify Prisma patterns incompatible with PgBouncer transaction-pooling

**Scope:** Read-only audit. Find any code that uses interactive transactions across multiple statements, advisory locks across statements, prepared statements that need caching, `LISTEN/NOTIFY`, `SET LOCAL`. These behave differently or break under PgBouncer transaction pooling.

**Prompt:**
> Audit the OmniMind codebase for patterns incompatible with PgBouncer transaction-pooling mode. Check: (1) `prisma.$transaction([...])` usages — array form is fine, callback form may have issues; (2) `prisma.$queryRawUnsafe` with `SET LOCAL ...` — won't persist across statements in transaction pooling; (3) advisory locks (`pg_try_advisory_lock`) acquired in one query and released in another — must be in the same transaction; (4) `LISTEN/NOTIFY` usage — won't work through PgBouncer; (5) prepared statement caching (Prisma uses parameterized queries by default; verify `pgbouncer=true` flag handles this). Produce `docs/contracts/pgbouncer-compatibility-audit.md` listing findings + per-finding remediation. For Phase 18's advisory-lock cron: this stays in `omnimind-cron`, which uses a DIRECT (non-PgBouncer) connection — verify and document. graphile-worker also requires `LISTEN/NOTIFY` and must use a direct connection; document in Task 19.4.

**Verification:** Audit doc reviewed; remediation applied where needed.

---

## Task 19.2 — Provision PgBouncer service

**Scope:** Stand up PgBouncer as a Railway service. Connect omnimind-api to it.

**Prompt:**
> Deploy PgBouncer as a Railway service using the official `bitnami/pgbouncer` Docker image (or `edoburu/pgbouncer`). Configure: `pool_mode=transaction`, `default_pool_size=80`, `reserve_pool_size=5`, `max_client_conn=1000`, `server_idle_timeout=600`, auth from Postgres. Connect: copy the existing `DATABASE_URL`, point PgBouncer's backend at it, set listen port. Set a new env var `PGBOUNCER_DATABASE_URL` for omnimind-api (NOT yet the active `DATABASE_URL` — staging first). Document the configuration in `docs/DEPLOYMENT-RUNBOOK.md`.

**Verification:** PgBouncer service healthy; can connect via `psql $PGBOUNCER_DATABASE_URL`.

---

## Task 19.3 — Cutover api to PgBouncer (staging then prod)

**Scope:** Switch omnimind-api's `DATABASE_URL` to point at PgBouncer.

**Prompt:**
> In staging first, then prod after 7-day soak: change omnimind-api's `DATABASE_URL` to the PgBouncer URL with appended params `?pgbouncer=true&connection_limit=5&pool_timeout=15`. Keep `omnimind-cron`'s `DATABASE_URL` pointing at the direct Postgres URL (its advisory-lock cron and graphile-worker LISTEN/NOTIFY require it). Deploy. Monitor: connection count on Postgres (should drop sharply), p99 query latency (should be flat or slightly higher due to PgBouncer hop), error rate (should be zero — if non-zero, the audit in Task 19.1 missed something; rollback by reverting `DATABASE_URL`). After 7 days clean in staging, repeat in prod.

**Verification:** Postgres connection count drops; p99 query latency stable; zero new error classes; observability shows PgBouncer in trace spans.

---

## Task 19.4 — graphile-worker for embedding queue + outbox delivery

**Scope:** Migrate the two highest-throughput async surfaces to graphile-worker. Time-based cron stays on node-cron.

**Prompt:**
> Install `graphile-worker` in `packages/omnimind-cron/`. Run `graphile-worker --schema-only --connection $DATABASE_URL` to create the `graphile_worker` namespace tables (this is one-time; run as part of cortex's docker-entrypoint). Migrate the embedding queue: replace the Phase 16 `EmbeddingQueueItem` polling job with `worker.addJob('embedding.batch', { ... })` enqueue calls and a `tasks/embedding-batch.ts` task file (graphile-worker convention). The outbox delivery worker (Phase 12): replace its node-cron polling with a graphile-worker task triggered by `LISTEN omnimind_outbox_event_emitted` notify (Postgres NOTIFY emitted on outbox INSERT via a trigger). Keep the time-based cron jobs (weekly-memo, pattern-detection, etc.) on node-cron — they're already advisory-locked and don't need graphile-worker's job-queue semantics. Update `docs/contracts/cortex-isolation.contract.md` and `packages/omnimind-cron/README.md`.

**Verification:** Embedding latency p95 drops <50ms (vs ~200ms with 5s polling); outbox deliveries fire within 100ms of write; existing eval scenarios all green.

---

## Task 19.5 — Cloudflare in front of Railway

**Scope:** Add Cloudflare DNS proxy + WAF + rate limit.

**Prompt:**
> Configure Cloudflare for the Railway domain: (1) move DNS for `omnimind-api-production.up.railway.app` (or our custom domain if any) under Cloudflare's nameservers, (2) enable proxy (orange cloud), (3) SSL/TLS mode `Full (strict)`, (4) WAF: enable managed rules (free tier covers OWASP basics), (5) Rate limiting: 10k req/10min per IP for unauthenticated paths (`/health`, `/openapi.json`, `/.well-known/*`), (6) Page Rules: cache `/health` for 30s, `/openapi.json` for 5 min. Document the configuration in `docs/DEPLOYMENT-RUNBOOK.md` including a "how to bypass Cloudflare in emergency" section (set DNS to grey cloud; takes <1 min to propagate). Verify by inspecting `cf-ray` and `cf-cache-status` headers in production responses.

**Verification:** `cf-ray` header present; cached endpoints return `cf-cache-status: HIT` after first request; manual scrape attempt past 10k/10min triggers Cloudflare's challenge.

---

## Task 19.6 — Replica scale + sticky sessions

**Scope:** Bump omnimind-api to 2 replicas; configure sticky sessions for SSE.

**Prompt:**
> In Railway: scale `omnimind-api` to 2 replicas. Enable sticky sessions via the Railway load balancer's session affinity cookie (verify Railway's current feature set; if unavailable, configure Cloudflare's "session affinity" page rule on SSE routes only — NOT all routes, to keep cache effectiveness). Verify: open a BoardRoom SSE stream; observe all SSE chunks served from one replica (check `x-served-by` header — add this header in `src/middleware/identity.ts` from a `RAILWAY_REPLICA_ID` env var). Test failover: in Railway, restart one replica during a live SSE stream; verify the BoardRoom client reconnects and re-issues the request, landing on the other replica. Document the failover behavior in `docs/USER-EXPERIENCE-NOTES.md`.

**Verification:** Two replicas serving; sticky sessions verified; failover test passes.

---

## Task 19.7 — Load test at 2x peak

**Scope:** Synthetic load test verifying the new topology handles 2x current peak comfortably.

**Prompt:**
> Use `autocannon` or `k6` (your pick; document in `eval/load-tests/README.md`). Generate synthetic load at 2x current peak (capture current peak RPS from observability) for 15 minutes. Profile: 60% memory reads, 20% memory writes, 15% persona invocations (SSE), 5% MCP calls. Record: p50/p95/p99 latency per endpoint, replica CPU + memory, Postgres connection count via PgBouncer, embedding queue depth, outbox depth. Pass criteria: p95 < 800ms on read endpoints; p95 < 5s on persona invocations (SSE first-byte); no 5xx errors; all replicas evenly loaded (max-min <30%); no DB connection pool exhaustion. Document the load test results in `docs/observability/phase-19-load-test-baseline.md`.

**Verification:** Load test passes pass criteria; baseline documented.

---

## Task 19.8 — Update CAPABILITIES-INVENTORY + cost projections

**Scope:** Documentation refresh.

**Prompt:**
> Update `docs/roadmap/02-current-state/CAPABILITIES-INVENTORY.md` with the new topology (PgBouncer, multi-replica API, Cloudflare, graphile-worker for queues). Update cost projections per the Wave 1 scalability audit's section C; recalibrate for actual observed Railway costs. Add a "Scale headroom" section estimating user-count to next bottleneck (likely Anthropic ITPM caps requiring tier upgrade or per-tenant key sharding around 5000 users). Update `STATUS/CURRENT-PHASE.md` to mark Phase 19 done and note "End of current roadmap; future phases TBD."

**Verification:** Docs reflect reality; cost projections are within 10% of observed.
