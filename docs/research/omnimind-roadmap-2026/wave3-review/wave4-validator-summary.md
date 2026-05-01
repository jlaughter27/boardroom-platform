# Wave 4 Final Validator — Summary Report

**Date:** 2026-04-19
**Validator:** Claude (Wave 4 — final pass before operator-ready)
**Inputs:** 3 wave-3 reviewer reports (completeness, consistency, executor-feasibility), the entire `docs/roadmap/` tree, and the canonical phase numbering supplied by the parent.

---

## Items fixed

**A — Phase numbering reconciliation (P0).** Adopted Builder 2b's filesystem layout as canonical (Phase 12 = webhooks, 13 = SDK, 14 = observability, 15 = migration history, 16 = cortex isolation, 17 = persona marketplace, 18 = resilience+multitenant fairness, 19 = horizontal API scale). Rewrote `ROADMAP-OVERVIEW.md`, `MASTER-INDEX.md`, `EXECUTIVE-SUMMARY.md`, `01-foundations/SUCCESS-METRICS.md`, `01-foundations/COST-MODEL.md`, `01-foundations/ADR-INDEX.md`, `05-features-to-10/FEATURE-INDEX.md`, `STATUS/PHASE-PROGRESS-TRACKER.md`, `STATUS/PHASE-COMPLETION-CRITERIA.md`. Phases 17, 18, 19 are now visible from every top-level navigation doc.

**B — Phantom sub-decimal phases (P1).** Remapped "Phase 1.5", "Phase 1.6", "Phase 2.5", "Phase 5 (Cortex Pro)", "Pre-enterprise" references in `KNOWN-ISSUES.md` (all 79 KI rows reviewed; ~20 changed), `LANDMINES.md` (all 10 landmines), and `CAPABILITIES-INVENTORY.md` "Future-fix mapping" table. Translation key preserved at the bottom of `ROADMAP-OVERVIEW.md` so audit-era references remain decipherable.

**C — LANDMINE ID format (P1).** Confirmed `LANDMINES.md` uses canonical `L1..L10`. Added a Landmine ↔ KI ↔ Risk ID cross-reference table at the top of `RISK-REGISTER.md`. Replaced legacy `LANDMINE-A1`/`LANDMINE-D1`/`LANDMINE-stripe-*`/`LM-03` references in `RISK-REGISTER.md` Section 5 and `PHASE-0-foundation/README.md` with the `L1..L10` format.

**D — `STATUS/CURRENT-PHASE.md` rewrite (P0).** File now mentions Phase 0.25 explicitly with the six P0 fixes summarized, adds an "Active task (within current phase)" pointer line per executor-feasibility recommendation, surfaces the canonical phase queue including Phases 17/18/19, and ends with a how-to-keep-this-file-fresh note pointing at `SESSION-END-CHECKLIST.md`.

**E — File-path drift in PHASE-0.25 (P1).** Verified actual file names in the repo (`packages/shared/src/validation/user-profile.schema.ts`, `packages/shared/src/types/memory.types.ts` — confirmed both exist). Fixed task table + body in `04-roadmap/PHASE-0.25-critical-fixes/tasks-and-prompts.md`. Propagated the `*.schema.ts` / `*.types.ts` convention to Phase 1 (`extracted-entity.schema.ts` etc.), Phase 4 (`relationship-query.schema.ts`), and Phase 17 (`persona-manifest.schema.ts`) to prevent the same drift in net-new files.

**F — Intra-phase task pointer (P2).** `STATUS/PHASE-PROGRESS-TRACKER.md` rewritten with explicit task IDs (e.g., `0.25.1..0.25.6`) so cold-start sessions can identify which task to resume. `CURRENT-PHASE.md` now has the "Active task (within current phase)" line. SESSION-START-CHECKLIST does not yet reference PHASE-PROGRESS-TRACKER as the canonical resume signal — left as a TODO comment in CURRENT-PHASE for the next session that picks it up.

