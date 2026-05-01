# Phase C — Migration Map (v1.3)

> **Status:** v1.2 ratified by validators; v1.3 amendment 2026-05-01 captures Phase D entry findings.
> **Generated:** 2026-04-30 (v1.0); revised 2026-04-30 (v1.1, v1.2); amended 2026-05-01 (v1.3)
> **Source proposal:** `docs/_inventory/PHASE-B-PROPOSAL-V2.md` (validator-ratified)
> **Active session:** master execution prompt v1.0
> **Next:** Phase D execution per §10 (with v1.3 amendments)
>
> **v1.3 Amendment (2026-05-01) — see `CHECKPOINT-phase-C.md` Addendum for full record:**
> - §10 outcome (c) was added in v1.2 round-3 risk-MED. Validator at Phase D entry verified it is **impossible** for this codebase: vite's `root: 'client'` does NOT change `process.cwd()`; postcss CWD remains `packages/boardroom-ai/` regardless of `root`. Only outcomes (a) and (b) exist. (c) note retained below for historical record but marked as invalidated.
> - §10 pre-step 0a result: **outcome (b) confirmed** — main builds CSS=4612 bytes / 0 utility classes; cherry-pick of 6e06597 onto clean main produces 37961 bytes / 162 classes (validator-verified).
> - §10 pre-step 0b' (replaces 0b): cherry-pick 6e06597 + defense-in-depth follow-up commit using path-anchored content paths (90d8894 approach) for CWD independence. Both commits include `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`.
> - §10 pre-step 0c: unchanged.
> - §10 pre-step 0d (NEW): commit `docs/_inventory/` to chore branch as audit trail before §10 commit 1.
> - §11 invariant #5 carve-out (d) added to EXECUTION-STATE.md to permit the postcss.config.js / tailwind.config.ts edits.
> - §11 cascade gate: SATISFIED (snapshot 11756f6 is empty; branch ref preserved; dangling worktree inert).
> - §6.3 line 207 ("AS-IS" prompt-loader) is INACCURATE for main — main's prompt-loader is broken (Bug #2 of orphaned 9cea951). NOT folded into Phase D scope (master prompt §3 stuck-state trigger). Tracked as separate P0 follow-up in EXECUTION-STATE.md "Open coordination items".
> - §12 verification: should add runtime `loadPrompt()` smoke test, not just file count. Defer text update to Phase D exit checkpoint.

This document enumerates **every concrete change** Phase D will make: every file move, every deletion, every code-comment edit, every doc-path edit in entry-point CLAUDE.md files, every CI assertion. Validators read this single file to challenge.

## Revision history

| Version | Findings addressed |
|---|---|
| v1.0 | initial draft |
| v1.1 | Architecture FAIL: §8 sed double-prefix bug (CRITICAL), §6.1 missed prisma schema refs (HIGH), §7.2 missed lines 32/442 (MED), §10 commit 4/8 sequencing (MED). Risk FAIL: §2.2 wave4 inbound=1 not 0 (CRITICAL), §5 sibling untracked provenance (CRITICAL), §11 branch coordination too vague (HIGH), §6.4 dist conditional dead branch (HIGH), §9.1 prompts count 19 not 17 (HIGH), §9.4 Docker glob fail-hard mode (HIGH), §9.3 hardcoded merge date (MED), §10 .bak cleanup (MED), missing rollback procedure (MED). Three findings require user decisions — see §16. |
| v1.2 | Architecture round-2 FAIL: §8 Pass B hand-edit depth math inverted (CRITICAL), §6.1 prisma:179 has no docs/ prefix (HIGH), §16/§11 status drift vs EXECUTION-STATE.md (HIGH). Risk round-2 FAIL: DECISION-3a unsafe — quizzical-hopper has post-merge commit 6e06597 with untracked-in-main postcss.config.js (CRITICAL), §11 wave4 gate still allows now-off-the-table 1B exception (HIGH), §10 Dockerfile RUN forward-references CI script (HIGH), §13 rollback assumes merge-commit but repo allows squash (HIGH), §9.3 PR title convention not locked (MED), missing soft-freeze precondition (MED), missing PR #1 dormancy tripwire (MED). All addressed in v1.2. |

---

## §1 — File moves (with redirect stubs at old path)

Stub format: 1 line + HTML marker so agents short-circuit:
```markdown
> Moved to `<new-path>`. <!-- AGENT_REDIRECT_ONLY -->
```

### §1.1 — Loose product docs → 4 purpose-aligned buckets (13 files)

| Old path | New path | Inbound refs |
|---|---|---:|
| `docs/PROJECT-BRIEF.md` | `docs/01-orientation/PROJECT-BRIEF.md` | 4 |
| `docs/CURRENT-STATE.md` | `docs/01-orientation/CURRENT-STATE.md` | 13 |
| `docs/ARCHITECTURE-QUICK-REF.md` | `docs/01-orientation/ARCHITECTURE-QUICK-REF.md` | 8 |
| `docs/MASTER-FRAMEWORK.md` | `docs/02-reference/MASTER-FRAMEWORK.md` | 42 (hub) |
| `docs/DECISIONS.md` | `docs/02-reference/DECISIONS.md` | 22 (hub) |
| `docs/FRAGILE-ZONES.md` | `docs/02-reference/FRAGILE-ZONES.md` | 9 |
| `docs/DEPLOYMENT-RUNBOOK.md` | `docs/03-operations/DEPLOYMENT-RUNBOOK.md` | 25 (hub) |
| `docs/DEPLOY-RAILWAY.md` | `docs/03-operations/DEPLOY-RAILWAY.md` | 3 |
| `docs/REALITY-BASELINE.md` | `docs/03-operations/REALITY-BASELINE.md` | 4 |
| `docs/FRONTEND-POLISH-REPORT.md` | `docs/_reports/FRONTEND-POLISH-REPORT.md` | 1 |
| `docs/PHASE-5-REPORT.md` | `docs/_reports/PHASE-5-REPORT.md` | 1 |
| `docs/REMEDIATION-REPORT.md` | `docs/_reports/REMEDIATION-REPORT.md` | 1 |
| `docs/REMEDIATION-2-REPORT.md` | `docs/_reports/REMEDIATION-2-REPORT.md` | 1 |

### §1.2 — Promotions (10 files)

