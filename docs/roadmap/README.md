# Omnimind Dev Roadmap — Master Index

**Last updated:** 2026-04-18
**Status:** Operator-ready scaffold + agent-validated content
**Supersedes:** `docs/MEM0_RE_INTEGRATION_PLAN.md` and `docs/MEM0_INTEGRATION_PLAN.md`

> **If you are Claude and this is a new session, read [`07-claude-instructions/CLAUDE-WORKFLOW.md`](07-claude-instructions/CLAUDE-WORKFLOW.md) FIRST.**
> It tells you which 2-3 files to load for whatever task you're picking up.

---

## What this is

A self-contained, context-saving operator manual for evolving omnimind from its current 6.5/10 state to a 10/10 production memory platform. Built by an 18-agent pipeline (4 researchers + 4 auditors + 6 builders + 3 reviewers + 1 final validator) over ~1 hour of compute.

This roadmap exists so that any future Claude session can pick up *any* phase, *any* task, *any* feature, without re-reading the entire repo. Read 2-3 files; execute.

## Top-level navigation

| Folder | Purpose | When to read |
|---|---|---|
| [01-foundations/](01-foundations/) | ADRs, constraints, success metrics, glossary — the non-negotiables | First time picking up the roadmap; whenever a decision feels architectural |
| [02-current-state/](02-current-state/) | Architecture map, capabilities inventory, known issues, landmines, dead code, tech debt | Audit / catch-up sessions; before any change |
| [03-research/](03-research/) | Research findings on AI memory SOTA, mem0, Obsidian, hybrid retrieval | Whenever a phase requires understanding *why* a choice was made |
| [04-roadmap/](04-roadmap/) | The phased plan. One folder per phase. | Picking up active work |
| [05-features-to-10/](05-features-to-10/) | "Make it 10/10" feature specs (MCP, SDK, markdown export, deep KG, etc.) | Designing a new capability |
| [06-risks-and-mitigations/](06-risks-and-mitigations/) | Risk register, 6/12-month forecasts, security/data/cost/operational risks | Risk reviews; pre-deploy gates |
| [07-claude-instructions/](07-claude-instructions/) | How to use this roadmap; load order; prompt templates; handoff format | EVERY new session, Claude reads CLAUDE-WORKFLOW.md first |
| [08-references/](08-references/) | Codebase map, ADR copies, external docs, source bibliography | Reference / fact-checking |
| [STATUS/](STATUS/) | Living state: what's in flight, blockers, decisions made, changelog | Beginning AND end of every session |

## Quick links by task

- **"I'm starting fresh, where do I begin?"** → [`07-claude-instructions/CLAUDE-WORKFLOW.md`](07-claude-instructions/CLAUDE-WORKFLOW.md)
- **"What's the next concrete thing to ship?"** → [`STATUS/CURRENT-PHASE.md`](STATUS/CURRENT-PHASE.md)
- **"What's the entire plan?"** → [`04-roadmap/ROADMAP-OVERVIEW.md`](04-roadmap/ROADMAP-OVERVIEW.md)
- **"What can break?"** → [`06-risks-and-mitigations/RISK-REGISTER.md`](06-risks-and-mitigations/RISK-REGISTER.md)
- **"What does omnimind actually do today?"** → [`02-current-state/CAPABILITIES-INVENTORY.md`](02-current-state/CAPABILITIES-INVENTORY.md)
- **"What's the team's bet on AI memory architecture?"** → [`03-research/ai-memory-sota.md`](03-research/ai-memory-sota.md)
- **"How would I add a Memory MCP server?"** → [`05-features-to-10/memory-mcp-server.md`](05-features-to-10/memory-mcp-server.md)

## Document conventions

- All tables, no walls of prose unless absolutely necessary.
- Every claim in this roadmap that depends on a prior research pass cites the source file.
- Every "do X" action has an exit criterion — measurable.
- Every deferred item has a named, measurable trigger to flip it back on.
- Every phase has a rollback plan.

## Living docs vs. frozen docs

| Frozen (don't edit without ADR) | Living (update as work progresses) |
|---|---|
| `01-foundations/CONSTRAINTS.md` | `STATUS/CURRENT-PHASE.md` |
| `04-roadmap/PHASE-N/README.md` (only via revision) | `STATUS/CHANGELOG.md` |
| `06-risks-and-mitigations/*` (re-audit quarterly) | `STATUS/DECISIONS-LOG.md` |
| `01-foundations/ADR-INDEX.md` (additive only) | `STATUS/BLOCKERS.md` |
