# Master Index — Where Do I Find X

**Audience:** Anyone (Claude or human) trying to find a specific document in the roadmap.
**Purpose:** Organized by intent ("I want to understand X"), not by directory. Every roadmap file should be discoverable from here.
**How to use:** Skim the section headings, find your intent, jump to the file.

If you can't find what you need here, the answer is probably "it doesn't exist yet" — open `STATUS/BLOCKERS.md` and add it.

---

## I want to orient myself (first time / returning after time away)

| File | One-line description |
|---|---|
| [`README.md`](README.md) | Top-level entry point — explains the directory structure of the roadmap |
| [`PROJECT-CONTEXT.md`](PROJECT-CONTEXT.md) | 5-minute context dump on what omnimind is, the architecture, the 13 ADRs, the 5 layers |
| [`EXECUTIVE-SUMMARY.md`](EXECUTIVE-SUMMARY.md) | 2-page version of the entire roadmap for quick catch-up |
| [`07-claude-instructions/CONTEXT-LOAD-ORDER.md`](07-claude-instructions/CONTEXT-LOAD-ORDER.md) | For Claude: which 2-3 docs to read for whatever task you're picking up |
| [`07-claude-instructions/SESSION-START-CHECKLIST.md`](07-claude-instructions/SESSION-START-CHECKLIST.md) | The 8-minute cold-start checklist for picking up a phase |
| [`07-claude-instructions/PROMPT-TEMPLATES.md`](07-claude-instructions/PROMPT-TEMPLATES.md) | Reusable session-kickoff and task-handoff prompt templates |

## I want to understand the current state of the system

| File | One-line description |
|---|---|
| [`02-current-state/CAPABILITIES-INVENTORY.md`](02-current-state/CAPABILITIES-INVENTORY.md) | What omnimind can do today — capability list with file references; also includes the 6.5/10 sophistication rationale and per-subsystem scale ceiling |
| [`02-current-state/ARCHITECTURE-MAP.md`](02-current-state/ARCHITECTURE-MAP.md) | Service boundaries, data flow, fragile zones |
| [`02-current-state/KNOWN-ISSUES.md`](02-current-state/KNOWN-ISSUES.md) | Severity-ranked register of every audit finding (KI-001..KI-079) plus accepted limitations |
| [`02-current-state/LANDMINES.md`](02-current-state/LANDMINES.md) | The 10 hidden risks (L1..L10) — silent-until-explosion failure modes |
| [`02-current-state/DEAD-CODE.md`](02-current-state/DEAD-CODE.md) | Quarantined code, active-but-dead services, schema dead artifacts |
| [`02-current-state/TECH-DEBT.md`](02-current-state/TECH-DEBT.md) | Top-30 tech debt register with effort and fix-phase pointers |

## I want to understand the plan

