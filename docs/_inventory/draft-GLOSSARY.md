# Glossary — BoardRoom + OmniMind Platform

> **Draft — staged in `docs/_inventory/` during PR 2 (Phase D bucket migration).** Will move to `docs/GLOSSARY.md` as part of §10 commit 12. Currently scoped to terms in active use; placeholders flagged "TBD" are listed in the migration map §4 spec but not yet referenced in code or docs.

**Audience.** Anyone (Claude or human) trying to decode an acronym, code prefix, or unfamiliar term used in the platform docs or code.

**How to use.** Skim until the term you don't recognize jumps out. Each entry is one short paragraph plus a "see also" pointer.

---

## Code prefixes

Used as identifiers for tasks, decisions, and capabilities. Format is `<prefix>-<number>` or `<prefix>-<slug>`.

| Prefix | Meaning | Example | Defined in |
|---|---|---|---|
| `P0-` | Phase 0 task IDs (foundation cleanup, feature flags, etc.) | `P0-1` Unified Prisma migration; `P0-2` Feature flag system | `docs/02-reference/MASTER-DEV-PLAN.md` |
| `IL-` | Input Layer (Quick Capture, voice intake, etc.) | `IL-1` ... `IL-4` | `docs/02-reference/MASTER-DEV-PLAN.md` Phase 0.4 |
| `OL-` | Output Layer (brief generator, export hub, etc.) | `OL-1`, `OL-3` | `docs/02-reference/MASTER-DEV-PLAN.md` Phase 0.5 |
| `KI-` | Known Issues (audit findings) | `KI-001`..`KI-079` | `docs/roadmap/02-current-state/KNOWN-ISSUES.md` |
| `L1`..`L10` | Landmines (silent-until-explosion failure modes) | `L1` Cortex jobs share the same DB connection pool | `docs/roadmap/02-current-state/LANDMINES.md` |
| `ADR-` | Architecture Decision Records (numbered) | `ADR-001` Custom agent runtime; `ADR-008` Native tool_use | `docs/02-reference/DECISIONS.md`, `docs/roadmap/01-foundations/ADR-INDEX.md` |
| `DEF-` | Deferred capabilities (with measurable trigger) | `DEF-014` Persona marketplace descope path | `docs/roadmap/04-roadmap/DEFERRED/` |
| `CC-` `MR-` `PL-` `WR-` `VT-` `AR-` `FG-` `CN-` `MN-` `CS-` `WT-` | TBD — listed in migration map §4 spec but not yet referenced in code or docs | — | (verify before adding new prefixed identifiers) |

## User-facing modes

These map to different persona dispatch combos in `packages/boardroom-ai/server/src/personas/mode-router.ts`.

| Mode | Persona subset emphasized | Use case |
|---|---|---|
| `decide` | All 7 personas (Optimist, Critic, Alternate, Technician, Questionnaire, Doer, CEO) | Full executive-style decision analysis |
| `stress-test` | Critic + Questionnaire + Alternate emphasis | Adversarial pressure test of an existing plan |
| `plan` | Doer + Technician emphasis | Action-oriented, "what do I do next?" |
| `brainstorm` | Optimist + Alternate emphasis | Creative reframing and option generation |
| `quick` | Subset (varies) | Lightweight one-shot analysis |

## Personas

Loaded at runtime from `docs/prompts/*.system.md` via `prompt-loader.ts`. Currently 18 prompts:

**7 Core personas:** `optimist`, `critic`, `alternate`, `technician`, `questionnaire`, `doer`, `ceo`

**4 Specialized (extraction + processing):** `email-extractor`, `memory-extractor`, `commitment-extraction`, `sufficiency-check`

**3 Onboarding:** `onboarding-bootstrap`, `onboarding-goals`, `onboarding-projects`

**4 Cortex (intelligence layer):** `cortex-memo`, `cortex-patterns`, `cortex-contradictions`, `cortex-simulation`

`quality-evaluator` is added in PR 3 (deferred).

## Statuses (entity lifecycle)

| Status | Meaning |
|---|---|
| `active` | Entity is in use; default state |
| `archived` | Removed from active queries but retrievable |
| `deletedAt` (DateTime) | Soft delete — preserve in DB but filter from queries |

All entities (Goal, Project, Task, Decision, Memory, etc.) use the `deletedAt` soft-delete pattern. Hard delete is rare and only via explicit admin tooling.

## Memory operations

Used by the Cortex memory pipeline (Phase 2 onward).

| Op | Meaning |
|---|---|
| `ADD` | New memory entry, no overlap with existing |
| `UPDATE` | Existing memory entry refined or extended |
| `DELETE` | Existing memory entry contradicted; mark as superseded |
| `NOOP` | Input was already represented; no write needed |

See `docs/roadmap/04-roadmap/PHASE-2-pattern-extraction/`.

## Architecture terms

| Term | Meaning |
|---|---|
| RRF | Reciprocal Rank Fusion — score-aggregation method for hybrid retrieval (Phase 3). See `docs/roadmap/01-foundations/GLOSSARY.md`. |
| HNSW | Hierarchical Navigable Small World — pgvector index type (Phase 3) |
| FTS | Full-Text Search — Postgres `tsvector` + `tsquery` |
| Trigram | `pg_trgm` extension for fuzzy substring matching |
| BoardRoom | Frontend + persona orchestration service (port 3001) |
| OmniMind | Persistent data + memory validation service (port 3333) |
| Cortex | Background intelligence layer (cron-driven pattern detection, weekly memos, contradiction alerts) |
| Persona | One of the 7 core analytical voices that compose a decision response |

## Doc structure terms (Phase D taxonomy)

| Bucket | Purpose |
|---|---|
| `docs/01-orientation/` | First-touch onboarding (PROJECT-BRIEF, CURRENT-STATE, ARCHITECTURE-QUICK-REF) |
| `docs/02-reference/` | Durable reference (MASTER-FRAMEWORK, DECISIONS, FRAGILE-ZONES, MASTER-DEV-PLAN, MASTER-DREAM-ROADMAP) |
| `docs/03-operations/` | Runbooks (DEPLOYMENT-RUNBOOK, DEPLOY-RAILWAY, REALITY-BASELINE) |
| `docs/_reports/` | Historical reports (FRONTEND-POLISH-REPORT, PHASE-5-REPORT, REMEDIATION-REPORT) |
| `docs/STATUS/` | Live session-state (CURRENT-PHASE, CHANGELOG, DECISIONS-LOG, BLOCKERS, PHASE-PROGRESS-TRACKER) — promoted from `docs/roadmap/STATUS/` |
| `docs/_meta/` | Agent-instruction meta (CLAUDE-WORKFLOW, CONTEXT-LOAD-ORDER, PROMPT-TEMPLATES, HANDOFF-TEMPLATE, SESSION-END-CHECKLIST) — promoted from `docs/roadmap/07-claude-instructions/` |
| `docs/_archive/` | Frozen content (orchestrator-prompts, research-wave-3-reviews) |

## See also

- `docs/CONVENTIONS.md` — naming, lifecycle, stub format conventions
- `docs/roadmap/01-foundations/GLOSSARY.md` — roadmap-specific memory-system terms
- `docs/INDEX.md` — categorized map of the docs tree
- `docs/02-reference/DECISIONS.md` — full ADR list with rationale
