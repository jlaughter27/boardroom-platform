# Checkpoint — Phase C (Migration Map)

Generated: 2026-05-01
Master prompt: v1.0

---

## Outcome

- **Phase:** C — Migration Map
- **Status:** EXIT — both validators returned PASS_WITH_NOTES on round 3
- **PR:** none (Phase C is paper-only; produced map for Phase D execution)
- **Duration:** initial draft + 3 validator rounds + 1 debate-validator round

## What changed

**Files added (all in `docs/_inventory/`):**
- `PHASE-C-MIGRATION-MAP.md` (v1.2 final, ~700 lines) — concrete enumeration of every file move, deletion, code edit, CI assertion, and PR construction order for Phase D
- `PHASE-C-DECISIONS-PROPOSED.md` — Claude's initial best-judgment decisions (preserved as historical record)
- `PHASE-C-DECISIONS-FINAL.md` — locked decisions after debate-validator round
- `CHECKPOINT-phase-C.md` (this file)

**Files modified:**
- `EXECUTION-STATE.md` — phase ledger updated (C done, D ready), all 4 decisions locked, PR #1 dormancy tripwire added, DECISION-3a refined to verify-then-cherry-pick-or-skip
- `EXECUTION-LOG.md` — appended Phase C exit entry

**Files moved/deleted:** none (Phase C is design, not execution)

## Decisions made (this phase)

| Decision | Outcome | Rationale | Reversible? |
|---|---|---|---|
| DECISION-1 wave4 disposition | 1A — archive + edit CHANGELOG.md:262 | citation is prose bookkeeping, no automated consumer | yes (revert edit + git mv back) |
| DECISION-2 sibling-repo provenance | 2B-with-SHA — port working-copy + SHA-256 in commit message | this repo is canonical home; sibling is dormant; synthetic 1-commit history adds no value | yes (delete ported file) |
| DECISION-3a quizzical-hopper | verify-then-cherry-pick-or-skip-then-delete | branch has post-merge work (commit 6e06597 with untracked-in-main postcss.config.js) that may or may not be needed | yes (no destructive actions until verified) |
| DECISION-3b distracted-satoshi | 3b-ii defer post-Phase-D | PR author owns semantic 29-fix conflicts; we own path renames | yes (PR remains open) |

## Validator results (3 rounds + 1 debate)