| Old path | New path | Reason |
|---|---|---|
| `docs/roadmap/STATUS/CURRENT-PHASE.md` | `docs/STATUS/CURRENT-PHASE.md` | session-state, every-session load |
| `docs/roadmap/STATUS/CHANGELOG.md` | `docs/STATUS/CHANGELOG.md` | session-state |
| `docs/roadmap/STATUS/DECISIONS-LOG.md` | `docs/STATUS/DECISIONS-LOG.md` | session-state |
| `docs/roadmap/STATUS/BLOCKERS.md` | `docs/STATUS/BLOCKERS.md` | session-state |
| `docs/roadmap/STATUS/PHASE-PROGRESS-TRACKER.md` | `docs/STATUS/PHASE-PROGRESS-TRACKER.md` | session-state |
| `docs/roadmap/07-claude-instructions/CLAUDE-WORKFLOW.md` | `docs/_meta/CLAUDE-WORKFLOW.md` | agent load-order map |
| `docs/roadmap/07-claude-instructions/CONTEXT-LOAD-ORDER.md` | `docs/_meta/CONTEXT-LOAD-ORDER.md` | agent load-order map |
| `docs/roadmap/07-claude-instructions/PROMPT-TEMPLATES.md` | `docs/_meta/PROMPT-TEMPLATES.md` | agent meta |
| `docs/roadmap/07-claude-instructions/HANDOFF-TEMPLATE.md` | `docs/_meta/HANDOFF-TEMPLATE.md` | agent meta |
| `docs/roadmap/07-claude-instructions/SESSION-END-CHECKLIST.md` | `docs/_meta/SESSION-END-CHECKLIST.md` | agent meta |

> **Note:** Promotions to `docs/STATUS/` and `docs/_meta/` will trigger relative-path edits in **every roadmap-internal doc** that cites them. Phase D §3 sed pass handles this.

---

## §2 — File moves (NO stubs — orphans, no inbound to redirect)

These have `inbound_count: 0` per Phase A inventory. Stubs would be dead weight (and would bloat the Docker image per architecture validator HIGH finding).

### §2.1 — Orchestrator prompts → archive (16 files)

All move to `docs/_archive/orchestrator-prompts/`:

| Source | Bytes |
|---|---:|
| `docs/prompts/PHASE-0-ORCHESTRATOR.md` | 24545 |
| `docs/prompts/PHASE-1-ORCHESTRATOR.md` | 30538 |
| `docs/prompts/PHASE-2-ORCHESTRATOR.md` | 30518 |
| `docs/prompts/PHASE-3-ORCHESTRATOR.md` | 50643 |
| `docs/prompts/PHASE-4-ORCHESTRATOR.md` | 51740 |
| `docs/prompts/PHASE-5-ORCHESTRATOR.md` | 23330 |
| `docs/prompts/UI-PHASE-A-DESIGN-FOUNDATION.md` | 22440 |
| `docs/prompts/UI-PHASE-B-PAGE-REBUILD.md` | 29888 |
| `docs/prompts/UI-PHASE-C-INTELLIGENCE-POLISH.md` | 25540 |
| `docs/prompts/REMEDIATION-ORCHESTRATOR.md` | 17707 |
| `docs/prompts/REMEDIATION-2-ORCHESTRATOR.md` | 23396 |
| `docs/prompts/FRONTEND-POLISH-ORCHESTRATOR.md` | 18467 |
| `docs/prompts/PRE-DEPLOY-FIXES.md` | 9508 |
| `docs/prompts/DEPLOY-ORCHESTRATOR.md` | 8907 |
| `docs/prompts/AUDIT-ORCHESTRATOR.md` | 10076 |
| `docs/prompts/FINAL-AUDIT-ORCHESTRATOR.md` | 12182 |

Plus a new `docs/_archive/orchestrator-prompts/README.md` explaining what these are and when each ran.

**Verification gate (per Risk validator):** After moves, assert `ls docs/prompts/*.system.md | wc -l ≥ 17` (17 = current runtime prompt count). Add to CI per §6.1.

### §2.2 — Wave-3 reviews → archive (3 confirmed; wave4 disposition gated on user decision)

All move to `docs/_archive/research-wave-3-reviews/`:

| Source | Bytes |
|---|---:|
| `docs/research/omnimind-roadmap-2026/wave3-review/consistency-review.md` | 31247 |
| `docs/research/omnimind-roadmap-2026/wave3-review/completeness-review.md` | 22930 |
| `docs/research/omnimind-roadmap-2026/wave3-review/executor-feasibility-review.md` | 20670 |

**Wave4 — pending user decision (DECISION-1 in §USER-DECISIONS).**

`docs/research/omnimind-roadmap-2026/wave3-review/wave4-validator-summary.md` has **inbound_count=1**, not 0 as v1.0 assumed. The single citation is at `docs/roadmap/STATUS/CHANGELOG.md:262` — a historical "Files created" entry, NOT a live load-bearing reference. Two acceptable resolutions:

- **(1A) Move + edit citation:** archive wave4 like its siblings; update `docs/roadmap/STATUS/CHANGELOG.md:262` to point to new archive path. Net effect: wave3-review/ becomes empty and gets removed.
- **(1B) Leave wave4 in place:** keep `wave3-review/wave4-validator-summary.md` where it is; archive only the 3 others. Means `wave3-review/` directory persists with 1 file. Asymmetric but lossless.

Phase D pre-flight assertion (hard gate, not a TODO): `inbound_count == 0 OR documented exception in commit message`.

---

## §3 — File deletions (no stubs — files were always empty)

7 files, all <500 bytes, ≤7 lines, no real content:

| File | Bytes | Lines |
|---|---:|---:|
| `docs/architecture/data-flow.md` | 116 | 5 |
| `docs/architecture/memory-pipeline.md` | 122 | 5 |
| `docs/architecture/persona-routing.md` | 122 | 5 |
| `docs/architecture/system-diagram.md` | 121 | 5 |
| `docs/schemas/database-schema.md` | 152 | 4 |
| `docs/schemas/memory-ontology.md` | 154 | 7 |
| `docs/schemas/persona-output-format.md` | 93 | 3 |

> **Important:** `docs/architecture/security-boundaries.md` is **NOT a stub** (117 lines, 6.7kb). Stays in place. Architecture validator's earlier "delete 4 empty stubs" referred only to the 4 in `architecture/` — security-boundaries.md was never on the deletion list.

---

## §4 — New files (additions to docs/)

