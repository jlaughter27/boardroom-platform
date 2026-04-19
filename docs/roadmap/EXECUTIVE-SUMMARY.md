# Executive Summary — Omnimind Roadmap 2026

**Audience:** Founder, advisors, future hires, anyone who needs the whole picture in five minutes.
**Length:** ~2 pages.
**Detail:** Every claim links to a deeper doc. This is the cover page; the dossier is the rest of `docs/roadmap/`.

---

## What omnimind is

Omnimind is the persistent intelligence layer behind **BoardRoom AI**, a decision-intelligence product for solo founders, indie hackers, and consultants. The user gets a 7-persona advisory board (Optimist, Critic, Alternate, Technician, Questionnaire, Doer, CEO) that remembers their goals, decisions, projects, and people across sessions. Omnimind owns the memory: hybrid retrieval (vector + full-text + trigram), validation, background "cortex" jobs (weekly memos, contradiction detection, pattern surfacing). BoardRoom owns the conversation. They talk over HTTP — the boundary is inviolable. The full architecture map lives in [`PROJECT-CONTEXT.md`](PROJECT-CONTEXT.md).

## Where it is today (2026-04)

Phase 1 of the original product spec is complete. Both services are deployed on Railway, 708 tests are green, and the system is accumulating real (small-scale) user memory. An honest grade from a four-track audit (code quality, security, scalability, data integrity) puts current sophistication at **6.5/10** — meaningfully above an MVP RAG demo, meaningfully below a production memory platform like Zep or mem0 cloud.

The audits surface a consistent picture: the bones are good, the gaps are concrete, and the scale ceiling on the current architecture is **500-1000 active users** before specific subsystems (single Postgres connection pool, in-process cron, in-memory rate limiter, no per-tenant token budget) start hurting users. Sources: [`docs/research/omnimind-roadmap-2026/wave1-audit/scalability-audit.md`](../research/omnimind-roadmap-2026/wave1-audit/scalability-audit.md), [`02-current-state/`](02-current-state/).

Top gaps blocking the next phase of growth:

- **No eval harness.** Every "did we improve?" claim today is vibes. Phase 0.5 fixes this.
- **No entity extraction or pattern-aware writes.** Memory grows but doesn't get smarter. Phases 1-5 fix this (the "mem0 core").
- **No public observability beyond `/health`.** Phase 14 fixes this.
- **No external interfaces beyond the BoardRoom UI.** No MCP server, no SDK, no markdown export, no webhooks. Phases 10-13 add them.
- **`prisma db push --accept-data-loss` in production.** A single landmine. Phase 15 defuses it (pull-forward candidate to right after Phase 0.25).

## The plan — four tracks, ~30 calendar weeks p50 (~37 weeks p90)

The roadmap groups 22 phases into four tracks. Solo founder + product + support work means assume **~60% sustained focus**, not 100%; that's why nominal phase work expands on the calendar. Full timeline in [`04-roadmap/ROADMAP-OVERVIEW.md`](04-roadmap/ROADMAP-OVERVIEW.md).

| Track | Phases | Calendar | What ships |
|---|---|---|---|
| **Critical fixes** | 0, 0.25, 0.5 (and Phase 15 pulled forward as defuse) | 2.5-3.5w | Foundation cleanup, six exploitable-today security/data fixes, eval harness baseline; migration history defuses the `db push` landmine |
| **Mem0 core** | 1, 2, 3, 4, 5a, 5b, 6, 7a, 9 | 11-12w | Entity tables, async pattern extraction, HNSW index + RRF fusion, recursive-CTE graph traversal, LLM augmentation behind cost caps, 5-signal ranker, ADR cleanup |
| **Make-it-10** | 10, 11, 12, 13, 14 (+ optional 17) | 14-18w (research-validated) | MCP server (4-6w), markdown export (3-4w), webhooks + event bus (2w), public SDK (3-4w), observability suite (2w); persona marketplace (4-6w, optional) |
| **Scale prep** | 15, 16, 18, 19 | 8-11w | Migration history (1w; defuse), cortex isolated (2w), resilience + multi-tenant fairness (2w), horizontal API scale (3w) — **only ship as scale signals fire** |

Two phases are explicitly **deferred with measurable triggers**: Phase 7b (outcome-weighted ranker — needs ≥200 populated `Decision.outcome` rows + a `MemoryCitation` table); Phase 8 (cross-encoder reranker — needs eval MRR <0.6 AND ≥4GB Railway RAM). Triggers, not vibes. Full deferral catalogue: [`04-roadmap/DEFERRED/README.md`](04-roadmap/DEFERRED/README.md).