| File | One-line description |
|---|---|
| [`04-roadmap/ROADMAP-OVERVIEW.md`](04-roadmap/ROADMAP-OVERVIEW.md) | Master timeline, dependency graph, per-phase summary, "what ships when" calendar, phase-number map |
| [`04-roadmap/PHASE-0-foundation/`](04-roadmap/PHASE-0-foundation/) | Foundation cleanup — clean repo, drop dead code, wire log drain (0.5w) |
| [`04-roadmap/PHASE-0.25-critical-fixes/`](04-roadmap/PHASE-0.25-critical-fixes/) | Six exploitable-today security/data fixes (~3 days) |
| [`04-roadmap/PHASE-0.5-eval-harness/`](04-roadmap/PHASE-0.5-eval-harness/) | 35-query baseline + non-regression gate (2w) |
| [`04-roadmap/PHASE-1-schema-alignment/`](04-roadmap/PHASE-1-schema-alignment/) | 4 entity tables + bi-temporal-lite + memoryType enum (1.5w) |
| [`04-roadmap/PHASE-2-pattern-extraction/`](04-roadmap/PHASE-2-pattern-extraction/) | Async post-write extraction; ADD/UPDATE/DELETE/NOOP; MemoryWriteEvent durability (2.5w) |
| [`04-roadmap/PHASE-3-hnsw-rrf/`](04-roadmap/PHASE-3-hnsw-rrf/) | HNSW vector index + Reciprocal Rank Fusion (1.5w) |
| [`04-roadmap/PHASE-4-graph-traversal/`](04-roadmap/PHASE-4-graph-traversal/) | Recursive-CTE `findRelatedEntities` over typed link tables (1w) |
| [`04-roadmap/PHASE-5a-llm-augmentation/`](04-roadmap/PHASE-5a-llm-augmentation/) | Nightly batch entity + relationship extraction with hard cost cap (2w) |
| [`04-roadmap/PHASE-5b-llm-consolidation/`](04-roadmap/PHASE-5b-llm-consolidation/) | Haiku check on UPDATE/NOOP boundary cases (1w) |
| [`04-roadmap/PHASE-6-entity-ranker-boost/`](04-roadmap/PHASE-6-entity-ranker-boost/) | 5th signal in `ranker.ts` behind flag (0.5w) |
| [`04-roadmap/PHASE-7a-recency-access/`](04-roadmap/PHASE-7a-recency-access/) | Exp-decay recency + log access count (0.5w) |
| [`04-roadmap/PHASE-9-purge-disabled/`](04-roadmap/PHASE-9-purge-disabled/) | Delete dead `_disabled/` trees; write ADR-014/015/016 (0.5w) |
| [`04-roadmap/PHASE-10-mcp-server/`](04-roadmap/PHASE-10-mcp-server/) | Memory MCP server for Claude Desktop, Cursor, GPTs (4-6w) |
| [`04-roadmap/PHASE-11-markdown-export/`](04-roadmap/PHASE-11-markdown-export/) | "Your data is yours" — markdown files in synced git repo (3-4w) |
| [`04-roadmap/PHASE-12-webhooks-event-bus/`](04-roadmap/PHASE-12-webhooks-event-bus/) | Webhooks + event bus — `MemoryWriteEvent` and entity events delivered to user-registered URLs (2w; ships before SDK) |
| [`04-roadmap/PHASE-13-sdk/`](04-roadmap/PHASE-13-sdk/) | Public TypeScript SDK published to npm (3-4w) |
| [`04-roadmap/PHASE-14-observability-suite/`](04-roadmap/PHASE-14-observability-suite/) | Log drain + metrics + tracing + alerting (2w) |
| [`04-roadmap/PHASE-15-migration-history/`](04-roadmap/PHASE-15-migration-history/) | Baseline migration; remove `--accept-data-loss` (1w; pull-forward candidate) |
| [`04-roadmap/PHASE-16-cortex-isolation/`](04-roadmap/PHASE-16-cortex-isolation/) | Cortex moves to separate Railway service (2w) |
| [`04-roadmap/PHASE-17-persona-marketplace/`](04-roadmap/PHASE-17-persona-marketplace/) | Git-installable, signed, sandboxed personas — install endpoint + sigstore (4-6w; optional, see DEF-014 for descope) |
| [`04-roadmap/PHASE-18-resilience-multitenant-fairness/`](04-roadmap/PHASE-18-resilience-multitenant-fairness/) | Per-tenant token budget, Postgres-backed rate limiter, real RLS (2w) |
| [`04-roadmap/PHASE-19-horizontal-api-scale/`](04-roadmap/PHASE-19-horizontal-api-scale/) | API service runs N replicas safely (3w) |
| [`04-roadmap/DEFERRED/`](04-roadmap/DEFERRED/) | All explicitly-deferred capabilities, each with a measurable trigger |

Each `PHASE-N-{slug}/` folder contains `README.md` (what + prereqs + exit criteria), `tasks-and-prompts.md` (atomic tasks with pre-written Claude prompts), and `testing-and-rollback.md` (verify and revert).

## I want to understand the ground rules

