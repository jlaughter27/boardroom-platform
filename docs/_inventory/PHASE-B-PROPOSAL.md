# Phase B — Target Tree Proposal

> **Status:** DRAFT for validation. Will be challenged by 3 parallel validator agents before approval.
> **Generated:** 2026-04-30
> **Prior phase:** Phase A inventory (296 files, 112 orphans, 114 hubs). See `docs/_inventory/summary.md`.

---

## Design principles

1. **Keep the roadmap pipeline intact.** It's 133 files (45% of corpus, 42% of size), well-cross-linked, and was built by an 18-agent pipeline. Moving it is gratuitous risk.
2. **Don't shuffle code-loaded docs.** `docs/prompts/*.system.md` is read by `prompt-loader.ts` at runtime. Path changes break code.
3. **Consolidate the loose `docs/*.md` files** into a clear "product" bucket. There are 13 of them today, mixing reference (MASTER-FRAMEWORK), runbook (DEPLOYMENT-RUNBOOK), point-in-time reports (PHASE-5-REPORT), and architecture (FRAGILE-ZONES). They are hubs — must keep redirect stubs at old paths.
4. **Add three machine-/agent-readable artifacts:** INDEX (manifest), GLOSSARY (vocabulary), and an automated freshness check.
5. **Archive — don't delete.** ~435kb of completed-pipeline orchestrator prompts and wave3 review docs are stale but historically valuable. They go to `_archive/`, never to `/dev/null`.
6. **No moves without redirect stubs.** Every old path leaves a 1-line stub for one cycle (Phase D), then deletes (Phase E) only after validating nothing breaks.

---

## Target tree

```
docs/
├── INDEX.md                          NEW    human-readable doc map
├── INDEX.json                        NEW    machine-readable manifest (auto-regen via inventory.py)
├── GLOSSARY.md                       NEW    every code prefix, persona, entity, status defined once
│
├── 01-product/                       NEW DIR — consolidates 13 loose top-level docs
│   ├── PROJECT-BRIEF.md              ←  docs/PROJECT-BRIEF.md
│   ├── MASTER-FRAMEWORK.md           ←  docs/MASTER-FRAMEWORK.md     (79kb, 42 inbound — hub)
│   ├── CURRENT-STATE.md              ←  docs/CURRENT-STATE.md         (13 inbound)
│   ├── ARCHITECTURE-QUICK-REF.md     ←  docs/ARCHITECTURE-QUICK-REF.md
│   ├── DECISIONS.md                  ←  docs/DECISIONS.md             (22 inbound — ADR index)
│   ├── DEPLOYMENT-RUNBOOK.md         ←  docs/DEPLOYMENT-RUNBOOK.md    (25 inbound — hub)
│   ├── DEPLOY-RAILWAY.md             ←  docs/DEPLOY-RAILWAY.md
│   ├── FRAGILE-ZONES.md              ←  docs/FRAGILE-ZONES.md
│   ├── REALITY-BASELINE.md           ←  docs/REALITY-BASELINE.md
│   └── _reports/                     SUB-DIR — point-in-time reports, kept for audit trail
│       ├── FRONTEND-POLISH-REPORT.md ←  docs/FRONTEND-POLISH-REPORT.md
│       ├── PHASE-5-REPORT.md         ←  docs/PHASE-5-REPORT.md
│       ├── REMEDIATION-REPORT.md     ←  docs/REMEDIATION-REPORT.md
│       └── REMEDIATION-2-REPORT.md   ←  docs/REMEDIATION-2-REPORT.md
│
├── architecture/                     AS-IS, but DELETE 4 empty stubs (5-line files)
├── contracts/                        AS-IS
├── schemas/                          AS-IS, but DELETE 3 empty stubs (3-7 line files)
├── roadmap/                          AS-IS — do NOT touch (133 files, pipeline-built)
├── tasks/                            AS-IS — but rebuild `_TASK-INDEX.md` to cite all phase subdirs
├── research/                         AS-IS — but move `omnimind-roadmap-2026/wave3-review/` to _archive
├── prompts/                          AS-IS for *.system.md (runtime); move orchestrators to _archive
│
└── _archive/
    ├── 2026-04-pre-roadmap/          AS-IS
    ├── orchestrator-prompts/         NEW — 16 one-shot pipeline orchestrators (~360kb)
    │   ├── README.md                 explains what these are, when each ran, and why archived
    │   ├── PHASE-0-ORCHESTRATOR.md   ←  docs/prompts/PHASE-0-ORCHESTRATOR.md
    │   ├── PHASE-1-ORCHESTRATOR.md   ←  docs/prompts/PHASE-1-ORCHESTRATOR.md
    │   ├── PHASE-2-ORCHESTRATOR.md   ←  docs/prompts/PHASE-2-ORCHESTRATOR.md
    │   ├── PHASE-3-ORCHESTRATOR.md   ←  docs/prompts/PHASE-3-ORCHESTRATOR.md
    │   ├── PHASE-4-ORCHESTRATOR.md   ←  docs/prompts/PHASE-4-ORCHESTRATOR.md
    │   ├── PHASE-5-ORCHESTRATOR.md   ←  docs/prompts/PHASE-5-ORCHESTRATOR.md
    │   ├── UI-PHASE-A-DESIGN-FOUNDATION.md
    │   ├── UI-PHASE-B-PAGE-REBUILD.md
    │   ├── UI-PHASE-C-INTELLIGENCE-POLISH.md
    │   ├── REMEDIATION-ORCHESTRATOR.md
    │   ├── REMEDIATION-2-ORCHESTRATOR.md
    │   ├── FRONTEND-POLISH-ORCHESTRATOR.md
    │   ├── PRE-DEPLOY-FIXES.md
    │   ├── DEPLOY-ORCHESTRATOR.md
    │   ├── AUDIT-ORCHESTRATOR.md
    │   └── FINAL-AUDIT-ORCHESTRATOR.md
    └── research-wave-3-reviews/      NEW — completed pipeline reviews (~75kb)
        ├── README.md
        ├── consistency-review.md
        ├── completeness-review.md
        ├── executor-feasibility-review.md
        └── (any sibling files in that dir)
```

