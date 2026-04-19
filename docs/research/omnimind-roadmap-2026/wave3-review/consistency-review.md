# Wave 3 Reviewer 2 — Consistency Review

**Reviewer:** Reviewer 2 (Consistency)
**Date:** 2026-04-18
**Scope:** Every file under `docs/roadmap/`
**Question answered:** Does the roadmap conflict with itself across the 8 parallel builder outputs?

---

## 1. Verdict (100 words)

**APPROVE-WITH-FIXES.** The roadmap is intellectually coherent — the same ideas, the same phases, the same risk taxonomy show up everywhere — but the *labels and identifiers* drifted badly between the 8 parallel builders. Phases 12-16 have **two competing numbering schemes** that disagree about which folder is the SDK vs. webhooks vs. observability. MASTER-INDEX points at a dozen files that don't exist. RISK-REGISTER uses fictitious phases (11, 12, 13 with completely different meanings than the folders). Landmine IDs use two formats. ADR target phases are wrong. Five empty old-numbering folders sit alongside their renamed replacements. Every one of these is mechanical to fix; the validator should treat this as an hour of careful sed-and-link work, not a re-architecture. None of the conflicts invalidates the underlying plan.

---

## 2. Phase-numbering audit

The single biggest consistency failure. Two schemes coexist; they disagree on Phases 11-16.

