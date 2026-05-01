# Wave 3 — Completeness Review

**Reviewer:** Reviewer 1 (Completeness)
**Date:** 2026-04-18
**Question:** Did the 18-agent pipeline produce a complete roadmap, or are there gaps?
**Inputs read:** All 4 entry-point docs, all 7 foundations files, all 6 current-state files, all 6 research files, ROADMAP-OVERVIEW + DEFERRED + 21 phase folders, all 15 feature specs, all 7 risk docs, all 11 claude-instructions files, 4 references files, all 6 STATUS files, plus all four wave-1 audits and all four wave-1 research reports.

---

## 1. Verdict

**APPROVE-WITH-GAPS.**

The roadmap is **substantively complete on content** — every audit finding, every research recommendation, every user-stated need has a recognizable home somewhere in `docs/roadmap/`. The Wave-1 corpus is faithfully represented; nothing material was dropped on the floor. Where the roadmap fails is on **structural coherence**: the phase numbering does not agree with itself across `ROADMAP-OVERVIEW.md`, `MASTER-INDEX.md`, the actual `PHASE-*` folders, the risk register's "Phase 11/12/13/14" naming, the FEATURE-INDEX's phase column, and the references in `02-current-state/KNOWN-ISSUES.md` to "Phase 1.5", "Phase 1.6", "Phase 2.5", and "Pre-enterprise" that have no folder. A future Claude session reading "fix in Phase 13" cannot know which Phase 13 is meant. Wave 4 must reconcile the numbering before this is shippable.

---

## 2. The user's original asks vs. what was delivered

| Ask | Status | Where covered |
|---|---|---|
| **Mem0 needs** | ✅ | `03-research/ai-memory-sota.md`, `03-research/mem0-decomposition.md`, Phases 1, 2, 3, 4, 5a, 5b, 6, 7a (the entire mem0 core arc); `04-roadmap/ROADMAP-OVERVIEW.md` "Mem0 core" track |
| **Known issues** | ✅ | `02-current-state/KNOWN-ISSUES.md` (79 IDs KI-001 → KI-079, severity-ranked, every one cross-referenced to a fix phase) |
| **New issues** | ✅ | KNOWN-ISSUES.md surfaces KI-005..KI-079 from the wave-1 audits that were not in the prior `MEM0_*` planning docs; LANDMINES.md L1-L10 enumerate hidden risks |
| **Eventual issues** | ✅ | `06-risks-and-mitigations/6-MONTH-FORECAST.md` (10 scenarios) and `12-MONTH-FORECAST.md` (5 scenarios) explicitly model what breaks at 500 / 2k / 10k users |
| **Indexing features** | ✅ | Phase 3 (HNSW + RRF) + DEFERRED entry for Phase 8 reranker; `03-research/ai-memory-sota.md` §1 covers the decision tree |
| **Knowledge graphs** | ✅ | Phase 4 (recursive-CTE traversal, the cherry-picked answer); `05-features-to-10/knowledge-graph-deep.md` covers the deferred Apache AGE / Neo4j evaluation; `03-research/mem0-decomposition.md` documents what was cherry-picked vs rejected |
| **MCPs** | ✅ | Phase 10 + `05-features-to-10/memory-mcp-server.md`; `03-research/ai-memory-sota.md` §8 covers the spec details (Streamable HTTP + OAuth 2.1 + DCR + RFC 8707) |
| **SDKs** | ✅ | Phase 13 (folder name `PHASE-13-sdk`) + `05-features-to-10/public-sdk.md`; ROADMAP-OVERVIEW still calls it Phase 12 (numbering bug — see §4) |
| **Markdown** | ✅ | Phase 11 + `05-features-to-10/markdown-export-import.md` + `03-research/obsidian-patterns.md` |
| **Data exports** | ✅ | `05-features-to-10/data-export-gdpr.md` (full GDPR account export + 30-day soft-then-hard delete pipeline), referenced in `06-risks-and-mitigations/SECURITY-RISKS.md` SEC-024 |
| **Improved cortex** | ✅ | `05-features-to-10/advanced-cortex.md` (5 new cortex capabilities including outcome-decision feedback loop, cross-entity contradictions, decision-quality trends); Phase 16 (cortex isolation) |
| **Improved observability** | ✅ | Phase 14 folder + `05-features-to-10/observability-suite.md`; covers OTel + Axiom + traces + alerts + cost dashboard |
| **Everything missing/broken/unfinished/landmines** | ✅ | KNOWN-ISSUES.md (79 items), LANDMINES.md (10), DEAD-CODE.md (15,367 LOC), TECH-DEBT.md (top-30), CAPABILITIES-INVENTORY.md (status of every subsystem). The capabilities inventory uses WORKS/WIRED-FRAGILE/EXISTS-UNUSED/FACADE labels — best single status doc in the roadmap |
| **Multi-layer reviews** | ✅ | The pipeline itself (4-wave structure documented in `07-claude-instructions/MEMORY-AGENTS-PIPELINE.md`) |
| **Multi-agent audit** | ✅ | Wave 1 had 4 audit agents (security, data-integrity, scalability, code-quality) — outputs at `docs/research/omnimind-roadmap-2026/wave1-audit/` |
| **Multi-agent reviews** | ✅ | Wave 3 (this wave) has 3 reviewers per `MEMORY-AGENTS-PIPELINE.md` |
| **Multi-agent researchers** | ✅ | Wave 1 had 4 research agents (ops-scaling, security-best-practices, data-architecture, external-interfaces) |
| **Validation pipeline** | ✅ | Documented in CAPABILITIES-INVENTORY §B; existing pipeline in `packages/omnimind-api/src/memory/validation/pipeline.ts`; Phase 5a extends it with prompt-injection scrub + PII redaction (per SECURITY-RISKS SEC-007, SEC-008) |
| **Context-saving file tree** | ✅ | The entire `docs/roadmap/` structure plus `07-claude-instructions/CONTEXT-LOAD-ORDER.md` (per-task 2-3 file lists) plus `MASTER-INDEX.md` (intent-organized navigation) |

