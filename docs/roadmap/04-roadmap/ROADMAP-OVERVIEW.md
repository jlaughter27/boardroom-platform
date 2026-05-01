# Roadmap Overview

**Audience:** Anyone (Claude or human) wanting the full tour of phases.
**Purpose:** Visual timeline + dependency graph + per-phase summary. Click into individual `PHASE-*/README.md` for execution detail.
**Last updated:** 2026-04-18 (Wave 4 validator pass — phase numbering reconciled, Phases 17/18/19 surfaced)

---

## At-a-glance

```
          MEM0 CORE                             MAKE-IT-10                       SCALE
          ────────────                          ──────────                       ─────

Phase 0     Foundation cleanup       0.5w  ┐
Phase 0.25  Critical fixes           ~3d   │
Phase 0.5   Eval harness             2w    │
Phase 1     Schema alignment         1.5w  │
Phase 2     Pattern extraction +     2.5w  │
            ADD/UPDATE/DELETE/NOOP         │
Phase 3     HNSW + RRF               1.5w  │ ── ~17-23 calendar weeks (solo founder, ~60% focus)
Phase 4     Graph traversal          1w    │
Phase 5a    LLM augmentation         2w    │
Phase 5b    LLM consolidation        1w    │
Phase 6     Entity ranker boost      0.5w  │
Phase 7a    Recency / access boost   0.5w  │
Phase 9     Purge _disabled/+ ADRs   0.5w  ┘

Phase 10    Memory MCP server        4-6w  ┐
Phase 11    Markdown export + git    3-4w  │ ── 12-17 weeks (after mem0 core, research-validated)
Phase 12    Webhooks + event bus     2w    │
Phase 13    Public TS SDK            3-4w  │
Phase 14    Observability suite      2w    │
Phase 17    Persona marketplace      4-6w (optional — see DEF-014 for descope path) ┘

Phase 15    Migration history        1w    ┐
Phase 16    Cortex isolation         2w    │ ── 8-11 weeks (when scale signals fire)
Phase 18    Resilience + multitenant 2w    │
Phase 19    Horizontal API scale     3w    ┘

DEFERRED (with named triggers):
  Phase 7b — Outcome feedback loop (trigger: ≥200 Decision.outcome populated + MemoryCitation table exists)
  Phase 8  — Cross-encoder reranker (trigger: eval MRR <0.6 AND Railway ≥4GB RAM)
```

## Per-phase summary

| # | Phase | Weeks | One-line goal | Owner | Confidence |
|---|---|---|---|---|---|
| 0 | Foundation cleanup | 0.5 | Clean repo, drop dead code, wire log drain | dev | HIGH |
| 0.25 | Critical fixes | ~0.5 (3 days) | Six exploitable-today security/data fixes (OAuth state, Stripe webhook, mass-assignment, RLS facade, ENCRYPTION_KEY, version race) | dev | HIGH |
| 0.5 | Eval harness | 2 | Hand-labeled 35-query baseline + non-regression gate | dev | HIGH |
| 1 | Schema alignment | 1.5 | 4 entity tables + bi-temporal-lite + memoryType enum | dev | HIGH |
| 2 | Pattern extraction + write loop | 2.5 | Async post-write extraction; deterministic ADD/UPDATE/DELETE/NOOP; `MemoryWriteEvent` durability | dev | HIGH |
| 3 | HNSW + RRF | 1.5 | HNSW index live; RRF A/B vs weighted | dev | HIGH |
| 4 | Graph traversal | 1 | Recursive-CTE `findRelatedEntities(id, hops=2)` over typed link tables | dev | MED |
| 5a | LLM entity + relationship augmentation | 2 | Nightly batch with hard cost cap | dev | MED |
| 5b | LLM consolidation upgrade | 1 | Haiku check on UPDATE/NOOP boundary cases | dev | MED |
| 6 | Entity-aware ranker boost | 0.5 | 5th signal in `ranker.ts` behind flag | dev | HIGH |
| 7a | Recency + access count refinement | 0.5 | Exp-decay + `log(access_count)` | dev | HIGH |
| 7b | Outcome-weighted ranker | DEFERRED | Resume on trigger | dev | LOW (deferred) |
| 8 | Cross-encoder reranker | DEFERRED | Resume on trigger | dev | LOW (deferred) |
| 9 | Purge `_disabled/` + ADRs | 0.5 | Delete dead trees; write ADR-014/015/016 | dev | HIGH |
| 10 | Memory MCP server | 4-6 | Expose memory r/w via MCP for Claude Desktop, Cursor, GPTs (research-validated; original 2w estimate was wrong) | dev | MED |
| 11 | Markdown export + git sync | 3-4 | "Your data is yours" — `.md` files in synced repo (research-validated; original 1w underestimated vault-layout design) | dev | MED |
| 12 | Webhooks + event bus | 2 | `MemoryWriteEvent` and entity events delivered to user-registered webhook endpoints; ships before SDK | dev | MED |
| 13 | Public TypeScript SDK | 3-4 | Published to npm; integration test green (research-validated; original 1.5w was wrong) | dev | HIGH |
| 14 | Observability suite | 2 | Log drain + metrics + tracing + alerting | dev | HIGH |
| 15 | Migration history | 1 | Baseline + `prisma migrate deploy`; remove `--accept-data-loss` (defuse-first candidate — pull forward to right after Phase 0 if possible) | dev | HIGH |
| 16 | Cortex isolation | 2 | Cortex moves to separate Railway service | dev | MED |
| 17 | Persona marketplace | 4-6 | Git-installable, signed, sandboxed personas; install endpoint + sigstore verification (optional — see DEF-014 for descope conditions) | dev | MED |
| 18 | Resilience + multitenant fairness | 2 | Per-tenant token budget enforcement; Postgres-backed rate limiter; real RLS rollout; ADR-010 narrowed | dev | HIGH |
| 19 | Horizontal API scale | 3 | API service runs N replicas safely (cron isolated, sticky sessions for SSE, breaker shared, PgBouncer in path) | dev | MED |

