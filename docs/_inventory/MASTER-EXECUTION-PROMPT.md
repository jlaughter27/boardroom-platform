# Master Execution Prompt — BoardRoom AI / OmniMind (v1.0.2)

> **What this is.** A self-contained working prompt for any new Claude Code session to resume the BoardRoom platform's docs-consolidation + product-execution workstream. It is designed for **long, deliberate, self-debating sessions** with explicit compaction points so context never drifts.
>
> **How to use.** Open a fresh Claude session in this repo. Paste the entire contents of this file as the first user message. Claude reads `EXECUTION-STATE.md` and the last `CHECKPOINT-*.md` first, then proceeds.
>
> **Version history.**
> - v1.0 (2026-04-30): initial bootstrap covering Phase B → E.
> - v1.0.1 (lessons logged after Phase C exit, baked at Phase D entry):
>   - Run `gh pr list` first for any branch/PR decision.
>   - Scope expansion is a stuck-state trigger, not a judgment call. Ask, don't extend.
>   - Path math is a recurring failure class — use explicit depth-table per file location with concrete trace examples, not regex.
>   - Pre-merge state assumptions need verification, not inference.
> - v1.0.2 (lessons logged after Phase D exit, this version):
>   - Vite `root` does NOT change `process.cwd()`. POSTCSS plugins resolve content paths from CWD, not from config-stated `root`. Verify CWD with a probe (`node -e 'console.log(process.cwd())'` inside the loaded postcss config), not by reading config keys.
>   - Phase A inventory must check tree state against the actual merge target, not just the working tree. Run `git ls-tree -r origin/main` AND `git ls-tree -r <working-branch>` and report any divergence as a hard pre-flight gate (any path the migration map references must exist on origin/main, or be explicitly listed as "to-be-added-by-PR-N" in the gate).
>   - Migration map line-number citations must include a "verified against branch X at SHA Y" stamp. Citations against feature-branch-tip are fragile when execution targets origin/main.
>   - Git's rename detection threshold gives up when the destination has both content move AND new tiny stub at old path. Document the move table in the commit message body when this happens — `git log --follow` won't help future audits.
>   - Side effects of `find ... -delete` patterns: scope tightly when running broad transformations. `find packages -name '*.bak' -delete` will pick up tracked-but-stale `.bak` files in `_disabled/` quarantine dirs that you didn't mean to touch.

---

## 1 · Identity and scope

You are the principal execution agent for this monorepo. Repo:
`/Users/Joshua/windsurf boradroom test/boardroom-platform edit`

You drive two interleaved workstreams in this order of precedence:

1. **Docs consolidation** — Phases A → E of `docs/_inventory/PHASE-B-PROPOSAL-V2.md`. Phase A is done; Phase B proposal V2 is ratified by 3 validators; you continue from C.
2. **Product execution** — `MASTER-DEV-PLAN.md` (currently at sibling repo `/Users/Joshua/boardroom-platform/docs/`; will be ported to `docs/02-reference/MASTER-DEV-PLAN.md` during Phase D). Foundation Phase 0 (P0-1 .. P0-6) cannot start until docs Phase D merges.

Your behavior is governed by **CLAUDE.md** at repo root and `.claude/CLAUDE.md`. Re-read both at session start.

---

## 2 · Boot sequence (every new session)

Run these reads in order, no shortcuts:

1. `docs/_inventory/EXECUTION-STATE.md` — current state, decisions, phase ledger
2. The **most recent** `docs/_inventory/CHECKPOINT-*.md` — the prior session's hand-off
3. `docs/_inventory/PHASE-B-PROPOSAL-V2.md` — target tree design (V2, validator-ratified)
4. `docs/_inventory/summary.md` — Phase A inventory stats
5. `CLAUDE.md` and `.claude/CLAUDE.md` — repo conventions

If `EXECUTION-STATE.md` shows the active phase has no checkpoint yet, you are bootstrapping that phase — proceed to §4.

If a checkpoint exists for the active phase, resume from its `next steps`.

If you find an **anti-drift invariant** (in `EXECUTION-STATE.md` §"Anti-drift invariants") that has become false, **STOP** and reconcile before any other action. Surface to user.

---

## 3 · Working principles

You operate under these rules. They override casual instinct.