| File | One-line description |
|---|---|
| [`01-foundations/CONSTRAINTS.md`](01-foundations/CONSTRAINTS.md) | The non-negotiables — 13 ADRs, service boundaries, code quality rules, stack lock-in |
| [`01-foundations/PRINCIPLES.md`](01-foundations/PRINCIPLES.md) | The non-ADR principles that guide every roadmap decision (pattern-first, measurable triggers, etc.) |
| [`01-foundations/SUCCESS-METRICS.md`](01-foundations/SUCCESS-METRICS.md) | Per-phase exit criteria + cross-cutting quality gates + product-level metrics |
| [`01-foundations/GLOSSARY.md`](01-foundations/GLOSSARY.md) | Definitions for terms used throughout the roadmap (RRF, HNSW, ADD/UPDATE/DELETE/NOOP, etc.) |
| [`01-foundations/COST-MODEL.md`](01-foundations/COST-MODEL.md) | Per-phase cost projections; per-user economics at 100/500/2k/10k users |
| [`01-foundations/ADR-INDEX.md`](01-foundations/ADR-INDEX.md) | Index of all 13 ADRs with one-line summaries |
| [`01-foundations/SCOPE-NEGOTIATION.md`](01-foundations/SCOPE-NEGOTIATION.md) | When/how to renegotiate phase scope; what requires user approval vs Claude alone |

## I want to understand the risks

| File | One-line description |
|---|---|
| [`06-risks-and-mitigations/RISK-REGISTER.md`](06-risks-and-mitigations/RISK-REGISTER.md) | Master risk list with severity, likelihood, owner, mitigation. Includes scalability section. |
| [`06-risks-and-mitigations/DATA-RISKS.md`](06-risks-and-mitigations/DATA-RISKS.md) | Schema-level risks: `db push --accept-data-loss`, embedding queue silent loss, cascade deletes |
| [`06-risks-and-mitigations/SECURITY-RISKS.md`](06-risks-and-mitigations/SECURITY-RISKS.md) | JWT rotation, OAuth token encryption, prompt injection, multi-tenant isolation |
| [`06-risks-and-mitigations/COST-RISKS.md`](06-risks-and-mitigations/COST-RISKS.md) | LLM cost overrun scenarios, per-tenant budget enforcement, circuit breakers |
| [`06-risks-and-mitigations/OPERATIONAL-RISKS.md`](06-risks-and-mitigations/OPERATIONAL-RISKS.md) | Single-instance failure modes, no CI/CD gate, no incident runbooks, restore drills |
| [`06-risks-and-mitigations/6-MONTH-FORECAST.md`](06-risks-and-mitigations/6-MONTH-FORECAST.md) | What breaks at 100→500 users (10 scenarios) |
| [`06-risks-and-mitigations/12-MONTH-FORECAST.md`](06-risks-and-mitigations/12-MONTH-FORECAST.md) | What breaks at 500→2k→10k users (5 scenarios) |

> Scalability risks live in `RISK-REGISTER.md` Section 3. Eval risks are scattered across `DATA-RISKS.md` (eval false negatives) and `OPERATIONAL-RISKS.md` (vibes-based shipping). No standalone files for those today.

## I want to understand a specific feature (the make-it-10 list)

