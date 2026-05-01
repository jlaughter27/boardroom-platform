# Cost Model — Per-Phase and Per-User Economics

**Audience:** Anyone making a "is this affordable" call — pricing decisions, feature cuts, scale planning.
**Purpose:** Honest dollar projections per phase and per user-tier. Pulls primarily from the scalability audit (`docs/research/omnimind-roadmap-2026/wave1-audit/scalability-audit.md` sections C and F) and the ops-scaling research (`docs/research/omnimind-roadmap-2026/wave1-research/01-ops-scaling.md`).
**Confidence note:** Hosting numbers are firm (Railway publishes them). LLM numbers assume current Anthropic Sonnet 4.6 / Haiku 4.5 list pricing and OpenAI `text-embedding-3-small` pricing as of 2026-04. WAU% (weekly-active fraction) is estimated from comparable indie SaaS tooling — measured numbers replace these as soon as Phase 13 observability ships.

---

## Today (baseline, ~10-100 users)

| Component | $/month | Source |
|---|---|---|
| Railway: 2× Hobby ($5) + Postgres ($10) | **$20** | scalability-audit.md §C |
| Anthropic Sonnet + Haiku (10% WAU) | ~$50 | scalability-audit.md §C — derived from per-user-day token math |
| OpenAI embeddings | <$1 | text-embedding-3-small @ $0.02/MTok, ~50 writes/user/mo |
| Observability (none beyond /health) | $0 | accepted limitation today |
| **Total today** | **~$70/mo idle, ~$0.70/active-user-mo variable** | |

A "real" active user produces ~5 sessions/day × 7 personas × (3k input + 800 output) tok × 0.4 cache weighting ≈ 84k input + 22k output tokens/day. At Sonnet list pricing ($3 in / $15 out per MTok), that's ~$0.17/active-user-day = **~$5.10/active-user-month** before cache savings or Haiku routing. The 0.5-1.5 number that appears in tier projections below applies the WAU fraction (not every user is active every day) and accounts for Haiku-routed cortex calls being ~5× cheaper.

## Cost at scale tiers

| Users | WAU% | Hosting/mo | LLM/mo | Total/mo | $/user/mo | Gross margin @ $20/mo plan |
|---|---|---|---|---|---|---|
| 100 | 10% | $20 | ~$50 | **$70** | **$0.70** | 96% |
| 500 | 30% | $100 | ~$760 | **$860** | **$1.72** | 91% |
| 2,000 | 40% | $255 | ~$4,100 | **$4,355** | **$2.18** | 89% |
| 10,000 | 50% | $1,050 | ~$25,500 | **$26,550** | **$2.66** | 87% |

Numbers from [`scalability-audit.md`](../../research/omnimind-roadmap-2026/wave1-audit/scalability-audit.md) sections C. "Hosting/mo" includes Railway services, Postgres, PgBouncer once required, and a separate cron worker once split. Cortex on Haiku adds ~$0.10/user/mo. OpenAI embeddings cost <$0.01/user/mo even at 10k users — never a lever.