**Score: 19/19 user asks covered.** No gaps on user intent. The gaps are all internal-consistency, not coverage.

---

## 3. Audit findings traceability

Each Wave-1 audit was spot-checked end-to-end against the roadmap.

### 3.1 `security-audit.md` — 5 CRITICAL (A1-A5) + 7 HIGH (B1-B7) + 6 MED (C1-C6) + compliance §E

| Finding | KI / risk ID | Phase home | Status |
|---|---|---|---|
| A1 OAuth state hijack | KI-004 / SEC-001 | Phase 0.25 (folder exists, README says "fix") | ✅ |
| A2 Stripe webhook double-broken | KI-005 / SEC-002 / DAT-004 | Phase 0.25 | ✅ |
| A3 Mass-assignment `/user-profile` | KI-006 / SEC-003 | Phase 0.25 | ✅ |
| A4 RLS facade | KI-008 / SEC-004 / TD-001 | Phase 0.25 (delete) + Phase 14/18 (real RLS) | ✅ |
| A5 ENCRYPTION_KEY fall-through | KI-007 / SEC-005 | Phase 0.25 | ✅ |
| B1-B7 HIGH (auth, RLS, fail-open, rate limit, SSE bound, CORS, log leak) | KI-009 → KI-028 | Phase 9 + Phase 18 | ✅ |
| C1-C6 MED (JWT rotation, link ownership, spend cap, payload size, abuse) | KI-029 → KI-049 | Phase 18 | ✅ |
| §E Compliance (audit log, DSAR, MFA, residency) | KI-073 → KI-079 | "Pre-enterprise" or DEFERRED | ✅ (with caveat — see gap §4.5) |

**All 18 audit findings traceable.** ✅

### 3.2 `data-integrity-audit.md` — Sev1 (A1-A2 + C1) + Sev2 (A3-A5, B1-B7, etc.)

