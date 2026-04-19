# PHASE 19 — Horizontal API Scale

**Time budget:** 3 weeks
**Sequence:** Last phase in this roadmap. Trigger: ~2000 active users OR p95 event-loop lag >50ms sustained, whichever comes first.
**Owner:** dev
**Confidence:** MED (well-understood patterns; biggest risk is sticky-session SSE behavior under failover)

---

## What this is

Move OmniMind API from "vertical-scaled single instance" to "N replicas behind a load balancer with sticky sessions for SSE." Per the Wave 1 audit, this is the **third move**, not the second — vertical scaling and workload separation (cortex isolation, Phase 16) carry further than most teams expect. This phase fires when those have been exhausted.

Concretely:

- **PgBouncer in transaction-pooling mode** in front of Postgres. Each Railway API replica connects to PgBouncer, not directly to Postgres. `connection_limit=5` per Prisma instance keeps total connections under Postgres's 100-connection cap even with 4-6 replicas. PgBouncer's `default_pool_size = 80` shares connections across all replicas.
- **Multi-instance API.** Railway scales `omnimind-api` to 2-4 replicas. Sticky sessions via Railway's load balancer cookie affinity (verify Railway's current support; may require a Cloudflare layer if not native).
- **SSE survival.** BoardRoom's SSE streams are TCP-bound to whichever replica accepted the connection. Sticky sessions ensure reconnects land on the same node. Document failover behavior: if a replica dies mid-stream, the client gracefully reconnects to a new replica and re-issues the request (idempotent for read-only persona invocations).
- **Embedding queue moves to graphile-worker.** Phase 16's `EmbeddingQueueItem` table + node-cron polling worked for one cortex replica. With multiple API replicas all enqueueing, and a desire for sub-100ms wakeup latency on writes, switch to graphile-worker (uses `LISTEN/NOTIFY`). graphile-worker also handles the outbox delivery worker (Phase 12). node-cron stays for time-based cron only.
- **Cloudflare in front of Railway.** Free WAF + DDoS protection; cheap edge cache for `/health` and `/openapi.json`. SSL termination at Cloudflare with `Full (strict)` to Railway. Per the audit, this absorbs cheap-abuse traffic that the in-app rate limiter shouldn't have to handle.
- **Read-replica deferred.** The audit recommends Phase 19 stays on the primary; read replicas are needed only at >5x read:write ratio AND >60% sustained primary CPU. We're not there.

---

## Why now

The trigger conditions are explicit:

- **At ~2000 active users** the cortex single-process loop already broke (fixed in Phase 16) and Anthropic ITPM caps started bending. The remaining bottleneck is the API process itself: ~80 RPS sustained per Express+Prisma instance × 5% concurrency × 2000 users ≈ borderline.
- **Above ~3000 active users** a single API replica is no longer mathematically sufficient.
- **Independently**, p95 event-loop lag >50ms sustained for 1h is a trigger regardless of user count — it means existing users feel slow.

## Prerequisites

- Phase 14 (observability) — must see event-loop lag, p95s, and per-replica metrics
- Phase 16 (cortex isolation) — API process must be cron-free before scaling
- Phase 18 (resilience + fairness) — durable rate limiter, durable embedding queue, durable outbox; advisory-lock cron all required so multi-instance doesn't double-fire or double-charge
- PgBouncer Railway template available (verify; if not, deploy as a custom service with the official Docker image)
- Cloudflare account configured for the Railway domain

## Exit criteria

- [ ] PgBouncer running as a Railway service (or sidecar); routes API → Postgres
- [ ] Prisma `DATABASE_URL` points at PgBouncer with `?pgbouncer=true&connection_limit=5&pool_timeout=15`
- [ ] API service scaled to 2 replicas in production; verified by observability showing both replicas serving traffic
- [ ] Sticky sessions active; verified by manual SSE test (start a stream, observe 100% of subsequent SSE chunks served from the same replica)
- [ ] Failover test: kill one replica during a live SSE stream; client reconnects to the other replica and re-issues the request successfully
- [ ] graphile-worker installed and migrated (`graphile-worker --schema-only`); embedding queue + outbox delivery worker migrated to it
- [ ] node-cron still owns time-based jobs (weekly memos, etc.) — no change there
- [ ] Cloudflare in front of `omnimind-api-production.up.railway.app`; observe Cloudflare in `req.headers['cf-ray']`
- [ ] Cloudflare WAF rate-limit rules configured (free tier: 10k req/10min per IP for unauthenticated routes)
- [ ] Postgres `max_connections` capacity verified: even at 6 API replicas + cortex + PgBouncer overhead, total stays under 80% of cap
- [ ] No advisory-lock cron breaks under multi-instance (verified by Phase 18 eval scenario re-run)
- [ ] Eval scenario: load test at 2x current peak; p95 latency stays under target; all replicas share load
- [ ] Cost tracking: dashboards show per-replica resource usage; total cost projection updated in `docs/roadmap/CAPABILITIES-INVENTORY.md`

## Dependencies

- **Upstream:** Phase 14, 16, 18 (all required)
- **Downstream:** none — last phase in this roadmap. Future phases (collaboration, paid features) build on top.

## Blast radius

- **Highest operational risk in the scale block.** Multiple things change at once: PgBouncer hop (latency + statement-cache caveats), multiple replicas (state leak risks), Cloudflare in path (cache + WAF surprises), graphile-worker (new infra component, even if Postgres-resident).
- **Mitigation:** ship in three sub-cutovers, NOT one big bang. (a) PgBouncer alone first; verify; (b) graphile-worker for queues; verify; (c) replica scale + Cloudflare. Each cutover has its own rollback.
- **Risk:** Prisma + PgBouncer in transaction-pooling mode loses interactive transactions, advisory locks across statements, prepared statements caching. Code audit before cutover identifies any usage of these patterns.
- **Risk:** sticky sessions can produce uneven load. Document expected ratios; alert if any single replica exceeds 70% of average.
- **Rollback:** every step has an env-flag or DNS-based rollback. Cloudflare DNS proxy can be toggled off in <1 min. PgBouncer can be removed by reverting `DATABASE_URL`. Replica count is a Railway slider.

---

**Constraints reminder:** Respect ADR-001 (no frameworks), ADR-002 (Anthropic only), ADR-003 (pgvector only), ADR-009 (node-cron only — graphile-worker is a Postgres extension of the same principle: no Redis). All prompts in `docs/prompts/*.system.md`. All LLM tool outputs Zod-validated. CLAUDE.md service-boundary rules apply.