**Margins are healthy at every tier** — but they all depend on per-tenant token-budget enforcement (scalability audit Quick Win #5) actually existing. Without it, one freemium power user can torch $1500/month in Anthropic spend and obliterate margin on the cohort.

## Per-phase cost impact

### Phases that ADD recurring cost

| Phase | What it adds | Monthly impact | Verification |
|---|---|---|---|
| **Phase 5a** LLM augmentation | Nightly batch entity + relationship extraction (Haiku) | +$0.42/user/mo at full rollout (~20% trigger rate, mem0 final-recommendation §6 numbers) | Cost-tracker meter; circuit breaker at $2/user/mo cap |
| **Phase 5b** LLM consolidation | Boundary-case Haiku check on UPDATE/NOOP | <$0.05/user/mo (small fraction of writes hit boundary) | Per-call cost logged |
| **Phase 8** (DEFERRED) reranker | Cross-encoder runs in-process with extra RAM | +$5-20/mo Railway plan bump (≥4GB RAM) | One-time bump, no per-user variable |
| **Phase 12** Webhooks + event bus | Outbound webhook delivery; minimal infra (Postgres-backed queue) | +$0/mo to ~$5/mo (egress + Railway) | Linear in webhook volume |
| **Phase 14** Observability suite | Log + metric + trace ingestion | +$0/mo at 100 users (free tiers); +$25-50/mo at 500-2k users (Axiom/Better Stack); +$100/mo at 10k users (Grafana Cloud Pro or Datadog band) — see `wave1-research/01-ops-scaling.md` §9 |
| **Phase 16** Cortex isolation | New Railway worker service | +$5-20/mo (one extra service) | Linear in workers, not users |
| **Phase 17** (optional) Persona marketplace | sigstore verification compute + storage of installed manifests | +$0-5/mo | Bounded by install volume |
| **Phase 19** Horizontal API scale | Multiple Railway API replicas + PgBouncer | +$30-80/mo (2-3 replicas + PgBouncer instance) | Linear in replicas |
| **Knowledge graph deep** (DEFERRED — see ROADMAP-OVERVIEW) | Apache AGE = $0 incremental; Neo4j sidecar = $50-200/mo | Wide range — depends on which path | Decision documented as ADR before any commit |

### Phases that SAVE cost (or unlock revenue)

| Phase | How it saves / earns | Estimated impact |
|---|---|---|
| **Phase 0.25 / quick-wins** Per-tenant token budget (initial caps) | Caps single-user runaway spend | **Prevents** ~$500-1500/mo/incident — the difference between healthy margin and a billing crisis |
| **Phase 14** Observability | Surfaces expensive endpoints; informs optimization | Indirect — typically pays for itself in the first p99 spike caught |
| **Phase 16** Cortex isolation | Frees API instance from cortex CPU spikes; defers needing more API replicas | At 2k users, defers a ~$40/mo extra API replica |
| **Phase 18** Resilience + multitenant fairness | Postgres-backed rate limiter + full per-tenant budget enforcement + real RLS | Same protection as Phase 0.25 — extends to multi-instance and adds the audit-grade RLS layer |
| **Phase 13** SDK | Indirect: enables external developer revenue (B2B, integrations) | Variable — not modeled |
| **Phase 12** Webhooks + event bus | Indirect: makes OmniMind a platform — Zapier, n8n, custom downstream | Variable |
| **Phase 10** MCP server | Indirect: makes BoardRoom usable from Claude Desktop / Cursor — expands TAM | Variable |
| **Phase 11** Markdown export | Reduces "data lock-in" objection; helps conversion | Variable |

## Cost ceilings — when to cut a feature on cost grounds

These are the decision rules. They aren't suggestions; they're commitments to ourselves.

| Ceiling | Action |
|---|---|
| Phase 5a costs >$2/user/mo at full rollout | **Reduce trigger rate** (more selective extraction); fall back to pattern-only path. Document in DECISIONS-LOG. |
| Phase 5a global spend exceeds $50/day during rollout | **Auto-disable** via cost-tracker circuit breaker; admin notified. |
| Total LLM $/user/mo exceeds $5 at any tier | **Block phase** that pushed it over; reassess routing (more Haiku, less Sonnet) before unblocking. |
| Observability spend exceeds 10% of hosting bill | **Migrate** from current vendor to next-cheaper tier (Axiom → self-hosted Grafana, Datadog → Axiom). |
| Hosting/user exceeds $0.50/mo at any tier | **Audit** — likely a misconfigured pool, a stuck cron job, or untested replica fanout. |
| Single endpoint p99 cost-per-call exceeds $0.10 | **Investigate** — typically a runaway tool loop or unbounded retrieval. |

## Build-time cost (Claude Code Opus + research APIs)

Build-side costs during execution of this roadmap:

| Item | Estimate |
|---|---|
| Claude Code (Opus) sole-build-agent token spend across all 18 phases | <$200 total — eval harness + research are the largest consumers |
| Anthropic API for eval harness runs | ~$10-30 per full eval pass; expected ~50 runs across roadmap = $500-1500 total |
| OpenAI embeddings for eval baseline + new schema rollouts | <$10 total |
| External research (Exa, web fetch) during planning | <$50 total |

Total estimated build cost across the whole roadmap: **<$2,500** at p90. This is in the noise relative to a single month of LLM spend at 500+ users.

## Open questions (will be answered post-Phase 13)

These are the numbers we're guessing at today. Phase 13 observability ships the instruments to replace guesses with measurements:

- Actual WAU% (we're using 10-50% across tiers — could be off by 2x in either direction)
- Actual cache-hit weighting (using 0.4 — Anthropic prompt caching may save more or less)
- Actual cortex job duration distribution (using 10-30s/user — could be skewed)
- Actual memory write rate (using 50/user/mo — could be much lower for casual users, much higher for power users)
- Actual `Decision.outcome` populate rate (gate for Phase 7b)

Until these are measured, **all per-user cost projections in this doc carry ±50% uncertainty.** The directional ranking (hosting < LLM, embeddings negligible, Sonnet > Haiku spend) is high-confidence; the absolute dollars are not.

---

**Source files:**
- [`docs/research/omnimind-roadmap-2026/wave1-audit/scalability-audit.md`](../../research/omnimind-roadmap-2026/wave1-audit/scalability-audit.md) §C, §D, §F
- [`docs/research/omnimind-roadmap-2026/wave1-research/01-ops-scaling.md`](../../research/omnimind-roadmap-2026/wave1-research/01-ops-scaling.md) §6, §9, §10
- [`docs/research/mem0-memory-architectures/stage5-validation/final-recommendation.md`](../../research/mem0-memory-architectures/stage5-validation/final-recommendation.md) §6