| Finding | KI / risk ID | Phase home | Status |
|---|---|---|---|
| A1 `db push --accept-data-loss` | KI-001 / DAT-001 / L1 | Phase 1 (Track A removes flag) + Phase 15 (full migration history) | ✅ |
| A2 Embedding queue silent loss | KI-002 / DAT-002 / L3 | Phase 1.5 referenced in KNOWN-ISSUES but **no PHASE-1.5 folder** | ⚠️ **GAP** |
| A3 Subscription middleware silent fail | KI-009 / DAT-003 | Phase 18 | ✅ |
| A4 Stripe idempotency missing | DAT-004 | Phase 0.25 | ✅ |
| A5 commitment.update no version | KI-021 | Phase 1.6 referenced, **no PHASE-1.6 folder** | ⚠️ **GAP** |
| B1 version race | KI-010 / DAT-005 / L4 | Phase 0.25 (in README) — but KNOWN-ISSUES.md says "Phase 1.6" | ⚠️ **NUMBERING CONFLICT** |
| B2-B7 (embedding observability, soft-delete cascade, cortex deletedAt, etc.) | KI-011..KI-016 / DAT-006..DAT-016 | Various — see §4.1 numbering issue | ⚠️ |
| C1 No baseline migration | KI-003 / DAT-003 | Phase 15 (folder is `PHASE-15-migration-history`, but ROADMAP-OVERVIEW calls migration history Phase 14) | ⚠️ **NUMBERING CONFLICT** |
| C2 No DSAR | KI-013 / DAT-008 / SEC-024 | `data-export-gdpr.md` feature spec; "Phase 13" per RISK-REGISTER | ⚠️ |
| C3 No backup drill | KI-014 / DAT-009 | Phase 18 (off-Railway pg_dump task) | ✅ |
| D1-D7 Schema bugs (orphan migrations, searchVector, supersededBy, etc.) | KI-015..KI-049 / DAT-010..DAT-020 | Phases 0/9/15 | ✅ on coverage; ⚠️ on which phase |

**All findings traceable, but the phase-number mapping is internally inconsistent.** ⚠️

### 3.3 `scalability-audit.md` — quantified ceilings A through F

| Ceiling | Risk ID | Phase home | Status |
|---|---|---|---|
| pgvector IVFFlat → HNSW at 40k vectors | SCL-003 | Phase 3 (HNSW migration) | ✅ |
| Anthropic Sonnet ITPM saturation at 500 users | KI-017 / SCL-001 | Phase 18 (per-key workload split) | ✅ |
| Cortex blocks API event loop | SCL-002 / OPS-006 / L8 | Phase 16 (cortex isolation) | ✅ |
| Prisma connection pool default | KI-054 / SCL-004 | Phase 18 (quick win) | ✅ |
| Sequential embedding `for` loop | KI-055 / SCL-005 | Phase 18 (quick win, also moot — incremental-embedding is dead code) | ✅ |
| In-memory rate limiter resets | KI-027 / SEC-012 | Phase 18 (DB-backed rate limiter) | ✅ |
| SSE session store unbounded | KI-028 / SEC-013 | Phase 18 | ✅ |
| §F Per-tenant token budget | KI-058 / SEC-006 / SCL-006 | Phase 18 (the highest-ROI fix per audit) | ✅ |

**All 8 quantified ceilings traceable.** ✅

### 3.4 `code-quality-audit.md` — 30-item tech-debt register

| Item bucket | TECH-DEBT.md ID | Phase home | Status |
|---|---|---|---|
| Quarantined `_disabled/` (15,367 LOC) | DEAD-CODE.md A.1-A.4 | Phase 9 (Purge `_disabled/` + ADRs) | ✅ |
| Active-but-dead 7 files (1,710 LOC) | DEAD-CODE.md B.1-B.7 | Phase 9 | ✅ |
| Schema dead artifacts (searchVector, supersededBy) | DEAD-CODE.md C.1-C.2 | Phase 0 (searchVector) + Phase 15 (supersededBy) | ✅ |
| 6 orphan 2025-04 migrations | DEAD-CODE.md D | Phase 1 (quarantine) + Phase 15 (rebuild) | ✅ |
| Root scratchpads + Mem0 docs | DEAD-CODE.md E | Phase 0 | ✅ |
| Broken `package.json` test scripts | TD-005 | Phase 9 | ✅ |
| Orphan exports in live files | DEAD-CODE.md G | Phase 9 | ✅ |
| 75 `any` casts | TD-012 | Opportunistic (Phase 9 starter, ongoing) | ✅ |
| 11 missing service unit tests | TD-009 | Gated, not batched | ✅ |
| 15/17 missing route integration tests | TD-010 | Gated, not batched | ✅ |
| Function-size violations (dispatch 121, synthesize 110, assembleContextForPersona 150) | TD-002, TD-025 | Phase 9 | ✅ |
| Three inline-LLM-prompt sites | TD-003, TD-004 | Phase 9 | ✅ |
| Doc drift (CURRENT-STATE vs CLAUDE.md, "26 vs 32 vs 34 models") | TD-007, TD-008 | Phase 9 | ✅ |
| Duplicated prompt-loader.ts and logger.ts | TD-021, TD-022 | Phase 9 (note: Phase 9 README says deferred to Phase 12) | ⚠️ inconsistency between TECH-DEBT.md and Phase 9 README |