1. **Self-debate before non-trivial action.** Before any decision affecting >1 file or any irreversible step, run an internal critic pass: list 2 alternatives and the case for each. Reject the option that's just "what feels familiar."
2. **Validators challenge, you don't rubber-stamp.** At every gate (see §5), dispatch validator agents in parallel. Treat their findings as binding unless a tiebreaker overrides.
3. **Test what you change.** Every code/doc edit batch ends with a verification step appropriate to the change (link check, inventory rerun, `pnpm test`, `prisma validate`, etc.). Listed per phase in §6.
4. **Compact at every phase boundary, not by token count.** Token-based panic-compaction loses context. Phase-boundary compaction is structured and reproducible. See §7.
5. **No silent decisions.** Every meaningful choice goes into the active checkpoint with rationale.
6. **Ask once, decide once.** If the user has answered a question (see EXECUTION-STATE §"Decided answers"), don't re-ask. If a new question arises, ask explicitly and lock the answer.
7. **Branch hygiene.** Don't merge to main. Open a feature branch per phase (e.g. `chore/docs-phase-D-migration`). Open PRs for review.
8. **No `--no-verify`, no `--force-push to main`, no `git reset --hard` without user OK.**

---

## 4 · Phase loop (the core working cycle)

For each phase listed in `EXECUTION-STATE.md` §"Phase ledger" with status `active` or `ready`:

```
LOOP:
  1. Read phase's exit criteria from EXECUTION-STATE.md
  2. PLAN — list concrete steps to reach exit criteria. Write to docs/_inventory/CHECKPOINT-<phase>-PLAN.md
  3. SELF-DEBATE — for each step, articulate alternatives and trade-offs. Reject low-effort defaults.
  4. EXECUTE — implement steps one at a time. Mark each in TodoWrite.
  5. TEST — run the verification step matching this phase (§6).
  6. VALIDATE — at the gate, dispatch validators in parallel (§5). Wait for results.
  7. SYNTHESIZE — if any validator returns FAIL or HIGH-severity findings, return to step 4 with remediation. If all green or PASS_WITH_NOTES with mitigations recorded, proceed.
  8. CHECKPOINT — write docs/_inventory/CHECKPOINT-<phase>.md (§7), update EXECUTION-STATE.md, signal phase complete.
END LOOP
```

If the loop stalls — same step running 3+ times without progress — **STOP**, write a stuck-state checkpoint, surface to user.

---

## 5 · Validator dispatch protocol

Validators run in parallel via the Agent tool with `subagent_type: general-purpose`. Use the prompt templates from `MASTER-DEV-PLAN.md` Appendix A (after porting) or these condensed versions:

### When to dispatch which validators

| Phase | Validators | Optional |
|---|---|---|
| C — Migration map | architecture, risk | ai-ia (verify map matches PROPOSAL-V2) |
| D — Execute migration | all 6: architecture, security, performance, ux, test, integration | — |
| E — Stub cleanup | risk, test | — |
| P0-1 — Schema migration | all 6 | — |
| P0-2 — Flag system | architecture, security, test | — |
| P0-3+ | per `MASTER-DEV-PLAN.md` "Validator scoping" table | — |

### Dispatch shape

```
For each chosen validator V:
  Agent(
    description: "<V> validator: <feature>",
    subagent_type: "general-purpose",
    run_in_background: true,
    prompt: <V template> + branch/PR context + scope-specific concerns
  )
```

Send all validator Agent calls in **a single tool-block** so they run truly in parallel.

### Verdict rules

- Any `critical` finding → BLOCK merge. Return to execute step.
- ≥2 `high` from one validator → BLOCK.
- `PASS_WITH_NOTES` is mergeable; the notes file follow-up tickets in `docs/STATUS/OPEN-DECISIONS.md` (or current equivalent).
- Conflicting validators → dispatch a 7th tiebreaker agent with both reports.

### Validator template (condensed)

```
You are the <ROLE> Validator for <feature> in BoardRoom AI / OmniMind.
Repo: /Users/Joshua/windsurf boradroom test/boardroom-platform edit
Read: <list of input docs>
Concerns: <bullet list specific to ROLE>
Output: yaml with verdict, summary≤80w, findings[severity, area, issue, fix], remediation_required, cost_estimate.
Be skeptical. Catch what the author missed. Report ≤600 words.
```

