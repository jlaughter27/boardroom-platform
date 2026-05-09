# BoardRoom AI — Master Dev Plan

> **Companion to:** [MASTER-DREAM-ROADMAP.md](./MASTER-DREAM-ROADMAP.md)
> **Generated:** 2026-04-17
> **Scope:** Implementation plan for all 40+ features across 9 modules, 10 new Prisma models, 13 Cortex cron jobs, with multi-agent validation gates at every merge.

---

## How to read this document

The roadmap tells you **what** to build. This plan tells you **how** to build it, **in what order**, **who signs off**, and **when it's done**. Each feature passes through a fixed gauntlet of six validator agents before it can merge. No feature ships unless all six return green, and the reports become part of the feature's permanent record.

This plan is opinionated about sequence. The roadmap's Tier 1-4 ordering is the right shape, but it under-weights the foundation work that everything depends on (data models, flag system, eval harness, Cortex scheduler refactor). Phase 0 below makes that work explicit.

---

## Table of contents

1. [Executive summary](#executive-summary)
2. [The multi-agent validation framework](#the-multi-agent-validation-framework)
3. [Per-feature contract](#per-feature-contract)
4. [Phase 0 — Foundation](#phase-0--foundation-2-3-weeks)
5. [Phase 1 — Retention Core (Roadmap Tier 1)](#phase-1--retention-core-5-weeks)
6. [Phase 2 — Intelligence Layer (Roadmap Tier 2)](#phase-2--intelligence-layer-6-weeks)
7. [Phase 3 — Power Features (Roadmap Tier 3)](#phase-3--power-features-8-weeks)
8. [Phase 4 — Premium / Differentiation (Roadmap Tier 4)](#phase-4--premium--differentiation-10-weeks)
9. [Phase 5 — Domain specializations](#phase-5--domain-specializations-4-weeks)
10. [Cortex Evolution — detailed plan](#cortex-evolution--detailed-plan)
11. [Data migration sequence](#data-migration-sequence)
12. [Testing strategy per tier](#testing-strategy-per-tier)
13. [Rollout infrastructure](#rollout-infrastructure)
14. [Risk register](#risk-register)
15. [Timeline and team sizing](#timeline-and-team-sizing)
16. [Appendix A — Validator agent prompt templates](#appendix-a--validator-agent-prompt-templates)
17. [Appendix B — Feature tracking board](#appendix-b--feature-tracking-board)

---

## Executive summary

| Metric | Value |
|---|---|
| Total features in roadmap | 40 (across 9 modules) + 7 infrastructure (Input/Output layers) |
| Net-new Prisma models | 10 |
| Extended Prisma models | 7 |
| Net-new Cortex cron jobs | 9 (3 scheduled + 1 on-demand → 12 scheduled + Simulation) |
| Estimated calendar time (2 FTE) | ~35 weeks (8 months) |
| Estimated calendar time (4 FTE) | ~20 weeks (5 months) |
| Build order | Phase 0 foundation (2-3w) → 4 feature phases → domain layer |
| Validator gates per feature | 6 (Architecture, Security, Performance, UX, Test, Integration) |

### Build philosophy

1. **Data model first, always.** A feature cannot start until its migration is planned, validated, and merged. Schema thrash mid-feature is the most expensive mistake we can make. Phase 0 lands every new/extended model up front.
2. **Every feature is flag-gated at birth.** New code paths default OFF. The flag system is foundation work, not a premium feature.
3. **Cortex job additions are semi-autonomous work.** They can proceed in parallel with UI features once Phase 0 ships the scheduler refactor. Split them across sprints so no single release ships more than 2 new background jobs.
4. **Validation agents run in parallel, not sequentially.** All 6 validators dispatch at once. Total gate time ≈ longest validator, not sum.
5. **Tier boundaries are revenue-shaped.** Each tier must be shippable to the matching price tier without the next tier being done. No cross-tier dependencies.

---

## The multi-agent validation framework

Six specialized validators review every feature before merge. Each is dispatched as a subagent (via the Agent tool with `general-purpose` type, using the prompt templates in Appendix A). They run in parallel and return structured reports.

### The six validators

| # | Validator | Scope | Blocking? | Typical runtime |
|---|---|---|---|---|
| 1 | **Architecture Validator** | Service boundaries, data model shape, backward compat, Prisma migration safety | YES | 10-20 min |
| 2 | **Security Validator** | AuthZ, row-level user isolation, PII handling, rate limits, input validation | YES | 10-15 min |
| 3 | **Performance Validator** | Query patterns (N+1), embedding cost, bundle size, streaming health | YES | 5-10 min |
| 4 | **UX Validator** | Brand system compliance, a11y (WCAG AA), responsive, empty/error/loading states | YES | 5-10 min |
| 5 | **Test Validator** | Unit coverage, eval scenario added if persona-affecting, seam test added if route | YES | 5-10 min |
| 6 | **Integration Validator** | Cross-module effects, Cortex scheduler impact, output-layer contract compatibility | YES | 10-15 min |

### Validator scoping — when each runs

Not every validator needs to run on every PR. Scope by diff surface to cut validator-hours ~40% on narrow changes:

| Validator | Runs when |
|---|---|
| Architecture | Always |
| Test | Always |
| Security | New route, new auth check, any PII-touching field, any LLM input path |
| Performance | New DB query, new embedding call, new dependency, any `for`-with-query pattern |
| UX | Any `.tsx`, `.css`, or `tokens.css` change |
| Integration | Change touches a shared entity (Decision, Memory, Commitment, etc.) or a Cortex output shape |

### Validator runtime access

Validators operate on diff + repo snapshot only. Validators that require runtime evidence must be given one of:
- **UX visual checks** — a live preview URL (Railway preview deploys or equivalent) for responsive / contrast / empty-state verification
- **Performance query plans** — CI artifact: `EXPLAIN ANALYZE` output for new queries
- **Test harness runs** — CI artifact: `pnpm test` + `pnpm eval:all` results attached to PR

Without runtime access, those validators must re-scope their FAIL criteria to static-only findings (e.g., Performance flags N+1 by pattern-match on `for`/`map` + `prisma` calls, not EXPLAIN plan). The runtime expectation must be declared in the PR description; validators absent runtime context surface that gap in their report rather than guessing.

### How the gate works

```
┌────────────────┐    ┌─────────────────────────┐
│ PR opened       │───▶│ Gate Controller          │
│ (feature branch)│    │  dispatches 6 validators │
└────────────────┘    └──────────┬──────────────┘
                                  │ (parallel)
       ┌──────────┬──────────┬────┼────┬──────────┬──────────┐
       ▼          ▼          ▼    ▼    ▼          ▼          ▼
   Architecture Security Performance UX Test Integration
       │          │          │    │    │          │
       └──────────┴──────────┴────┼────┴──────────┘
                                  ▼
                        ┌──────────────────┐
                        │ All 6 green?     │
                        │  YES → mergeable │
                        │  NO  → remediate │
                        └──────────────────┘
```

### Validator report format (required)

```yaml
validator: architecture
feature: WR-1
verdict: PASS | PASS_WITH_NOTES | FAIL
summary: <= 80 words
findings:
  - severity: critical | high | medium | low | info
    area: <specific file or concept>
    issue: <what's wrong>
    fix: <concrete remediation>
remediation_required: [list of must-fix items]
cost_estimate: <lines changed, time>
```

### Escalation rules

- **Any `critical` finding** blocks merge, period.
- **≥2 `high` findings** from the same validator blocks merge.
- **PASS_WITH_NOTES** is merge-ok but the notes file a follow-up ticket automatically.
- **Disagreement between validators** (e.g., Arch says "use X", Perf says "X is slow") escalates to a 7th "Tiebreaker" agent with access to both reports.

### What the validators do NOT do

- They don't write code. They read + report.
- They don't replace human code review. A human sign-off is still required on top of the 6 validators.
- They don't catch product bugs (wrong feature, wrong UX decision). That's the creative-strategist's job upstream.

---

## Per-feature contract

Every ticket — regardless of tier — must follow this shape. This is non-negotiable; it's what the validators check against.

```markdown
# Feature: <CODE> — <Name>
**Phase:** <0-5>   **Tier:** <1-4>   **Owner:** <dev>
**Flag:** <flag-name>   **Status:** planned | in-dev | in-review | merged | live

## What / Why (product)
3-5 sentences. Not a retelling of the roadmap — the *specific* slice we are shipping this ticket.

## Acceptance criteria (user-observable)
- [ ] AC1 — …
- [ ] AC2 — …
- [ ] AC3 — …

## Data model changes
- New models: (list with fields)
- Extended models: (list with new fields)
- Migration name: <timestamp>_<slug>
- Reversible? yes/no
- Data backfill required? yes/no

## API surface
- New routes: POST/GET/PATCH …
- Modified routes: …
- Contract updates in /docs/contracts/

## Frontend surface
- New pages/components: …
- Modified components: …
- Brand system compliance: `text-primary` / `bg-sidebar` / etc., no hardcoded hex

## Cortex touchpoints
- Reads: …
- Writes: …
- New job? yes/no

## Flag strategy
- Flag name, default state, rollout plan (1% → 10% → 50% → 100%)

## Validator gates
- [ ] Architecture
- [ ] Security
- [ ] Performance
- [ ] UX
- [ ] Test
- [ ] Integration

## Telemetry
- Events to emit: …
- Success metric: …
- Kill criteria: if X happens, flag off
```

---

## Phase 0 — Foundation (2-3 weeks)

**Mission:** Everything downstream depends on these. No feature tier can start before Phase 0 is fully merged.

### P0-1 — Unified Prisma migration for all roadmap models

**Single migration, not many.** Add all 10 new models and 7 extensions in one reviewable migration. This avoids the "is this migration from F-17 compatible with the one from F-23?" nightmare that killed the mem0 experiments.

Models to add:
- `Document`, `IngestEndpoint`, `GeneratedArtifact`, `ExportConfig`, `StrategyCanvas`, `Scenario`, `ScenarioEntityLink`, `CapsuleMemoryLink`, `WatchlistItem`, `Sprint`

Models to extend:
- `Decision` (`metadata Json @default("{}")`)
- `Person` (`email String?`, `metadata Json @default("{}")`)
- `DecisionAssumption` (`invalidatedAt`, `invalidatedReason`, `linkedMemoryIds`)
- `CustomPersona` (`metadata Json`)
- `ThinkingPattern` (`evidenceIds String[]`)
- `Session` (`metadata Json`)
- `MeetingOutput` (`metadata Json`)

Validator gates — all 6. Extra scrutiny on **Architecture** (shape of relations, index coverage) and **Performance** (indexes on `userId`, on JSON metadata GIN if PG allows).

Deliverables:
1. `packages/omnimind-api/prisma/schema.prisma` — all models added, commented per roadmap
2. `packages/shared/src/types/*` — TypeScript interfaces for each new entity
3. `packages/shared/src/validation/*.schema.ts` — Zod schemas for each
4. `packages/omnimind-api/prisma/migrations/<timestamp>_roadmap_foundation/` — migration + seed adjustments
5. Each new model gets at minimum: CRUD service stubs (`packages/omnimind-api/src/services/<entity>.service.ts`) that will fail Integration validator until wired, so each feature is forced to claim ownership

### P0-2 — Feature flag system

**No feature ships without a flag.** Build once, use everywhere.

**Step 0 — reconcile existing orphaned migration (do this first, blocks everything else):** A raw SQL migration `packages/omnimind-api/prisma/migrations/20250412040000_add_feature_flags/` already creates `feature_flags`, `feature_flag_logs`, `killswitch_triggers`, `killswitch_activations` tables in prod, but has **no corresponding Prisma model** in `schema.prisma` and its callsite code lives in a quarantined `_disabled/` dir. P0-2 will collide on first deploy unless reconciled. Pick one:
- **Adopt** — run `prisma db pull` against a staging DB with the migration applied, verify the inferred `FeatureFlag` model matches the shape below, promote to `schema.prisma`. Decide fate of the 3 auxiliary tables (logs, killswitch_triggers, killswitch_activations) — adopt or drop.
- **Discard** — write a new migration that drops the 4 tables first, then create the clean `FeatureFlag` model below. Delete `_disabled/` code.

Either path must be documented in the PR. Architecture + Security validators gate the decision.

- `FeatureFlag` Prisma model: `(id, key, defaultState, rolloutPercent, allowList String[], denyList String[], targetPlan String?, killSwitch Boolean)`
- `/flags/*` routes on OmniMind: `GET /flags/for-user`, `PATCH /flags/<key>` (admin)
- `useFlag(key)` hook on the client, with SSR-safe default
- `requireFlag(key)` server middleware
- Admin UI under `/settings/flags` (Enterprise only)

Validator gates — Architecture, Security, Test.

### P0-3 — Cortex scheduler refactor

Current: `cortex-scheduler.ts` has 3 jobs hardcoded (verified — uses destructured `schedule()` from node-cron at lines 15, 33, 51). Simulation runs on-demand via `POST /cortex/simulate`, not cron.
Target: pluggable job registry so we can add jobs without touching the scheduler.

- `CortexJob` interface: `{ name, schedule, dependsOn?, enabled, shadowMode: boolean, shadowOutput?: (result) => void, run(ctx) }`
- Registry pattern: jobs self-register at boot time
- Telemetry: duration, success/failure, rows touched (existing `memory-cleanup.job.ts` has the precedent pattern — `durationMs`, `usersProcessed`, counts)
- Flag-gated: every new job is behind a flag (`cortex-<jobname>`)
- Backoff on failure (in-process retry with exponential backoff; **no distributed queueing** — preserves ADR-009)
- Dependency ordering, in-process only (Pattern Detection depends on Memory updates this week)
- **Shadow-mode capability**: when `shadowMode: true`, the job runs on schedule, builds its result object, and passes it to `shadowOutput` (log-file writer by default) instead of writing to DB. Inspected via `/admin/cortex/shadow-runs` admin view.

**Transition plan for existing 3 jobs:** freeze current `cortex-scheduler.ts`, re-implement each job against the registry behind a flag (`cortex-registry-v2`), run both paths in parallel for 1 week comparing outputs, then flip the flag and delete the old scheduler. Atomic swap at deploy-time is rejected — too much blast radius on user-visible memos/patterns.

Validator gates — all 6.

### P0-4 — Input Layer (IL-1 to IL-4) infrastructure

These are foundation because every feature assumes data can arrive. Build the pipes now, not when a feature needs them.

- **IL-1 Quick Capture**: floating FAB + `/capture` endpoint + Haiku classifier. Land first — smallest surface.
- **IL-2 Voice Input**: reuses `transcription.service.ts` (Deepgram + Whisper) already exists; just wire it into Quick Capture.
- **IL-3 Document Ingestion**: multi-format extract (pdf-parse, mammoth, xlsx) + chunk + embed. Biggest Phase 0 item.
- **IL-4 Email Forward**: SendGrid inbound webhook + per-user `IngestEndpoint` addresses.

Each is flag-gated. IL-3 and IL-4 are heavy; they can land in parallel.

### P0-5 — Output Layer (OL-1, OL-3) infrastructure

- **OL-1 Brief Generator** [greenfield]: generic brief route + `GeneratedArtifact` caching layer. Individual briefs per entity type come in feature tiers (War Room brief in Phase 1, Person brief in Phase 3, etc.).
- **OL-3 Export Hub** [partial]: `packages/boardroom-ai/server/src/services/export.service.ts` already exports decision sessions (~80% of "My Decision Journal"). What's missing: the framework layer (pluggable exporter registry), the route surface, and the `ExportConfig` model wiring. Keep the existing service; wrap it as the first registered exporter.
- **OL-2 Calendar Integration** [partial, deferred to Phase 3]: `google-calendar.service.ts` and `calendar.routes.ts` already ship OAuth2 + event fetch. `OAuthToken` model is live. What's left for Phase 3: **token encryption via `ENCRYPTION_KEY`** (currently stored as-is via OmniMind client — a security gap; validator must catch this), meeting-prep Cortex job, 90-day token rotation, audit log of token use.

### P0-6 — Eval harness expansion

Currently: persona distinctiveness + retrieval quality + e2e flow evals.

Add before any Tier 2+ feature:
- **Proactive push quality**: do Cortex-generated nudges feel signal (not noise)?
- **Artifact quality**: are generated briefs/proposals/sermon drafts defensible?
- **Cross-module correctness**: does a WR-2 contradiction alert reliably surface in CC-1?

### Phase 0 exit criteria

- [ ] All 10 new models + 7 extensions merged via single migration, orphaned `20250412040000_add_feature_flags` reconciled
- [ ] Feature flag system live with at least 3 flags active: `ql-capture` (IL-1), `doc-ingestion` (IL-3), `email-forward` (IL-4)
- [ ] Cortex scheduler refactored; all 3 scheduled jobs + Simulation (on-demand) run under new registry, with parallel-run validation complete
- [ ] IL-1 (Quick Capture) live in dogfood; IL-2/IL-3/IL-4 flag-gated behind `internal-only`
- [ ] OL-1 + OL-3 scaffolds ship one concrete reference artifact each (existing `export.service.ts` wrapped as first exporter)
- [ ] Eval harness covers 3 new scenario types
- [ ] All 6 validators sign off on the Phase 0 bundle (with the scoping rules from "Validator scoping" applied)
- [ ] Transition from `prisma db push` to named-migration workflow documented and followed from this migration forward

---

## Phase 1 — Retention Core (5 weeks)

**Mission:** Make the existing product sticky. Every feature in this phase visualizes data we already have; no new models required beyond P0.

**Roadmap coverage:** Tier 1 features (CC-1, CC-2, CC-3, PL-1, PL-2, IL-1).

### Sprint 1A (week 1-2): Dashboard visualizations

| Feature | Owner | Validator focus | Flag |
|---|---|---|---|
| CC-1 Active Decisions Board | FE-1 | UX, Performance | `cc-decisions-board` |
| CC-2 Commitment Radar | FE-2 | UX, Performance | `cc-commitment-radar` |

Both are client-heavy, reuse existing entity stores, zero server work. Ship together so Dashboard feels transformatively richer overnight.

### Sprint 1B (week 3-4): Signal & accountability

| Feature | Owner | Validator focus | Flag |
|---|---|---|---|
| CC-3 Momentum Score | BE-1 + FE-1 | Architecture, Test | `cc-momentum` |
| PL-1 Commitment Engine (Enhanced) | BE-2 | Security, Integration | `pl-commitment-v2` |

CC-3 needs a daily score calc (new Cortex job). PL-1 extends the extraction pipeline; Security validator scrutinizes the "auto-accept commitment" path for false positives.

### Sprint 1C (week 5): Flow consolidation

| Feature | Owner | Validator focus | Flag |
|---|---|---|---|
| PL-2 Weekly Review Protocol | FE-1 + BE-2 | UX, Integration | `pl-weekly-review` |
| Phase 1 polish pass | all | all | — |

Polish pass is explicit. Every Phase 1 feature gets cross-checked for brand compliance, a11y, mobile responsiveness.

### Phase 1 exit criteria

- [ ] All 6 Tier-1 features flag-on for ≥10% of users
- [ ] No P0 regressions in existing persona dispatch path
- [ ] Momentum score calibrated against a gold-standard set (manually labeled ≥50 users) — Spearman ρ > 0.7 with 95% CI reported; n=20 is too small for stable Pearson r
- [ ] Weekly Review completion rate > 40% among users who start it (kill criterion)
- [ ] All 6 validators green on every feature

---

## Phase 2 — Intelligence Layer (6 weeks)

**Mission:** Make the product irreplaceable. Features here exploit the data advantage — other tools cannot replicate this without the same memory depth.

**Roadmap coverage:** CC-4, MR-1, WR-2, WR-3, VT-1.

### Sprint 2A (week 1-2): Cortex front doors

| Feature | Owner | Validator focus | Flag |
|---|---|---|---|
| CC-4 Weekly Intelligence Briefing | FE-1 + BE-1 | UX, Integration | `cc-briefing` |
| MR-1 Thinking Pattern Dashboard | FE-2 | UX, Performance | `mirror-patterns` |

These elevate Cortex outputs from invisible background → core UX. Integration validator must confirm the `WeeklyMemo` / `ThinkingPattern` shapes are stable.

### Sprint 2B (week 3-4): Decision accountability

| Feature | Owner | Validator focus | Flag |
|---|---|---|---|
| WR-2 Assumption Tracker | BE-2 | Architecture, Security | `wr-assumptions-v2` |
| WR-3 Outcome Tracking & Decision Journal | FE-1 + BE-1 | UX, Test | `wr-outcomes` |

WR-2 needs a new Cortex job (`assumption-monitoring`, weekly). WR-3 is heavy UX — Test validator enforces eval coverage for the outcome-reflection prompt.

### Sprint 2C (week 5-6): Context persistence

| Feature | Owner | Validator focus | Flag |
|---|---|---|---|
| VT-1 Context Capsules | BE-1 + FE-2 | Architecture, Performance | `vault-capsules` |

Capsules are the "no more re-explaining" feature. Performance validator stresses the embedding cost of continuous capsule refresh.

### Phase 2 exit criteria

- [ ] Cortex produces user-perceived value weekly (survey: "did you learn something from your briefing?" > 70%)
- [ ] Assumption false-positive rate < 15% on contradiction detection
- [ ] Context capsules reduce per-session token consumption by ≥ 20% (power user cohort)
- [ ] All 5 features flag-on for ≥25% of users

---

## Phase 3 — Power Features (8 weeks)

**Mission:** Justify the $79/mo Executive tier. Features here are differentiation, not retention.

**Roadmap coverage:** FG-1, CN-1, CN-3 (Calendar), AR-4, WR-1, VT-2.

### Sprint 3A (week 1-2): Goal intelligence

| Feature | Owner | Validator focus | Flag |
|---|---|---|---|
| FG-1 Goal Decomposition Engine | BE-1 + FE-1 | Architecture, Test | `forge-goal-decomp` |

Sonnet-driven Goal → Project → Task hierarchy generation. Integration validator confirms the extraction respects existing parent/child constraints.

### Sprint 3B (week 3-4): People depth

| Feature | Owner | Validator focus | Flag |
|---|---|---|---|
| CN-1 Stakeholder Profiles (Deep) | FE-1 + BE-2 | Security, UX | `council-profiles-v2` |

Pastoral-care privacy sensitivity rules surface here (`metadata.sensitiveContext`). Security validator gates extra hard.

### Sprint 3C (week 5-6): Calendar + meeting intelligence

| Feature | Owner | Validator focus | Flag |
|---|---|---|---|
| OL-2 Calendar (encryption + rotation) | BE-2 | Security | `calendar-sync-v2` |
| CN-3 Meeting Prep (Proactive) | BE-1 + FE-2 | UX, Performance | `meeting-prep` |

OL-2 is a partial feature (OAuth + event fetch ship in P0-5). This sprint adds: `ENCRYPTION_KEY`-wrapped token storage, 90-day token rotation, audit log of every token use, meeting-prep Cortex job trigger. `meeting-prep` fires a Cortex job 30min before calendar events — Performance validator checks we're not spamming Anthropic API.

### Sprint 3D (week 7-8): Stress + visualization

| Feature | Owner | Validator focus | Flag |
|---|---|---|---|
| AR-4 Red Team Mode | BE-1 | Test, Integration | `arena-red-team` |
| WR-1 Decision Tree Builder | FE-1 + FE-2 | UX, Performance | `wr-decision-tree` |
| VT-2 Document Library | BE-2 + FE-1 | Performance, Security | `vault-docs` |

Big sprint. Red Team reuses persona orchestration. Decision Tree is heavy D3/React Flow work. Document Library is the user-facing side of IL-3 ingestion.

### Phase 3 exit criteria

- [ ] Executive tier signups ≥ 10% of Pro users within 4 weeks of launch
- [ ] All 6 features flag-on for 100% of Executive plan users
- [ ] Calendar event → meeting prep generation success rate ≥ 90%

---

## Phase 4 — Premium / Differentiation (10 weeks)

**Mission:** Enterprise/Executive feature parity with bespoke consulting tools. Each feature is individually small, collectively large.

**Roadmap coverage:** AR-1, AR-2, AR-3, FG-2, FG-3, WT-1, WR-4, PL-3, PL-4, CN-2, CN-4, VT-3, VT-4.

**Contract enforcement:** Phase 4 bundles 13 features across 5 sprints. The per-feature contract (section "Per-feature contract") is non-negotiable — each of the 13 features ships a contract stub (`/docs/tasks/phase-4/TASK-<CODE>.md`) **before** its sprint kicks off. Sprint kickoff is blocked without all contracts in-repo. This prevents the "feature listed in a table with no owner/flag/data-model detail" pattern that the current sprint tables default to.

### Sprint 4A (week 1-2): Arena simulations

AR-1 Pitch Simulator, AR-2 Negotiation Prep. New archetype personas. Eval harness expansion is mandatory.

### Sprint 4B (week 3-4): Crisis & scenarios

AR-3 Crisis Simulator, FG-3 Scenario Planner. Uses new `Scenario` model from Phase 0. Integration validator traces cascade effects.

### Sprint 4C (week 5-6): Strategy artifacts

FG-2 Strategy Canvas, PL-3 Sprint Planner, PL-4 Delegation Briefer. All produce `GeneratedArtifact` rows. Output-layer contract validation is the gate.

### Sprint 4D (week 7-8): External intelligence

WT-1 Industry Radar, WR-4 Stakeholder Simulation. External web-search integration. Security validator checks that external queries don't leak user-specific terms.

### Sprint 4E (week 9-10): Advanced people intelligence

CN-2 Custom Persona Builder (Enhanced), CN-4 Network Map, VT-3 Relationship Graph, VT-4 Timeline View. Heavy frontend work (D3 force graphs).

### Phase 4 exit criteria

- [ ] Enterprise tier attach rate ≥ 5% of Executive users
- [ ] Eval scenarios cover all new persona archetypes
- [ ] Every flag-off path works (progressive-enhancement validated)

---

## Phase 5 — Domain specializations (4 weeks)

**Mission:** Unlock vertical market expansion. Ministry first (user is pastor), consultants second.

### Sprint 5A (week 1-2): Ministry

MN-1 Sermon Prep Workshop, MN-2 Pastoral Care Tracker, MN-3 Stewardship Intelligence. Security validator doubles down on `sensitiveContext` handling.

### Sprint 5B (week 3-4): Consultants

CS-1 Client Engagement Tracker, CS-2 Proposal Generator, CS-3 Expertise Inventory. Integration validator checks Proposal Generator's use of past `GeneratedArtifact` doesn't leak cross-client data.

---

## Cortex Evolution — detailed plan

Current (3 scheduled + 1 on-demand): Weekly Memo (Sun 6pm), Pattern Detection (Mon 3am), Contradiction Scan (Mon 4am — verified from `CORTEX_CONFIG`; prior "Tue 9pm" in drafts was inaccurate), Simulation (on-demand via `POST /cortex/simulate`).

Target: 12 scheduled + Simulation = 13 total Cortex operations. Add 9 new scheduled jobs per roadmap Cortex Evolution table.

### Rollout sequence

Each new job lands with its own flag, runs for a week shadow-mode (logs output, doesn't write to DB), then gets promoted.

| Job | Phase | Shadow-week | Promote |
|---|---|---|---|
| Assumption Monitoring | Phase 2A | Sprint 2A week 1 | Sprint 2A week 2 |
| Commitment Nudges | Phase 1B | Sprint 1B week 1 | Sprint 1B week 2 |
| Decision Staleness | Phase 2A | Sprint 2A week 1 | Sprint 2A week 2 |
| Relationship Health | Phase 3B | Sprint 3B week 1 | Sprint 3B week 2 |
| Context Capsule Refresh | Phase 2C | Sprint 2C week 1 | Sprint 2C week 2 |
| Values Alignment | Phase 4 (MR support) | | |
| Goal Progress | Phase 3A | | |
| External Intelligence | Phase 4D | Mandatory shadow for 2 weeks (external cost) | |
| Meeting Prep | Phase 3C | Mandatory shadow for 2 weeks | |

### Cost control

**External Intelligence (WT-1)** is the job that can blow the budget. Web search per user per week × 50k users = real money. Hard per-user monthly cap enforced in scheduler, not in the job itself. Performance validator must sign off on the cap.

### Observability

Every Cortex job emits:
- `cortex_job_run` (job name, duration, rows_touched, success, user_count)
- `cortex_job_output` (job name, entityType, entityId created)
- `cortex_alert_generated` (alertType, severity, userId)

Dashboard in `/admin/cortex` shows last-24h run health.

---

## Data migration sequence

Phase 0 lands all schema in one migration. But **data backfills** happen staggered, because some need code to exist before they run.

| Migration | When | Backfill needed? | Notes |
|---|---|---|---|
| `roadmap_foundation` | Phase 0 week 1 | No | Pure DDL |
| `populate_assumption_inheritance` | Phase 2B | Yes — scan existing `DecisionAssumption` rows, detect text similarity to build `inheritedFromId` chains | Sonnet-based, idempotent |
| `backfill_context_capsules` | Phase 2C | Yes — generate capsules for top 10 projects per user | Cortex job |
| `backfill_expertise_profile` (consultants only) | Phase 5B | Yes — analyze memory tagged `expertise` | Opt-in per user |

Every backfill:
- Idempotent (safe to re-run)
- Flag-controlled
- Logs per-user progress
- Reversible (stores `prior_state` blob to enable undo)

---

## Testing strategy per tier

### Tier 0 (foundation) — types of tests required

- **Unit**: every service method, every Zod schema
- **Contract**: every new route has a seam test (client calls it, asserts shape)
- **Migration**: reversibility check (`prisma migrate reset` → `up` → assert schema matches)

### Tier 1-2 (retention, intelligence) — add:

- **Eval**: new scenarios for any feature touching persona output (CC-4, MR-1, WR-2)
- **A11y**: axe-core in Vitest for every new page

### Tier 3-4 (power, premium) — add:

- **Load**: simulate 1k concurrent users for Red Team, Decision Tree, Meeting Prep
- **Cross-module correctness**: WR-2 assumption invalidation → does CC-1 board reflect it within 60s?

### Tier 5 (domain) — add:

- **Privacy**: pastoral-care data never surfaces in non-pastoral-care queries
- **Tenant isolation**: one ministry's sermon archive invisible to another

---

## Rollout infrastructure

### Flag strategy per feature

1. **Build behind internal-only flag** — dev team + 3 pilot users.
2. **Canary 1% of plan-eligible users** — 48h minimum, watch telemetry.
3. **Canary 10%** — 1 week.
4. **Canary 50%** — 1 week.
5. **100%** — flag becomes no-op; scheduled for removal in 2 weeks.
6. **Kill switch** — every flag has a hardcoded kill criterion. If triggered, flag auto-flips OFF and alerts dev team.

### Telemetry per feature

Minimum events:
- `<feature>_viewed` — user saw the UI
- `<feature>_engaged` — user took the primary action
- `<feature>_completed` — user reached success state
- `<feature>_abandoned` — user bailed mid-flow
- `<feature>_error` — any error, with error type tag

### Kill criteria examples

| Feature | Kill if … |
|---|---|
| WR-1 Decision Tree | p95 generation time > 45s |
| CC-4 Weekly Briefing | in-app briefing dismiss-without-read rate > 60% (no outbound email pipeline exists) |
| AR-4 Red Team | user leaves persona dispatch before any message is sent > 60% of sessions |
| WT-1 Industry Radar | monthly LLM cost per user > $2 (requires per-user cost attribution layer; see Phase 4 prerequisite) |

---

## Risk register

### High-risk items

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Phase 0 migration breaks prod data | Low | Catastrophic | Single migration, review gate by Architecture + Security validators, dry-run on staging copy of prod before merge |
| Cortex jobs produce noisy notifications, users disable | Medium | High | Shadow mode for every new job, tight kill criteria, per-user notification budget |
| Voice/document ingestion opens up prompt injection surface | Medium | High | Security validator specifically for IL-2/IL-3, content-classifier that strips known-injection patterns before embedding |
| Calendar OAuth token leakage | Low | Catastrophic | Encryption at rest (already have `ENCRYPTION_KEY`), rotation every 90 days, audit log of every token use |
| External Intelligence (WT-1) cost runaway | Medium | Medium | Hard per-user monthly cap in scheduler, shadow mode 2 weeks, Performance validator gate |
| Proactive intelligence feels creepy/surveillance-y | Medium | High | Settings → "Proactive mode" toggle with per-job granularity, clear messaging on first use |
| Red Team Mode generates harmful content | Medium | Medium | Add `harmful_content_filter` to Red Team persona output path, eval harness includes adversarial prompts |
| Relationship graph performance at > 500 people | Medium | Medium | Server-side pagination + clustering before D3 renders; Performance validator stress-tests 1k nodes |
| Orphaned `_disabled/` flag code + `20250412040000_add_feature_flags` SQL migration collide with P0-2 | High | Medium | P0-2 Step 0 reconciliation blocks all other flag work; pick adopt or discard before touching `FeatureFlag` model |
| In-memory rate limit + flag eval at multi-instance scale (CLAUDE.md known limitation) | Medium | Medium | Flag evaluator must not rely on in-process caching across Railway instances; carry target-plan membership in JWT claim or use cache with TTL ≤ 10s; revisit when horizontal-scaling beyond 1 instance |
| Token encryption gap in existing `google-calendar.service.ts` | Medium | High | OAuth tokens currently stored via OmniMind client without `ENCRYPTION_KEY` wrap; Phase 3 Sprint 3C closes this, but flag it in security backlog now |

### Medium-risk items

- Flag system becomes confused graveyard of stale flags → automated flag cleanup cron (flag 100% + no code refs → delete)
- Eval harness drifts from production scenarios → monthly refresh job that samples real sessions (anonymized)
- Documentation drift between roadmap and reality → this document is version-controlled; update on every phase exit
- Brand system violations creep back in (hardcoded hex) → pre-commit hook + UX validator

---

## Timeline and team sizing

**Resolve before planning:** CLAUDE.md declares "Claude Code (Opus) is the sole build agent — Claude owns ALL packages." The calendar below is a **planning estimate based on a notional 2-4 FTE team, not a commitment**. Two options:
- If solo + Opus remains the build model, the 4-FTE calendar should be treated as a theoretical upper-bound of velocity, not schedule. Expect actual calendar time to exceed the 2-FTE column.
- If the team expands to match the BE-1/BE-2/FE-1/FE-2/PM-QA roles below, update this section and the per-phase sprint owners in earlier phases (currently they reference those same role codes).

Do not cite this timeline externally as a delivery commitment without resolving the above.

### Team composition (assumption)

- **BE-1**: Senior full-stack, focus on Cortex + orchestration
- **BE-2**: Full-stack, focus on entity CRUD + integrations (Stripe, Calendar, Email)
- **FE-1**: Senior frontend, focus on state + accessibility
- **FE-2**: Frontend, focus on visualization (D3, React Flow)
- **PM/QA**: runs eval, writes scenarios, triages validator findings

### Calendar estimate

| Phase | 2 FTE | 4 FTE (recommended) |
|---|---|---|
| Phase 0 | 4 weeks | 2.5 weeks |
| Phase 1 | 7 weeks | 5 weeks |
| Phase 2 | 9 weeks | 6 weeks |
| Phase 3 | 12 weeks | 8 weeks |
| Phase 4 | 14 weeks | 10 weeks |
| Phase 5 | 6 weeks | 4 weeks |
| **Total** | **~52 weeks** | **~35 weeks** |

### Critical path

```
Phase 0 (foundation)
   ├── P0-1 Schema (blocks all)
   ├── P0-2 Flags (blocks all)
   └── P0-3 Cortex (blocks Phase 2+)
           │
Phase 1 ──┤
           │
Phase 2 ──┼── depends on P0-3
           │
Phase 3 ──┼── OL-2 Calendar blocks CN-3
           │
Phase 4 ──┴── WT-1 must land late (external cost)
```

Phase 1 can start as soon as P0-1 and P0-2 merge (≈ week 1.5). Phase 2 must wait for P0-3.

---

## Appendix A — Validator agent prompt templates

Each validator is a self-contained subagent. Copy-paste into the Agent tool at gate time.

### Architecture Validator

```
You are the Architecture Validator. Your job is to review a feature PR for:
- Service boundary violations (BoardRoom calling DB directly, OmniMind owning UX)
- Prisma migration safety (irreversible operations, missing indexes, cascade concerns)
- Data model shape vs. intent (are foreign keys right, nullable in the right places)
- Backward compatibility (does this break existing clients)
- Code organization (routes/services/middleware conventions followed)

Read the PR diff at <PR_URL> or branch <BRANCH_NAME>.

Report in the validator format. Verdict is FAIL if you find any service-boundary violation, migration irreversibility, or missing index on a join column. Verdict is PASS_WITH_NOTES for any medium/low findings. Verdict is PASS only if you have zero findings.

Constraints:
- This codebase mandates BoardRoom → OmniMind via HTTP only. Direct Prisma from BoardRoom is an auto-FAIL.
- Every model query must include userId filter (row-level isolation).
- Migrations must be reversible unless the PR description explicitly waives that.
```

### Security Validator

```
You are the Security Validator. Review this feature PR for:
- AuthZ: does every new route verify userId ownership of targeted entities?
- Row-level isolation: can user A access user B's data via any new path?
- Input validation: is every route body/query parsed with Zod before DB?
- Rate limiting: is the new route attached to a rate limiter? At what budget?
- Secrets: any new API keys, OAuth tokens, or encrypted fields added?
- PII handling: if the feature touches Person data, is sensitive context handled per spec?
- Prompt injection: if the feature ingests user-supplied text that flows to an LLM, is there injection defense?

FAIL if any new route lacks userId verification, any LLM call lacks input sanitization, or any PII lacks audit trail.

Look specifically at packages/boardroom-ai/server/src/middleware/auth.ts enforcement points and packages/omnimind-api/src/middleware/auth.ts.
```

### Performance Validator

```
You are the Performance Validator. Review this feature PR for:
- Database N+1 queries (any loop with a query inside)
- Missing indexes on new columns used in WHERE/JOIN
- Embedding generation cost (is it per-request or cached?)
- Bundle size impact on the client (any new dep > 50kb gzipped flags a medium finding)
- Streaming health (SSE flush cadence, no long-running sync compute)
- Cortex job runtime (shadow-mode p95 must be < 30s for a weekly job, < 5s for a daily job)

FAIL on any N+1 on a user-visible path. PASS_WITH_NOTES for speculative concerns.

Context: The app uses PostgreSQL + pgvector. Per-session token budget is 7-10 items. OmniMind timeout default is 10s.
```

### UX Validator

```
You are the UX Validator. Review this feature PR for:
- Brand system compliance: no hardcoded hex colors outside tokens.css, no blue/indigo/purple leaks, warm-gold primary used consistently
- Accessibility (WCAG AA minimum): color contrast, focus-visible, keyboard nav, screen reader labels
- Responsive: works at 375px, 768px, 1280px
- Empty / loading / error states: all three exist, not just the happy path
- Copy: matches the product voice from docs/tasks/BRAND-SYSTEM.md
- Motion: matches the restrained motion philosophy (no gratuitous animation)

Run:
- grep for hardcoded hex colors (#[0-9a-f]{3,6}) in new .tsx files
- grep for text-blue-, bg-indigo-, etc.
- Visual inspection via screenshots if a live preview is available

FAIL on any brand-system violation or any WCAG AA contrast failure.
```

### Test Validator

```
You are the Test Validator. Review this feature PR for:
- Unit test coverage: every new service method, every Zod schema
- Contract test: every new route must have a seam test under packages/boardroom-ai/server/tests/integration/
- Eval scenario: any feature affecting persona output must add a scenario to eval/scenarios/
- Idempotency: if a new Cortex job, verify it can re-run without side effects
- Flag behavior: the feature must have a test demonstrating flag-off = feature absent

FAIL if any new route lacks a seam test. FAIL if flag-off behavior is untested.

Run `pnpm test` and `pnpm eval:all` if possible.
```

### Integration Validator

```
You are the Integration Validator. Review this feature PR for:
- Cross-module effects: does this feature's data change affect any other module's display?
- Cortex scheduler impact: if this feature adds a job, does it respect the registry pattern?
- Output-layer contract compatibility: any new entity type that should produce a brief/export?
- Downstream consumers: any existing component that reads the modified entity and needs updating?
- Eval scenario ripple: do existing scenarios still pass?

Specifically trace:
- If Decision changed → does WR-3 journal still render?
- If DecisionAssumption changed → does WR-2 tracker still display?
- If Cortex output format changed → do MR-1, CC-4 still parse it?

FAIL on any cross-module regression.
```

### Tiebreaker (invoked only on validator disagreement)

```
You are the Tiebreaker. Two or more validators returned conflicting verdicts on this PR. Review the validator reports (provided below) and the code in question. Determine:
1. Which validator is correct (or is this a genuine tradeoff?)
2. If a tradeoff, which side serves the user better given this feature's role in the product
3. If correctness, which validator's framing missed context

Produce a decision with rationale. Your verdict is final for this PR.
```

---

## Appendix B — Feature tracking board

(Suggested format — implement in Linear/Jira/Notion.)

```
┌──────────────┬────────┬──────────┬──────────┬───────────────┬──────────────┐
│ Feature Code │ Phase  │ Owner    │ Flag     │ Validator     │ Status       │
├──────────────┼────────┼──────────┼──────────┼───────────────┼──────────────┤
│ P0-1         │ 0      │ BE-1     │ —        │ ✓✓✓✓✓✓        │ merged       │
│ P0-2         │ 0      │ BE-2     │ —        │ ✓✓✓✓✓✓        │ merged       │
│ P0-3         │ 0      │ BE-1     │ —        │ ✓✓✓✓✓✓        │ in-review    │
│ P0-4 (IL-1)  │ 0      │ FE-2     │ ql-cap   │ ✓✓✓·✓✓        │ UX remediate │
│ ...          │        │          │          │               │              │
│ CC-1         │ 1A     │ FE-1     │ cc-decs  │ ·····         │ planned      │
│ CC-2         │ 1A     │ FE-2     │ cc-comm  │ ·····         │ planned      │
│ CC-3         │ 1B     │ BE-1/FE1 │ cc-mom   │ ·····         │ planned      │
│ PL-1         │ 1B     │ BE-2     │ pl-v2    │ ·····         │ planned      │
│ PL-2         │ 1C     │ FE-1/BE2 │ pl-wr    │ ·····         │ planned      │
│ ...          │        │          │          │               │              │
└──────────────┴────────┴──────────┴──────────┴───────────────┴──────────────┘
```

Validator column shows six slots: Architecture, Security, Performance, UX, Test, Integration. `✓` = green, `·` = pending, `✗` = fail, `!` = remediate.

---

## Document versioning

This plan is living. Update at each phase exit. Checklist for updates:

- [ ] Phase exit criteria met? Check box.
- [ ] Any feature slipped tiers? Re-sequence and explain.
- [ ] New risk identified? Add to risk register.
- [ ] Validator process breaking down? Amend the relevant Appendix A prompt.
- [ ] Commit with `docs: update MASTER-DEV-PLAN — phase X exit`.

---

*Next action: schedule Phase 0 kickoff. Assign P0-1 and P0-2 to the two BE owners. Dispatch first validator dry-runs on P0-1 migration draft.*
