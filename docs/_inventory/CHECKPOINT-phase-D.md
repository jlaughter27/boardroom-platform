# Checkpoint — Phase D (Execute Migration)

Generated: 2026-05-01
Master prompt: v1.0.1 (executed against; v1.0.2 lessons logged below)

---

## Outcome

- **Phase:** D — Execute Migration (bucket reorganization, promotions, archives, deletions, ref rewrites)
- **Status:** PR open. PR #4 (draft) at https://github.com/jlaughter27/boardroom-platform/pull/4
- **Duration:** Phase D entry pre-steps + 12 §10 commits + 5 prep/audit-trail commits + 1 phase-exit commit (this checkpoint)
- **Major pivot:** Zeta plan (split into 3 PRs) after divergence audit revealed `docs/roadmap/` doesn't exist on `origin/main`

## What changed

### Files added (this PR)

**Top-level new docs (§10 commit 12):**
- `docs/INDEX.md` — categorized map of the docs tree
- `docs/INDEX.json` — machine-readable curated subset
- `docs/LOAD-MAP.json` — task-type → file mapping (20 task types)
- `docs/GLOSSARY.md` — code prefixes, statuses, modes, persona names
- `docs/CONVENTIONS.md` — naming, lifecycle, stub format conventions

**Audit-trail (committed in `6a991a8`):**
- `docs/_inventory/` (14 files) — Phase A-C planning artifacts
  - `PHASE-C-MIGRATION-MAP.md` v1.4 (final)
  - `PHASE-C-DECISIONS-FINAL.md`
  - `PHASE-B-PROPOSAL-V2.md`
  - `MASTER-EXECUTION-PROMPT.md`
  - `EXECUTION-STATE.md`
  - `EXECUTION-LOG.md`
  - `CHECKPOINT-phase-C.md` (with Phase D entry validator addendum)
  - `CHECKPOINT-phase-D.md` (this file, in commit being recorded now)
  - `files.json`, `summary.md`, `hubs.md`, `orphans.md`
  - `scripts/inventory.py`, `scripts/pass-b-rewrite.py`

**CI scripts (§10 commit 8 + pre-prep `7ad3cfd`):**
- `scripts/check-prompts-integrity.sh`
- `scripts/check-doc-links.py`
- `tests/e2e/phase-e-stub-cleanup-due.test.ts`

**Sibling-repo ports (§10 commit 2):**
- `docs/02-reference/MASTER-DEV-PLAN.md` (sha256 captured in commit message)
- `docs/02-reference/MASTER-DREAM-ROADMAP.md` (sha256 captured)

**Bucket dirs scaffolded (§10 commit 1):**
- 8 dirs with `.gitkeep` markers (since removed by subsequent commits as dirs gained real content)

**Archive READMEs (§10 commits 5-6):**
- `docs/_archive/orchestrator-prompts/README.md`
- `docs/_archive/research-wave-3-reviews/README.md`

### Files moved

- 13 loose docs → 4 buckets (§10 commit 3)
- 5 STATUS files: `docs/roadmap/STATUS/*` → `docs/STATUS/*` (§10 commit 4)
- 5 _meta files: `docs/roadmap/07-claude-instructions/*` → `docs/_meta/*` (§10 commit 4)
- 16 orchestrator prompts: `docs/prompts/PHASE-*-ORCHESTRATOR.md` etc. → `docs/_archive/orchestrator-prompts/` (§10 commit 5)
- 4 wave3-reviews: `docs/research/omnimind-roadmap-2026/wave3-review/*` → `docs/_archive/research-wave-3-reviews/` (§10 commit 6); the wave3-review/ dir is now empty and removed by git

**Total moves:** 43 files across 6 commits.

### Redirect stubs created (23 total)

Each moved-with-stub path got a 1-line redirect with the `<!-- AGENT_REDIRECT_ONLY -->` HTML marker:
- 13 stubs in `docs/<old-loose-doc-path>` (§10 commit 3)
- 5 stubs in `docs/roadmap/STATUS/` (§10 commit 4)
- 5 stubs in `docs/roadmap/07-claude-instructions/` (§10 commit 4)

NO stubs at `docs/_archive/` move sources (orchestrator-prompts had inbound=0; wave3-reviews had only the single CHANGELOG citation that was edited inline).

### Files deleted

- 7 empty architecture/schema stubs (§10 commit 7): `docs/architecture/{data-flow,memory-pipeline,persona-routing,system-diagram}.md` + `docs/schemas/{database-schema,memory-ontology,persona-output-format}.md`
- The `docs/architecture/` directory is now empty and removed by git
- The `docs/schemas/` directory is now empty and removed by git
- 1 stale `.bak` file: `packages/omnimind-api/src/services/_disabled/search-analytics.service.ts.bak` (incidental cleanup during §6.1 sed pass)