| File | Source / construction | Size estimate |
|---|---|---|
| `docs/INDEX.md` | Hand-written 100-200 lines. Categorized map of the docs tree. Points at LOAD-MAP.json, GLOSSARY.md, and the 4 main buckets. | ~150 lines |
| `docs/INDEX.json` | Auto-generated by `docs/_inventory/scripts/inventory.py` (modified to emit a curated subset, not the full `files.json`). | ~50kb JSON |
| `docs/LOAD-MAP.json` | Hand-curated. ~20 task types → 2-3 files each. Built from `docs/_meta/CONTEXT-LOAD-ORDER.md`. | ~5kb JSON |
| `docs/GLOSSARY.md` | Hand-written. Code prefixes (P0-/CC-/MR-/PL-/WR-/VT-/AR-/FG-/CN-/MN-/CS-/WT-/IL-/OL-), statuses, modes. ≤150 lines. Links out to `docs/prompts/` for personas, Prisma for entities. | ~150 lines |
| `docs/CONVENTIONS.md` | Hand-written. Naming, lifecycle, stub format, code-prefix taxonomy. ~100 lines. | ~100 lines |
| `docs/_archive/orchestrator-prompts/README.md` | Hand-written. Explains origin and date of each orchestrator. | ~50 lines |
| `docs/_archive/research-wave-3-reviews/README.md` | Hand-written. Explains the wave-3 pipeline reviews. | ~30 lines |

---

## §5 — External port (sibling repo) — provenance gated on user decision (DECISION-2)

Per user decision (option a): port these from `/Users/Joshua/boardroom-platform/docs/` into this repo.

| Source (sibling) | Destination (this repo) | Size | Sibling git status |
|---|---|---:|---|
| `MASTER-DEV-PLAN.md` | `docs/02-reference/MASTER-DEV-PLAN.md` | 845 lines | UNTRACKED (working copy only) |
| `MASTER-DREAM-ROADMAP.md` | `docs/02-reference/MASTER-DREAM-ROADMAP.md` | exists, verified 2026-04-30 | UNTRACKED (working copy only) |

**Provenance problem.** Both files are `??` in sibling git — they're working-copy-only with no commit history. Porting captures whatever's on disk at the moment of port, with zero upstream provenance. Sibling repo also has uncommitted edits to `.claude/CLAUDE.md`, `prompt-loader.ts`, and `index.ts`.

Two acceptable resolutions (DECISION-2):

- **(2A) Commit-then-port:** Run `git -C /Users/Joshua/boardroom-platform add docs/MASTER-DEV-PLAN.md docs/MASTER-DREAM-ROADMAP.md && git -C /Users/Joshua/boardroom-platform commit -m "docs: capture pre-port snapshot of MASTER-DEV-PLAN and MASTER-DREAM-ROADMAP"` first. Then port files this side, with the sibling commit SHA captured in the port commit message: `Ported from sibling repo @ <SHA>`. Cleanest provenance.
- **(2B) Working-copy port:** Add `> Ported from sibling working copy at /Users/Joshua/boardroom-platform/docs/ on 2026-04-30 (no upstream history; sibling files were untracked). Sibling now superseded.` header to each ported file. Cheaper but loses provenance.

After port (either option), sibling clone gets a 1-line stub at the old path: `> This file's canonical home is now <github-url>.` Sibling becomes deprecated; future edits land here.

---

## §6 — Code-comment edits (sed-replace targets)

Per Risk validator HIGH finding. These live in source files; redirect stubs at old doc paths don't help comments.

### §6.1 — `MASTER-FRAMEWORK.md` reference path updates

`docs/MASTER-FRAMEWORK.md` → `docs/02-reference/MASTER-FRAMEWORK.md`

| File | Line(s) |
|---|---|
| `packages/shared/src/types/persona.types.ts` | 2 |
| `packages/shared/src/types/decision.types.ts` | 2 |
| `packages/shared/src/types/user-profile.types.ts` | 2 |
| `packages/shared/src/types/commitment.types.ts` | 2 |
| `packages/shared/src/types/modes.types.ts` | 2 |
| `packages/shared/src/constants/rate-limits.ts` | 3 |
| `packages/shared/src/constants/persona-config.ts` | 2, 11 |
| `packages/boardroom-ai/CLAUDE.md` | 36 |
| `packages/omnimind-api/prisma/schema.prisma` | 3 |

> **v1.2 correction:** Only line 3 needs the sed-replace. Line 179 reads `// NEW: OmniMind Memory Layer (MASTER-FRAMEWORK.md Section 4)` — bare reference, no `docs/` prefix, contextually clear. Architecture round-2 flagged that the `docs/MASTER-FRAMEWORK.md → docs/02-reference/MASTER-FRAMEWORK.md` sed pattern won't match line 179 anyway. Decision: leave line 179 alone (the bare reference points readers to the canonical doc by name, which works regardless of path).

### §6.2 — Deleted-stub references → ARCHIVED comment

`docs/schemas/database-schema.md` and `docs/schemas/memory-ontology.md` are being **deleted** (§3). Replace with explanatory comment.

| File | Line | Old | New |
|---|---|---|---|
| `packages/shared/src/types/entities.types.ts` | 2 | `// Implement from: docs/schemas/database-schema.md` | `// Implement from: packages/omnimind-api/prisma/schema.prisma (canonical entity definitions). The previous docs/schemas/database-schema.md stub was deleted in docs Phase D — schema.prisma is the source of truth.` |
| `packages/shared/src/types/memory.types.ts` | 2 | `// Implement from: docs/schemas/database-schema.md + docs/schemas/memory-ontology.md` | `// Implement from: packages/omnimind-api/prisma/schema.prisma (Memory model) and docs/02-reference/MASTER-FRAMEWORK.md §4 Data Model.` |

### §6.3 — Paths that DO NOT change (verified — recorded for validator confidence)