## Dependency graph

```
0 ──> 0.25 ──> 0.5 ──> 1 ──> 2 ──> 3 ──> 4 ──> 5a ──> 5b ──> 6 ──> 7a ──> 9
                                                                    │
                                                ┌───────────────────┴─────────────────────┐
                                                │                                         │
                                                ▼                                         ▼
                                        Make-it-10 track                            Scale track
                                        10 (MCP)                                    15 (Migration history) ── (gates Phase 1 ideally pulled forward)
                                          │                                         │
                                          ▼                                         ▼
                                        11 (Markdown)                              16 (Cortex isolation)
                                          │                                         │
                                          ▼                                         ▼
                                        12 (Webhooks) ── ships before SDK          18 (Resilience + multitenant fairness)
                                          │                                         │
                                          ▼                                         ▼
                                        13 (SDK)                                   19 (Horizontal API scale)
                                          │
                                          ▼
                                        14 (Observability)
                                          │
                                          ▼
                                        17 (Persona marketplace, optional — see DEF-014)
```

**Critical-path note:** Phase 15 (migration history) is technically scheduled later but has a HIGH-priority defuse role — it's a 1-week task that should be pulled forward to right after Phase 0.25 if at all possible. The `prisma db push --accept-data-loss` landmine (L1) is severe enough that any mem0 schema work in Phases 1-5 carries risk until Phase 15 ships. See `06-risks-and-mitigations/DATA-RISKS.md` for detail.

## What ships when (calendar-relative)

Assuming start date `T+0` and 60% sustained focus (solo founder + product + support):

| Week | Milestone |
|---|---|
| T+0 | Begin Phase 0 |
| T+1w | Phase 0 complete; Phase 0.25 begins |
| T+1.5w | Phase 0.25 complete (security/data critical fixes shipped); Phase 0.5 begins |
| T+3.5w | Eval harness live; Phase 1 begins |
| T+5w | Schema aligned (entities + bi-temporal-lite + memoryType); Phase 2 begins |
| T+7.5w | Pattern extraction + write loop live; Phase 3 begins |
| T+9w | HNSW + RRF; Phase 4 begins |
| T+10w | Graph traversal; Phase 5a begins |
| T+12w | LLM augmentation; Phase 5b begins |
| T+13w | LLM consolidation; Phases 6+7a (parallel, ~1w) |
| T+14w | Ranker upgrades; Phase 9 |
| T+14.5w | **Mem0 core complete; ADR-014/015/016 written** |
| T+19.5w | Memory MCP server live (Phase 10, 4-6w) |
| T+23w | Markdown export live (Phase 11, 3-4w) |
| T+25w | Webhooks + event bus live (Phase 12, 2w) |
| T+28.5w | Public SDK shipped (Phase 13, 3-4w) |
| T+30.5w | Observability suite live (Phase 14, 2w) |
| T+31.5w | Migration history; `--accept-data-loss` removed (Phase 15, 1w) |
| T+33.5w | Cortex isolated to separate service (Phase 16, 2w) |
| T+35.5w | Resilience + multitenant fairness (Phase 18, 2w) |
| T+38.5w | Horizontal API scale (Phase 19, 3w) |
| Optional | Phase 17 (Persona marketplace) — slot anywhere after Phase 13 if signal warrants (4-6w) |