## Top 5 risks

1. **`prisma db push --accept-data-loss` in production entrypoint.** Any schema misstep during Phases 1-5 carries data-loss risk until Phase 15 ships. *Mitigation:* pull Phase 15 forward to immediately after Phase 0.25.
2. **Phase 5a LLM cost overrun.** Nightly batch entity extraction can blow past budget if usage spikes. *Mitigation:* hard `$/user/month` cap (≤$2), cost-tracker counter shipped before Phase 5a starts, circuit breaker on spend velocity.
3. **Single Railway instance / no horizontal scale.** Cron + API share one Node process. At 500 users, weekly cortex starts contending with live API traffic. *Mitigation:* Phase 16 isolates cortex; Phase 18 ships per-tenant fairness; Phase 19 ships horizontal API scale. Quick-wins in scalability audit (`p-limit`, connection-limit query string, Postgres-backed rate limiter) buy 2-5x headroom first.
4. **Solo founder bandwidth shock.** A single 2-week interrupt (illness, customer crisis, fundraising) compresses everything downstream. *Mitigation:* roadmap is structured so Phases 1, 2, 3 each ship usable value independently — order of completion matters more than uninterrupted velocity.
5. **Eval harness false negative.** A phase that *should* show measured lift might not, because the 35-query baseline doesn't cover the slice that improved. *Mitigation:* every phase has a phase-specific eval slice (e.g. multi-entity queries for Phase 6), separate from the standard regression check.

Full risk register with severity, likelihood, owner, and mitigation: [`06-risks-and-mitigations/RISK-REGISTER.md`](06-risks-and-mitigations/RISK-REGISTER.md).

## Top 5 wins after roadmap completes

1. **Measured quality, not asserted quality.** Eval harness reports MRR/nDCG/P@5 every commit. "Phase X improved retrieval" becomes a falsifiable claim with a chart.
2. **Memory that actively gets smarter.** Pattern extraction + LLM augmentation + entity-aware ranking turn raw writes into a structured, queryable graph. Personas reference goals → projects → tasks → people, not just isolated text snippets.
3. **External developer surface.** MCP server (Phase 10) + markdown export (Phase 11) + webhooks/event bus (Phase 12) + npm SDK (Phase 13) = Claude Desktop, Cursor, and a hypothetical "BoardRoom in Cursor" plugin all become real products without rewriting the backend.
4. **Operational visibility.** Phase 14 gives p50/p99 retrieval latency dashboards, queue-lag alerting, and cost telemetry. The first time something breaks at 3am, we'll know.
5. **Defused landmines.** Phase 15 ends `--accept-data-loss`; Phase 9 deletes the `_disabled/` tree with three explanatory ADRs; Phase 16 stops cortex from blocking the API event loop; Phase 0.25 closes the OAuth/Stripe/encryption-key holes. The "things that can silently lose data or get exploited today" list goes from many to ~zero.

## Total time + cost estimate

**Time:** ~17-23 calendar weeks for the mem0 core + critical fixes; +14-18 for make-it-10 (research-validated for Phases 10/11/13); +8-11 for scale prep (Phases 15/16/18/19). **p50 = ~30 weeks total. p90 = ~37 weeks.** Compress only if eval data shows specific phases delivered no measurable lift — don't compress on optimism.

**Cost (build):** Claude Code (Opus) is the sole build agent. No additional headcount required. Anthropic + OpenAI API spend during build is in the noise (<$50 total across the entire roadmap; the eval harness is the largest line item).

**Cost (run, post-roadmap):** Hosting + LLM at 500 users projects to ~$1.70/user/month all-in, climbing to ~$2.66/user/month at 10 000 users — comfortably ≥85% gross margin against a $20/month plan. Detailed projections by user tier and per-phase cost impact in [`01-foundations/COST-MODEL.md`](01-foundations/COST-MODEL.md).

**Decisions deferred to user signoff:** the order of Phases 10/11/12/13 within the make-it-10 track (any order works as long as 12 ships before 13), whether to ship Phase 17 (gated on customer demand per DEF-014), whether to ship Phase 16/18/19 in this calendar window (gated on real scale signals), and the exact pricing tier launch.

---

**Read next:** [`04-roadmap/ROADMAP-OVERVIEW.md`](04-roadmap/ROADMAP-OVERVIEW.md) for the full per-phase breakdown, or [`MASTER-INDEX.md`](MASTER-INDEX.md) to jump to whatever question you actually have.