| File | Line | Reference | Why unchanged |
|---|---|---|---|
| `packages/shared/src/types/api.types.ts` | 2 | `docs/contracts/omnimind-api.contract.md` | contracts/ AS-IS |
| `packages/shared/src/types/memory-type.types.ts` | 13 | `docs/roadmap/04-roadmap/PHASE-1-schema-alignment/SCHEMA-DRAFT.md` | roadmap/ AS-IS |
| `packages/shared/src/constants/persona-config.ts` | 19, 20-26 | `docs/prompts/<name>.system.md` × 7 | prompts/ AS-IS for *.system.md |
| `packages/boardroom-ai/server/src/lib/prompt-loader.ts` | 6, 9, 27 | walks up to `docs/prompts/` | dir AS-IS |
| `packages/omnimind-api/src/lib/prompt-loader.ts` | 5, 19 | walks up to `docs/prompts/` | dir AS-IS |
| `packages/omnimind-api/src/lib/db.ts` | 14 | `docs/architecture/security-boundaries.md` | file AS-IS |
| `packages/omnimind-api/src/services/simulation.service.ts` | 47 | `docs/prompts/*.system.md` | dir AS-IS |
| `packages/boardroom-ai/server/src/services/gmail.service.ts` | 138 | `docs/prompts/*.system.md` | dir AS-IS |
| `packages/boardroom-ai/server/src/services/llm-quality-scorer.service.ts` | 9 | `docs/prompts/quality-evaluator.system.md` | file AS-IS |
| `packages/boardroom-ai/server/src/routes/onboarding-bootstrap.routes.ts` | 8 | `docs/prompts/onboarding-bootstrap.system.md` | file AS-IS |
| `packages/boardroom-ai/client/src/components/onboarding/bootstrap-content.ts` | 7 | same | file AS-IS |
| `packages/shared/src/validation/boardroom-llm-response.schema.ts` | 43 | `docs/prompts/onboarding-bootstrap.system.md` | file AS-IS |
| `scripts/list-recent-data-for-eval.ts` | 147 | `docs/contracts/eval-harness.md` | contracts/ AS-IS |
| `scripts/pre-deploy-check.sh` | 24 | `docs/architecture/security-boundaries.md` | file AS-IS |
| `eval/runners/eval-retrieval-goldset.ts` | 23 | `docs/contracts/eval-harness.md` | contracts/ AS-IS |

### §6.4 — Compiled `dist/` artifacts

**Verified 2026-04-30:** `packages/shared/dist/` is `.gitignored`; `git ls-files packages/shared/dist/` returns 0 results. No rebuild needed during Phase D. CI/build will produce fresh artifacts on next deploy with corrected comments.

---

## §7 — Entry-point doc edits (line-by-line)

### §7.1 — `CLAUDE.md` (root) — minimal edits, only 2 doc refs

| Line | Old | New |
|---|---|---|
| 3 | `[\`docs/roadmap/\`](docs/roadmap/)` | unchanged (path stays) |
| 46 | `\`docs/prompts/*.system.md\`` | unchanged (path stays) |

✓ **No edits required.** Root CLAUDE.md is already a thin pointer.

### §7.2 — `.claude/CLAUDE.md` — large edit set

Approximate edit count: **20+ line edits**. Categorized:

**A. Promotion rewrites (lines 24, 25, 28, 29, 30, 34, 97, 98):**
- `docs/roadmap/STATUS/CURRENT-PHASE.md` → `docs/STATUS/CURRENT-PHASE.md` (note `../docs/...` relative path adjustment from `.claude/`)
- `docs/roadmap/07-claude-instructions/CLAUDE-WORKFLOW.md` → `docs/_meta/CLAUDE-WORKFLOW.md`
- `docs/roadmap/07-claude-instructions/CONTEXT-LOAD-ORDER.md` → `docs/_meta/CONTEXT-LOAD-ORDER.md`
- `docs/roadmap/07-claude-instructions/HANDOFF-TEMPLATE.md` → `docs/_meta/HANDOFF-TEMPLATE.md`
- `docs/roadmap/STATUS/CHANGELOG.md` → `docs/STATUS/CHANGELOG.md`

**B. Loose-doc moves (lines 100, 102, 103, 107-114, 161-168, 334, 418, 442):**
- `docs/DECISIONS.md` → `docs/02-reference/DECISIONS.md` (×2 — lines 100, 418)
- `docs/FRAGILE-ZONES.md` → `docs/02-reference/FRAGILE-ZONES.md` (×2 — lines 102, 334)
- `docs/PROJECT-BRIEF.md` → `docs/01-orientation/PROJECT-BRIEF.md` (line 107)
- `docs/CURRENT-STATE.md` → `docs/01-orientation/CURRENT-STATE.md` (line 108)
- `docs/ARCHITECTURE-QUICK-REF.md` → `docs/01-orientation/ARCHITECTURE-QUICK-REF.md` (line 109)
- `docs/DEPLOYMENT-RUNBOOK.md` → `docs/03-operations/DEPLOYMENT-RUNBOOK.md` (line 111)
- `docs/MASTER-FRAMEWORK.md` → `docs/02-reference/MASTER-FRAMEWORK.md` (×2 — lines 114, 162)
- Tree diagram (lines 161-168) updated as a block — rewrite the entire tree drawing

**C. Stale ref fixes (lines 32, 442 — added in v1.1):**
- **Line 32:** `docs/MEM0_INTEGRATION_PLAN.md`, `docs/MEM0_RE_INTEGRATION_PLAN.md` already in `docs/_archive/2026-04-pre-roadmap/`. Rewrite line 32 to point at archive paths.
- **Line 103:** `docs/tasks/_TASK-INDEX.md` — path stays (tasks/ AS-IS), but the line says "is HISTORICAL; the live task index is `docs/roadmap/STATUS/PHASE-PROGRESS-TRACKER.md`" — needs `docs/STATUS/PHASE-PROGRESS-TRACKER.md` after promotion.
- **Line 442:** `docs/tasks/_TASK-INDEX.md` cited again — path stays. NO EDIT NEEDED, but explicitly enumerated here for validator audit confidence (Architecture validator MEDIUM).

**D. Tree-diagram update (lines 161-168):**
- The ASCII tree shows `docs/ ├── MASTER-FRAMEWORK.md` etc. at root. Rewrite to show new structure with `01-orientation/`, `02-reference/`, `03-operations/`, `_reports/`, `_meta/`, `STATUS/` etc.

### §7.3 — `packages/boardroom-ai/CLAUDE.md` — 1 edit

| Line | Old | New |
|---|---|---|
| 36 | `docs/MASTER-FRAMEWORK.md` | `docs/02-reference/MASTER-FRAMEWORK.md` |

### §7.4 — `packages/shared/CLAUDE.md` — 0 edits

Verified — no `docs/` paths referenced.

### §7.5 — `packages/omnimind-api/CLAUDE.md` — 0 edits

Verified — only ref is `docs/contracts/omnimind-api.contract.md` which stays.

### §7.6 — `README.md` — 4 edits

| Line | Old | New |
|---|---|---|
| 15 | `docs/MASTER-FRAMEWORK.md` | `docs/02-reference/MASTER-FRAMEWORK.md` |
| 16 | `docs/tasks/BRAND-SYSTEM.md` | unchanged (verified exists) |
| 100 | `docs/MASTER-FRAMEWORK.md` | `docs/02-reference/MASTER-FRAMEWORK.md` |
| 101 | `docs/DECISIONS.md` | `docs/02-reference/DECISIONS.md` |

---

## §8 — Roadmap-internal cross-reference updates (REWRITTEN in v1.1)

