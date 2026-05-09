# Orchestrator Prompts (Archived)

> **Frozen.** These files were one-shot orchestrator prompts used to drive specific multi-agent runs during the project's earlier phases. They are preserved here for audit and historical reference; they are NOT part of the runtime prompt-loader path and have `inbound_count = 0` per the Phase A inventory.

## What lives here

Each file is a self-contained orchestration spec — a long-form prompt that was fed to a coordinator agent to dispatch sub-agents and assemble their outputs. They are **not** loaded by code at runtime (the runtime persona prompts live at `docs/prompts/*.system.md` and are loaded by `packages/*/src/lib/prompt-loader.ts`).

| File | Origin / role |
|---|---|
| `PHASE-0-ORCHESTRATOR.md` | Phase 0 foundation work (schema, validation, retrieval scaffold) |
| `PHASE-1-ORCHESTRATOR.md` | Phase 1 multi-persona dispatch + streaming + synthesis |
| `PHASE-2-ORCHESTRATOR.md` | Phase 2 cortex intelligence layer (patterns, memos, contradictions) |
| `PHASE-3-ORCHESTRATOR.md` | Phase 3 integrations (Calendar, Gmail, Stripe, custom personas) |
| `PHASE-4-ORCHESTRATOR.md` | Phase 4 (planned but not run as orchestrated batch) |
| `PHASE-5-ORCHESTRATOR.md` | Phase 5 (planned but not run as orchestrated batch) |
| `UI-PHASE-A-DESIGN-FOUNDATION.md` | UI overhaul Phase A — design tokens + layout |
| `UI-PHASE-B-PAGE-REBUILD.md` | UI overhaul Phase B — per-page rebuild |
| `UI-PHASE-C-INTELLIGENCE-POLISH.md` | UI overhaul Phase C — intelligence-aware polish |
| `REMEDIATION-ORCHESTRATOR.md` | First remediation pass (post-deploy bug sweep) |
| `REMEDIATION-2-ORCHESTRATOR.md` | Second remediation pass |
| `FRONTEND-POLISH-ORCHESTRATOR.md` | Frontend polish wave (post-Phase-A UI work) |
| `PRE-DEPLOY-FIXES.md` | Targeted fixes immediately before a deployment cutover |
| `DEPLOY-ORCHESTRATOR.md` | Deploy-readiness coordination |
| `AUDIT-ORCHESTRATOR.md` | First audit-pass coordinator |
| `FINAL-AUDIT-ORCHESTRATOR.md` | Final audit-pass coordinator |

## Why these are archived, not deleted

- **Audit trail.** A future auditor following the project's history (commits, release notes, retros) will want to see how a given subsystem was built. These orchestrator specs explain the multi-agent dispatch structure used at the time.
- **Pattern library.** The orchestration patterns (validator gates, stuck-state handling, sub-agent specs) are reusable. Future orchestrations may borrow shape from these.
- **Lossless.** None of these have been edited since archival. If you need to reconstruct what was run on date X, the file content from that date is preserved in git history.

## What you should NOT do

- **Do not edit.** These are frozen. If you want a new orchestration, write a new prompt.
- **Do not load these at runtime.** The codebase's `prompt-loader.ts` only globs `docs/prompts/*.system.md`. Even if you copy one of these into the runtime prompts directory, it won't be picked up unless it has the `.system.md` suffix.
- **Do not assume the project is mid-run on any of these.** Each was a one-shot. The current execution state lives in `docs/STATUS/` (post-Phase-D).

## Provenance

Moved here in Phase D (`docs/_inventory/PHASE-C-MIGRATION-MAP.md` v1.4 §2.1) as part of the docs-tree consolidation. No content edits were made during the move; only the path changed (`docs/prompts/` → `docs/_archive/orchestrator-prompts/`).
