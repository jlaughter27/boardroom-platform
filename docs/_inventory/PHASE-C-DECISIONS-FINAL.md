# Phase C decisions — final (post-debate)

> **Status:** Locked after debate-validator round. 1 SUSTAIN, 2 OVERTURNED, 1 still-open user decision surfaced.
> **Generated:** 2026-05-01
> **Supersedes:** `docs/_inventory/PHASE-C-DECISIONS-PROPOSED.md`

---

## DECISION-1 — wave4-validator-summary.md disposition

**Locked: 1A — archive wave4 + edit `docs/STATUS/CHANGELOG.md:262`.** SUSTAINED by debate validator.

### Validator confirmation

CHANGELOG.md:262 citation is prose bookkeeping inside a 2026-04-18 retro entry, not a structured manifest any tool consumes. No `.github/workflows/` exists; no changelog-driven scripts in repo. Risk of breaking a consumer is zero.

### Adds (from validator's "new considerations")

- The Phase D PR description must include the CHANGELOG line edit in its "files modified" list so a future auditor following the citation chain finds the new path immediately.
- The new `docs/_archive/research-wave-3-reviews/README.md` must explicitly note that the wave3-review/ dir originally contained 4 files, in case directory-level provenance matters later.

---

## DECISION-2 — sibling-repo provenance for ported files

**REVISED: 2B (with SHA-256 content hash) — port working-copy + capture file content hash in port commit message.** OVERTURNED by debate validator.

### Why my original 2A was wrong

1. **Anti-drift invariant #2** (per `docs/_inventory/EXECUTION-STATE.md`) says **this repo becomes the canonical home** for these docs. Committing them to sibling first creates a forked dead-end history — sibling holds files that will never be edited there again. That's provenance debt, not provenance payoff.
2. **Sibling repo has been dormant since 2026-04-08.** Adding commits there manufactures fake activity.
3. **A single synthetic commit isn't "real history."** Identical reconstructability to a SHA-256 of the file content captured in the port commit message — without polluting sibling git.
4. **2A would be cross-repo writes without explicit user permission** — the user is operating in this repo. Committing in `/Users/Joshua/boardroom-platform/` is a state mutation outside the worktree the user is operating in. Same scope-creep failure mode as my D-3 "I drive" expansion.

### Locked plan

1. Generate SHA-256 of file content for both sibling files at port time:
   ```bash
   shasum -a 256 /Users/Joshua/boardroom-platform/docs/MASTER-DEV-PLAN.md
   shasum -a 256 /Users/Joshua/boardroom-platform/docs/MASTER-DREAM-ROADMAP.md
   ```
2. Copy file content into this repo at `docs/02-reference/`.
3. Phase D commit message records:
   ```
   chore(docs): port MASTER-DEV-PLAN and MASTER-DREAM-ROADMAP from sibling working copy

   Source: /Users/Joshua/boardroom-platform/docs/ (untracked working copy as of 2026-05-01)
   MASTER-DEV-PLAN.md sha256: <hash>
   MASTER-DREAM-ROADMAP.md sha256: <hash>

   Per Phase B V2 user decision (option a) and Phase C debate-validator
   (DECISION-2 OVERTURN), this repo is the new canonical home for these docs.
   Sibling repo's untracked working-copy versions are now superseded.
   ```
4. **Optional follow-up (not blocking Phase D):** I'll surface to the user a separate question about whether the sibling repo should be archived/deprecated formally, since its docs/ dir is now superseded for these two files. NOT a Phase D action.

---

## DECISION-3 — active-branch coordination

**REVISED: split into 3a (acted) and 3b (user-input-needed).** OVERTURNED by debate validator's discovery of PR state.

### Critical evidence I missed

I never ran `gh pr list`. The validator did:

| PR | Branch | State | Merged-as |
|---|---|---|---|
| #2 | `claude/quizzical-hopper` | **MERGED** | commit 39b3df3 in main, 2026-04-09 (squash merge) |
| #1 | `claude/distracted-satoshi` | **OPEN** | 39 files / 1057 insertions, touching auth + shared schemas |

`git log main..origin/claude/quizzical-hopper` still shows 4 commits — those are the **pre-squash original commits**, stale residue of an already-merged PR. The branch's WORK is in main; the BRANCH is just leftover.

### Locked actions

#### DECISION-3a — `claude/quizzical-hopper`: close as superseded

ACTION I will execute (no user input needed): the branch's work is already in main via squash-merged PR #2. Plan:

1. Verify one more time before deletion: `git log --merges --grep='Brand\|brand system' main` — confirm merge SHA 39b3df3 is in main.
2. Delete the remote branch: `git push origin --delete claude/quizzical-hopper`.
3. Document this as a Phase D pre-step in the migration map.

This avoids the validator's flagged failure: re-merging already-landed work creating bogus conflicts.

#### DECISION-3b — `claude/distracted-satoshi`: SURFACE TO USER

The validator was right that "use your best judgment" did NOT pre-authorize me to drive a 39-file rebase touching `auth.routes.ts`, `cortex` services, and shared schemas without explicit code review. That's risk-bearing change with no CI safety net.

**Three options for the user (DECISION-3b):**

- **3b-i — Merge pre-Phase-D (user or Claude drives rebase, separate decision):** Rebase distracted-satoshi onto current main, resolve conflicts, merge. Phase D operates on cleaner main. Hidden cost: re-run Phase A inventory after merge — line citations in PHASE-C-MIGRATION-MAP.md may shift.
- **3b-ii — Defer to post-Phase-D (PR author or someone else handles rebase later):** Phase D ships now. PR #1 author rebases against the new tree. Increased conflict surface for them but bounded scope.
- **3b-iii — Close as stale:** PR #1 has been open 3 weeks with no activity from author. If the user judges the work is superseded or no longer wanted, close. Loses 39 files of audit-fix work.

**Claude's recommendation:** 3b-ii (defer post-Phase-D). Reasons:
- The `auth/cortex/shared` touches in PR #1 deserve careful code review by whoever wrote them, not bulk-rebase by me.
- Phase D's path renames are the EASIER half of the conflict surface — a sed pattern catches them. The "29 fixes" semantic conflicts are the hard half; the original PR author owns those.
- 3b-i blocks Phase D on additional work whose timeline isn't ours to control.
- 3b-iii is too aggressive without user confirmation that the work is unwanted.

But this is the user's call, not mine.

---

## Reflection on what I missed

Two failures of best-judgment in the original proposal:

1. **Did not run `gh pr list`** before forming D-3 opinion. That single missing query invalidated half the decision. Lesson: any decision about branches should consult PR state first, not just `git log` and `git diff`.
2. **Both 2A and 3B-modified contained "Claude does work outside the immediate task" expansions.** 2A: writes to a different repo. 3B-modified: drives a 39-file rebase. The user's "use your best judgment" instruction was about WHICH option to PICK, not pre-authorization to expand my action surface. Lesson: scope expansion needs explicit ask, even when prior instruction sounds permissive.

Both lessons baked into a v1.2 of the master execution prompt:
- §3 working principles add: "before any branch/PR decision, run `gh pr list` first."
- §3 working principles add: "scope expansion (action surface beyond the immediate task) is a stuck-state trigger, not a judgment call. Ask, don't extend."

That update happens at the next compaction (Phase C exit), not now.

---

*End of final decisions. Awaiting user resolution of DECISION-3b only.*
