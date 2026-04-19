# 12-Month Forecast — What Breaks at Scale

**Wave 2 Builder 4 · Risks & Mitigations**
**Date:** 2026-04-18 (Wave 4 reconciliation note: "Phase 11–13" in this file's posture line means Builder 4's old numbering — under canonical numbering this is Phase 0.25 + Phase 14 + Phase 15 + Phase 16 + Phase 18; see `RISK-REGISTER.md` Section 6)
**Horizon:** April 2026 → April 2027
**Posture:** Assumes the 6-month forecast plays out: critical defuse phases (Phase 0.25 + Phase 15 pulled forward) and the make-it-10 track land on schedule, MAU grows from 100 → 2000, paid conversion stabilizes. The 12-month risks live in territory the 6-month forecast doesn't cover: scale, cost, and second-order effects of growth — addressed by Phase 16 + Phase 18 + Phase 19.

Cross-reference: `RISK-REGISTER.md` for risk IDs (canonical phase numbers); `6-MONTH-FORECAST.md` for the prior horizon; `COST-RISKS.md` for spend modeling.

---

## Scenario 1 — Cortex breakdown at 2000 users (the Sunday-night collision)

**Risks:** SCL-002, OPS-006
**Trigger metric:** `users × avg_processing_seconds_per_user > 24 hours / 3 weekly jobs`. Today: 100 × 10s = 0.3 hrs. At 2000 users × 30s = **16.6 hours per job × 3 = 50 hours of work compressed into a 24-hour window.**

**Symptom:** The Sunday memo job is still running on Tuesday afternoon. The Monday pattern-detection job either skips (cron throttle) or piles on top, multiplying contention. Memos for some users never generate; pattern alerts go out for the wrong week. Users learn the cortex output is unreliable and stop trusting it.

**Blast radius:** Every user, every week. Specifically degrades the highest-leverage product feature (the Sunday-night Whole-Week Memo is what makes the platform "an executive coach who remembers"). Lose this and the differentiated value of OmniMind collapses to "yet another AI chatbot."

**Fix phase:** **13** (Cron worker isolation) — single dedicated Railway service. Then **14** (multi-replica cron-worker pool with queue partitioning by `userId`). The graphile-worker pattern (research §3) handles fan-out cleanly.

**Cost of inaction:** Cortex is the moat. A weekend it doesn't run is a refund cycle. By month 9 of inaction, NPS for "the Sunday memo" will be the lowest-rated feature. **Fixing it after users notice = 3× the rebuild cost (you're rebuilding trust, not just code).**

---

## Scenario 2 — IVFFlat index degradation; semantic search p95 > 800ms

**Risks:** SCL-003
**Trigger metric:** Total `MemoryEntry.embedding` row count crosses **40,000**. Today: ~10,000. At 2000 users × 200 memories/user = **400,000**. The original `lists=100` heuristic targeted `sqrt(rows) ≈ 632` — IVFFlat is now scanning **~4,000 vectors per probe** with default probes=1, and `lists=100` was right for a 10k-vector universe.

**Symptom:** Persona context-assembly slows. Each persona call triggers ~3 semantic queries; cumulative p95 climbs from ~30ms today to **400–800ms per persona × 7 personas = 5+ seconds added to first-token latency**. Users perceive the app as "thinking too long" and assume model degradation, not infra.

**Blast radius:** Every retrieval, every session. Affects retention more than acquisition because power users hit it first.

**Fix phase:** **14** (HNSW migration). `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64)`. Quick wins #6 and #7 from scalability audit (rebuild IVFFlat to `lists = ceil(sqrt(rows))`, raise probes from 1 to 10) buy ~6 months of headroom but don't fix the trajectory.

**Cost of inaction:** At 2000 users, retrieval latency is the user-facing symptom of "platform is bad now." HNSW migration is a 1-day script with a 1-hour run window — but *only* if the schema column count and migration history (Phase 14) are clean. Without DAT-001 fixed, the HNSW migration risks becoming a `db push` that silently rebuilds the whole table.