| File | One-line description |
|---|---|
| [`05-features-to-10/FEATURE-INDEX.md`](05-features-to-10/FEATURE-INDEX.md) | Index of all feature specs with phase column and status |
| [`05-features-to-10/memory-mcp-server.md`](05-features-to-10/memory-mcp-server.md) | Spec: Memory MCP server (Phase 10) |
| [`05-features-to-10/markdown-export-import.md`](05-features-to-10/markdown-export-import.md) | Spec: markdown export + git sync (Phase 11) |
| [`05-features-to-10/webhooks-event-bus.md`](05-features-to-10/webhooks-event-bus.md) | Spec: webhooks + event bus (Phase 12) |
| [`05-features-to-10/public-sdk.md`](05-features-to-10/public-sdk.md) | Spec: public TypeScript SDK (Phase 13) |
| [`05-features-to-10/observability-suite.md`](05-features-to-10/observability-suite.md) | Spec: metrics + tracing + alerting (Phase 14) |
| [`05-features-to-10/per-tenant-cost-controls.md`](05-features-to-10/per-tenant-cost-controls.md) | Spec: per-user $/month caps + circuit breaker (Phase 18) |
| [`05-features-to-10/advanced-cortex.md`](05-features-to-10/advanced-cortex.md) | Spec: outcome-decision feedback, cross-entity contradictions (post Phase 16) |
| [`05-features-to-10/memory-editor-ui.md`](05-features-to-10/memory-editor-ui.md) | Spec: memory list/search/edit/soft-delete UI (slot in Phase 11) |
| [`05-features-to-10/data-export-gdpr.md`](05-features-to-10/data-export-gdpr.md) | Spec: full-account export, 30-day soft-then-hard delete, OAuth cascade |
| [`05-features-to-10/retrieval-explainability.md`](05-features-to-10/retrieval-explainability.md) | Spec: per-result signal contributions for trust + debugging |
| [`05-features-to-10/multi-tenant-teams.md`](05-features-to-10/multi-tenant-teams.md) | Spec: shared memories with per-user scopes (DEFERRED until 1k+ users) |
| [`05-features-to-10/embedding-model-versioning.md`](05-features-to-10/embedding-model-versioning.md) | Spec: 2-model coexistence + backfill |
| [`05-features-to-10/knowledge-graph-deep.md`](05-features-to-10/knowledge-graph-deep.md) | Spec: Apache AGE / Neo4j evaluation (gated; see ROADMAP-OVERVIEW Where DEFERRED phases re-enter) |
| [`05-features-to-10/persona-marketplace.md`](05-features-to-10/persona-marketplace.md) | Spec: persona marketplace (PLANNED as Phase 17; alternative-deferral spec at `04-roadmap/DEFERRED/persona-marketplace.md`) |

## I want primary source / reference material

| File | One-line description |
|---|---|
| [`08-references/adrs/`](08-references/adrs/) | Local copies of the 13 ADRs from `docs/DECISIONS.md` (offline reference). See README in this folder for status. |
| [`03-research/`](03-research/) | Curated summaries of the wave 1 research outputs (audit + research tracks) |
| [`08-references/external-docs.md`](08-references/external-docs.md) | External docs referenced by the roadmap (mem0, pgvector, HNSW, Anthropic SDK, etc.) |
| [`08-references/repo-tour.md`](08-references/repo-tour.md) | Where everything lives in the monorepo |
| [`08-references/codebase-map.md`](08-references/codebase-map.md) | File tree with annotations |
| [`../research/omnimind-roadmap-2026/wave1-audit/`](../research/omnimind-roadmap-2026/wave1-audit/) | Raw wave 1 audit outputs: code-quality, data-integrity, scalability, security |
| [`../research/omnimind-roadmap-2026/wave1-research/`](../research/omnimind-roadmap-2026/wave1-research/) | Raw wave 1 external research: ops-scaling, security best practices, data architecture, external interfaces |
| [`../research/mem0-memory-architectures/stage5-validation/final-recommendation.md`](../research/mem0-memory-architectures/stage5-validation/final-recommendation.md) | The mem0 deep-dive that informed Phases 1-9 |

## I want to know what's happening right now

| File | One-line description |
|---|---|
| [`STATUS/CURRENT-PHASE.md`](STATUS/CURRENT-PHASE.md) | Which phase is active right now; what task is in flight |
| [`STATUS/PHASE-PROGRESS-TRACKER.md`](STATUS/PHASE-PROGRESS-TRACKER.md) | Per-task tracker across all phases (todo / wip / done / blocked) |
| [`STATUS/PHASE-COMPLETION-CRITERIA.md`](STATUS/PHASE-COMPLETION-CRITERIA.md) | Exact signoff checklist used at end of every phase |
| [`STATUS/BLOCKERS.md`](STATUS/BLOCKERS.md) | Open blockers needing user input or external resolution |
| [`STATUS/CHANGELOG.md`](STATUS/CHANGELOG.md) | Append-only log of phase completions and significant scope changes |
| [`STATUS/DECISIONS-LOG.md`](STATUS/DECISIONS-LOG.md) | Append-only log of decisions taken during execution (DEC-N entries) |