| Round | Validator | Verdict | Headline |
|---|---|---|---|
| 1 | Architecture | FAIL | CRITICAL §8 sed double-prefix bug, missed prisma:3, missed lines 32/442 |
| 1 | Risk | FAIL | CRITICAL wave4 inbound=1, sibling untracked, prompts count 19 not 17, Docker glob fail-hard |
| Debate | DECISIONS validator | 1 SUSTAIN, 2 OVERTURN | caught I never ran `gh pr list` (PR #2 already merged) and that "best judgment" doesn't pre-authorize cross-repo writes |
| 2 | Architecture | FAIL | CRITICAL §8 Pass B inverted depth bug (same failure class as round 1), HIGH prisma:179 has no docs/ prefix, status drift |
| 2 | Risk | FAIL | CRITICAL DECISION-3a unsafe (post-merge commit 6e06597 has untracked-in-main postcss.config.js), residual wave4 1B exception, Dockerfile RUN forward-references unwritten script, rollback assumes merge-commit but repo allows squash |
| 3 | Architecture | PASS_WITH_NOTES | clean — all 3 round-2 findings addressed; depth math verified across 3 tiers; no path-math regression; stuck_state_signal=false |
| 3 | Risk | PASS_WITH_NOTES | clean — all 7 round-2 findings addressed; 2 new MED inline-fixable defects (pre-step 0a command + decision-tree third outcome) absorbed during this checkpoint; no stuck-state |

## Lessons learned (folded into master prompt at Phase D start)

1. **`gh pr list` first** — any branch/PR decision must consult PR state, not just `git log` and `git diff`. I missed that PR #2 was already squash-merged.
2. **Scope expansion is a stuck-state trigger** — both 2A ("commit in sibling") and 3B-modified ("I drive 39-file rebase") were action-surface expansions beyond user authorization. "Use your best judgment" was about WHICH option to pick, not pre-authorization to expand action scope.
3. **Path math is a recurring failure class** — round-1 over-prefix bug, round-2 inverted under-prefix bug. v1.2 fixed by replacing sed with explicit depth-table per file location with concrete trace examples. Future moves should use this pattern from the start.
4. **Pre-merge state assumptions need verification, not inference** — the quizzical-hopper "pure pre-squash residue" debate-validator claim (later overturned by round-2 risk) was based on observation without timestamp verification. Always check post-merge timestamps.

These are baked into v1.0.1 of the master execution prompt at the next session boundary.

## What's next

- **Active phase:** D — Execute migration
- **First action for next session:** Per migration map §10 pre-step 0a — run `pnpm --filter @boardroom/boardroom-ai dev:client` from repo root on clean main checkout, inspect Tailwind build state, take outcome (a/b/c). Then proceed with §10 commits in order.
- **Open coordination items carried forward:**
  - `cascade/get-a-grasp-on-this-project-ce9f67` (local) — must be reconciled before chore branch
  - `claude/quizzical-hopper` deletion gated on §10 pre-step 0a outcome
  - `claude/distracted-satoshi` deferred per 3b-ii; dormancy tripwire armed (Phase D merge + 14d)
  - Sibling repo deprecation (separate user question, not blocking)

## Anti-drift invariants verified

- [x] Roadmap pipeline tree (`docs/roadmap/`) is live source of truth — confirmed; v1.2 keeps it intact
- [x] MASTER-DEV-PLAN currently in sibling, ported in Phase D — confirmed via `ls /Users/Joshua/boardroom-platform/docs/`
- [x] `docs/prompts/*.system.md` loaded by code, others not — confirmed via grep; v1.2 keeps prompts dir AS-IS for `*.system.md`
- [x] BoardRoom → OmniMind via HTTP only — unaffected by docs reorg; doc-comment edits in shared/src don't change service boundaries
- [x] No mass file moves outside docs/ — verified; only changes outside docs/ are sed-replaces (~11 lines), `packages/*/CLAUDE.md` (1 edit), Dockerfile (3 edits), and conditional postcss.config.js cherry-pick

## Phase D readiness gate

All gates from migration map §11 currently:
- Decision gates: ✅ all 4 LOCKED
- File-system gates: 🟡 build verification not yet run (pre-step 0a)
- Coordination gates: 🟡 cascade/* needs reconciliation, soft-freeze when ready

**Phase D is ready to begin** when the operator runs the §10 pre-steps.

---

*Phase C exits. Compaction sequence per master prompt §7: write checkpoint (this file) → update EXECUTION-STATE → append to EXECUTION-LOG → end session OR /compact.*

---

## Addendum: Phase D entry validator outcome (2026-05-01, post-compact)

A debate validator was deployed to challenge a proposed amendment to locked DECISION-3a. The amendment claimed: pre-step 0a verified main's Tailwind broken AND 6e06597's content-path fix `'./client/src/...'` is incompatible with current `vite.config.ts` `root: 'client'` (because postcss CWD would be `client/`, making `./client/src/` resolve to `client/client/src/`).

**Validator verdict: FAIL on amendment, REJECT_THIRD_OPTION.**

**The CWD claim is false.** Vite's `root` config sets the project entry/index.html base — it does NOT chdir. The validator independently:
- Cherry-picked 6e06597 onto a clean main worktree
- Inserted a probe to log `process.cwd()` during postcss execution
- Confirmed CWD = `packages/boardroom-ai/`, NOT `client/`
- Built and produced CSS = 37961 bytes / 162 utility classes (works correctly)

So the locked plan's outcome (b) — cherry-pick 6e06597 — actually works. The amendment was solving a non-problem.

**This is a third instance of the same failure class** that bit Phase C rounds 1 and 2:
1. Round 1 §8 sed: path-math by inference (over-prefix bug)
2. Round 2 §8 Pass B: path-math by inference (under-prefix bug)
3. Phase D entry pre-step 0a: CWD-math by inference (vite `root` ≠ chdir)

Each iteration was tighter than the last. `stuck_state_signal: false` per validator. Master prompt §3 v1.0.1 lesson "verify, don't infer" was already baked in but wasn't internalized at decision time. **Adding to v1.0.2 (next compaction):** "vite `root` does NOT change `process.cwd()` — POSTCSS plugins resolve content paths from CWD. Verify CWD with a probe, not by reading config-stated `root`."

### Validator items absorbed into Phase D entry execution

| Item | Severity | Resolution |
|---|---|---|
| C-1 amendment rationale false | CRITICAL | Locked plan stands. Cherry-pick 6e06597. |
| H-1 prompt-loader broken on main | HIGH | NEW P0 follow-up logged in EXECUTION-STATE.md "Open coordination items". NOT folded into Phase D scope. §6.3 line 207 needs migration-map text update at Phase D exit (defer to checkpoint-D). |
| H-2 invariant #5 doesn't permit postcss config | HIGH | Carve-out (d) added to invariant #5 in EXECUTION-STATE.md. |
| M-1 provenance trailer | MED | Cherry-pick automatically preserves Co-Authored-By. Defense-in-depth follow-up commit must include `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`. |
| M-2 cascade worktree gate | MED | Reconciled. Snapshot 11756f6 is empty (no file changes). Branch ref preserved. Dangling worktree inert. §11 satisfied. |
| L-1, L-2 | LOW | Confirmed accurate; no action. |

### Revised pre-step 0b' (replaces locked 0b)

1. `git checkout main && git pull --ff-only origin main` (after `git fetch`)
2. `git checkout -b chore/docs-phase-D-migration`
3. `git cherry-pick 6e06597` (preserves Opus Co-Authored-By trailer; this is the locked plan, validator-verified to work)
4. **Defense-in-depth follow-up commit:** edit `packages/boardroom-ai/client/tailwind.config.ts` to use path-anchored content paths via `path.dirname(fileURLToPath(import.meta.url))` (the 90d8894 approach from feature/folder-migration). Commit message includes `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>` and explains: "Defends against future invocation contexts where CWD might differ from packages/boardroom-ai/. Cherry-pick of 6e06597 already builds correctly; this commit makes the build CWD-independent."
5. Build verification on chore branch: `pnpm exec vite build --config client/vite.config.ts` from `packages/boardroom-ai/`; assert CSS contains utility classes via grep.

### Revised pre-step 0c (unchanged from locked but with prerequisite check)

Only after step 5 of 0b' confirms utility classes are present: `git push origin --delete claude/quizzical-hopper`.

### NEW pre-step 0d (audit-trail commit)

After 0b'/0c, before §10 commit 1: `git add docs/_inventory && git commit -m "chore(docs): add Phase A-C inventory and migration planning artifacts"`. This puts the audit trail (files.json, hubs.md, orphans.md, summary.md, MASTER-EXECUTION-PROMPT, PHASE-B-PROPOSAL-V2, PHASE-C-MIGRATION-MAP, PHASE-C-DECISIONS-FINAL, EXECUTION-STATE, CHECKPOINT-phase-C, EXECUTION-LOG) on the chore branch where Phase D PR can reference them per §10.4.