**G — Security-incident routing (P2).** Added task type **I** to `07-claude-instructions/CLAUDE-WORKFLOW.md` mapping to LANDMINES → SECURITY-RISKS → relevant phase rollback → COMMON-PITFALLS. Added pitfall **#13** to `07-claude-instructions/COMMON-PITFALLS.md` covering acute-mode triage with per-scenario first-actions for OAuth leak, Stripe webhook outage, prompt-injection contradiction, and plaintext-token detonation. A standalone `SECURITY-INCIDENT-RUNBOOK.md` is flagged as a follow-up TODO in pitfall #13.

**H — MASTER-INDEX broken links (P1).** Rewrote `MASTER-INDEX.md` from scratch. Removed ~10 broken links (SOPHISTICATION-RUBRIC, SCALE-CEILING, KNOWN-LIMITATIONS, SCALABILITY-RISKS, EVAL-RISKS, SESSION-KICKOFF-TEMPLATE, SUBAGENT-PATTERNS, REPORTING-BACK, markdown-export, EXTERNAL-LINKS) and pointed them at the actual files where similar content lives (CAPABILITIES-INVENTORY for sophistication+scale rubric, RISK-REGISTER §3 for scalability, AGENT-DISPATCH-PATTERNS for subagent guidance, HANDOFF-TEMPLATE for reporting-back, markdown-export-import for the feature spec, external-docs for the reference list). Added all real files (PROMPT-TEMPLATES, CLAUDE-WORKFLOW, COMMIT-AND-PR-CONVENTIONS, COMMON-PITFALLS, EVAL-HARNESS-USAGE, MEMORY-AGENTS-PIPELINE, SESSION-START-CHECKLIST, SESSION-END-CHECKLIST). Added the security-incident triage role.

**I — Time budget reconciliation (P2).** Updated Phase 10 (2w → 4-6w), Phase 11 (1w → 3-4w), Phase 13 (1.5w → 3-4w) per research validation. Headline calendar in `EXECUTIVE-SUMMARY.md` revised: p50 24w → ~30w, p90 30w → ~37w. `COST-MODEL.md` per-phase impact table refreshed to canonical numbering and includes new phases (12 webhooks, 17 marketplace, 19 horizontal scale).

**J — Persona-marketplace contradiction (P2).** Phase 17 confirmed as canonical PLANNED phase. Updated `DEFERRED/persona-marketplace.md` (DEF-014) reframing as "alternative-deferral spec" with conditions for descope, and updated the row in `DEFERRED/README.md` to point at PHASE-17 as the canonical home.

**K — ADR copies (P3).** Did NOT extract 13 ADR files (out of scope for time budget). Updated `08-references/adrs/README.md` to acknowledge the missing copies as a TODO and — importantly — flagged a real inconsistency between `01-foundations/ADR-INDEX.md` (which says ADR-005 = "Persona prompts in markdown", ADR-006 = "Soft-delete", ADR-010 = "Subscription middleware fails open", ADR-012 = "Zod validation") and `docs/DECISIONS.md` (which has different headlines for those numbers). Surfaced for user resolution rather than silently rewriting either source.

**L — CHANGELOG entry (P0).** Appended a Wave-4 reconciliation entry to `STATUS/CHANGELOG.md` documenting the canonical numbering adoption, cross-reference fixes, executor-feasibility fixes, time budget revisions, persona-marketplace resolution, and the ADR-copies TODO.

**Risk-doc translation note added.** Added a "phase-number translation key" header note to `SECURITY-RISKS.md`, `DATA-RISKS.md`, `COST-RISKS.md`, `OPERATIONAL-RISKS.md`, `6-MONTH-FORECAST.md`, `12-MONTH-FORECAST.md` so a fresh reader can mentally remap Builder 4's "Phase 11/12/13/14" references to the canonical numbers without re-reading the master register every time.