## I want to know how to run the meta-process (Claude orchestration)

| File | One-line description |
|---|---|
| [`07-claude-instructions/CLAUDE-WORKFLOW.md`](07-claude-instructions/CLAUDE-WORKFLOW.md) | Task-type → docs routing table (the spine of session orchestration) |
| [`07-claude-instructions/CONTEXT-LOAD-ORDER.md`](07-claude-instructions/CONTEXT-LOAD-ORDER.md) | For Claude: read these N docs in this order before starting any task |
| [`07-claude-instructions/SESSION-START-CHECKLIST.md`](07-claude-instructions/SESSION-START-CHECKLIST.md) | The 8-minute cold-start checklist |
| [`07-claude-instructions/SESSION-END-CHECKLIST.md`](07-claude-instructions/SESSION-END-CHECKLIST.md) | What to update before closing a session (CURRENT-PHASE, CHANGELOG, etc.) |
| [`07-claude-instructions/PROMPT-TEMPLATES.md`](07-claude-instructions/PROMPT-TEMPLATES.md) | Reusable session-kickoff and task-handoff prompt templates |
| [`07-claude-instructions/HANDOFF-TEMPLATE.md`](07-claude-instructions/HANDOFF-TEMPLATE.md) | Format for end-of-session handoff (status, blockers, next-action) |
| [`07-claude-instructions/AGENT-DISPATCH-PATTERNS.md`](07-claude-instructions/AGENT-DISPATCH-PATTERNS.md) | When to spawn an Explore subagent vs handle directly |
| [`07-claude-instructions/COMMIT-AND-PR-CONVENTIONS.md`](07-claude-instructions/COMMIT-AND-PR-CONVENTIONS.md) | Commit message format, PR template, signoff conventions |
| [`07-claude-instructions/COMMON-PITFALLS.md`](07-claude-instructions/COMMON-PITFALLS.md) | The 12 most common Claude mistakes with detection commands and fixes |
| [`07-claude-instructions/EVAL-HARNESS-USAGE.md`](07-claude-instructions/EVAL-HARNESS-USAGE.md) | How to use the eval harness (Phase 0.5 onward) |
| [`07-claude-instructions/MEMORY-AGENTS-PIPELINE.md`](07-claude-instructions/MEMORY-AGENTS-PIPELINE.md) | The 4-wave structure (audit → research → build → review) |

## I want the TL;DR for a specific role

| Role | Read these in order |
|---|---|
| **Founder / business reader** | `EXECUTIVE-SUMMARY.md` → `04-roadmap/ROADMAP-OVERVIEW.md` → `06-risks-and-mitigations/RISK-REGISTER.md` |
| **New Claude session, picking up a phase** | `PROJECT-CONTEXT.md` → `STATUS/CURRENT-PHASE.md` → the active `04-roadmap/PHASE-N-*/README.md` → `01-foundations/CONSTRAINTS.md` |
| **New human contributor (engineer)** | `PROJECT-CONTEXT.md` → `02-current-state/CAPABILITIES-INVENTORY.md` → `01-foundations/CONSTRAINTS.md` → `04-roadmap/ROADMAP-OVERVIEW.md` → cherry-pick from `08-references/` |
| **Auditing for risk** | `EXECUTIVE-SUMMARY.md` → `06-risks-and-mitigations/RISK-REGISTER.md` → `02-current-state/CAPABILITIES-INVENTORY.md` (scale-ceiling rationale) → wave 1 audit outputs |
| **Pricing / cost analysis** | `01-foundations/COST-MODEL.md` → `06-risks-and-mitigations/COST-RISKS.md` → wave 1 scalability audit section C |
| **Security incident triage** | `02-current-state/LANDMINES.md` → `06-risks-and-mitigations/SECURITY-RISKS.md` → relevant phase rollback (`04-roadmap/PHASE-N/testing-and-rollback.md`) → `07-claude-instructions/COMMON-PITFALLS.md` (security-incident section) |

---

**If something below this line exists in the repo but isn't indexed above, that's a bug — surface it via `STATUS/BLOCKERS.md` so a future session can add it.**