---

## What I'm asserting (and the validators must challenge)

| # | Assertion | Confidence |
|---|---|---|
| A1 | Moving the 13 loose docs to `01-product/` will require updating ~70+ inbound references across CLAUDE.md, .claude/CLAUDE.md, README.md, and other docs. Stubs cover transition. | high |
| A2 | The 16 orchestrator prompts in `docs/prompts/` are NOT loaded by any code path. The `*.system.md` ones are; the `*-ORCHESTRATOR.md` ones aren't. Safe to archive. | medium — needs code grep |
| A3 | The 4 wave3 reviews in `docs/research/omnimind-roadmap-2026/wave3-review/` are completed pipeline outputs, not still-cited research. Safe to archive. | medium — verify inbound from production roadmap docs |
| A4 | The 7 stub files in `docs/architecture/` and `docs/schemas/` (each <200 bytes, 3-7 lines) are empty placeholders. Safe to delete. | high |
| A5 | Adding INDEX.md, INDEX.json, GLOSSARY.md improves agent load-order without breaking anything. Pure additions. | high |
| A6 | The `docs/roadmap/` tree is healthy and should not be reorganized. | high |
| A7 | `docs/tasks/_TASK-INDEX.md` is incomplete and should be rebuilt as part of cleanup. 35 task files have zero inbound. | medium — verify with sample reads |

---

## Files to be deleted (not moved)

| File | Bytes | Lines | Reason |
|---|---:|---:|---|
| docs/architecture/data-flow.md | ~120 | 5 | empty stub |
| docs/architecture/memory-pipeline.md | ~120 | 5 | empty stub |
| docs/architecture/persona-routing.md | ~120 | 5 | empty stub |
| docs/architecture/system-diagram.md | ~120 | 5 | empty stub |
| docs/schemas/database-schema.md | ~120 | 4 | empty stub |
| docs/schemas/memory-ontology.md | ~180 | 7 | empty stub |
| docs/schemas/persona-output-format.md | ~80 | 3 | empty stub |

Total: 7 files, ~860 bytes.

---

## Open questions for validators

1. **Code references to `docs/prompts/`** — does any non-test code path do `readFileSync('docs/prompts/PHASE-N-ORCHESTRATOR.md')` style? If yes, that orchestrator stays.
2. **CI / build-time refs** — do any `.github/workflows/`, `scripts/`, `package.json`, `turbo.json`, or `Dockerfile` paths reference doc files? Moves break those.
3. **External tools** — Claude Desktop MCP servers, Cursor index files, anything that hardcoded paths.
4. **CLAUDE.md and `.claude/CLAUDE.md`** — both files cite many of the 13 loose docs. They must be updated as part of the move PR (Phase D). Validators verify the rewrite is complete.
5. **`docs/MEM0_*.md`** files referenced in `.claude/CLAUDE.md` line 36-37 — these no longer exist at root (already moved to `_archive/`). The reference is stale. Stub-or-fix?

---

## Migration sequence (Phase D)

1. Branch: `chore/docs-consolidation`
2. Create `docs/01-product/` and `docs/01-product/_reports/`
3. Create `docs/_archive/orchestrator-prompts/` and `docs/_archive/research-wave-3-reviews/`
4. `git mv` each file to its new home (preserves history)
5. At each old path, write a 1-line stub: `> Moved to <new-path>. This stub will be removed in Phase E (~30 days).`
6. Delete the 7 empty architecture/schema stubs (no-stub since they had no real content)
7. Update CLAUDE.md, .claude/CLAUDE.md, README.md to reference new paths
8. Generate `docs/INDEX.json` from `docs/_inventory/scripts/inventory.py`
9. Write `docs/INDEX.md` and `docs/GLOSSARY.md`
10. Re-run inventory; verify orphan count drops and no new unresolved refs.
11. Open PR; reviewers verify nothing broke.

## Phase E (later, ~30 days after merge)

1. Re-run inventory.
2. If no inbound to old stub paths from outside the repo (search git log, search code), delete stubs.
3. Final inventory pass.

---

*Ready for validator challenge.*
