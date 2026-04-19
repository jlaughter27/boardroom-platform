# Session Start Checklist — The First 8 Minutes

**Audience:** Claude (every new session), the moment after reading the user's first message.
**Purpose:** Five concrete steps to take before writing any code or doing any deep research. Total wall-clock: ~8 minutes.

If you skip these, you will start cold, miss the active phase, and produce output that contradicts what the previous Claude session shipped.

---

## Step 1 — Read `STATUS/CURRENT-PHASE.md` (1 min)

This file tells you exactly what's in flight. It is overwritten each session, so it's the freshest signal in the repo.

What you're looking for:
- Active phase number and name
- Next 5 actions list
- Open decisions

If `CURRENT-PHASE.md` is missing or empty, you're starting fresh — skip to Step 3 with `PROJECT-CONTEXT.md` as your first read.

## Step 2 — Identify your task type via `CLAUDE-WORKFLOW.md` (30 sec)

Match the user's request to one of the eight task types in the [task-type table](CLAUDE-WORKFLOW.md#step-1-identify-your-task-type) (A–H):

- A. Pick up active phase
- B. Audit / status report
- C. Risk review
- D. Design a new feature
- E. Architectural question
- F. Debug a production issue
- G. Refactor / clean up
- H. Update planning docs

Don't agonize over the match. If two types fit, pick the more specific one. If none fit, default to **A**.

## Step 3 — Load 2-3 files per `CONTEXT-LOAD-ORDER.md` (5 min)

[`CONTEXT-LOAD-ORDER.md`](CONTEXT-LOAD-ORDER.md) maps your task type to the exact 2-3 files you need. Read them in order. **Do not** read other files for "background."

Examples:
- Task type A on Phase 0: read `04-roadmap/PHASE-0-foundation/README.md` → `tasks-and-prompts.md` → `02-current-state/DEAD-CODE.md` → `06-risks-and-mitigations/DATA-RISKS.md`.
- Task type F (debug): read `02-current-state/LANDMINES.md` → `06-risks-and-mitigations/OPERATIONAL-RISKS.md` → the relevant phase rollback doc.

If a referenced file says "see X for detail" and X is not in the load-order list, you can read it — but only if it's directly relevant to *this* task.

## Step 4 — Check `STATUS/BLOCKERS.md` for relevant blockers (1 min)

A blocker that touches your task changes everything. Examples:
- "Phase 1 blocked on Phase 14 migration history" — don't start Phase 1.
- "Embedding queue tripping circuit breaker in prod" — don't merge anything that adds embedding load.
- "Schema change in flight from prior session, uncommitted" — don't start a parallel schema change.

If your task is blocked, surface it to the user immediately. Don't try to work around the blocker silently.

## Step 5 — Confirm understanding to the user before starting (1 sentence)

State what you're about to do in one sentence. Example:

> "I'll pick up Phase 0 task 3 (drop the `searchVector` column + add migration), based on `STATUS/CURRENT-PHASE.md`. No blockers in `BLOCKERS.md`. Starting now."

This single sentence catches misalignment before you burn context. If the user disagrees, the cost is one sentence of yours; if you'd skipped this step, the cost is the entire session.

---

## Anti-patterns to avoid

- **"Let me read the whole codebase to be safe."** This burns 30-50% of your context budget on reads that produce zero output. Trust the load-order map.
- **"Let me re-derive the architecture from `MASTER-FRAMEWORK.md` first."** That doc is 80kb. Read the focused 2-3 files and expand only if needed.
- **Spawning a research subagent before you've read `STATUS/`.** The subagent will produce work that contradicts what shipped yesterday.
- **Starting work without confirming understanding.** A single misaligned word in the user's prompt can send you down a 100k-token detour. The 1-sentence check costs almost nothing.
- **Skipping `BLOCKERS.md` "because there are usually none."** Blockers are exactly the things that make sessions go sideways. Always check.
- **Treating `PROJECT-CONTEXT.md` as required reading every session.** It's the orientation doc for *new* sessions, not the per-task context. If you've worked on this project recently, you don't need to re-read it.

---

## Special cases

**No `STATUS/` files exist yet.** Read `PROJECT-CONTEXT.md` and `04-roadmap/ROADMAP-OVERVIEW.md`, then ask the user what phase they want to start with.

**The user's request is "do X" with no roadmap context.** Map X to a task type, follow the load order, then ask the user whether X belongs in the active phase or is a side request that should be tracked separately.

**You're picking up mid-task from a previous session that crashed or compacted.** Read `STATUS/CHANGELOG.md`'s most recent entry — it should have a "Next session:" line. That's your starting point.

---

## Why this checklist exists

A previous Claude session spent 80k tokens reading every file in `docs/` before realizing the user just wanted a single config edit. The work that should have taken 5 minutes took 45 and burned through compaction. This checklist exists to prevent that pattern from repeating.