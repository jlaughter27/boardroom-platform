# Changelog

Append-only log of work shipped against this roadmap. Most recent at top.

Format: `## YYYY-MM-DD — Phase X — Action`

---

## 2026-04-18 — Wave 4 validator pass — Reconciliation

The Wave 4 final validator reconciled the 18-agent pipeline output. No code changes; documentation-only fixes.

**Phase numbering — canonical scheme adopted (Builder 2b's filesystem layout):**
- Phase 12 = webhooks-event-bus (was variously SDK, hardening)
- Phase 13 = sdk (was observability)
- Phase 14 = observability-suite (was migration history)
- Phase 15 = migration-history (was cortex isolation; pull-forward candidate)
- Phase 16 = cortex-isolation (was knowledge-graph deep)
- Phases 17 (persona marketplace), 18 (resilience + multitenant fairness), 19 (horizontal API scale) added to all top-level docs (ROADMAP-OVERVIEW, MASTER-INDEX, EXECUTIVE-SUMMARY, COST-MODEL, SUCCESS-METRICS, PHASE-PROGRESS-TRACKER, PHASE-COMPLETION-CRITERIA)
- Phantom sub-decimal phases (1.5, 1.6, 2.5, 5/Cortex Pro, "Pre-enterprise") remapped per `04-roadmap/ROADMAP-OVERVIEW.md` "phase-number map" section (Phase 1 durability layer / Phase 0.25 / DEFERRED with named triggers)
- 8 empty stub phase folders deleted by the parent (PHASE-12-sdk, PHASE-13-observability, PHASE-14-migration-history, PHASE-15-cortex-isolation, PHASE-16-knowledge-graph-deep, PHASE-7b-outcome-feedback, PHASE-8-reranker, PHASE-DEFERRED). Canonical phase folder list documented in ROADMAP-OVERVIEW.

**Cross-reference fixes:**
- LANDMINE ID format harmonized to L1..L10 (was a mix of L*, LANDMINE-A1, LANDMINE-D1, LANDMINE-stripe-*, LM-03). Cross-reference table added to top of `06-risks-and-mitigations/RISK-REGISTER.md` mapping Landmine ↔ KI ↔ Risk ID.
- `KNOWN-ISSUES.md` "Fix phase" column rewritten for all 79 KI entries to use canonical phase numbers.
- `LANDMINES.md` "Roadmap home" lines on all 10 landmines rewritten to canonical phases.
- `RISK-REGISTER.md` Section 6 rewritten as canonical risk-by-phase quick map.
- `MASTER-INDEX.md` rewritten to remove ~10 broken links (SOPHISTICATION-RUBRIC, SCALE-CEILING, KNOWN-LIMITATIONS, SCALABILITY-RISKS, EVAL-RISKS, SESSION-KICKOFF-TEMPLATE, SUBAGENT-PATTERNS, REPORTING-BACK, markdown-export, EXTERNAL-LINKS) — now points at the actual files (CAPABILITIES-INVENTORY, RISK-REGISTER §3, AGENT-DISPATCH-PATTERNS, HANDOFF-TEMPLATE, markdown-export-import, external-docs).

**Executor-feasibility fixes:**
- `STATUS/CURRENT-PHASE.md` rewritten: now mentions Phase 0.25 explicitly, adds "Active task (within current phase)" pointer line, surfaces the canonical phase queue.
- `STATUS/PHASE-PROGRESS-TRACKER.md` rewritten: extended through Phase 19, added explicit task IDs per phase (e.g., 0.25.1..0.25.6) so cold-start sessions know which task to resume.
- `STATUS/PHASE-COMPLETION-CRITERIA.md` extended through Phase 19.
- File-path drift fixed in `04-roadmap/PHASE-0.25-critical-fixes/tasks-and-prompts.md` (`user-profile.ts` → `user-profile.schema.ts`, `memory.ts` → `memory.types.ts`); same convention propagated to Phase 1 + Phase 4 + Phase 17 (`extracted-entity.schema.ts`, `relationship-query.schema.ts`, `persona-manifest.schema.ts`, etc.).
- Added security-incident task type (I) to `07-claude-instructions/CLAUDE-WORKFLOW.md` task-type table; added matching pitfall #13 to `07-claude-instructions/COMMON-PITFALLS.md` covering acute-mode triage flow and per-scenario first-actions.

**Time budget reconciliation:**
- Phase 10 (MCP server) revised: 2w → 4-6w per research validation
- Phase 11 (markdown export) revised: 1w → 3-4w per research validation
- Phase 13 (SDK) revised: 1.5w → 3-4w per research validation
- EXECUTIVE-SUMMARY headline calendar revised: p50 24w → ~30w; p90 30w → ~37w
- COST-MODEL per-phase impact table updated for canonical numbering and new phases (12 webhooks, 17 marketplace, 19 horizontal scale)

**Persona-marketplace contradiction resolved:**
- Phase 17 confirmed as PLANNED (real phase folder retained)
- `DEFERRED/persona-marketplace.md` (DEF-014) reframed as alternative-deferral spec with conditions for descope; row in `DEFERRED/README.md` now points at PHASE-17 as canonical home.

**ADR copies (item K) — TODO acknowledged:**
- `08-references/adrs/` README updated to reflect that the 13 ADRs in `docs/DECISIONS.md` have not been split into one-file-per-ADR copies. Flagged a real inconsistency between `01-foundations/ADR-INDEX.md` (ADR-005/006/010/012 headlines) and `docs/DECISIONS.md` (different headlines for those numbers) — left BOTH intact and surfaced for user decision rather than silently rewriting either.

**Files created:** 1 (`docs/_archive/research-wave-3-reviews/wave4-validator-summary.md` — archived in Phase D 2026-05-01; original path was `docs/research/omnimind-roadmap-2026/wave3-review/wave4-validator-summary.md`)
**Files modified:** ~25 across all roadmap subdirectories
**Files deleted:** 0 (parent already removed the 8 empty stub folders)

Next session: Phase 0 (foundation cleanup) is unblocked and ready to execute. Phase 0.25 follows.

---

## 2026-04-18 — Roadmap scaffold — Initial creation

- Created `docs/roadmap/` directory tree (10 top-level dirs, 21 phase folders)
- Wrote entry-point docs: `README.md`, `PROJECT-CONTEXT.md`, `07-claude-instructions/CLAUDE-WORKFLOW.md`, `07-claude-instructions/CONTEXT-LOAD-ORDER.md`
- Wrote initial STATUS docs: `CURRENT-PHASE.md`, `BLOCKERS.md`, `CHANGELOG.md` (this file), `DECISIONS-LOG.md`
- Built by 18-agent pipeline: 4 researchers + 4 auditors + 6 builders + 3 reviewers + 1 final validator
- Subsequent agent waves filled `01-foundations/` through `08-references/`

Next session: pick up Phase 0 from `04-roadmap/PHASE-0-foundation/`.
