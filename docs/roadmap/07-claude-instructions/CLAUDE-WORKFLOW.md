# Claude Workflow — How to Use This Roadmap

**Audience:** Claude, every new session.
**Purpose:** Tell you which 2-3 files to load for the task at hand. Saves you from re-reading the whole repo.

---

## Step 1: Identify your task type

Match what the user just asked you to one of these task types:

| Task type | Files to read (in order) | Total context |
|---|---|---|
| **A. Pick up an active phase and execute** | `STATUS/CURRENT-PHASE.md` → `04-roadmap/PHASE-N/README.md` → `04-roadmap/PHASE-N/tasks-and-prompts.md` | ~3-5 KB |
| **B. Audit / status report** | `02-current-state/CAPABILITIES-INVENTORY.md` → `02-current-state/KNOWN-ISSUES.md` → `STATUS/CURRENT-PHASE.md` | ~5-8 KB |
| **C. Risk review** | `06-risks-and-mitigations/RISK-REGISTER.md` → `06-risks-and-mitigations/6-MONTH-FORECAST.md` | ~4-6 KB |
| **D. Design a new feature** | `05-features-to-10/FEATURE-INDEX.md` → specific feature spec | ~3-5 KB |
| **E. Resolve an architectural question** | `01-foundations/CONSTRAINTS.md` → `01-foundations/ADR-INDEX.md` → relevant section of `08-references/adrs/` | ~6-10 KB |
| **F. Debug a production issue** | `02-current-state/LANDMINES.md` → `06-risks-and-mitigations/OPERATIONAL-RISKS.md` → relevant phase rollback (`04-roadmap/PHASE-N/testing-and-rollback.md`) | ~4-6 KB |
| **G. Refactor / clean up** | `02-current-state/DEAD-CODE.md` → `02-current-state/TECH-DEBT.md` | ~3-4 KB |
| **H. Update planning docs** | `STATUS/DECISIONS-LOG.md` → relevant frozen doc | varies |
| **I. Security incident triage** (acute mode — "this is happening RIGHT NOW") | `02-current-state/LANDMINES.md` (L1..L10 — find the closest match) → `06-risks-and-mitigations/SECURITY-RISKS.md` (per-finding mitigation + residual risk) → relevant phase rollback (`04-roadmap/PHASE-N/testing-and-rollback.md`) → `07-claude-instructions/COMMON-PITFALLS.md` (security-incident section) | ~5-8 KB |

If your task doesn't fit any of these, default to **A** (pick up active phase) and add `PROJECT-CONTEXT.md` for orientation.

## Step 2: Load context, then act

After reading the files in Step 1, you have everything you need. **Do not** read random other files for "background." If a referenced file is needed, the load-order doc names it explicitly.

## Step 3: Update STATUS/ before ending the session

This is non-negotiable. Every session ends by appending to:

- `STATUS/CHANGELOG.md` — what shipped
- `STATUS/DECISIONS-LOG.md` — what was decided (if any)
- `STATUS/CURRENT-PHASE.md` — what's next (if state changed)
- `STATUS/BLOCKERS.md` — what's blocked (if any)

Use [`HANDOFF-TEMPLATE.md`](HANDOFF-TEMPLATE.md) for the format. This is how the next Claude session picks up cold without losing context.

## Anti-patterns

- **Reading the entire `docs/` tree to "be thorough."** This burns tokens and produces worse output. Trust the load-order map.
- **Re-running research that's already in `03-research/`.** Cite the file; don't re-derive.
- **Editing `01-foundations/`, `04-roadmap/PHASE-*/README.md`, or `06-risks-and-mitigations/` mid-execution.** These are frozen. Update via ADR.
- **Spawning subagents to do work the load-order doc covers.** Subagents are for *new* research or audit, not for re-reading what's already written.
- **Skipping STATUS/ updates.** Every session that doesn't update STATUS makes the next session start cold.

## When to spawn subagents

Subagents are appropriate for:
- Genuinely new research (web research, exploring a part of the codebase not mapped in `02-current-state/`)
- Multi-perspective audits (security, performance, etc.)
- Building large new artifacts (a new feature spec, a new phase)

Subagents are NOT appropriate for:
- Re-reading docs that are already summarized
- Executing single tasks where the prompt and context fit in one Claude call
- "Validating" decisions already in `01-foundations/CONSTRAINTS.md`

## Critical reminders

- **Service boundary is inviolable.** BoardRoom never touches Postgres directly. Every data operation goes through OmniMind HTTP.
- **`prisma db push --accept-data-loss` is in the production entrypoint.** This is the #1 landmine. Touching schema requires extreme care.
- **The 7 personas share an entity graph, not messages.** Don't propose message-passing patterns.
- **Anthropic-only LLM (ADR-002).** No exceptions in v1.
- **Prompts live in `docs/prompts/*.system.md`.** Never embed prompt strings in TypeScript.
