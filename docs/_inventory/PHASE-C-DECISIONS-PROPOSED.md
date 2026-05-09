# Phase C decisions — proposed (awaiting debate-validator challenge)

> **Status:** Claude's best-judgment calls on the 3 decisions surfaced by validator round 1. Will be challenged by a debate validator that explicitly argues against these calls.
> **Generated:** 2026-05-01

---

## DECISION-1: wave4-validator-summary.md disposition

**Choice: 1A — archive wave4 alongside its 3 siblings; edit `docs/STATUS/CHANGELOG.md:262` (post-promotion path) to point at the new archive location.**

### Rationale

1. The 1 inbound reference is in `CHANGELOG.md:262`, in a "Files created" record listing what files were created in a past wave. It's historical bookkeeping, not a live citation that another system reads.
2. Editing one CHANGELOG line costs <1 minute. Leaving an asymmetric `wave3-review/` directory (option 1B) costs nothing today but accumulates as future cognitive load every time someone wonders "why is this dir half-empty?"
3. Symmetric outcome: `wave3-review/` becomes empty and gets removed entirely. Tree is cleaner.

### Strongest case for the rejected option (1B)

If the wave4 file is the most recent / most authoritative document of the wave — and the others are intermediate pipeline outputs — then leaving wave4 in `wave3-review/` while archiving the prerequisites preserves a clear "current vs historical" distinction.

### Why I'm rejecting it

The validator already produced its summary; subsequent work in the repo (the production roadmap docs in `docs/roadmap/04-roadmap/`) is the live artifact. Wave4's role was to generate the production roadmap, which exists. The summary is now historical.

---

## DECISION-2: sibling-repo provenance for ported files

**Choice: 2A — commit MASTER-DEV-PLAN.md and MASTER-DREAM-ROADMAP.md in the sibling repo first; capture sibling SHA in the Phase D port commit message.**

### Rationale

1. These are two ~25kb strategic documents that will be cited heavily across the platform. They deserve real version history, not "ported from working copy at <date>" preamble.
2. The cost is one `git add && git commit` in the sibling repo, ~1 minute. Negligible.
3. SHA capture in the port commit message gives any future reader a way to reconstruct exactly what was ported when. Provenance pays back at audit time.

### Strongest case for the rejected option (2B)

The sibling repo has multiple uncommitted edits (`prompt-loader.ts`, `index.ts`, `.claude/CLAUDE.md`). Committing just the two doc files cherry-picks them out of context, potentially mis-pairing them with WIP code that's not ready. A "ported from working copy" header is more honest about the messy state.

### Why I'm rejecting it

- The two doc files are independent of the WIP code edits in the sibling. Committing them alone doesn't entangle them with anything.
- The commit message in sibling can explicitly note "snapshot for cross-repo port; companion WIP edits not yet committed."
- Honesty argument is real but solved by the commit message, not by avoiding the commit.

---

## DECISION-3: active-branch coordination

**Choice: 3B-modified — Claude drives rebase + merge of both `origin/claude/distracted-satoshi` and `origin/claude/quizzical-hopper` to main BEFORE opening the Phase D PR. If either branch has irreconcilable conflicts with main, surface to user rather than force-resolve.**

### Rationale

1. Inspecting the branches:
   - **distracted-satoshi** modifies 25+ files in client, server, omnimind. Commits include "fix: apply 29 validated fixes from adversarial audit (Wave 2)" and "fix(shared): correct type/schema mismatches." This is substantial audit-fix work, not a draft.
   - **quizzical-hopper** modifies 25+ files including a "feat: migrate brand system from indigo dark-only to warm gold light/dark" — a deliberate UI migration that the brand-system docs would be inconsistent without.
2. **Option 3A (close both) discards ~50 files of substantive work.** Unacceptable — that's months of build effort represented in those branches.
3. **Option 3C (Phase D ships first, branch authors handle rebase) is double conflict cost.** quizzical-hopper modifies `.claude/CLAUDE.md`, which Phase D also extensively edits. Branch author hits both pre-existing-with-main conflicts AND Phase D rename conflicts in one rebase. Worse experience than splitting them into two clean rebases.
4. **Option 3B contains the conflict surface area.** Two separate pre-Phase-D PRs. Phase D operates on clean main.

### "I drive" modification

The user said "use your best judgment." The pragmatic interpretation: I drive the rebase/merge work since branch authors may not be active. Specifically: I rebase both branches onto current main, resolve conflicts where mechanical, and surface anything semantic or ambiguous to user before merging.

### Strongest case for the rejected options

**3A (close both):**
- These branches are 3 weeks old. If they were urgent they would have merged. Maybe they're abandoned and the work is being redone elsewhere.
- "fix: apply 29 validated fixes" suggests an automated/throwaway pass. If those fixes are right, they should land via a fresh PR with current main as base.
- Closing forces the user to consciously decide what's worth resurrecting. 3B preserves stale work indefinitely.

**3C (Phase D first, branches handle rebase):**
- The branch authors know their work better than I do. They should resolve their own conflicts with the new tree.
- 3B blocks Phase D on dependency work that may have its own complications. 3C decouples.
- If I drive 3B and break something, blame for the breakage is on me. If branch author drives, blame stays with them.

### Why I'm rejecting them

**Against 3A:** age ≠ stale. The substantial code work in both branches has not been redone in main; closing them irrecoverably loses that work. A 5-minute branch inspection (already done above) confirms substance.

**Against 3C:** the user explicitly said "use your best judgment" — passing the work to absent branch authors who may not respond is not best judgment. Plus the `.claude/CLAUDE.md` overlap means Phase D and quizzical-hopper rebase are CONJOINED conflicts; better to resolve them in two clean stages than one ambiguous one.

---

## Open exposure (acknowledged, not resolved)

- **What if `distracted-satoshi`'s 29 fixes have been superseded by other work in main since 2026-04-08?** Possible. Mitigation: when I rebase, the diff vs main will reveal redundancy. If a fix is already in main, the rebase resolves it as a no-op.
- **What if `quizzical-hopper`'s brand-system migration conflicts with the warm-gold work that's already in main?** Possible. The CLAUDE.md describes the brand system as warm-gold light/dark — could be already merged from this branch via a different path. Mitigation: rebase will surface duplication.
- **What if a branch's tests fail after rebase?** Then I surface to user; not force-resolved.

---

*Awaiting debate-validator challenge.*