---

## Scenario 3 — Stripe webhook reconciliation needed after 6 months of drift

**Risks:** DAT-004, OPS-014
**Trigger metric:** Cumulative paying users × ~5% webhook failure rate = first reconciliation event. At 200 paying users by month 9, expect **10 known-drift accounts** and **unknown-unknowns at 2× that rate**.

**Symptom:** Customer emails "I cancelled three months ago, why was I charged?" Or worse, the inverse: "I paid, app says free trial expired." Stripe dashboard shows the truth; the app DB doesn't agree. Without a reconciliation job, every drift event requires manual SQL.

**Blast radius:** Trust + chargeback risk + Stripe account-health hit (>1% chargeback rate triggers Stripe enhanced monitoring).

**Fix phase:** **12** ships the idempotency table and signature fix. The **reconciliation job** (Phase 13) is the second half: a daily cron that lists Stripe subscriptions modified in the last 24h and re-syncs OmniMind state.

**Cost of inaction:** First chargeback incident: ~$25 fee + 1 hour of investigation. Tenth: Stripe enhanced monitoring fee (~$50/mo). Hundredth: Stripe puts the account into review. **Once a payments processor distrusts you, you do not get to leave the doghouse for ~12 months.**

---

## Scenario 4 — OAuth token refresh failures cascade into "ghost integrations"

**Risks:** DAT-015, SEC-001 (post-fix residual)
**Trigger metric:** Time. Google's refresh tokens expire when (a) user revokes access in Google account settings, (b) the token is unused for 6 months, (c) Google's policy clock rolls (every ~12 months for some apps). At 12 months in, expect **~15–25% of OAuth tokens to be in some failure mode**.

**Symptom:** Calendar integration shows "Connected" forever (status check returns true based on row existence), but Calendar events return `[]` because every API call silently catches the auth error. User believes the integration works but their meetings aren't getting picked up by memory-extractor. Cortex output drifts from reality.

**Blast radius:** All integration users at 12 months. Worse than failure-loud-then-fix: failure-quiet-and-spread.

**Fix phase:** **12** adds `OAuthToken.lastError`, `lastErrorAt`, `status enum('healthy','degraded','expired')`. **13** adds the recovery UX (badge in UI, periodic re-auth prompt). **14** adds Google Workspace Marketplace verification (required for >100-user OAuth apps anyway).

**Cost of inaction:** Each ghost integration drips into Cortex memo quality. The 100th user with broken Calendar sync writes the support ticket "your AI doesn't know what's on my calendar" — the founder reads it as "model failure," investigates, finds OAuth, realizes the platform has been silently broken for 6 months. **This is the kind of bug that turns a product roadmap into a tech-debt roadmap.**

---

## Scenario 5 — OpenAI embedding model deprecation forces full re-embed

**Risks:** SCL-011, DAT-016
**Trigger metric:** OpenAI announces deprecation of `text-embedding-3-small` (no announcement today; historical OpenAI deprecation cycle: ~24 months from release; `text-embedding-3-small` shipped Jan 2024). Plausible deprecation announcement: late 2026 or 2027.

**Symptom:** OpenAI sends a 6-month deprecation notice. The replacement model has different dimensions (e.g. 1024 vs 1536) → existing pgvector column is incompatible. Without per-row `embedding_model` and `embedding_dimensions` tracking, the migration is **all-or-nothing**: re-embed every memory in a single window.

**Blast radius:** At 2000 users × 200 memories × $0.00002/1k tok × 200 tokens = **~$1.60 to re-embed the universe**. Cheap on cost. Expensive on **time**: serial-issued OpenAI calls at Tier 2 (3000 RPM) take ~4 hours; during the window, semantic search is degraded for everyone.