| Phase # | Folder name (filesystem) | Cited in (files) as ... | Conflicting names | Reconciliation |
|---|---|---|---|---|
| 0 | `PHASE-0-foundation/` | Foundation cleanup (everywhere) | none | ✅ consistent |
| 0.25 | `PHASE-0.25-critical-fixes/` | "Critical fixes" (EXECUTIVE-SUMMARY, COST-MODEL, BLOCKERS, PHASE-PROGRESS-TRACKER, PHASE-COMPLETION-CRITERIA) | NOT in ROADMAP-OVERVIEW.md timeline or per-phase summary table | Add Phase 0.25 row to ROADMAP-OVERVIEW.md |
| 0.5 | `PHASE-0.5-eval-harness/` | Eval harness (everywhere) | none | ✅ consistent |
| 1 | `PHASE-1-schema-alignment/` | Schema alignment (everywhere) | none | ✅ consistent |
| 1.5 | (no folder) | Persistent embedding queue (KNOWN-ISSUES KI-002, KI-011; LANDMINES L3 "Phase 1.5") | NO FOLDER EXISTS | Either create folder OR re-home KI-002/011 into PHASE-1 or PHASE-0.25 |
| 1.6 | (no folder) | Optimistic concurrency (KI-010, KI-021; LANDMINES L4) | NO FOLDER EXISTS | Same — reroute to PHASE-1 or PHASE-0.25 |
| 2 | `PHASE-2-pattern-extraction/` | Pattern extraction (everywhere) | none | ✅ consistent |
| 2.5 | (no folder) | Security hardening (LANDMINES L5/L6/L7/L9 "Phase 2.5"; KI-004/005/007/024 "Phase 2.5") | NO FOLDER EXISTS — these were rolled into PHASE-0.25 | Update LANDMINES + KNOWN-ISSUES "Fix phase" column to PHASE-0.25 |
| 3 | `PHASE-3-hnsw-rrf/` | HNSW + RRF (everywhere) | none | ✅ consistent |
| 4 | `PHASE-4-graph-traversal/` | Graph traversal (ROADMAP-OVERVIEW, GLOSSARY) | LANDMINES L2 calls "Phase 4 (Collaboration / multi-user rooms)" — different concept | Pick one definition; "Collaboration" Phase 4 was the OLD product roadmap; the new Phase 4 is graph traversal. Update LANDMINES + KNOWN-ISSUES |
| 5a | `PHASE-5a-llm-augmentation/` | LLM augmentation (everywhere) | none | ✅ consistent |
| 5b | `PHASE-5b-llm-consolidation/` | LLM consolidation (everywhere) | none | ✅ consistent |
| 5 (no suffix) | (no folder) | "Cortex Pro" (KI-019, KI-048, KI-067-071) | Ambiguous — KI rows say "Phase 5" but folders are 5a/5b | Update KNOWN-ISSUES "Fix phase" to 5a or 5b explicitly |
| 6 | `PHASE-6-entity-ranker-boost/` | Entity ranker (everywhere) | none | ✅ consistent |
| 7a | `PHASE-7a-recency-access/` | Recency/access (everywhere) | none | ✅ consistent |
| 7b | `PHASE-7b-outcome-feedback/` (EMPTY) + `DEFERRED/phase-7b-outcome-feedback.md` | Deferred everywhere | Folder exists empty; real spec lives in DEFERRED/ | Delete the empty PHASE-7b folder OR move spec into it |
| 8 | `PHASE-8-reranker/` (EMPTY) + `DEFERRED/phase-8-reranker.md` | Deferred everywhere | Same as 7b | Same fix |
| 9 | `PHASE-9-purge-disabled/` | Purge `_disabled/` (everywhere) | none | ✅ consistent |
| 10 | `PHASE-10-mcp-server/` | MCP server (everywhere) | none | ✅ consistent |
| 11 | `PHASE-11-markdown-export/` | Markdown export (ROADMAP-OVERVIEW, MASTER-INDEX, EXECUTIVE-SUMMARY, FEATURE-INDEX) | RISK-REGISTER §6 calls Phase 11 "Foundations / Observability / Cost & Queue" — different surface entirely | This is the CORE conflict. Two builder outputs (Builder 2b and Builder 4) used "Phase 11" for different things. Builder 2b's filesystem is canonical; rewrite RISK-REGISTER §6 to use the actual numbering |
| 12 | `PHASE-12-webhooks-event-bus/` (real) + `PHASE-12-sdk/` (EMPTY ghost) | (1) ROADMAP-OVERVIEW, MASTER-INDEX, EXECUTIVE-SUMMARY, COST-MODEL, PHASE-PROGRESS-TRACKER, PHASE-COMPLETION-CRITERIA, SUCCESS-METRICS = "Public TypeScript SDK" (1.5w). (2) Real folder + PHASE-17 README + FEATURE-INDEX = "Webhooks & Event Bus" (2w). (3) RISK-REGISTER + SECURITY-RISKS = "Hardening" | Three different meanings | Builder 2b's intent is canonical (12 = Webhooks). Delete empty PHASE-12-sdk folder. Update ROADMAP-OVERVIEW, MASTER-INDEX, EXECUTIVE-SUMMARY, COST-MODEL, PHASE-PROGRESS-TRACKER, PHASE-COMPLETION-CRITERIA, SUCCESS-METRICS, RISK-REGISTER all to Phase 12 = Webhooks. Renumber every "see Phase 12 (SDK/Hardening)" reference accordingly |
| 13 | `PHASE-13-sdk/` (real) + `PHASE-13-observability/` (EMPTY ghost) | (1) ROADMAP-OVERVIEW, MASTER-INDEX, EXECUTIVE-SUMMARY, COST-MODEL, PHASE-PROGRESS-TRACKER, PHASE-COMPLETION-CRITERIA, SUCCESS-METRICS, FEATURE-INDEX = "Observability suite" (2w). (2) Real folder + PHASE-17 README + FEATURE-INDEX (separately) = "Public TypeScript SDK" (3-4w). (3) RISK-REGISTER + SECURITY-RISKS = "RLS rollout, GDPR, Cron isolation, Workers" | Three different meanings | Builder 2b's intent is canonical (13 = SDK). Delete empty PHASE-13-observability folder. Same global rename as Phase 12 |
| 14 | `PHASE-14-observability-suite/` (real) + `PHASE-14-migration-history/` (EMPTY ghost) | (1) ROADMAP-OVERVIEW, MASTER-INDEX, EXECUTIVE-SUMMARY, COST-MODEL, PHASE-PROGRESS-TRACKER, PHASE-COMPLETION-CRITERIA, SUCCESS-METRICS, KNOWN-ISSUES, LANDMINES, ADR-INDEX (ADR-019), TECH-DEBT, FEATURE-INDEX (per-tenant cost controls) = "Migration history" (1w). (2) Real folder + PHASE-16 README + FEATURE-INDEX (observability) = "Observability suite" (2w). (3) RISK-REGISTER + SECURITY-RISKS = "Migration history, HNSW, multi-instance enablers" | Three different meanings | Builder 2b's intent is canonical (14 = Observability). Delete empty PHASE-14-migration-history folder. Same global rename |
| 15 | `PHASE-15-migration-history/` (real) + `PHASE-15-cortex-isolation/` (EMPTY ghost) | (1) ROADMAP-OVERVIEW, MASTER-INDEX, EXECUTIVE-SUMMARY, COST-MODEL, PHASE-PROGRESS-TRACKER, PHASE-COMPLETION-CRITERIA, SUCCESS-METRICS, ADR-INDEX (ADR-020), FEATURE-INDEX (advanced cortex) = "Cortex isolation" (2w). (2) Real folder + PHASE-16 README = "Migration history" (1w) | Two meanings | Builder 2b's intent is canonical (15 = Migration history). Delete empty PHASE-15-cortex-isolation folder. Same global rename |
| 16 | `PHASE-16-cortex-isolation/` (real) + `PHASE-16-knowledge-graph-deep/` (EMPTY ghost) | (1) ROADMAP-OVERVIEW, MASTER-INDEX, EXECUTIVE-SUMMARY, COST-MODEL, PHASE-PROGRESS-TRACKER, PHASE-COMPLETION-CRITERIA, SUCCESS-METRICS, FEATURE-INDEX (KG deep) = "Knowledge graph deep" (3w). (2) Real folder + PHASE-17 + PHASE-18 = "Cortex isolation" (2w) | Two meanings | Builder 2b's intent is canonical (16 = Cortex isolation). Delete empty PHASE-16-knowledge-graph-deep folder. Move KG deep to a NEW Phase 20+ slot or keep it as feature-only spec |
| 17 | `PHASE-17-persona-marketplace/` | Persona marketplace (FEATURE-INDEX, PHASE-18 README) | DEFERRED/README.md DEF-014 says marketplace is DEFERRED with trigger "≥5 customer requests" | Direct contradiction. Pick one: either marketplace is an active Phase 17 OR it's deferred until 5 requests. Probably the latter — remove PHASE-17 folder, keep DEF-014 |
| 18 | `PHASE-18-resilience-multitenant-fairness/` | Resilience (FEATURE-INDEX "multi-tenant teams Phase 18+", PHASE-19 README) | NOT mentioned in ROADMAP-OVERVIEW timeline, EXECUTIVE-SUMMARY tracks, MASTER-INDEX, PHASE-PROGRESS-TRACKER, PHASE-COMPLETION-CRITERIA, SUCCESS-METRICS, COST-MODEL | Add Phase 18 everywhere |
| 19 | `PHASE-19-horizontal-api-scale/` | Horizontal scale | NOT mentioned in ROADMAP-OVERVIEW, EXECUTIVE-SUMMARY, MASTER-INDEX, PHASE-PROGRESS-TRACKER, PHASE-COMPLETION-CRITERIA, SUCCESS-METRICS, COST-MODEL | Same as 18 |