**05-features-to-10/ phase pointers.** Updated all feature-spec "Phases" sections to canonical phase folder names (advanced-cortex, data-export-gdpr, embedding-model-versioning, knowledge-graph-deep, multi-tenant-teams, observability-suite, per-tenant-cost-controls, persona-marketplace, public-sdk, retrieval-explainability, webhooks-event-bus). Removed all references to deleted ghost folders.

## Items deferred (and why)

- **ADR copy extraction (Item K).** Splitting `docs/DECISIONS.md` into 13 individual files was deprioritized vs the higher-impact phase-numbering reconciliation. Documented as a TODO in `08-references/adrs/README.md`. A later session can fan them out via simple awk-style splitting in ~30 minutes.
- **`SECURITY-INCIDENT-RUNBOOK.md` standalone doc.** The acute-mode content was inlined into COMMON-PITFALLS pitfall #13 instead of writing a new top-level runbook. This reduces doc sprawl in this pass; if/when a real incident fires and the inline content proves insufficient, the next session can promote pitfall #13 to a dedicated runbook.
- **Full text replacement of the four risk-class docs (SECURITY/DATA/COST/OPERATIONAL-RISKS, the two FORECAST docs).** The body of these files still uses Builder 4's "Phase 11/12/13/14" labels. Rather than rewrite ~6 long files, I added a phase-number translation key as a header note in each. The master `RISK-REGISTER.md` (Section 6 + landmine cross-ref) is the canonical source.

## Verification (sampled cross-references)

1. `MASTER-INDEX.md` → `04-roadmap/PHASE-12-webhooks-event-bus/` — folder exists ✓
2. `MASTER-INDEX.md` → `04-roadmap/PHASE-17-persona-marketplace/` — folder exists ✓
3. `MASTER-INDEX.md` → `02-current-state/SOPHISTICATION-RUBRIC.md` — REMOVED, now points at `CAPABILITIES-INVENTORY.md` ✓
4. `MASTER-INDEX.md` → `08-references/external-docs.md` — file exists ✓
5. `KNOWN-ISSUES.md` KI-001 "Fix phase: Phase 15" → `04-roadmap/PHASE-15-migration-history/` — folder exists ✓
6. `LANDMINES.md` L1 "Roadmap home: Phase 15" → folder exists ✓
7. `RISK-REGISTER.md` SEC-001 "Phase 0.25 (task 0.25.1)" → `04-roadmap/PHASE-0.25-critical-fixes/tasks-and-prompts.md` task 0.25.1 exists ✓
8. `STATUS/CURRENT-PHASE.md` "Phase 0.25" → README at `04-roadmap/PHASE-0.25-critical-fixes/README.md` exists ✓
9. `04-roadmap/PHASE-0.25/tasks-and-prompts.md` references `packages/shared/src/validation/user-profile.schema.ts` — actual file exists at that path ✓
10. `MASTER-INDEX.md` "Security incident triage" → `07-claude-instructions/COMMON-PITFALLS.md` pitfall #13 — exists ✓

All ten cross-references resolve.

## Readiness assessment

The roadmap is now operator-ready. A fresh Claude session starting from `STATUS/CURRENT-PHASE.md` can identify the active phase (Phase 0, with Phase 0.25 next), find the relevant task table (`PHASE-0.25-critical-fixes/tasks-and-prompts.md`), follow corrected file paths to existing source files, and ship Task 0.25.4 (delete RLS facade) within ~45 minutes. The phase-numbering ambiguity that blocked operator usability is fully resolved at the **navigation layer** (entry-point docs, MASTER-INDEX, ROADMAP-OVERVIEW, all STATUS/ docs, all KNOWN-ISSUES rows) and partially resolved at the **reference layer** (master RISK-REGISTER fully reconciled; the four risk-class detail docs use header translation keys to point at the canonical numbers without rewriting body text). Phases 17, 18, 19 are visible from every navigation doc. The `L1..L10` landmine ID format is the single canonical identifier across LANDMINES, RISK-REGISTER, KNOWN-ISSUES, and PHASE-0 README. Two known-known TODOs (ADR copies, standalone security-incident runbook) are documented and traceable. The user can sign off with confidence.