### Files modified

**Cross-reference rewrites (§10 commit 4):**
- 6 files in `docs/roadmap/`, 46 refs total
- Pass A (sed): 4 absolute-path refs rewritten
- Pass B (Python `pass-b-rewrite.py`): 42 relative-path refs depth-adjusted

**Source-comment edits (§10 commits 9, 11):**
- 9 files in `packages/shared/src/{types,constants}/` and `packages/omnimind-api/prisma/schema.prisma:3` (§6.1)
- 2 files: `entities.types.ts` + `memory.types.ts` (§6.2 — explanatory comment for deleted-stub refs)
- 1 file: `packages/boardroom-ai/CLAUDE.md:36` (§7.3, completed in §6.1 sed pass)

**Entry-point doc edits (§10 commits 10, 11):**
- `.claude/CLAUDE.md`: 16 path edits via sed + tree-diagram rewrite (lines 161-173) + line-32 small fix
- `README.md`: 3 path edits via sed

**CHANGELOG citation (§10 commit 6):**
- `docs/STATUS/CHANGELOG.md` line ~51 (was migration map's "line 262") updated to point at new wave4 archive path

**Dockerfile (§10 commit 11):**
- `packages/boardroom-ai/Dockerfile`: COPY check-prompts-integrity.sh + RUN it post-prompts-COPY + ENV PROMPTS_DIR=/app/docs/prompts

**Pre-deploy script (§10 commit 8):**
- `scripts/pre-deploy-check.sh`: bumped step counter /6 → /8 + added 2 new steps (prompts-integrity + doc-links)

**.gitignore (§10 commit 1):**
- Added `*.bak` line

## Decisions made (this phase)

| Decision | Outcome | Rationale | Reversible? |
|---|---|---|---|
| Phase D entry amendment to DECISION-3a | REJECTED by validator (FAIL on amendment) | My CWD claim was empirically false; vite `root` does not change `process.cwd()`. Locked plan stands; cherry-pick 6e06597 actually works | yes |
| Strategic Zeta plan pivot | LOCKED | Divergence audit revealed `docs/roadmap/` only on feature/folder-migration; split work into 3 PRs | yes (each PR independently revertable) |
| Cherry-pick 9 Cat B + 1 Cat A commit into PR 1 | LOCKED | Includes prompt-loader fix (Bug #2 EXECUTION-STATE-flagged P0), brand polish, test-greens, and the dc23b2a roadmap pipeline | yes |
| Defer Cat C/D commits to PR 3 | LOCKED | Phase 0/1 prep + 34-file security overhaul deserve dedicated review cycle | yes |
| Drop redundant 8bd228d/e805f57 on chore branch rebase | LOCKED | PR 1's 80534c2/dfe895a supersede the chore branch's earlier defense-in-depth Tailwind work | yes (commits still in reflog) |
| Keep `_inventory/` audit trail in PR 2 | LOCKED | §10.4 PR description requires references to PHASE-C-MIGRATION-MAP.md and PHASE-C-DECISIONS-FINAL.md | yes |
| 7 files in `docs/roadmap/` outside §1.2 scope | DEFERRED | PHASE-COMPLETION-CRITERIA + 6 in 07-claude-instructions/ — candidates for follow-up promotion if user agrees | yes |
| MEM0 broken-ref in `.claude/CLAUDE.md:32` | LOCAL FIX | Replaced concrete archive path with generic `docs/_archive/` reference (which exists post-Phase-D scaffold) | yes |

## Validator results

| Round | Validator | Verdict | Headline |
|---|---|---|---|
| Phase D entry | Debate validator | FAIL on amendment | C-1 critical: false CWD claim. Validator independently re-tested and showed cherry-pick of 6e06597 produces 37961-byte CSS / 162 utility classes — option (b) of locked plan IS correct. |

After validator FAIL, locked plan was followed (cherry-pick + defense-in-depth). Validator's H-1, H-2, M-1, M-2 findings absorbed into EXECUTION-STATE.md as open coordination items + invariant #5 carve-out (d) + cherry-pick provenance preservation + cascade gate handling.

No additional validator rounds during §10 execution because each commit's spec was concrete enough to be self-verifying via the migration map + run scripts.

## Lessons learned (folded into master prompt v1.0.2)

1. **Vite `root` does NOT change `process.cwd()`.** Verified empirically by validator's probe. POSTCSS plugins resolve content paths from CWD, not from config-stated `root`. **Lesson:** verify CWD with a probe (`echo "cwd=$(node -e 'console.log(process.cwd())')"`), not by reading config-stated `root`. Recurring failure class: "vite/build-tool config inference" added to verify-don't-infer log.

2. **Phase A inventory must check the tree state against the actual merge target, not just the working tree.** Phase A was run against feature/folder-migration; migration map assumed those files were on main. Caused mid-execution stuck-state at §10 commit 3 (REALITY-BASELINE.md missing) and forced Zeta plan pivot. **Lesson:** Phase A should run `git ls-tree -r origin/main` AND `git ls-tree -r <working-branch>` and report any divergence as a hard pre-flight gate. Add to master prompt §1 (Phase A inventory protocol).

3. **Migration map line-number citations must be rebased onto target-branch state at Phase D start.** §7.2 line 442 etc. were correct because the map was authored against feature/folder-migration which shares dc23b2a as ancestor with PR 1. But REALITY-BASELINE.md, MEM0_*, and security-boundaries.md citations were against working-tree state with no main equivalent. **Lesson:** any line-citation list should include a "verified against branch X" stamp.

4. **Git's rename detection threshold gives up when the destination has both content move AND new tiny stub at old path.** §10 commit 4 produced 27-file modifications + 5 new files instead of 10 renames + 5 mods. Audit trail still intact (file content moved, refs updated, stubs created), just `git log --follow` chasing is harder. **Lesson:** when content+stub crosses similarity threshold, git becomes unreliable for rename history. Document the move table in commit message body for posterity.

5. **Side effects of `find ... -delete` are not always wanted.** §6.1 sed pass produced .bak files; `find packages -name '*.bak' -delete` cleaned them up but ALSO incidentally deleted a tracked `_disabled/search-analytics.service.ts.bak` (a stale tracked .bak that shouldn't have been in git). Net effect was beneficial cleanup but unintentional. **Lesson:** scope cleanup `find` patterns more tightly (e.g. `find <specific-dirs> -name '*.bak' -delete`) when running broad transformations.

These five lessons fold into v1.0.2 of the master execution prompt at the next session boundary (or this exit checkpoint).

## What's next

- **Active phase:** D — awaiting user merge of PR #4 (currently draft)
- **Phase E (pending tripwire):** 30 days post-merge — open Phase E PR to delete the 23 redirect stubs. Test `tests/e2e/phase-e-stub-cleanup-due.test.ts` will fail loudly if missed.
- **PR 3 (separate workstream):** 13 Cat C/D commits from feature/folder-migration when Phase 1 starts.
- **Open coordination items carried forward (per EXECUTION-STATE):**
  - `claude/distracted-satoshi` dormancy tripwire re-anchored to PR #4 merge + 14 days
  - 7 files in `docs/roadmap/` outside §1.2 scope (potential follow-up)
  - 4 pre-existing TSC errors in shared/utils/validation-helpers.ts (fixed by PR 3)

## Anti-drift invariants verified

- [x] Roadmap pipeline tree (`docs/roadmap/`) is live source of truth — confirmed; PR 1 brought it onto main, Phase D promoted STATUS/_meta out without disturbing the rest
- [x] MASTER-DEV-PLAN ported into this repo — confirmed; in `docs/02-reference/MASTER-DEV-PLAN.md` (commit `ce60783`)
- [x] `docs/prompts/*.system.md` loaded by code, others not — confirmed; orchestrator one-shots moved to `_archive/`, runtime prompts untouched at 18 (`prompt-loader.ts` paths preserved)
- [x] BoardRoom → OmniMind via HTTP only — unaffected by Phase D
- [x] No mass file moves outside `docs/` — verified; only outside-docs changes are sed-replaces (~14 lines), Dockerfile (4 lines), pre-deploy-check.sh (4 lines), and the postcss.config.js / tailwind.config.ts add (covered by carve-out (d))

## Phase D exit gates verified

- [x] All 12 §10 commits landed on chore branch
- [x] Branch pushed to origin (`chore/docs-phase-D-migration`)
- [x] PR #4 opened (draft) at https://github.com/jlaughter27/boardroom-platform/pull/4
- [x] PR title contains literal "Phase D" — §9.3 tripwire will derive 30-day countdown from this PR's merge
- [x] PR description includes rollback variants (per §13) + rebase cheat sheet for `claude/distracted-satoshi`
- [x] Build verification on chore branch: `python3 scripts/check-doc-links.py` OK, `bash scripts/check-prompts-integrity.sh` OK, JSON files valid
- [x] No stale `docs/roadmap/STATUS/` or `docs/roadmap/07-claude-instructions/` absolute paths remain in tree
- [ ] **PR review + merge** — pending user

---

*Phase D exits with PR #4 in draft. Phase E will fire 30 days post-merge.*
*Compaction sequence per master prompt §7: write checkpoint (this file) → update EXECUTION-STATE → append to EXECUTION-LOG → end session OR /compact.*