**Fix phase:** **13** (Embedding versioning). Add `embedding_model`, `embedding_dimensions`, `embedded_at` columns to `MemoryEntry`. Track per-row provenance. When migration time comes, re-embed in trickle mode (lowest priority queue, single worker, no impact on live traffic).

**Cost of inaction:** Discovery happens when the OpenAI deprecation email arrives. Founder has 6 months to migrate. The first 5 months are spent realizing the schema doesn't support partial re-embed. Migration becomes a panic-mode all-or-nothing 4-hour outage.

---

## Scenario 6 — Railway plan upgrade required (and the second-order effects)

**Risks:** SCL-007, SCL-013, SCL-008
**Trigger metric:** RAM under load crosses Railway Pro per-instance ceiling (~2 GB sustained). At 500 users today: ~700 MB RSS. At 2000 users with cortex co-located: ~1.5–2 GB. Add the unbounded SSE store (SEC-013) and the in-memory rate limiter Map: actual ceiling crossing is closer to month 9.

**Symptom:** Railway sends "instance was OOM-killed" notifications. App restarts mid-session. SSE streams die. In-memory rate limiter resets — abuse window opens (compounds SEC-012). Cron jobs in flight die — see Scenario 1.

**Blast radius:** Every user during the OOM window (typically ~30s of cold start). Compounds with DAT-002 (lost embedding queue) — every OOM = lost memories.

**Fix phase:** **13** moves the cron + worker workloads off the API instance. **14** adds PgBouncer + per-instance connection limits, enables N=2 API replicas with sticky-session SSE.

**Cost of inaction:** Railway Pro instance bumps are cheap ($20 → $50/mo per instance). The expensive part is the operational chaos: every OOM is a 30-second outage during which paying users get errors. Forty-eight OOMs in a month = brand damage.

---

## Scenario 7 — Anthropic spend hits $5k/mo without per-tenant attribution

**Risks:** SCL-006, SEC-006 (residual after Phase 11 caps)
**Trigger metric:** Active users × WAU rate × cost-per-user. Per scalability audit §C: at 2000 users × 40% WAU × $2.00/user/mo = **$1600/mo Anthropic + $2500 cortex + $1000 misc = ~$5100/mo**. At 5000 users: ~$13,000/mo.

**Symptom:** Anthropic invoice arrives. Founder cannot attribute the spend per user, per persona, per workflow. Without `LlmUsage` table line-item granularity, "the Doer persona is 40% of spend" is a guess, not a fact. Optimization targets the wrong thing.

**Blast radius:** Margins. At $5/user/mo COGS and $20/user/mo plan, gross margin is 75% — fine until the next 6-month projection misses. Without per-tenant attribution, you cannot price tiers correctly (heavy cortex users cost 5× the average).

**Fix phase:** **11** ships the `LlmUsage` table (basic counts). **13** adds per-persona, per-workflow attribution. **14** introduces Anthropic Message Batches API (50% cost cut on cortex, per research §10) once the volume justifies the implementation.

**Cost of inaction:** Margin compression is silent. By the time it's loud, the runway has been eaten. Founders typically discover this when they try to raise — investors ask "what's your COGS per user?" and the answer is "I don't know, I track total spend." That's a no.

---

## Scenario 8 — Cron-duplicate writes when first second Railway instance lands

**Risks:** SCL-002 (multi-instance variant), DAT-011, DAT-014
**Trigger metric:** First multi-replica Railway deploy. With `node-cron` running in-process on N replicas, every cron event fires N times. WeeklyMemo writes duplicate rows (DAT-011 unfixed = no `@@unique([userId, weekStart])`).

**Symptom:** Users with two memos for the same week. Pattern-detection alerts firing twice. Contradiction scans running 2× the cost. The N=2 replica that was supposed to *help* scaling **doubles** the cortex work without doubling capacity.

**Blast radius:** Anthropic spend doubles for cortex workload (~30% of spend, so ~15% global increase). Data quality (duplicate rows) requires hand-cleanup.

