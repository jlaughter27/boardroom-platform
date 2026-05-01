# Scope Negotiation — When and How to Renegotiate Phase Scope

**Audience:** Claude (mid-execution, hitting a snag) or human (asked to approve a scope change).
**Purpose:** Define which scope changes Claude can decide alone vs. which require user signoff. Define the process for either case so nothing gets quietly cut or quietly inflated.

The roadmap is a contract with the user. Changing the contract requires a paper trail.

---

## When to consider renegotiating scope

Scope renegotiation is appropriate when one of these triggers fires:

1. **Phase running over budget.** The phase budget is in `04-roadmap/PHASE-N-{slug}/README.md`. If actual elapsed time exceeds 1.5× budget AND the work isn't visibly close to done, it's time to renegotiate. (The "1.5×" is a soft tripwire — sometimes the last 10% legitimately takes 50% of the time. Use judgment.)

2. **Blocking dependency missing.** A phase task assumes a piece of infra, a third-party API, or a schema element that turns out not to exist. Example: Phase 6 assumes the Phase 1 entity tables are populated; if Phase 1 backfill never ran, Phase 6 has nothing to rank.

3. **New finding invalidates plan.** Mid-phase, you discover a fact that breaks the plan: an Anthropic API change, a Postgres extension limitation, a regression on a foundational test, an audit reveals an unrecorded landmine.

4. **A higher-priority task interrupts.** A production incident, a security disclosure, a customer crisis. Phase work pauses; the question is "what comes off the plan to make room?"

5. **Sequencing realization.** You realize the dependency graph in `ROADMAP-OVERVIEW.md` is wrong — Phase X actually needs Phase Y to ship first. (Phase 14 pulled forward to right after Phase 0 is the canonical example.)

If none of these are firing, **don't renegotiate**. Push through. Roadmap drift from "this is harder than I thought" is a normal part of execution, not a scope question.

---

## What Claude can decide alone (small adjustments)

Claude can adjust scope without user approval when ALL of these are true:

- The change keeps the phase's exit criteria from `01-foundations/SUCCESS-METRICS.md` intact
- The change doesn't affect any other phase's prerequisites
- The change doesn't push hard on a constraint in `01-foundations/CONSTRAINTS.md` (no new infra, no new LLM provider, no service-boundary violations)
- The time impact is within the phase's existing budget (or saves time)

Examples of allowed Claude decisions:
- Refactoring an internal helper into two files for clarity
- Choosing between two equivalent test patterns
- Renaming a private function for readability
- Adjusting an internal data shape that isn't exposed in any contract
- Picking which file to touch first within a phase
- Inlining vs extracting a small utility based on what reads cleanly

**Rule of thumb:** if a senior engineer reviewing the diff would say "this is implementation detail," Claude decides. If they'd say "we should talk about this," Claude escalates.

---

## What requires user approval (phase scope changes)

Claude does NOT decide alone — escalate via `STATUS/BLOCKERS.md` and stop the phase — when ANY of these are true:

- Cutting a task from the phase (changing exit criteria)
- Adding a task to the phase (inflating scope)
- Changing the phase's success metric (e.g. dropping a precision threshold)
- Changing the phase's time budget by more than 50%
- Introducing a new dependency (npm package, infra, third-party API)
- Touching anything in `CONSTRAINTS.md` (any ADR, any service boundary, any stack lock-in)
- Reordering phases in the roadmap (e.g. pulling Phase 14 forward)
- Marking an item DEFERRED or un-deferring an existing one
- Anything that changes the cost model in [`COST-MODEL.md`](COST-MODEL.md)

Escalation steps when Claude hits one of these:

1. **Stop work** on the in-flight task; commit any safe progress with a clear "WIP — paused for scope decision" message.
2. **Open a BLOCKERS.md entry** with: which trigger fired, what the recommended scope change is, what the alternatives are, what the impact is on dependent phases.
3. **Update PHASE-PROGRESS-TRACKER.md** — set the relevant task(s) to `blocked` and reference the BLOCKERS entry.
4. **Wait for user response.** Do not proceed on the disputed scope; switch to an unrelated task only if one is clearly safe to advance.

---

## The process (regardless of who decides)

Every scope change — whether Claude decides alone or after user approval — leaves the same paper trail:

1. **Surface in `STATUS/BLOCKERS.md`** (or, if Claude decided alone and there was no blocker, skip to step 2).
2. **Record in `STATUS/DECISIONS-LOG.md`** as a `DEC-N` entry. Include: date, trigger, decision, alternatives considered, who decided (Claude alone or user-approved), impact on other phases.
3. **Update the affected phase folder** — typically `04-roadmap/PHASE-N-{slug}/README.md` — with a `## Scope amendment` section pointing to the DEC-N entry.
4. **Update `STATUS/CHANGELOG.md`** — append an entry recording the scope change. (Reserve CHANGELOG entries for phase-level events; small Claude-decided refactors don't qualify.)
5. **If exit criteria changed,** update `01-foundations/SUCCESS-METRICS.md` and `STATUS/PHASE-COMPLETION-CRITERIA.md` to match.

Without all five steps, the change isn't real — future sessions will rediscover the original scope and undo your work.

---

## Anti-patterns

- **Quiet cuts.** "I'll just skip this one task; nobody will notice." → A future session will notice when an exit criterion fails and won't know why. Always record.
- **Quiet inflation.** "While I'm in here, I might as well also fix..." → Scope creep that turns a 1-week phase into a 3-week one. Out-of-scope finds get spawned via `mcp__ccd_session__spawn_task` or filed as a deferred item, not folded into the active phase.
- **Renegotiating to avoid hard work.** If a task is just *hard*, push through. Renegotiation is for when the plan is wrong, not when execution is uncomfortable.
- **Forgetting that DEFERRED is also a scope change.** Pushing an item to DEFERRED requires a DECISIONS-LOG entry and an addition to `04-roadmap/DEFERRED/README.md` with a measurable trigger.
- **"User isn't around, I'll just decide."** No. If the trigger says user-approval-required, the answer is `blocked`, not `Claude decides anyway`.

---

**Cross-references:**
- [`01-foundations/CONSTRAINTS.md`](CONSTRAINTS.md) — what Claude can never change without explicit ADR-level approval
- [`STATUS/BLOCKERS.md`](../STATUS/BLOCKERS.md) — where to surface scope blockers
- [`STATUS/DECISIONS-LOG.md`](../STATUS/DECISIONS-LOG.md) — where every scope change gets recorded
- [`STATUS/CHANGELOG.md`](../STATUS/CHANGELOG.md) — phase-level event log
- [`04-roadmap/DEFERRED/README.md`](../04-roadmap/DEFERRED/README.md) — where deferred items live with their triggers