The promotion of `STATUS/` and `07-claude-instructions/` out of `docs/roadmap/` means **every roadmap-internal doc** that cites them needs path adjustment. Per inventory:

- `docs/roadmap/STATUS/CURRENT-PHASE.md` is currently cited by 8 docs (per Phase A hub list)
- `docs/roadmap/07-claude-instructions/CLAUDE-WORKFLOW.md` is cited by 6 docs

### v1.0 sed-pass had a CRITICAL bug

`s|STATUS/CURRENT-PHASE.md|../STATUS/CURRENT-PHASE.md|g` would match the `STATUS/` substring inside ALREADY-CORRECT `../STATUS/CURRENT-PHASE.md` references in `docs/roadmap/01-foundations/SCOPE-NEGOTIATION.md` and `PRINCIPLES.md`, double-prefixing them to `../../STATUS/CURRENT-PHASE.md` (wrong by one level). Verified by Architecture validator. **Rewritten as two-pass approach below.**

### Two-pass strategy (v1.1)

**Pass A (automated, safe).** Rewrite ABSOLUTE paths only — no relative-path matching:

```bash
# Dry-run preview first
find docs/roadmap -name '*.md' -print0 | xargs -0 grep -lE 'docs/roadmap/(STATUS|07-claude-instructions)/' | xargs grep -nE 'docs/roadmap/(STATUS|07-claude-instructions)/'

# Actual pass (after dry-run review)
find docs/roadmap -name '*.md' -print0 | xargs -0 sed -i '' \
  -e 's|docs/roadmap/STATUS/|docs/STATUS/|g' \
  -e 's|docs/roadmap/07-claude-instructions/|docs/_meta/|g'

# Cleanup any .bak files that GNU/BSD sed may leave
find docs/roadmap -name '*.bak' -delete 2>/dev/null || true
```

> Note: the `-i ''` form is BSD/macOS sed-compatible. GNU sed uses `-i` without the empty arg. The Phase D PR description should specify which the runner is using; if mixed, use `-i.bak` and delete `.bak` afterward.

**Pass B (hand-edit, for bare-relative refs).** First, enumerate all bare-relative `STATUS/` and `07-claude-instructions/` citations:

```bash
# These are the paths to hand-edit
grep -rEn '\]\((\.\./)?(STATUS|07-claude-instructions)/' docs/roadmap/
grep -rEn '`(STATUS|07-claude-instructions)/' docs/roadmap/
```

### Depth math (REWRITTEN in v1.2 — round-2 caught the inverted bug)

**Post-move target paths:** `docs/STATUS/X.md` and `docs/_meta/X.md` (top-level under `docs/`, NOT under `docs/roadmap/` anymore).

Apply `..` for each directory level between the **citing file** and `docs/`:

| Citing file location | `..` count to reach `docs/` | New ref |
|---|---:|---|
| `docs/roadmap/X.md` (root of roadmap) | 1 | `../STATUS/Y.md` |
| `docs/roadmap/<top>/X.md` (e.g. `01-foundations/PRINCIPLES.md`) | 2 | `../../STATUS/Y.md` |
| `docs/roadmap/<top>/<sub>/X.md` (e.g. `04-roadmap/PHASE-N-foundation/README.md`) | 3 | `../../../STATUS/Y.md` |

Same depth rule for `_meta/`.

**Concrete example** (a citing file in `docs/roadmap/01-foundations/PRINCIPLES.md`):
- BEFORE Phase D: `[STATUS](../STATUS/CURRENT-PHASE.md)` resolves to `docs/roadmap/STATUS/CURRENT-PHASE.md` ✓
- AFTER Phase D move (STATUS now at `docs/STATUS/`): `../STATUS/CURRENT-PHASE.md` resolves to `docs/roadmap/STATUS/CURRENT-PHASE.md` ✗ (now a stub!)
- CORRECT post-move ref: `../../STATUS/CURRENT-PHASE.md` resolves to `docs/STATUS/CURRENT-PHASE.md` ✓

Edit by hand; do not sed (regex can't reliably distinguish current depths without parsing path structure).

**Belt-and-braces.** Add `*.bak` to root `.gitignore` before any sed pass to prevent accidental commit of sed backup files.

**Verification (UPDATED in v1.2 — round-2 caught the over-strict grep).** After both passes:

```bash
# 1. Confirm no remaining absolute pre-move paths (under-adjusted)
grep -rEn 'docs/roadmap/(STATUS|07-claude-instructions)/' docs/roadmap/ && echo 'FAIL: stale absolute refs'

# 2. Spot-check a sample by depth tier — the EXPECTED ../-count should match the citing file's depth
grep -rEn '\]\((\.\./)+(STATUS|_meta)/' docs/roadmap/ | head -10
# Manually verify each line: count of `../` segments == depth of citing file relative to docs/

# 3. Make sure stubs at old paths are correctly placed
test -f docs/roadmap/STATUS/CURRENT-PHASE.md || echo 'FAIL: stub at old STATUS path missing'
```

There is no purely-mechanical "is the depth right?" check — depth is a function of the citing file's location, so verification is per-file. Spot-check ~5 files at each depth tier and confirm.

---

## §9 — CI assertions to add

Per Risk + Architecture validators.

### §9.1 — Prompts integrity check (UPDATED in v1.1)

**Verified count is 19 system prompts on 2026-04-30**, not 17. v1.0 used a stale threshold.

New file: `scripts/check-prompts-integrity.sh`
```bash
#!/usr/bin/env bash
# Asserts that the runtime persona prompt count doesn't accidentally drop.
# Threshold derived from git baseline at HEAD~1 (auto-tracks future additions).
set -euo pipefail