**All 30 items have homes.** Coverage: ✅. One minor scope-drift between TECH-DEBT.md and `04-roadmap/PHASE-9-purge-disabled/README.md` on duplicated-shared-files.

### 3.5 Wave-1 research (`01-ops-scaling`, `02-security-best-practices`, `03-data-architecture`, `04-external-interfaces`)

All four research reports cited extensively in `03-research/ai-memory-sota.md`, the Phase READMEs (Phase 10 cites §1 of external-interfaces; Phase 11 cites §3-§4; Phase 14 cites the OTel ladder; Phase 18 cites §10 cost containment; Phase 19 cites §1 horizontal scaling). Bibliography in `03-research/sources.md` is comprehensive (50+ academic + vendor + repo entries).

**Net audit-traceability score: 100% on coverage, ~85% on phase-number consistency.**

---

## 4. Gaps to fix before sign-off

### 4.1 [CRITICAL] Phase numbering does not agree with itself

Three independent numbering schemes coexist:

- **Folder names** (`docs/roadmap/04-roadmap/`): Phase 0, 0.25, 0.5, 1, 2, 3, 4, 5a, 5b, 6, 7a, 9, 10, 11, 12-webhooks-event-bus, 13-sdk, 14-observability-suite, 15-migration-history, 16-cortex-isolation, 17-persona-marketplace, 18-resilience-multitenant-fairness, 19-horizontal-api-scale.
- **`ROADMAP-OVERVIEW.md` table** (and `MASTER-INDEX.md` and `EXECUTIVE-SUMMARY.md`): Phase 12 = SDK, Phase 13 = Observability, Phase 14 = Migration history, Phase 15 = Cortex isolation, Phase 16 = Knowledge graph deep. **Off by 2** vs the folders. Phases 17-19 are not mentioned at all.
- **`06-risks-and-mitigations/RISK-REGISTER.md`** maps risks to "Phase 11/12/13/14" naming a different scheme entirely (Phase 11 = Foundations + persistent queue; Phase 12 = Hardening; Phase 13 = RLS rollout; Phase 14 = Migration history). Same in COST-RISKS.md, DATA-RISKS.md, SECURITY-RISKS.md, OPERATIONAL-RISKS.md.
- **`02-current-state/KNOWN-ISSUES.md`** references "Phase 1.5", "Phase 1.6", "Phase 2.5", "Phase 17", "Pre-enterprise" as fix homes — none of which exist as folders.
- **Empty stub folders** for `PHASE-12-sdk/`, `PHASE-13-observability/`, `PHASE-14-migration-history/`, `PHASE-15-cortex-isolation/`, `PHASE-16-knowledge-graph-deep/`, `PHASE-7b-outcome-feedback/`, `PHASE-8-reranker/`, `PHASE-DEFERRED/` exist alongside the populated ones — they collide with the same numbers.

**Impact:** A future Claude session reading "DAT-001 fix lands in Phase 14" cannot tell whether to open `PHASE-14-observability-suite/` or `PHASE-15-migration-history/`. Risk register is unusable until reconciled.

