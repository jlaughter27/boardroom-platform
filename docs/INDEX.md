# Docs Index — BoardRoom + OmniMind Platform

**Audience:** Anyone (Claude or human) trying to find a specific document. Organized by intent ("I want to understand X"), not by directory. Every active doc should be discoverable from here.

**How to use:** Skim the section headings, find your intent, jump to the file. If you need a path-to-file mapping by task type, see [`LOAD-MAP.json`](LOAD-MAP.json). If you don't know what an acronym means, see [`GLOSSARY.md`](GLOSSARY.md). If you're confused about naming/lifecycle conventions, see [`CONVENTIONS.md`](CONVENTIONS.md).

---

## I want to orient myself (first time / returning after a break)

| File | One-line description |
|---|---|
| [`01-orientation/PROJECT-BRIEF.md`](01-orientation/PROJECT-BRIEF.md) | 1-page product context (what BoardRoom + OmniMind is, who it's for) |
| [`01-orientation/CURRENT-STATE.md`](01-orientation/CURRENT-STATE.md) | What's live now, what's next; updated each phase |
| [`01-orientation/ARCHITECTURE-QUICK-REF.md`](01-orientation/ARCHITECTURE-QUICK-REF.md) | File tree, data flows, auth — compressed architecture map |
| [`STATUS/CURRENT-PHASE.md`](STATUS/CURRENT-PHASE.md) | The active phase + active task pointer (read this first every session) |
| [`_meta/CLAUDE-WORKFLOW.md`](_meta/CLAUDE-WORKFLOW.md) | For Claude: what 2-3 files to load for a given task type |

## I want to understand the architecture and constraints

| File | One-line description |
|---|---|
| [`02-reference/MASTER-FRAMEWORK.md`](02-reference/MASTER-FRAMEWORK.md) | Complete product + technical spec (~80kb, 21k words) |
| [`02-reference/DECISIONS.md`](02-reference/DECISIONS.md) | 13 ADRs with rationale |
| [`02-reference/FRAGILE-ZONES.md`](02-reference/FRAGILE-ZONES.md) | What breaks easily; touch with care |
| [`02-reference/MASTER-DEV-PLAN.md`](02-reference/MASTER-DEV-PLAN.md) | Full dev plan with multi-agent validation framework |
| [`02-reference/MASTER-DREAM-ROADMAP.md`](02-reference/MASTER-DREAM-ROADMAP.md) | Aspirational long-horizon roadmap |
| [`contracts/`](contracts/) | API service contracts (BoardRoom ↔ OmniMind) |

## I want to deploy or operate the system

| File | One-line description |
|---|---|
| [`03-operations/DEPLOYMENT-RUNBOOK.md`](03-operations/DEPLOYMENT-RUNBOOK.md) | Railway config, env vars, common deploy issues |
| [`03-operations/DEPLOY-RAILWAY.md`](03-operations/DEPLOY-RAILWAY.md) | Step-by-step Railway deployment |
| [`03-operations/REALITY-BASELINE.md`](03-operations/REALITY-BASELINE.md) | What the system actually does today (vs the spec) |

## I want to know what's happening right now

| File | One-line description |
|---|---|
| [`STATUS/CURRENT-PHASE.md`](STATUS/CURRENT-PHASE.md) | Active phase + active task |
| [`STATUS/PHASE-PROGRESS-TRACKER.md`](STATUS/PHASE-PROGRESS-TRACKER.md) | Live progress per phase |
| [`STATUS/CHANGELOG.md`](STATUS/CHANGELOG.md) | Phase-level event log |
| [`STATUS/DECISIONS-LOG.md`](STATUS/DECISIONS-LOG.md) | Single source of truth for non-ADR decisions |
| [`STATUS/BLOCKERS.md`](STATUS/BLOCKERS.md) | Open questions and blockers |

## I am Claude, picking up a task

| File | One-line description |
|---|---|
| [`_meta/CLAUDE-WORKFLOW.md`](_meta/CLAUDE-WORKFLOW.md) | Workflow specifically for Claude sessions |
| [`_meta/CONTEXT-LOAD-ORDER.md`](_meta/CONTEXT-LOAD-ORDER.md) | Which 2-3 docs to read for whatever task you're picking up |
| [`_meta/PROMPT-TEMPLATES.md`](_meta/PROMPT-TEMPLATES.md) | Reusable session-kickoff and task-handoff prompt templates |
| [`_meta/HANDOFF-TEMPLATE.md`](_meta/HANDOFF-TEMPLATE.md) | Session-end handoff format |
| [`_meta/SESSION-END-CHECKLIST.md`](_meta/SESSION-END-CHECKLIST.md) | Explicit close-out checklist |
| [`LOAD-MAP.json`](LOAD-MAP.json) | Task-type → file map (machine-readable; for tooling) |

## I want the OmniMind memory-system roadmap (deep dive)

The roadmap is a self-contained subtree built by an 18-agent pipeline (4 researchers + 4 auditors + 8 builders + 3 reviewers + 1 final validator) on 2026-04-18. Treat as authoritative for memory-system planning.

| File | One-line description |
|---|---|
| [`roadmap/MASTER-INDEX.md`](roadmap/MASTER-INDEX.md) | Roadmap-internal index (where do I find X) |
| [`roadmap/EXECUTIVE-SUMMARY.md`](roadmap/EXECUTIVE-SUMMARY.md) | 2-page roadmap summary |
| [`roadmap/PROJECT-CONTEXT.md`](roadmap/PROJECT-CONTEXT.md) | 5-minute roadmap context dump |
| [`roadmap/04-roadmap/ROADMAP-OVERVIEW.md`](roadmap/04-roadmap/ROADMAP-OVERVIEW.md) | Master timeline + dependency graph |
| [`roadmap/06-risks-and-mitigations/RISK-REGISTER.md`](roadmap/06-risks-and-mitigations/RISK-REGISTER.md) | Risk-first lens |
| [`roadmap/02-current-state/`](roadmap/02-current-state/) | Known issues, landmines, dead code, tech debt |
| [`roadmap/01-foundations/`](roadmap/01-foundations/) | Constraints, principles, success metrics, ADR index |
| [`roadmap/`](roadmap/) | Everything else (151 files; use the roadmap's MASTER-INDEX) |

## I want to look up a definition or convention

| File | One-line description |
|---|---|
| [`GLOSSARY.md`](GLOSSARY.md) | Code prefixes, statuses, modes, persona names — platform-level taxonomy |
| [`CONVENTIONS.md`](CONVENTIONS.md) | Naming, lifecycle, stub format, doc-tree taxonomy |
| [`roadmap/01-foundations/GLOSSARY.md`](roadmap/01-foundations/GLOSSARY.md) | Roadmap-specific terms (RRF, HNSW, ADD/UPDATE/DELETE/NOOP, etc.) |

## Reports and historical artifacts

| Path | What lives here |
|---|---|
| [`_reports/`](_reports/) | Frontend polish, Phase 5, remediation reports — preserved for audit |
| [`_archive/orchestrator-prompts/`](_archive/orchestrator-prompts/) | 16 one-shot orchestrator prompts (PHASE-0..5, UI-A..C, etc.) |
| [`_archive/research-wave-3-reviews/`](_archive/research-wave-3-reviews/) | 4 wave-3 reviewer outputs from the 18-agent pipeline |

## Ongoing migration artifacts (will be removed in Phase E cleanup)

| Path | What lives here |
|---|---|
| [`_inventory/`](_inventory/) | Phase A-C migration planning artifacts (inventory, target tree, migration map, decisions, checkpoint, execution log) |

## Tasks (historical — live progress is in STATUS/)

| Path | What lives here |
|---|---|
| [`tasks/`](tasks/) | Phase-based task specs (TASK-001..TASK-014). Historical; the live task index is `STATUS/PHASE-PROGRESS-TRACKER.md`. |

## Runtime persona prompts

| Path | What lives here |
|---|---|
| [`prompts/`](prompts/) | `*.system.md` files loaded at runtime by `prompt-loader.ts`. Edit prompts here, not buried in TypeScript. |

## Research raw outputs

| Path | What lives here |
|---|---|
| [`research/`](research/) | Wave-1 audit + research outputs from the 18-agent pipeline (the wave3 reviews live in `_archive/`). |

---

**Don't see what you need?** Check [`STATUS/BLOCKERS.md`](STATUS/BLOCKERS.md) and add it as an open question, or check [`CONVENTIONS.md`](CONVENTIONS.md) for the doc-bucket taxonomy to figure out where it should live.