CURRENT=$(ls docs/prompts/*.system.md 2>/dev/null | wc -l | tr -d ' ')
BASELINE=$(git ls-files 'docs/prompts/*.system.md' 2>/dev/null | wc -l | tr -d ' ')

# If git baseline is missing (fresh checkout, etc.), fall back to literal floor of 19
FLOOR=${BASELINE:-19}
[ "$FLOOR" -lt 19 ] && FLOOR=19

if [ "$CURRENT" -lt "$FLOOR" ]; then
  echo "FAIL: docs/prompts/*.system.md count is $CURRENT, expected ≥$FLOOR"
  exit 1
fi
echo "OK: $CURRENT system prompts present (floor=$FLOOR)"
```

Wired into `package.json`:
```json
"scripts": {
  ...
  "check:prompts": "bash scripts/check-prompts-integrity.sh"
}
```

Add to `pre-deploy-check.sh` and any future CI workflow.

### §9.2 — Link-validity check on entry-point docs

New file: `scripts/check-doc-links.py`. Reuses `docs/_inventory/scripts/inventory.py` engine but scoped to:
- `CLAUDE.md`, `.claude/CLAUDE.md`, `packages/*/CLAUDE.md`, `README.md`
- `scripts/pre-deploy-check.sh`

For each doc-path reference, assert `test -e <path>`. Exit non-zero on any miss. Include in `pre-deploy-check.sh`.

### §9.3 — Phase E tripwire (UPDATED in v1.1)

**Self-updating: derive merge date from git, no hardcoded literal.**

New test file: `tests/e2e/phase-e-stub-cleanup-due.test.ts`:
```ts
// Fails if: today >= D-merge-date + 30 days AND docs/ contains AGENT_REDIRECT_ONLY stubs.
// Forces a Phase E PR within 30 days of D merge.
import { execSync } from 'child_process';

const STUB_MARKER = '<!-- AGENT_REDIRECT_ONLY -->';

// Derive Phase D merge date from git: first merge commit whose subject contains "Phase D"
function phaseDMergeDate(): Date | null {
  try {
    const iso = execSync(
      "git log --merges --format=%aI --grep='Phase D' --grep='phase-D' -i | head -1",
      { encoding: 'utf8' }
    ).trim();
    return iso ? new Date(iso) : null;
  } catch {
    return null;
  }
}

it('Phase E stub cleanup is not overdue', () => {
  const mergeDate = phaseDMergeDate();
  if (!mergeDate) {
    // Phase D hasn't merged yet; tripwire dormant
    return;
  }
  const tripwire = new Date(mergeDate.getTime() + 30 * 24 * 3600 * 1000);
  if (Date.now() < tripwire.getTime()) return;

  // Past 30 days. Check for stubs.
  const stubCount = parseInt(
    execSync(`git grep -l '${STUB_MARKER}' -- docs/ | wc -l`, { encoding: 'utf8' }).trim() || '0'
  );
  expect(stubCount).toBe(0); // forces Phase E PR
});
```

If Phase D merge subject doesn't include "Phase D" or "phase-D", the test silently passes (dormant). Convention: PR title must contain one of those phrases.

### §9.4 — Dockerfile hardening (REWRITTEN in v1.1)

v1.0 proposed `COPY docs/prompts/*.system.md docs/prompts/` to exclude orchestrator stubs from the production image. **Risk validator HIGH:** BuildKit fails the build hard if zero `.system.md` files match. Combined with §9.1 misnumber, a future cleanup that drops below visibility could brick a deploy.

**Safer formulation: keep directory COPY, run integrity check during build.**

| File | Line | Action |
|---|---|---|
| `packages/boardroom-ai/Dockerfile` | 14 | UNCHANGED — keep `COPY docs/prompts/ docs/prompts/` |
| `packages/boardroom-ai/Dockerfile` | 51 | UNCHANGED — keep `COPY --from=builder /app/docs/prompts/ ./docs/prompts/` |
| `packages/boardroom-ai/Dockerfile` | post-COPY (new line) | ADD: `RUN bash scripts/check-prompts-integrity.sh` (in builder stage) |
| `packages/boardroom-ai/Dockerfile` | runner stage (new line) | ADD: `ENV PROMPTS_DIR=/app/docs/prompts` (architecture validator MEDIUM) |

This gives a louder failure mode than the glob trick: build fails immediately with a count mismatch message, rather than silently shipping a broken image.

**Rationale for keeping orchestrator stubs out of production:** since orchestrators move to `_archive/` per §2.1 (no stubs at old path — they're orphans), `docs/prompts/` will only contain `*.system.md` files post-Phase D. Directory COPY is fine because there's nothing else there to copy. The integrity check catches accidental future additions.

---

## §10 — Phase D PR construction order (REVISED in v1.2)

Each numbered group = one logical commit. v1.2 changes from v1.1:
- **CI scripts now precede Dockerfile hardening** (round-2 risk caught: the Dockerfile RUN line forward-references a script that doesn't exist yet — would break per-commit builds and `git bisect`)
- **PR title MUST contain "Phase D"** (round-2 risk: the §9.3 tripwire greps for that string)
- **PR description MUST include rebase cheat sheet for `claude/distracted-satoshi`** (per locked DECISION-3b-ii)
- **Pre-step (commit 0): tailwind/postcss build verification** before quizzical-hopper deletion (round-2 risk caught the post-merge commit 6e06597 risk)

Each commit leaves a buildable, consistent tree. PR title: `chore(docs): Phase D — consolidation and bucket migration`.

### Pre-step (before opening chore branch)

**0a. Verify main's Tailwind build state (corrected per round-3 risk MED).** From repo root run `pnpm --filter @boardroom/boardroom-ai dev:client` (or `cd packages/boardroom-ai && pnpm dev:client`). The `client/` dir has no package.json — running `pnpm dev` inside `client/` will fail with "no package.json" not a tailwind issue. Vite's `root: 'client'` setting in `client/vite.config.ts` makes the actual content paths in main's `tailwind.config.ts` (`./src/...`) resolve relative to client/. Load `http://localhost:5173` and inspect for Tailwind utility classes (or run a smoke test that asserts a Tailwind-generated class exists in DOM). **Three possible outcomes:**

  - **(a) Build OK and main's tailwind paths match 6e06597's intent** → branch's fix is already represented (probably differently). Skip cherry-pick. Delete branch (0c).
  - **(b) Build broken (Tailwind classes missing)** → 6e06597's content is needed. Cherry-pick to chore branch (0b).
  - **(c) Build OK BUT main's tailwind paths (`./src/...`, vite root='client') differ from 6e06597's (`./client/src/...`, vite root not 'client')** → DO NOT cherry-pick. The branch's "fix" was for a different invocation context that no longer applies in main. Cherry-picking would actively break main's working build. Skip directly to 0c.

The decision tree's third outcome was missed in v1.2's first draft and added per round-3 risk MED finding.

**0b (conditional). Cherry-pick 6e06597.** ONLY if Pre-step 0a outcome is (b):
```bash
git checkout -b chore/docs-phase-D-migration main
git cherry-pick 6e06597
# Verify: postcss.config.js now tracked, tailwind.config.ts shows updated content paths
git push -u origin chore/docs-phase-D-migration
```

**0c. Delete `claude/quizzical-hopper`.** AFTER 0a (and 0b if needed) confirm completeness:
```bash
git push origin --delete claude/quizzical-hopper
```

### Phase D commits (in PR construction order)

1. **commit: chore(docs): create new bucket directories** — empty dir creates (`.gitkeep` files), add `*.bak` to `.gitignore`
2. **commit: chore(docs): port MASTER-DEV-PLAN and MASTER-DREAM-ROADMAP from sibling repo** — adds `docs/02-reference/MASTER-DEV-PLAN.md` and `MASTER-DREAM-ROADMAP.md`. Per DECISION-2 (locked: 2B-with-SHA), commit message captures `shasum -a 256` of each ported file plus the sibling working-copy timestamp.
3. **commit: chore(docs): move 13 loose product docs to buckets** — `git mv` × 13 + redirect stubs at old paths
4. **commit: chore(docs): promote STATUS and meta dirs + rewrite roadmap-internal refs** — `git mv` × 10 + redirect stubs + Pass A sed + Pass B hand-edits + `find -name '*.bak' -delete`. Tree consistent at this commit boundary.
5. **commit: chore(docs): archive 16 orchestrator prompts** — `git mv` × 16 (no stubs) + new README
6. **commit: chore(docs): archive 3 wave-3 reviews + edit CHANGELOG.md citation** — `git mv` × 3 (no stubs) + new README + edit `docs/STATUS/CHANGELOG.md:262` to point at new archive path (per locked DECISION-1: 1A only).
7. **commit: chore(docs): delete 7 empty architecture/schema stubs** — pure deletes
8. **commit: chore(ci): add prompts-integrity script, link-validity script, phase-E tripwire test** — scripts + test files. **MOVED EARLIER in v1.2 so subsequent Dockerfile RUN works.**
9. **commit: chore(code): update doc-path comments in packages/shared/src and prisma schema** — sed-replace × ~11 lines (only prisma:3, not :179)
10. **commit: chore(code): update entry-point CLAUDE.md and README.md** — `.claude/CLAUDE.md` 20+ edits (lines 24, 25, 28, 29, 30, 32, 34, 97, 98, 100, 102, 103, 107-114, 161-168, 334, 418, 442), `packages/boardroom-ai/CLAUDE.md` 1 edit (line 36), root CLAUDE.md 0 edits, README.md 4 edits (lines 15, 100, 101)
11. **commit: chore(code): harden Dockerfile prompts COPY** — keep directory COPY + add `RUN bash scripts/check-prompts-integrity.sh` post-COPY (script now exists from commit 8) + add `ENV PROMPTS_DIR=/app/docs/prompts`
12. **commit: chore(docs): add INDEX.md, INDEX.json, LOAD-MAP.json, GLOSSARY.md, CONVENTIONS.md** — new files

### PR description requirements (NEW in v1.2)

The Phase D PR description MUST include:

1. **Title containing "Phase D"** — required for §9.3 tripwire (`gh pr view <num> --json title | grep -i 'phase d'` must match).
2. **Rollback variants** for both squash-merge and merge-commit styles (see §13).
3. **Rebase cheat sheet for `origin/claude/distracted-satoshi`** (per locked DECISION-3b-ii) — table of old-path → new-path mappings for the 5 loose docs the branch modifies (PROJECT-BRIEF, CURRENT-STATE, ARCHITECTURE-QUICK-REF, FRAGILE-ZONES, DEPLOYMENT-RUNBOOK). Includes one-liner rebase command suggestion.
4. **Reference to `docs/_inventory/PHASE-C-MIGRATION-MAP.md` and `PHASE-C-DECISIONS-FINAL.md`** for full audit trail.

Total: **12 commits** + 0a-0c pre-steps. ~43 files moved, ~42 file edits, ~10 new files.

---

## §11 — Phase D pre-conditions (REVISED in v1.2, hard gates)

All must be true before opening Phase D PR. Each is a blocking pre-flight assertion, not an aspiration.

### Validator gates
- [ ] This map (`PHASE-C-MIGRATION-MAP.md` v1.2) ratified by architecture + risk validators in round 3 with PASS or PASS_WITH_NOTES verdict

### Decision gates (all locked per `PHASE-C-DECISIONS-FINAL.md`)
- [x] DECISION-1 locked: 1A (archive wave4 + edit CHANGELOG)
- [x] DECISION-2 locked: 2B-with-SHA (port working-copy + SHA-256 in commit message)
- [x] DECISION-3a locked: verify-then-cherry-pick-or-skip-then-delete-quizzical-hopper (per §10 pre-steps 0a/0b/0c)
- [x] DECISION-3b locked: 3b-ii (defer post-Phase-D, PR author handles rebase)

### File-system gates (verified 2026-05-01)
- [x] Sibling `/Users/Joshua/boardroom-platform/docs/MASTER-DEV-PLAN.md` accessible
- [x] Sibling `/Users/Joshua/boardroom-platform/docs/MASTER-DREAM-ROADMAP.md` accessible
- [ ] **Tailwind/postcss build verification done** (per §10 pre-step 0a) — outcome documented in PR description
- [ ] **wave4-validator-summary.md inbound count is 0 AFTER §10 commit 6 lands** (CHANGELOG.md:262 edit included; **1B exception NOT permitted** per locked DECISION-1)
- [ ] `ls docs/prompts/*.system.md | wc -l` returns ≥19
- [ ] `git ls-files packages/shared/dist/ | wc -l` returns 0 (dist still untracked)
- [ ] `*.bak` added to root `.gitignore`

### Coordination gates (NEW in v1.2)
- [ ] **PR title contains "Phase D"** (literal — required for §9.3 tripwire and rollback documentation)
- [ ] **No active editor sessions** touching `docs/roadmap/` during Phase D commit window — verified by `git fetch && git log main..origin/main` empty before opening PR (soft-freeze precondition; tests for INCOMING commits not yet seen locally — the reverse direction was flagged by round-3 risk LOW). Also record `origin/main` SHA at PR-open and re-check before merge.
- [ ] `cascade/get-a-grasp-on-this-project-ce9f67` (local checkout) reconciled — WIP committed, stashed, or branched-off-clean
- [ ] `claude/quizzical-hopper` deletion executed per §10 pre-step 0c
- [ ] PR description includes: rollback variants (per §13), rebase cheat sheet for `claude/distracted-satoshi` (per locked DECISION-3b-ii)

---

## §12 — Verification commands (Phase D)

After Phase D commits land locally (before pushing):

```bash
# 1. Inventory rerun — orphan count should drop, no new unresolved refs
python3 docs/_inventory/scripts/inventory.py

# 2. Prompts integrity
bash scripts/check-prompts-integrity.sh

# 3. Link validity (will create script during Phase D)
python3 scripts/check-doc-links.py

# 4. Type check + tests
pnpm typecheck
pnpm test

# 5. Docker build smoke (boardroom-ai only — has the docs/prompts COPY)
docker build -t boardroom-ai:phase-d-smoke -f packages/boardroom-ai/Dockerfile .

# 6. Pre-deploy
bash scripts/pre-deploy-check.sh

# 7. Sanity: search for stubs
git grep -l 'AGENT_REDIRECT_ONLY' docs/  # should match all stub files
```

If any check fails, do not open PR. Fix forward, re-verify.

---

## §13 — Rollback procedure (REVISED in v1.2 — round-2 caught merge-style ambiguity)

This repo allows all three merge styles (`mergeCommitAllowed`, `squashMergeAllowed`, `rebaseMergeAllowed` all true per `gh repo view`). Rollback command differs by style. **Phase D PR description MUST specify intended merge style** so rollback path is unambiguous.

**Recommended merge style: merge-commit** (preserves the per-commit history that this map carefully constructed; allows targeted partial rollback).

### Rollback within 24h of merge

**If merged via merge-commit (recommended):**
```bash
git revert -m 1 <phase-d-merge-sha>
```

**If merged via squash:**
```bash
# Squash collapses all 12 commits into one — revert that single commit, no -m flag
git revert <phase-d-squash-sha>
```

**If merged via rebase:**
```bash
# Rebase replays each commit on main — revert the range
git revert <last-phase-d-commit-sha>...<first-phase-d-commit-sha>~1
```

### Sibling-repo asymmetric rollback (regardless of merge style)

Reverting the Phase D merge in THIS repo does NOT revert sibling-repo changes. Need to:

```bash
# 1. (this repo) Revert per merge style above
# 2. (sibling repo) Revert the port-stub commit
git -C /Users/Joshua/boardroom-platform log --oneline -5  # find SHAs
git -C /Users/Joshua/boardroom-platform revert <sibling-stub-sha>

# 3. Notify branch authors
# claude/distracted-satoshi rebase plan (per DECISION-3b-ii) is cancelled
```

### Rollback after 24h

Orchestrators may have shipped to production; downstream branches may be based on the new tree. Don't revert. Identify the specific failure and fix-forward with a follow-up PR.

### Stub-only rollback (partial)

If a subset of files broke but most are fine:
```bash
git checkout <pre-D-sha> -- docs/<specific-path>
```
followed by a new PR. Avoids whole-Phase-D revert when the issue is local.

---

## §14 — What this map does NOT cover (out of scope)

These are out of scope for Phase D, even though they touched the conversation:

- **Rebuilding `_TASK-INDEX.md`** to cite all phase-N task subdirs (35 tasks-orphans). Side task, not blocking.
- **Restructuring `docs/roadmap/`** internally (4-deep paths). AI-IA validator's MED finding rejected as scope creep.
- **`_deprecated/` lifecycle tier.** User decided YAGNI.
- **Adding `docs/roadmap/_redirect.md` short-aliases.** AI-IA validator's nice-to-have, deferred.
- **Cleanup of 1023+ unresolved refs.** AI-IA validator's INFO finding. Some get fixed incidentally by entry-point edits; the rest is a follow-up workstream.

---

## §15 — Validator dispatch plan (round 2)

v1.0 round 1 returned: Architecture FAIL + Risk FAIL with 3 critical findings. v1.1 addressed every finding above. Round 2:

| Validator | Scope |
|---|---|
| Architecture | does v1.1 §8 sed pass eliminate the double-prefix bug? are §6.1 prisma refs handled? are §7.2 lines 32 and 442 covered? does combined commit 4 in §10 produce a consistent tree? |
| Risk | are §11 hard gates strict enough? does §13 rollback handle the sibling asymmetry? are §9 CI assertions resistant to silent failure? |

Both run in parallel, background. If round 2 returns PASS or PASS_WITH_NOTES, Phase C exits; checkpoint and mark Phase D ready (gated on user resolving DECISION-1, DECISION-2, DECISION-3).

If round 2 returns another FAIL, escalate to user with a stuck-state checkpoint per master prompt §8.

---

## §16 — DECISIONS (all locked per `PHASE-C-DECISIONS-FINAL.md`)

### DECISION-1 — LOCKED: 1A
Archive wave4 + edit `docs/STATUS/CHANGELOG.md:262` (post-promotion path). SUSTAINED by debate validator.
- PR description must list the CHANGELOG edit
- Archive README records original 4-file dir count
- **No 1B exception path** — round-2 risk validator caught the residual gate language and v1.2 tightened §11

### DECISION-2 — LOCKED: 2B-with-SHA
Port working-copy + capture `shasum -a 256` of file content in port commit message. OVERTURNED from original 2A.
- Per anti-drift invariant #2, this repo is the new canonical home
- Committing in the dormant sibling would create forked dead-end history
- SHA-256 gives identical reconstructability without polluting sibling git

### DECISION-3a — LOCKED: verify-then-cherry-pick-or-skip-then-delete (REVISED in v1.2)
Round-2 risk validator caught that `claude/quizzical-hopper` is NOT pure pre-squash residue — at least commit 6e06597 (postcss.config.js + tailwind path fix) is post-squash work. v1.2 plan:

1. **§10 pre-step 0a** — Verify main's Tailwind build state.
2. **§10 pre-step 0b (conditional)** — If build broken, cherry-pick 6e06597 to chore branch.
3. **§10 pre-step 0c** — Only after 0a/0b confirm completeness, delete `claude/quizzical-hopper`.

Other quizzical-hopper commits verified (2026-05-01):
- `2bae6d3` (5 handoff docs) — content IS in main (verified by checking PROJECT-BRIEF.md, ARCHITECTURE-QUICK-REF.md, etc. exist in `git show main:...`). Skip.
- `0a53531` (brand migration) — IS in main via squash merge 39b3df3. Skip.
- `29f2cb5` (CLAUDE.md expand) — `.claude/CLAUDE.md` line counts match between main and 29f2cb5 (both 431 lines). Content IS in main. Skip.
- `6e06597` (postcss + tailwind) — postcss.config.js NOT tracked in main (untracked-on-disk only). Cherry-pick conditional on build verification.

### DECISION-3b — LOCKED: 3b-ii (defer post-Phase-D)
Per user, 2026-05-01. Phase D ships first; PR #1 author handles rebase later.
- Phase D PR description includes path-rename cheat sheet for the 5 loose docs distracted-satoshi modifies
- Dormancy tripwire added to `EXECUTION-STATE.md` Open Coordination Items: PR #1 rebase deadline = Phase D merge + 14d, escalate if no activity

---

*End of map v1.2. Awaiting validator round 3.*