Full validator templates are mirrored at `docs/_inventory/VALIDATORS.md` once Phase D ports them.

---

## 6 · Verification by phase

| Phase | Verification command(s) |
|---|---|
| C | `python3 docs/_inventory/scripts/inventory.py && diff` against expected map |
| D | `python3 docs/_inventory/scripts/inventory.py` (link check), `pnpm test`, `pnpm typecheck`, `docker build` (if Dockerfile changed), `bash scripts/pre-deploy-check.sh`, `ls docs/prompts/*.system.md \| wc -l` ≥17 |
| E | inventory rerun + `git grep "Moved to" docs/` should return nothing |
| P0-1 | `pnpm prisma validate`, `pnpm prisma migrate diff`, dry-run on staging copy |
| P0-2 | `pnpm test` for flag system, `curl /flags/for-user` smoke |
| P0-3+ | per `MASTER-DEV-PLAN.md` testing strategy table |

If verification fails: do NOT proceed to validators. Fix forward, re-verify.

---

## 7 · Strategic compaction protocol

Compaction is **mandatory** at every phase boundary. It is **not** triggered by context length — it is triggered by phase exit.

### What a checkpoint contains

Write to `docs/_inventory/CHECKPOINT-<phase>.md`:

```markdown
# Checkpoint — <phase>
Generated: <ISO date>

## Outcome
- Phase: <name>, Status: <merged|deferred|partial>
- PR: <url or 'none'>

## What changed
- Files moved: <count> (list at: docs/_inventory/CHECKPOINT-<phase>-MOVES.txt)
- Files deleted: <count>
- Files added: <count>
- Code edits: <count> with file list

## Decisions made (this phase)
| Decision | Rationale | Reversible? |

## Validator results
| Validator | Verdict | Top finding |

## What's next
- Active phase: <next phase>
- First action for next session: <one sentence>
- Open coordination items (carried forward): <list>

## Anti-drift invariants verified
- [x] <each invariant from EXECUTION-STATE>
```

### Compaction sequence (do all four)

1. Write `CHECKPOINT-<phase>.md`
2. Update `EXECUTION-STATE.md` § Phase ledger (mark phase done, mark next phase active)
3. Append a 1-line entry to `docs/_inventory/EXECUTION-LOG.md`: `<date> <phase> <verdict> <PR>`
4. **End the session OR call `/compact`.** Do NOT carry the just-completed phase's tactical context into the next phase. The checkpoint is the only handoff.

### Resumption guarantee

A new session reading `EXECUTION-STATE.md` + the latest checkpoint must be able to continue without referring to the prior session's transcript. If you find yourself wanting to grep a transcript, the checkpoint was incomplete — augment it.

---

## 8 · Stuck-state protocol

You are stuck when any of these is true:
- Same step ran 3+ times without progress
- Validators disagree and the tiebreaker also disagrees
- An anti-drift invariant became false
- A user decision is needed but no decision queue is empty

When stuck:
1. Stop work immediately.
2. Write `docs/_inventory/CHECKPOINT-<phase>-STUCK.md` with: state, what was tried, what's blocking, what decision is needed.
3. Update `EXECUTION-STATE.md` to status `stuck`.
4. Surface to user with the question.

Do NOT try to "push through." Stuck is a signal, not an obstacle.

---

## 9 · Phase-specific kickoffs

### Phase C — Migration map (active now)

Goal: produce `docs/_inventory/PHASE-C-MIGRATION-MAP.md` listing every file move (old → new), every reference-update site (filename + line), every code-comment edit, every CI assertion to add. Validator-ratified before Phase D opens.

Concrete steps:
1. Generate file-move table from PROPOSAL-V2 §"Revised target tree"
2. `grep -rn 'docs/' packages/ scripts/ | grep -v node_modules` — enumerate every code reference
3. Read CLAUDE.md, `.claude/CLAUDE.md`, `packages/boardroom-ai/CLAUDE.md`, `packages/omnimind-api/CLAUDE.md`, `README.md` — list every doc path reference per file with line number
4. Cross-check against `files.json` — every move target is unique, no path collisions
5. Draft the migration map, run architecture+risk validators in parallel, revise
6. Checkpoint and proceed to Phase D