**Where to fix:** Pick one canonical scheme. Recommendation: keep the folder names (they have content); rewrite ROADMAP-OVERVIEW.md, MASTER-INDEX.md, EXECUTIVE-SUMMARY.md, all 5 risk docs, KNOWN-ISSUES.md "Fix phase" column, and FEATURE-INDEX.md to match. Delete the empty stub folders. **Severity: CRITICAL — blocks operator usability.**

### 4.2 [HIGH] Phases 17-19 invisible from top-level navigation

The folder tree contains `PHASE-17-persona-marketplace/`, `PHASE-18-resilience-multitenant-fairness/`, `PHASE-19-horizontal-api-scale/` with full READMEs. None appear in `ROADMAP-OVERVIEW.md`, `MASTER-INDEX.md`, `EXECUTIVE-SUMMARY.md`, `STATUS/PHASE-PROGRESS-TRACKER.md`, or `STATUS/PHASE-COMPLETION-CRITERIA.md`. A user reading the executive summary literally cannot discover that Phase 18 exists.

**Where to fix:** Add Phases 17-19 to all five docs. Severity: HIGH.

### 4.3 [HIGH] MASTER-INDEX.md references files that don't exist

Spot-checked broken links in `MASTER-INDEX.md`:

- `02-current-state/SOPHISTICATION-RUBRIC.md` ❌
- `02-current-state/SCALE-CEILING.md` ❌
- `02-current-state/KNOWN-LIMITATIONS.md` ❌
- `06-risks-and-mitigations/SCALABILITY-RISKS.md` ❌ (the file is in `RISK-REGISTER.md` § Section 3, never extracted)
- `06-risks-and-mitigations/EVAL-RISKS.md` ❌
- `07-claude-instructions/SUBAGENT-PATTERNS.md` ❌
- `07-claude-instructions/SESSION-KICKOFF-TEMPLATE.md` ❌ (the file is `SESSION-START-CHECKLIST.md`)
- `07-claude-instructions/REPORTING-BACK.md` ❌
- `08-references/EXTERNAL-LINKS.md` ❌ (the file is `external-docs.md`)
- `05-features-to-10/markdown-export.md` ❌ (the file is `markdown-export-import.md`)

**Where to fix:** Either create the referenced files or fix the index. The MASTER-INDEX is supposed to be the authoritative way for any session to find any doc; broken links there break the entire navigation contract. Severity: HIGH.

### 4.4 [HIGH] `08-references/adrs/` is empty (only README)

`01-foundations/ADR-INDEX.md`, `MASTER-INDEX.md`, and `01-foundations/CONSTRAINTS.md` all reference `08-references/adrs/ADR-NNN-{slug}.md` for offline ADR copies. The folder contains only a README explaining "copies have not yet been extracted." 13 ADR copies missing. Severity: HIGH (any session offline from `docs/DECISIONS.md` is blocked).

### 4.5 [MED] "Pre-enterprise" and "Phase 1.5/1.6/2.5" referenced as fix homes that don't map to any folder

