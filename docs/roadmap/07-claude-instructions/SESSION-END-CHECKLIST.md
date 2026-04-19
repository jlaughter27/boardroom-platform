# Session End Checklist — Before You Sign Off

**Audience:** Claude (every session, before producing the final summary message).
**Purpose:** A six-step checklist that turns the abstract guidance in [`HANDOFF-TEMPLATE.md`](HANDOFF-TEMPLATE.md) into a concrete pre-flight. Each step has a clear "done" signal.

If you skip any of these, the next session starts cold and may undo or duplicate your work.

---

## Step 1 — Update `STATUS/CHANGELOG.md`

**Done when:** A new dated entry is appended to the file with: phase number, 1-3 bullets of what shipped, files touched, test result, deploy status, and a "Next session:" line.

Format:

```markdown
## YYYY-MM-DD — Phase X — Brief action title

- What was done (1-3 bullets)
- Files touched (paths)
- Tests run + result
- Deploy status (if applicable)

Next session: [what's next, 1 sentence]
```

CHANGELOG is **append-only**. Never edit prior entries. If the work was research/planning only (no code), still log it — the next Claude needs to know research was done.

## Step 2 — Update `STATUS/CURRENT-PHASE.md` if state changed

**Done when:** The file accurately reflects the current active phase, the next 5 actions, and any open decisions — OR you've confirmed nothing changed and left it alone.

This file is **overwritten**, not appended. Update if any of these changed:
- Active phase number
- Next 5 actions list
- Open decisions

If your session completed a phase, update the phase number to the next one and seed its next-actions list from `04-roadmap/PHASE-N+1-{slug}/tasks-and-prompts.md`.

If your session was research-only and the active phase didn't move, leave it alone.

## Step 3 — Update `STATUS/DECISIONS-LOG.md` if any non-trivial decision was made

**Done when:** Either a new decision entry is added, OR you've consciously confirmed no decision-worthy choice happened.

What counts as a non-trivial decision (per [`HANDOFF-TEMPLATE.md`](HANDOFF-TEMPLATE.md)):
- Picked one technical approach over another with the user's input
- Deferred something previously planned
- Added something not in the roadmap
- Discovered a constraint that changes how a phase should be built

What does NOT count:
- Routine code edits
- Bug fixes that don't change architecture
- Following an existing plan as written

If unsure, err toward logging. A 3-line decision entry costs nothing; an unlogged decision that surprises the next session costs hours.

## Step 4 — Update `STATUS/BLOCKERS.md` if a blocker was added or removed

**Done when:** Every active blocker reflects current reality.

Add a blocker if:
- Your session hit something it couldn't resolve (missing env var, schema conflict, external service down, ambiguous requirement)
- You discovered a precondition for a future phase that isn't met yet

Remove a blocker if:
- Your session resolved it (note in CHANGELOG which blocker was cleared)

A blocker entry should include: what's blocked, what's blocking it, who/what would unblock it, severity (HIGH/MED/LOW), date added.

## Step 5 — Run typecheck + tests if code shipped

**Done when:** Both `npm run typecheck` and `npm run test` exit 0 — OR you've explicitly noted in CHANGELOG that they did not pass and why.

Commands:

```bash
npm run typecheck   # Across all packages
npm run test        # Vitest, ~708 tests
```

If a test you didn't touch is failing, that's a separate problem — log it in BLOCKERS.md and don't claim "tests green" in CHANGELOG. Honest red is better than dishonest green.

For research-only or docs-only sessions, this step is N/A but mention it in CHANGELOG ("no code shipped, tests not run").

## Step 6 — Brief the user with the next-session direction

**Done when:** Your final message includes:
- One sentence on what shipped
- One sentence on what's next
- Any blocker the next session must resolve before continuing

Example:

> "Shipped: Phase 0 task 3 — dropped `searchVector` column, migration committed (`20260418_drop_search_vector`), all tests green. Next: Phase 0 task 4 (move root scratchpad markdown to `docs/_archive/`). No blockers."

This brief is what the human relays to the next Claude — make it precise.

---

## What "done" means at the session level

A session is complete when **all six steps above are checked**. If you skip step 5 because tests were red, the session is **not complete** — surface the failure to the user instead of pretending the work landed.

---

## Anti-patterns

- **Marking a session done before running tests.** The next Claude inherits a broken main.
- **Putting decisions in CHANGELOG instead of DECISIONS-LOG.** They're separate files for separate purposes; mixing them means decisions get lost in chronological noise.
- **Editing CHANGELOG retroactively** to "clean up" a prior entry. CHANGELOG is the audit trail. If something was wrong, add a new corrective entry; don't rewrite history.
- **Skipping STATUS/ updates because the session was small.** Even small work that resolved a blocker must update BLOCKERS.md.
- **Verbose final summaries that bury the next-session direction.** The human is going to copy-paste the last sentence into the next Claude's prompt. Keep it precise.
- **Updating STATUS/ at session start "to plan."** STATUS/ reflects what shipped, not what you intend. Plan in your head; record in STATUS/ at the end.

---

## When you genuinely cannot complete the checklist

If you hit a merge conflict on STATUS/, can't summarize because the work wasn't conclusive, or any other reason you can't update STATUS/ cleanly:

1. Do **not** end the session silently.
2. Tell the user explicitly: "I made changes but couldn't update STATUS/{file} because {reason}."
3. Wait for the user to either help resolve or accept the lost-context risk knowingly.

The cost of one extra back-and-forth is much smaller than the cost of the next session starting blind.