**Fix phase:** **13** has cron isolation (single dedicated cron service). **14** adds the leader-election pattern via Postgres advisory locks if you want cron in N≥2 replicas (per scalability audit §E). The DAT-011 unique constraint should land in Phase 12 as preventative.

**Cost of inaction:** This is Scenario 1 squared — inability to scale cortex horizontally because cortex doesn't survive horizontal scale. The fix is mechanically simple but blocks the Phase 14 work that depends on N>1 replicas.

---

## Scenario 9 — Postgres single-primary read saturation at 1500+ users

**Risks:** SCL-003, SCL-004, SCL-008, SCL-010
**Trigger metric:** Sustained read RPS on `MemoryEntry`. Per ops-scaling research §4: read replicas pay off at >5× write traffic AND primary >60% CPU sustained. At 2000 users with 30% concurrent retrieval activity, hybrid retrieval (semantic + FTS + trigram) hits ~60–80 RPS sustained — well into the "consider replicas" zone.

**Symptom:** Persona response times climb gradually. Cron windows make it worse. P95 latency on retrieval queries breaches 1s. The primary CPU graph plateaus at 70%.

**Blast radius:** Every read, all the time. Symptoms are **gradual**, which is dangerous — there's no single incident to galvanize the fix.

**Fix phase:** **14** introduces PgBouncer + connection-limit tuning. **Phase 15+** (beyond this roadmap, signal-driven) introduces read replicas via `@prisma/extension-read-replicas`. Earlier wins: HNSW migration (Phase 14), partial indexes filtering `deletedAt IS NULL` (DAT-020 fix), in-process LRU cache for hot 5% of memory entries.

**Cost of inaction:** Latency creep is the slowest-burn risk on this list. Six months of unnoticed accumulation = a competitor demo where their app is faster than yours and you don't know why.

---

## Scenario 10 — Backup never restored; first Railway-side incident is unrecoverable

**Risks:** OPS-004, DAT-009, DAT-001
**Trigger metric:** First Railway-side database incident. Probability over 12 months: industry baseline ~2–5% (managed Postgres on a young provider). Conditional on the incident occurring, probability that the backup-restore drill has happened: **0%** today.

**Symptom:** Database is gone. Railway snapshot exists. Restore procedure has never been tested. The restore initiates `db push --accept-data-loss` on first boot of the restored instance (DAT-001 cascade) and silently mutates the restored schema. Possibly partial recovery; possibly worse than nothing.

**Blast radius:** Everything. Every memory, every decision, every commitment, every embedding, every OAuth token, every subscription state.

**Fix phase:** **11** must include a **scripted restore drill** before any meaningful user data is loaded. Quarterly thereafter. Coupled with DAT-001 fix (entrypoint switches off `db push`).

**Cost of inaction:** This scenario's probability is low. Its blast radius is total. Standard risk-math says: **multiply by the cost of the company.** Even at 5% probability × full company value, the expected cost dwarfs the 1-day cost of a drill.

---

## Top-3 priority order (12-month horizon)

1. **Phase 13 cortex isolation** closes Scenarios 1, 4, 8 — every multi-instance future depends on it.
2. **Phase 14 migration history + HNSW** closes Scenarios 2, 3 (reconciliation), 5 (re-embed migration safety), 9 (read scaling preconditions).
3. **Phase 11's backup drill** closes Scenario 10. The cheapest insurance on the list, the highest expected loss if skipped.

---

## What we are explicitly accepting in the 12-month window

- **OPS-001 (single-region Railway)** — accepted; cost of multi-region replication exceeds expected outage cost at <5000 users.
- **SEC-022 (no SSO/MFA)** — accepted; first enterprise deal that demands it forces the build, not a roadmap-driven build.
- **SCL-007 (full horizontal API scale)** — staged via Phase 14 enablers; multi-replica API itself deferred to signal-driven Phase 15+.

---

**Word count: ~1,650.**