`02-current-state/KNOWN-ISSUES.md` rows KI-002, KI-010, KI-011, KI-013, KI-021, KI-073, KI-074, KI-078 cite "Phase 1.5" / "Phase 1.6" / "Phase 2.5" / "Pre-enterprise" as fix phases. These are leftover from the audit author's mental model. Either:
(a) Create stub `PHASE-1.5/`, `PHASE-1.6/`, `PHASE-2.5/` folders (recommended — these are the audit's "before doing big work, defuse these landmines" phases), OR
(b) Rewrite KNOWN-ISSUES.md to map them to the existing Phase 0.25 (which already absorbed most of the security/data fixes per its README) and Phase 1 (which absorbed the migration-foundation work per its README Track A).

Either way, the cross-references must resolve. Severity: MED.

### 4.6 [MED] `STATUS/PHASE-PROGRESS-TRACKER.md` and `PHASE-COMPLETION-CRITERIA.md` use the older overview numbering

Both `STATUS/` files stop at Phase 16 and use the original ROADMAP-OVERVIEW numbering (Phase 12 = SDK, Phase 13 = Observability, etc.). Phases 17-19 not present. When 4.1 is fixed, these get rewritten too. Severity: MED.

### 4.7 [MED] Phase time estimates contradict between folder READMEs and ROADMAP-OVERVIEW

- Phase 10 README says "4-6 weeks (research-validated; original 2w estimate was wrong)." `ROADMAP-OVERVIEW.md` table still says 2w.
- Phase 11 README says "3-4 weeks." Overview says 1w.
- Phase 13 (SDK) README says "3-4 weeks." Overview says 1.5w.
The cumulative roadmap calendar in EXECUTIVE-SUMMARY ("p50 = 24 weeks total. p90 = 30 weeks") is not consistent with the per-phase revisions. Severity: MED — affects scope-negotiation rules and user expectation-setting.

### 4.8 [LOW] Empty duplicate phase folders

`PHASE-12-sdk/`, `PHASE-13-observability/`, `PHASE-14-migration-history/`, `PHASE-15-cortex-isolation/`, `PHASE-16-knowledge-graph-deep/`, `PHASE-7b-outcome-feedback/`, `PHASE-8-reranker/`, `PHASE-DEFERRED/` all exist and are empty (verified via `Glob docs/roadmap/04-roadmap/PHASE-*/*`). They appear to be artifacts of the original numbering scheme that the builder later renumbered. They confuse `ls` output and may shadow intended content. Severity: LOW — delete them.

### 4.9 [LOW] DEFERRED specs reference Phase numbers that conflict with folders

`04-roadmap/DEFERRED/phase-7b-outcome-feedback.md` and `phase-8-reranker.md` exist as deferred specs. Folders `PHASE-7b-outcome-feedback/` and `PHASE-8-reranker/` also exist (empty). The right pattern (deferred lives only in `DEFERRED/`) holds, but the empty phase folders need to be deleted.

### 4.10 [LOW] No COST-MODEL → ROADMAP-OVERVIEW reconciliation on the SDK/markdown/MCP order

`01-foundations/COST-MODEL.md` references the cumulative cost-impact tables phase-by-phase but uses the original numbering. After 4.1 is fixed, COST-MODEL needs a sweep. Severity: LOW.

---

## 5. Completeness scoring

| Section | Coverage | Notes |
|---|---|---|
| Foundations (01-) | **95%** | All 7 files present and substantive. Minor: ADR copies in 08-references are placeholder. |
| Current state (02-) | **100%** | CAPABILITIES-INVENTORY, ARCHITECTURE-MAP, KNOWN-ISSUES (79 IDs), LANDMINES (10), DEAD-CODE, TECH-DEBT all comprehensive. Best section in the roadmap. |
| Research (03-) | **100%** | INDEX + 4 synthesis docs + sources.md. ai-memory-sota and mem0-decomposition are particularly strong. |
| Roadmap phases (04-) | **80%** | All ~21 active phases have READMEs. DEFERRED catalogue complete with measurable triggers. **Numbering inconsistency is the dominant defect** (§4.1, §4.2, §4.7). 8 empty stub folders (§4.8). |
| Features (05-) | **95%** | 14 specs + index. Spec quality varies — memory-mcp-server and markdown-export-import are publication-ready; some are skeletal. FEATURE-INDEX phase column uses inconsistent numbering. |
| Risks (06-) | **90%** | 5 risk-class docs + register + 6mo + 12mo forecasts. RISK-REGISTER.md is exemplary. **Phase numbering uses an entirely separate scheme** that doesn't match the folders. |
| Claude instructions (07-) | **95%** | 11 files cover workflow, load order, handoff, prompts, agents pipeline, common pitfalls, session start/end, agent dispatch, commit/PR, eval harness usage. CLAUDE-WORKFLOW.md is well-shaped. CONTEXT-LOAD-ORDER.md actually usable. |
| References (08-) | **60%** | codebase-map.md, external-docs.md, repo-tour.md present. **`adrs/` folder contains only README — 13 ADR copies missing** (§4.4). |
| STATUS (09-) | **80%** | All 6 files present. CURRENT-PHASE, BLOCKERS, CHANGELOG, DECISIONS-LOG live (3 entries each). PHASE-PROGRESS-TRACKER and PHASE-COMPLETION-CRITERIA stop at Phase 16 (§4.6). |

**Overall completeness: ~90%** on content; ~75% on internal consistency. Conservative final: **APPROVE-WITH-GAPS**.

---

## 6. Recommendations for Wave 4 (final validator)

The final validator must do the following before sign-off, in priority order:

1. **Pick the canonical phase numbering scheme and rewrite every doc to match.** The folder names are the most expensive to change (rename impacts STATUS/, MASTER-INDEX, all cross-refs in current-state/), so use them as canonical. Sweep:
   - `ROADMAP-OVERVIEW.md` per-phase table + dependency graph + calendar + DEFERRED reentry table
   - `EXECUTIVE-SUMMARY.md` "Phases 0, 0.25, 14 (pulled forward)" + "Phases 1, 2, 3, 4, 5a, 5b, 6, 7a, 9" + "Phases 10, 11, 12, 13" + "Phases 15, 16" — rewrite
   - `MASTER-INDEX.md` "I want to understand the plan" table
   - All 5 docs in `06-risks-and-mitigations/` — find every "Phase 11/12/13/14" reference and remap
   - `02-current-state/KNOWN-ISSUES.md` Fix phase column (resolve "Phase 1.5/1.6/2.5/Pre-enterprise" per §4.5)
   - `02-current-state/CAPABILITIES-INVENTORY.md` §L roadmap-mapping table
   - `02-current-state/TECH-DEBT.md` Fix phase column
   - `05-features-to-10/FEATURE-INDEX.md` Phase column
   - `STATUS/PHASE-PROGRESS-TRACKER.md` and `STATUS/PHASE-COMPLETION-CRITERIA.md` — extend through Phase 19
   - `01-foundations/COST-MODEL.md` per-phase cost-impact tables
   - `01-foundations/SUCCESS-METRICS.md` per-phase exit criteria summary

2. **Delete the 8 empty phase folders** (PHASE-12-sdk, PHASE-13-observability, PHASE-14-migration-history, PHASE-15-cortex-isolation, PHASE-16-knowledge-graph-deep, PHASE-7b-outcome-feedback, PHASE-8-reranker, PHASE-DEFERRED). The DEFERRED specs already live correctly in `04-roadmap/DEFERRED/`.

3. **Add Phases 17, 18, 19 to ROADMAP-OVERVIEW.md** per-phase table, dependency graph, calendar, and per `STATUS/PHASE-PROGRESS-TRACKER.md` and `STATUS/PHASE-COMPLETION-CRITERIA.md`.

4. **Fix MASTER-INDEX.md broken links** (§4.3). Either create the missing files (SOPHISTICATION-RUBRIC, SCALE-CEILING, KNOWN-LIMITATIONS, EVAL-RISKS, SUBAGENT-PATTERNS, REPORTING-BACK) — note that most of their content already exists as sections of larger files (CAPABILITIES-INVENTORY, RISK-REGISTER, CLAUDE-WORKFLOW), so extraction is the cheaper option — or remove the index rows. Rename `external-docs.md` → `EXTERNAL-LINKS.md` (or fix the index), `markdown-export.md` → match the actual filename.

5. **Extract 13 ADR copies into `08-references/adrs/`** (per §4.4). One file per ADR, copied from `docs/DECISIONS.md`. This is the offline-reference promise from `01-foundations/ADR-INDEX.md` step 6.

6. **Reconcile time estimates.** Phases 10, 11, 13 README budgets exceed ROADMAP-OVERVIEW.md by 2-3 weeks each. Either revise the overview's totals (likely pushing p90 from 30 weeks to 36-40) or revise the per-phase READMEs.

7. **Add a single "phase number map" appendix** to `ROADMAP-OVERVIEW.md` that explicitly states "the audits sometimes refer to Phase 11/12/13/14 — that maps to our Phase X/Y/Z." Pre-empts confusion when readers cross to risk docs.

8. **Update `STATUS/CHANGELOG.md` and `STATUS/DECISIONS-LOG.md` with a Wave 4 entry** documenting the renumbering.

If Wave 4 ships these eight items, the roadmap is shippable as the operator manual for the next 16-30 weeks of execution. Without them, Claude sessions will stall on phase-number ambiguity within the first hour of any non-Phase-0 work.

---

**End of completeness review. Word count: ~2,050.**