**Pre-enterprise / "beyond 14"** — referenced as a fix phase in KNOWN-ISSUES (KI-013, KI-073, KI-074, KI-078) and RISK-REGISTER (SEC-022, SEC-023, SEC-025, OPS-001) but no folder exists. Treat as DEFERRED/ catch-all.

---

## 3. Empty / duplicate folders to clean up

### Empty old-numbering ghost folders (5 to delete after the rename)

| Folder | Action |
|---|---|
| `04-roadmap/PHASE-12-sdk/` (empty) | Delete (real Phase 12 = webhooks; SDK is now Phase 13) |
| `04-roadmap/PHASE-13-observability/` (empty) | Delete (real Phase 13 = SDK; observability is now Phase 14) |
| `04-roadmap/PHASE-14-migration-history/` (empty) | Delete (real Phase 14 = observability; migration history is now Phase 15) |
| `04-roadmap/PHASE-15-cortex-isolation/` (empty) | Delete (real Phase 15 = migration history; cortex isolation is now Phase 16) |
| `04-roadmap/PHASE-16-knowledge-graph-deep/` (empty) | Delete (real Phase 16 = cortex isolation; KG deep has no phase number — only `05-features-to-10/knowledge-graph-deep.md`) |

### Empty deferred-phase folders (3 with content elsewhere)

| Folder | Action |
|---|---|
| `04-roadmap/PHASE-7b-outcome-feedback/` (empty) | Delete; canonical spec lives at `04-roadmap/DEFERRED/phase-7b-outcome-feedback.md` |
| `04-roadmap/PHASE-8-reranker/` (empty) | Delete; canonical spec at `04-roadmap/DEFERRED/phase-8-reranker.md` |
| `04-roadmap/PHASE-DEFERRED/` (empty) | Delete; the real DEFERRED is `04-roadmap/DEFERRED/` (no PHASE- prefix) — this is a duplicate name with no content |

### Folder-content overlap (1 case)

- `04-roadmap/PHASE-17-persona-marketplace/` (full README + tasks) **contradicts** `04-roadmap/DEFERRED/persona-marketplace.md` (says deferred until ≥5 customer requests). Pick one and delete the other.

---

## 4. Cross-reference audit

Sampled 35 cross-references (link paths, "see X-NNN" identifiers, "Phase N" mentions). Verified each.