p50 estimate: **~30 weeks**. p90 estimate: **~37 weeks** (revised from earlier 24w/30w to reflect research-validated phase budgets in 10/11/13). Compress only if eval data shows specific phases delivered no measurable lift — don't compress on optimism.

## Where DEFERRED phases re-enter

| Deferred phase | Trigger | Estimated work when triggered |
|---|---|---|
| 7b. Outcome-weighted ranker | `Decision.outcome` populated on ≥200 decisions AND `MemoryCitation` table exists (requires its own design) | 4-6 weeks |
| 8. Cross-encoder reranker | Eval harness shows top-5 MRR <0.6 AND Railway plan ≥4GB RAM AND 24h soak passes | 3 weeks |
| Knowledge graph deep (former Phase 16 KG) | Pattern-match queries become a product feature AND recursive CTE p95 >500ms | 3+ weeks |
| 17. Persona marketplace (alternative-deferral) | Already PLANNED as Phase 17. Only flips deferred if customer demand <5 requests in 90 days OR security model unsolved. See DEF-014. | 4-6 weeks |

See `04-roadmap/DEFERRED/` for full deferred-item specs.

## Phase folders — execution detail

Each `04-roadmap/PHASE-N-{slug}/` contains:
- `README.md` — what this phase is, prereqs, exit criteria, time budget
- `tasks-and-prompts.md` — atomic tasks, each with a pre-written Claude prompt
- `testing-and-rollback.md` — how to verify, how to revert

When picking up a phase, read the phase folder + `STATUS/CURRENT-PHASE.md`. That's all the context Claude needs.

## Phase-number map (for cross-referencing audits and risk docs)

The wave-1 audits and the original `06-risks-and-mitigations/RISK-REGISTER.md` (Builder 4) sometimes used a different numbering scheme. Use this map when you encounter the older numbers in audit text or risk-register entries:

| In audit / risk text it may say | The canonical phase is |
|---|---|
| "Phase 11 (Foundations / Observability / Cost & Queue)" | mostly **Phase 14** (observability) and **Phase 18** (cost controls) — also **Phase 0.25** for the most-critical-now fixes |
| "Phase 12 (Hardening: auth, billing, validation)" | mostly **Phase 0.25** (critical fixes) — overflow into **Phase 18** (RLS rollout) |
| "Phase 13 (RLS rollout, GDPR, Cron isolation, Workers)" | **Phase 18** (RLS), **Phase 16** (cortex isolation), **Phase 14** (observability for cron) |
| "Phase 14 (Migration history, HNSW, multi-instance enablers)" | **Phase 15** (migration history), **Phase 3** (HNSW), **Phase 19** (horizontal API scale) |
| "Phase 1.5 (persistent embedding queue)" | folded into **Phase 1** Track A or **Phase 0.25**; treat as part of the schema-alignment defuse work |
| "Phase 1.6 (optimistic concurrency)" | folded into **Phase 0.25** task 0.25.6 |
| "Phase 2.5 (security hardening)" | absorbed by **Phase 0.25** entirely |
| "Phase 5 (Cortex Pro)" | **Phase 5a** + **Phase 5b** combined |
| "Pre-enterprise" | **DEFERRED/** (with trigger: first SOC 2 / GDPR conversation) |

## Where to go next

- **Active execution:** `STATUS/CURRENT-PHASE.md`
- **Risk-first lens:** `06-risks-and-mitigations/RISK-REGISTER.md`
- **Capability-first lens:** `02-current-state/CAPABILITIES-INVENTORY.md`
- **Constraints check:** `01-foundations/CONSTRAINTS.md`