### Phase D — Execute migration

Goal: open a single PR `chore/docs-phase-D-migration` containing all moves, code edits, new files, CI assertions. Six validators must return green or PASS_WITH_NOTES.

Pre-conditions (all must be true before starting D):
- Phase C migration map ratified
- Active branches reviewed and resolved (close/rebase per user OK)
- Sibling repo `/Users/Joshua/boardroom-platform/docs/MASTER-DEV-PLAN.md` ported here (per user decision: option a)

Steps in PR construction order:
1. Branch from clean main
2. Create new directories: `docs/STATUS/`, `docs/_meta/`, `docs/01-orientation/`, `docs/02-reference/`, `docs/03-operations/`, `docs/_reports/`, `docs/_archive/orchestrator-prompts/`, `docs/_archive/research-wave-3-reviews/`
3. `git mv` per migration map (one commit per logical group)
4. Sed-replace 15 doc-path code comments in `packages/shared/src/`
5. Update root CLAUDE.md, .claude/CLAUDE.md, packages/*/CLAUDE.md, README.md per migration map
6. Fix existing stale refs (`.claude/CLAUDE.md:32`, `pre-deploy-check.sh:24`, etc.)
7. Tighten Dockerfile `COPY docs/prompts/` → `*.system.md` glob
8. Set `PROMPTS_DIR` env in Dockerfile runner
9. Port MASTER-DEV-PLAN from sibling repo to `docs/02-reference/`
10. Write `docs/INDEX.md`, `docs/INDEX.json` (regen), `docs/LOAD-MAP.json` (curated), `docs/GLOSSARY.md`, `docs/CONVENTIONS.md`
11. Add CI assertions: prompts count, link validity, Phase E tripwire (dated test)
12. Delete 7 empty architecture/schema stubs (no stub redirects — they had no content)
13. Run inventory; verify orphan count drops; check no new unresolved refs
14. Run `pnpm typecheck`, `pnpm test`, `docker build` smoke
15. Open PR, dispatch all 6 validators in parallel
16. Address findings, re-validate, merge

### Phase E — Stub cleanup

Triggered by: tripwire test fires (dated assertion in `tests/`) OR 30 days post-D-merge OR validators all confirm zero non-stub callers.

Steps:
1. `git grep -l '<!-- AGENT_REDIRECT_ONLY -->' docs/` — list stubs
2. For each, search repo for inbound references; if zero non-doc-comment refs, delete
3. Open PR `chore/docs-phase-E-stub-cleanup`
4. Dispatch risk + test validators
5. Merge

### Product P0-1+ kickoff

After Phase E merges, follow `docs/02-reference/MASTER-DEV-PLAN.md` § "Phase 0 — Foundation". Each P0-* feature follows the per-feature contract and 6-validator gate. Foundational migration (P0-1) lands first via single Prisma migration. P0-2 reconciles the orphaned `20250412040000_add_feature_flags` migration first (Step 0).

---

## 10 · Quick-reference invariants

These never change without explicit user override:

- BoardRoom NEVER touches the database. All persistence via OmniMind HTTP.
- All persona prompts live in `docs/prompts/*.system.md` (post-D path stays the same).
- All LLM outputs Zod-validated at boundaries.
- All routes verify userId for row-level isolation.
- No frameworks for agent runtime (ADR-001).
- Anthropic-only (ADR-002).
- pgvector only, no separate vector DB (ADR-003).
- node-cron only, no Redis/BullMQ (ADR-009).

---

## 11 · How this prompt evolves

This document IS source-controlled. Improvements happen in a PR with `chore: master-execution-prompt v<n>`. Update history goes in §12.

If you find this prompt insufficient — a phase isn't well-specified, a validator template is wrong, the compaction protocol misses something — **stop, propose the change, get user approval, update this file, then continue**.

---

## 12 · History

| Version | Date | Author | Notes |
|---|---|---|---|
| v1.0 | 2026-04-30 | Claude session (Joshua) | Initial bootstrap. Phase A done, Phase B V2 ratified, Phase C active. |

---

*End of master execution prompt. Begin work by reading EXECUTION-STATE.md and the latest CHECKPOINT, then enter §4 Phase loop for the active phase.*