| Citing file | Reference | Target exists? | Match correct? |
|---|---|---|---|
| MASTER-INDEX.md | `02-current-state/SOPHISTICATION-RUBRIC.md` | ❌ NO | — |
| MASTER-INDEX.md | `02-current-state/SCALE-CEILING.md` | ❌ NO | — |
| MASTER-INDEX.md | `02-current-state/KNOWN-LIMITATIONS.md` | ❌ NO | — |
| MASTER-INDEX.md | `06-risks-and-mitigations/SCALABILITY-RISKS.md` | ❌ NO | — |
| MASTER-INDEX.md | `06-risks-and-mitigations/EVAL-RISKS.md` | ❌ NO | — |
| MASTER-INDEX.md | `07-claude-instructions/SESSION-KICKOFF-TEMPLATE.md` | ❌ NO | — |
| MASTER-INDEX.md | `07-claude-instructions/SUBAGENT-PATTERNS.md` | ❌ NO | — |
| MASTER-INDEX.md | `07-claude-instructions/REPORTING-BACK.md` | ❌ NO | — |
| MASTER-INDEX.md | `05-features-to-10/markdown-export.md` | ❌ NO (real file is `markdown-export-import.md`) | — |
| MASTER-INDEX.md | `08-references/EXTERNAL-LINKS.md` | ❌ NO (real file is `external-docs.md`) | — |
| MASTER-INDEX.md | `04-roadmap/PHASE-12-sdk/` | ❌ EMPTY | wrong — should be PHASE-12-webhooks-event-bus + PHASE-13-sdk |
| MASTER-INDEX.md | `04-roadmap/PHASE-13-observability/` | ❌ EMPTY | wrong — should be PHASE-14-observability-suite |
| MASTER-INDEX.md | `04-roadmap/PHASE-14-migration-history/` | ❌ EMPTY | wrong — should be PHASE-15-migration-history |
| MASTER-INDEX.md | `04-roadmap/PHASE-15-cortex-isolation/` | ❌ EMPTY | wrong — should be PHASE-16-cortex-isolation |
| MASTER-INDEX.md | `04-roadmap/PHASE-16-knowledge-graph-deep/` | ❌ EMPTY | KG deep has no phase folder; only feature spec |
| EXECUTIVE-SUMMARY.md | "Phase 13 fixes this" (observability) | ✓ via Phase 14 (real) | wrong number — say Phase 14 |
| EXECUTIVE-SUMMARY.md | "Phases 10-12 add them" (MCP, SDK, markdown) | partially — SDK is now Phase 13 | wrong — say "Phases 10, 11, 13" |
| EXECUTIVE-SUMMARY.md | `06-risks-and-mitigations/RISK-REGISTER.md` | ✓ EXISTS | ✓ |
| EXECUTIVE-SUMMARY.md | "Phase 14 defuses [`db push`]" | ✓ via Phase 15 (real) | wrong number — say Phase 15 |
| ROADMAP-OVERVIEW.md | `06-risks-and-mitigations/DATA-RISKS.md` | ✓ EXISTS | ✓ |
| ROADMAP-OVERVIEW.md | "Phase 14 (migration history)" critical-path note | ✓ via Phase 15 (real) | wrong number |
| RISK-REGISTER.md | "Phase 11 (Foundations / Observability / Cost & Queue)" | ❌ Phase 11 folder = markdown export, NOT foundations | wrong — Builder 4 used a fictitious numbering |
| RISK-REGISTER.md | "Phase 12 (Hardening)" | ❌ Phase 12 folder = webhooks, NOT hardening | wrong — Builder 4's Phase 12 maps to Phase 0.25 |
| RISK-REGISTER.md | "Phase 13 (RLS rollout)" | ❌ Phase 13 folder = SDK, NOT RLS | wrong — likely maps to Phase 18 |
| RISK-REGISTER.md | "see LANDMINE-A1" | ❌ LANDMINES uses L1..L10, not LANDMINE-A1 | wrong format |
| RISK-REGISTER.md | "see LANDMINE-A2" | ❌ Same | wrong format |
| RISK-REGISTER.md | "see LANDMINE-D1" | ❌ Same | wrong format |
| RISK-REGISTER.md | "see LANDMINE-A4" | ❌ Same | wrong format |
| RISK-REGISTER.md | "see LANDMINE-stripe-webhook-broken" | ❌ Format mismatch entirely | wrong format |
| LANDMINES.md | "see [`KNOWN-ISSUES.md`](KNOWN-ISSUES.md)" | ✓ EXISTS | ✓ |
| LANDMINES.md | "Roadmap home: Phase 14" (L1) | ✓ via Phase 15 (real) | wrong number |
| LANDMINES.md | "Roadmap home: Phase 1.5" (L3) | ❌ NO PHASE 1.5 FOLDER | needs reroute |
| LANDMINES.md | "Roadmap home: Phase 1.6" (L4) | ❌ NO PHASE 1.6 FOLDER | needs reroute |
| LANDMINES.md | "Roadmap home: Phase 2.5" (L5/L6/L7/L9) | ❌ NO PHASE 2.5 FOLDER | likely PHASE-0.25 |
| LANDMINES.md | "Roadmap home: Phase 17" (L10) | ✓ folder exists, but L10 says "fails-open" while Phase 17 is marketplace | wrong target |
| PHASE-0-foundation/README.md | "see LM-03 dead column" | ❌ LANDMINES uses L1..L10, no LM-03 | wrong format (and LM-03 isn't a thing — searchVector is mentioned in L1 indirectly) |
| FEATURE-INDEX.md | persona-marketplace "Phase 17 PLANNED" | ✓ folder exists | conflicts with DEF-014 in DEFERRED |
| FEATURE-INDEX.md | per-tenant cost controls "Phase 14" | ❌ Phase 14 folder = observability | wrong — cost controls live conceptually in Phase 0.25 + Phase 18 |
| FEATURE-INDEX.md | observability suite "Phase 13" | ❌ Phase 13 folder = SDK | wrong — should be Phase 14 |
| FEATURE-INDEX.md | webhooks "Phase 13 (ship before SDK)" | ❌ contradicts itself in same row | should be Phase 12 (real) |
| FEATURE-INDEX.md | public-sdk "Phase 12" | ❌ Phase 12 folder = webhooks | should be Phase 13 |
| FEATURE-INDEX.md | knowledge-graph-deep "Phase 16" | ❌ Phase 16 folder = cortex isolation | KG deep has no phase folder anymore |
| FEATURE-INDEX.md | advanced-cortex "Phase 15" | ❌ Phase 15 folder = migration history | wrong target |
| MASTER-INDEX.md | `08-references/adrs/` directory | ✓ EXISTS but contains only README.md (no actual ADR copies) | promise broken |
| ADR-INDEX.md | "ADR-019 ... End of Phase 14" (migration history baseline) | ✓ via Phase 15 (real) | wrong number |
| ADR-INDEX.md | "ADR-020 ... End of Phase 15" (cortex isolation) | ✓ via Phase 16 (real) | wrong number |

**Verdict on cross-references:** ~40% of sampled cross-refs are broken. The breakage is concentrated in three classes: (a) MASTER-INDEX promised files that builders didn't produce, (b) phase-number drift between Builder 2b and the rest of the roadmap, (c) LANDMINE ID format mismatch (L1..L10 vs LANDMINE-A1..D1 etc.).

---

## 5. Terminology drift

| Concept | Variants used | Citation count | Recommended canonical name |
|---|---|---|---|
| Reciprocal Rank Fusion | "RRF", "Reciprocal Rank Fusion", "RRF fusion" | 12+ | **RRF** (defined in GLOSSARY) |
| Weighted score combination | "weighted fusion", "weighted score combination", "weighted" (in `RANKER_MODE=rrf|weighted`) | 8+ | **weighted fusion** (matches GLOSSARY + ROADMAP-OVERVIEW) |
| Bi-temporal model | "bi-temporal-lite", "bi-temporal lite", "bi-temporal-lite scaffolding", "bi-temporal" | 9+ | **bi-temporal-lite** (with hyphen — matches GLOSSARY definition that pairs `validAt`/`invalidAt`/`supersededBy`) |
| Eval harness | "eval harness", "retrieval eval harness", "eval-driven" | 14+ | **eval harness** |
| Memory write loop | "ADD/UPDATE/DELETE/NOOP", "ADD / UPDATE / DELETE / NOOP", "write-decision loop", "ADD/UPDATE/DELETE/NOOP loop" | 11+ | **ADD/UPDATE/DELETE/NOOP loop** (no spaces, slash-separated, matches GLOSSARY) |
| Vector-graph index | "HNSW", "HNSW index", "Hierarchical Navigable Small World" | 8+ | **HNSW** (defined in GLOSSARY) |
| MCP exposure | "Memory MCP server", "MCP server", "memory-as-MCP" | 10+ | **Memory MCP server** (matches feature spec title) |
| Public SDK | "Public TypeScript SDK", "Public SDK", "@omnimind/sdk", "TS SDK" | 9+ | **Public TypeScript SDK** (matches Phase 13 README + feature spec) |
| Cortex isolation | "Cortex isolation", "Cortex moves to separate Railway service", "cortex worker service" | 7+ | **Cortex isolation** (matches Phase 16 README) |
| Migration history phase | "Migration history", "baseline migration", "defuse the `prisma db push` landmine" | 6+ | **Migration history** (matches Phase 15 README title) |
| OAuth-callback hijack | "SEC-001", "OAuth state hijack", "OAuth callback hijack", "L5", "KI-004", "A1" | 8+ | Use **SEC-001** as primary; cross-link to L5 (LANDMINES) and KI-004 (KNOWN-ISSUES) |
| Stripe webhook break | "SEC-002 / DAT-004", "Stripe webhook broken", "L6", "KI-005" | 7+ | Use **SEC-002 + DAT-004** pair; cross-link L6, KI-005 |
| Embedding queue loss | "in-process embedding queue", "L3", "KI-002", "DAT-002" | 6+ | Use **DAT-002** as primary; cross-link L3, KI-002 |

Most terminology is healthy. The danger zone is the **landmine ↔ KI ↔ risk register triple**: the same defect has three IDs depending on which doc you're in. Validator should add a "see also" cross-link block in RISK-REGISTER explicitly mapping LANDMINE Lx ↔ KI-NNN ↔ SEC/DAT/SCL/OPS-NNN.

---

## 6. Time budget conflicts

Phases where time estimates disagree between docs:

| Phase | ROADMAP-OVERVIEW says | Phase README says | EXECUTIVE-SUMMARY track | Reconciliation |
|---|---|---|---|---|
| 9 | 0.5w | 1.5 days | (in 0.5w bucket) | Same — ~0.5 working week. Just differ in unit. ✓ |
| 10 | 2w | **4-6 weeks** ("research-validated; original 2w underestimated") | 6-10w bucket | Phase README is canonical (4-6w). Update ROADMAP-OVERVIEW. |
| 11 | 1w | **3-4 weeks** ("research-validated; original 1w estimate did not account for vault-layout design") | (6-10w bucket) | Phase README is canonical (3-4w). Update ROADMAP-OVERVIEW. |
| 12 (canonical = Webhooks) | 1.5w (but listed as SDK!) | 2w (Webhooks README) | (6-10w bucket says SDK is in Phase 12) | Reset entire row: Phase 12 = Webhooks @ 2w |
| 13 (canonical = SDK) | 2w (but listed as Observability!) | **3-4 weeks** (SDK README says original 1.5w was wrong) | — | Reset: Phase 13 = SDK @ 3-4w |
| 14 (canonical = Observability) | 1w (listed as Migration history!) | 2w (Observability README) | (Make-it-10 6-10w bucket) | Reset: Phase 14 = Observability @ 2w |
| 15 (canonical = Migration history) | 2w (listed as Cortex isolation!) | 1w (Migration history README) | (5-8w Scale prep bucket) | Reset: Phase 15 = Migration history @ 1w |
| 16 (canonical = Cortex isolation) | 3w (listed as KG deep!) | 2w (Cortex isolation README) | (5-8w bucket) | Reset: Phase 16 = Cortex isolation @ 2w |
| 17 (Persona marketplace OR deferred) | not in OVERVIEW | 4-6 weeks (Phase 17 README) | not in EXECUTIVE-SUMMARY tracks | If shipping: add 4-6w. If deferred: remove the folder. |
| 18 (Resilience) | not in OVERVIEW | 2 weeks | not in EXECUTIVE-SUMMARY tracks | Add 2w to OVERVIEW + EXEC-SUM scale-prep bucket |
| 19 (Horizontal scale) | not in OVERVIEW | 3 weeks | not in EXECUTIVE-SUMMARY tracks | Add 3w to OVERVIEW + EXEC-SUM |

**Total roadmap calendar estimate** in EXECUTIVE-SUMMARY says "p50 = 24 weeks total. p90 = 30 weeks." but if Phase 10 is 4-6w (not 2w), Phase 11 is 3-4w (not 1w), Phase 13 is 3-4w (not 1.5w), the make-it-10 stretch alone is ~12-17 weeks not 6-10w. **Headline estimate is ~5-7 weeks low.** The validator should refresh either the per-phase estimates (compress to original) OR the headline calendar (extend to ~28-37 weeks p50/p90).

---

## 7. Severity scale conflicts

Two scales coexist:

| Doc | Scale used | Notes |
|---|---|---|
| KNOWN-ISSUES.md | "1=catastrophic / 2=high / 3=medium / 4=low / 5=cosmetic" | Numeric 1-5 |
| LANDMINES.md | "severity 1 / severity 2 / severity 3" (referenced in headers) | Numeric 1-3, no 4/5 |
| TECH-DEBT.md | "1 = catastrophic · 2 = high · 3 = medium · 4 = low · 5 = cosmetic" | Same as KNOWN-ISSUES (numeric 1-5) |
| RISK-REGISTER.md | "Severity — 1 catastrophic / 2 high / 3 medium / 4 low / 5 cosmetic" + Sev column = 1, 2, 3, 4, 5 | Same numeric 1-5. ✓ |
| SECURITY-RISKS.md | "Severity: 1/5 (catastrophic)", "Severity: 3/5", etc. | Numeric 1-5 written as fractions. ✓ semantically same |
| ROADMAP-OVERVIEW.md / per-phase READMEs | "Confidence: HIGH / MED / LOW" (different axis — confidence not severity) | Three-bucket qualitative |
| Phase READMEs | "Blast radius: Low / Medium / High" (different axis) | Three-bucket qualitative |

**Verdict:** Severity scale itself is consistent (1-5 numeric across all primary catalogs). The minor drift is LANDMINES.md only using 1/2/3 (no row reaches 4 or 5), but that's truncation not conflict — the scale is the same 1-5. **No fix required.** Confidence and blast-radius are correctly separate axes from severity.

---

## 8. ADR reference conflicts

ADR identifier format is **mostly** consistent:

| Format | Where used | Count |
|---|---|---|
| `ADR-001`, `ADR-013` (zero-padded to 3 digits with hyphen) | ADR-INDEX, CONSTRAINTS, every feature spec, Phase 17 README, GLOSSARY | dominant — ~30+ uses |
| `001`, `002`, `013` (no prefix, in tables) | ADR-INDEX (column 1), CONSTRAINTS (column 1), PROJECT-CONTEXT | ~15 uses (in tables only — defensible) |
| "ADR 001", "ADR 013" (no hyphen) | none found | 0 |
| "ADR-1", "ADR-13" (un-padded) | none found | 0 |
| `ADRs 001-013` (range form) | every feature spec ("Constraints reminder") | ~15 uses — consistent |

**Verdict:** ADR format is clean. The only loose end is **target-phase numbers attached to pending ADRs**:

- ADR-019 says "End of Phase 14" — but Phase 14 folder is now Observability. The migration-history baseline ADR should reference Phase 15.
- ADR-020 says "End of Phase 15" — but Phase 15 folder is now Migration history. The cortex-isolation ADR should reference Phase 16.

**Fix:** update ADR-INDEX rows for ADR-019 and ADR-020 once phase numbering is finalized.

---

## 9. Recommendations for Wave 4 (final validator)

The fixes are mechanical and should take ≤2 hours of careful editing. Concrete checklist:

### A. Phase numbering — pick one scheme and propagate (HIGHEST PRIORITY)

1. **Adopt Builder 2b's filesystem numbering as canonical**: Phase 11=Markdown, 12=Webhooks, 13=SDK, 14=Observability, 15=Migration history, 16=Cortex isolation, 17=Persona marketplace, 18=Resilience, 19=Horizontal scale.
2. **Delete the 5 empty old-numbering ghost folders**: `PHASE-12-sdk/`, `PHASE-13-observability/`, `PHASE-14-migration-history/`, `PHASE-15-cortex-isolation/`, `PHASE-16-knowledge-graph-deep/`.
3. **Delete 3 empty stub folders**: `PHASE-7b-outcome-feedback/`, `PHASE-8-reranker/`, `PHASE-DEFERRED/` (real DEFERRED has no PHASE- prefix).
4. **Resolve persona-marketplace contradiction**: either delete `PHASE-17-persona-marketplace/` (and keep DEF-014 deferred) OR delete DEF-014 entry (and add Phase 17 to ROADMAP-OVERVIEW + EXEC-SUM tracks). Recommend the former — it matches the original "5 customer requests" trigger.

### B. Rewrite docs that use the old numbering for Phases 12-16

Search-and-replace pass needed in:
- `04-roadmap/ROADMAP-OVERVIEW.md` (timeline table, dependency graph, "what ships when" calendar, deferred-phases re-entry table)
- `MASTER-INDEX.md` (phase listing in "I want to understand the plan" section)
- `EXECUTIVE-SUMMARY.md` (track table, top-5 risks #1, top-5 wins #4, "Phase 14 defuses" callout)
- `01-foundations/COST-MODEL.md` (per-phase cost impact table, "Phases that SAVE cost")
- `01-foundations/SUCCESS-METRICS.md` (per-phase exit criteria table rows for 12-16)
- `01-foundations/ADR-INDEX.md` (ADR-019 and ADR-020 target phases)
- `STATUS/PHASE-PROGRESS-TRACKER.md` (Phase 12-16 sections; add Phase 17/18/19)
- `STATUS/PHASE-COMPLETION-CRITERIA.md` (same)
- `06-risks-and-mitigations/RISK-REGISTER.md` (Sections 1-4 "Phase that fixes" column, Section 6 phase quick-map. **This is the largest rewrite** — every SEC/DAT/SCL/OPS row's phase target needs auditing against the canonical numbering)
- `06-risks-and-mitigations/SECURITY-RISKS.md`, `DATA-RISKS.md`, `COST-RISKS.md`, `OPERATIONAL-RISKS.md`, `6-MONTH-FORECAST.md`, `12-MONTH-FORECAST.md` (all use Builder 4's old "Phase 11/12/13" numbering)
- `02-current-state/KNOWN-ISSUES.md` ("Fix phase" column; resolve "Phase 1.5", "Phase 1.6", "Phase 2.5", "Phase 5", "Pre-enterprise" → real phase numbers)
- `02-current-state/LANDMINES.md` ("Roadmap home" lines on L1, L3, L4, L5, L6, L7, L8, L9, L10)
- `02-current-state/TECH-DEBT.md` ("Fix phase" column)
- `05-features-to-10/FEATURE-INDEX.md` (every Phase column: 12=Webhooks not SDK, 13=SDK not Observability, 14=Observability not cost-controls, 15=Migration not cortex, 16=Cortex not KG-deep)
- `04-roadmap/PHASE-17-persona-marketplace/README.md` and `PHASE-18.../README.md` (prereq lines that say "Phase 12 = webhooks" etc are correct under canonical scheme; verify no stale pointers)

### C. Create or re-home missing files

MASTER-INDEX promises these — either create them or remove the rows:

| Promised file | Action |
|---|---|
| `02-current-state/SOPHISTICATION-RUBRIC.md` | Either create (audit content exists in EXECUTIVE-SUMMARY's "6.5/10" rationale) or remove from MASTER-INDEX |
| `02-current-state/SCALE-CEILING.md` | Either create (content exists in scalability-audit) or remove |
| `02-current-state/KNOWN-LIMITATIONS.md` | Remove from MASTER-INDEX (CONSTRAINTS.md already covers this) |
| `06-risks-and-mitigations/SCALABILITY-RISKS.md` | Either create (Section 3 of RISK-REGISTER could spin off) or remove |
| `06-risks-and-mitigations/EVAL-RISKS.md` | Remove (eval risks are scattered across DATA-RISKS / OPERATIONAL-RISKS) |
| `07-claude-instructions/SESSION-KICKOFF-TEMPLATE.md` | Either create (pattern exists in HANDOFF-TEMPLATE.md) or rename existing PROMPT-TEMPLATES.md to satisfy |
| `07-claude-instructions/SUBAGENT-PATTERNS.md` | Either create (covered partially in AGENT-DISPATCH-PATTERNS.md) or update MASTER-INDEX to point at the existing file |
| `07-claude-instructions/REPORTING-BACK.md` | Either create or update MASTER-INDEX to point at HANDOFF-TEMPLATE.md |
| `05-features-to-10/markdown-export.md` | Update MASTER-INDEX to use real filename `markdown-export-import.md` |
| `08-references/EXTERNAL-LINKS.md` | Update MASTER-INDEX to use real filename `external-docs.md` |
| `08-references/adrs/` (promised ADR copies) | Either copy 13 ADR files in OR remove the "local copies of all 13 ADRs" claim from MASTER-INDEX + ADR-INDEX |

### D. Cross-reference ID format harmonization

1. **Landmine IDs:** decide on `L1..L10` (LANDMINES.md style) and update RISK-REGISTER Section 5 to use that format. Search for `LANDMINE-A1`, `LANDMINE-A2`, `LANDMINE-D1`, `LANDMINE-A4`, `LANDMINE-stripe-*`, `LANDMINE-cortex-*`, `LANDMINE-persona-*` — all should become `L1..L10`.
2. **PHASE-0 README** says "see LM-03 dead column" — change to L1 or just "see LANDMINES.md (the searchVector mention)" since searchVector isn't its own landmine.
3. Add a **canonical cross-reference table** at the top of RISK-REGISTER mapping LANDMINE-Lx ↔ KI-NNN ↔ SEC/DAT/SCL/OPS-NNN. This eliminates the "same defect has three names" ambiguity.

### E. Phantom phase rehoming

Sub-decimal phases referenced but with no folder:
- **Phase 1.5** (persistent embedding queue) — referenced by KI-002, KI-011, LANDMINES L3. Re-home into PHASE-0.25 (it's a critical fix) or create PHASE-1.5 folder.
- **Phase 1.6** (optimistic concurrency) — referenced by KI-010, KI-021, LANDMINES L4. Re-home into PHASE-0.25 or PHASE-1.
- **Phase 2.5** (security hardening) — referenced by L5, L6, L7, L9, KI-004, KI-005, KI-007, KI-024. **All of this is already in PHASE-0.25** per its README — just update the references.
- **Phase 5 / Phase 5 (Cortex Pro)** — referenced by KI-019, KI-048, KI-067-071. Re-home into PHASE-5a or PHASE-5b explicitly, or note "Phase 5a+5b combined."
- **Phase 4 (Collaboration / multi-user rooms)** — referenced by LANDMINE L2 and KNOWN-ISSUES KI-008. Note: real Phase 4 is "Graph traversal." The "Collaboration" Phase 4 is a legacy product-roadmap reference. Update LANDMINES + KNOWN-ISSUES to say "future multi-user rooms work (DEFERRED, see DEF-015)" instead.
- **Phase 17 / Phase 18 / Phase 19** in RISK-REGISTER and KNOWN-ISSUES often point at "Resilience" or "Horizontal scale" but use the OLD numbering where Phase 17=Resilience. Under the canonical numbering, Resilience is Phase 18 and Horizontal scale is Phase 19. Re-map.
- **"Pre-enterprise"** — used as a fix-phase value in KI-013, KI-073, KI-074, KI-078 and in RISK-REGISTER ("beyond 14"). Standardize to one label, ideally `DEFERRED/` with a trigger like "first SOC 2 / GDPR conversation."

### F. Calendar / time budget reconciliation

Either:
- **Option A (compress):** Update individual Phase 10/11/13 READMEs to honour the original 2w/1w/1.5w estimates and note "research surfaced concerns; revisit if timeline slips."
- **Option B (extend, recommended):** Update ROADMAP-OVERVIEW timeline table + EXEC-SUM headline calendar (24w/30w → ~30w/37w p50/p90) to reflect the validated 4-6w / 3-4w / 3-4w estimates. This matches the 60% sustained-focus assumption that's already in EXEC-SUM.

### G. Status labels

Spot-checked DEFERRED, ACTIVE, PLANNED, SHIPPED — these are used consistently in FEATURE-INDEX. ROADMAP-OVERVIEW uses LOW/MED/HIGH for confidence. PHASE-COMPLETION-CRITERIA uses todo/wip/done/blocked. STATUS/PHASE-PROGRESS-TRACKER uses todo/wip/done/blocked. **No fixes needed for status taxonomy.**

### H. Final integrity check after fixes

After applying A-F, run:
1. `find docs/roadmap -name '*.md' -exec grep -l 'Phase 1[2-6]' {} \;` — eyeball every hit and verify it now references the canonical phase semantics.
2. `find docs/roadmap -name '*.md' -exec grep -lE 'LANDMINE-[A-Z][0-9]' {} \;` — should return nothing after the L1..L10 harmonization.
3. For every `[text](path)` markdown link in MASTER-INDEX, EXECUTIVE-SUMMARY, ROADMAP-OVERVIEW, PROJECT-CONTEXT, README — verify the target file exists.
4. Re-verify `PHASE-PROGRESS-TRACKER.md` covers every phase in the dependency graph (currently missing 0.25, 17, 18, 19).
5. Re-verify `STATUS/PHASE-COMPLETION-CRITERIA.md` has criteria for every active phase (currently missing 0.25 already — wait, it does have it! — but missing 17, 18, 19).

---

**Bottom line:** the roadmap's *thinking* is sound and consistent. The roadmap's *labeling* is broken in exactly the places you'd expect when 8 builders run in parallel without a numbering authority: the phases that two different builders touched (12-16) and the cross-reference identifiers (LANDMINE format, MASTER-INDEX paths). The validator's job is mechanical: pick canonical names, sed-and-link the rest. Nothing here invalidates the underlying plan or any individual phase's content.
