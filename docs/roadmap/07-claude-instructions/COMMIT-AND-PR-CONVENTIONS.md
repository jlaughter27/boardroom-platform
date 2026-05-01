# Commit & PR Conventions — How Code Lands in This Repo

**Audience:** Claude (about to commit) or human contributor.
**Purpose:** Concrete rules for commit messages, commit cadence, PR descriptions, and direct-push vs PR decisions. Specific to this repo (Railway auto-deploy on `main`).

For the global rule baseline, see `~/.claude/rules/common/git-workflow.md`. This doc adds the BoardRoom-specific bits.

---

## Commit message format

```
<type>: <short description>

<optional body — what changed and why>
<optional body — links to ADRs, issues, audit items>
```

**Types** (from common rules):
- `feat` — new feature
- `fix` — bug fix
- `refactor` — restructure without behavior change
- `docs` — docs-only
- `test` — tests-only
- `chore` — config, deps, build
- `perf` — performance improvement
- `ci` — CI config

**Subject line:** under 72 chars, imperative mood ("add", not "added"), no trailing period.

**Body:** wrap at 72 chars. Explain the *why*, not the *what* (the diff shows the what). Reference ADRs when applicable: `Per ADR-002, ...`. Reference audit items as `audit item #N`.

**Examples from this repo's history (good shape to mimic):**

```
feat(ui): finish the rebrand — PWA install package, scrollbar + shimmer tint, dashboard hero, README
fix(client): unbreak black-screen render — remove jsonwebtoken/bcryptjs from @boardroom/shared client bundle
feat(onboarding): bootstrap flow — single-shot profile extraction from doc/paste/voice
```

**Note on attribution:** Per the user's global git-workflow rule, attribution is disabled via `~/.claude/settings.json`. **Do not append `Co-Authored-By: Claude ...` lines** unless the user explicitly opts in for a specific commit.

---

## When to commit during a phase

Default: **commit per task, not per phase**.

The roadmap phases break down into atomic tasks in each `04-roadmap/PHASE-N-{slug}/tasks-and-prompts.md`. Each task is sized to be one logical commit: typecheck green, tests green, single-purpose diff.

**Commit per task when:**
- The task has a clear "done" signal (file deleted, migration applied, test passing)
- The diff is reviewable on its own
- Reverting just this task is meaningful

**Commit per phase only when:**
- The phase is structurally one indivisible change (rare — usually a sign the phase is sized wrong)
- All tasks in the phase share the same test surface and partial commits would leave the test suite red

**Don't:**
- Batch unrelated changes into one commit "to save time"
- Commit work-in-progress that fails typecheck
- Commit after only running typecheck — also run tests

---

## Pre-commit gate (non-negotiable)

Before every commit:

```bash
npm run typecheck   # All packages
npm run test        # ~708 tests, Vitest
```

Both must exit 0. If a test you didn't touch is failing on `main`, that's a separate problem — log it in `STATUS/BLOCKERS.md` and either fix it as a separate commit or coordinate with the user. **Don't commit on top of a red main.**

For Phase 0.5+ work, also run the eval harness when it ships:

```bash
npm run eval:retrieval   # Or whichever eval is relevant to your change
```

See [`EVAL-HARNESS-USAGE.md`](EVAL-HARNESS-USAGE.md) for when the eval gate applies.

---

## When to push direct to `main` vs open a PR

**Both services auto-deploy on push to `main`.** This means every push is effectively a deploy. Choose the path accordingly.

**Push direct to `main` when:**
- The change is a docs-only update (no code)
- The change is a single-file fix that you've tested locally and the user explicitly asked for direct-to-main
- You're inside an active phase that the user is supervising in real time

**Open a PR when:**
- The change touches `prisma/schema.prisma` (because of the `--accept-data-loss` landmine — see [`COMMON-PITFALLS.md`](COMMON-PITFALLS.md) #3)
- The change touches Docker, the entrypoint, or middleware ordering
- The change crosses the BoardRoom ↔ OmniMind seam (`omnimind-client.ts`, `omnimind-api/src/routes/`)
- The change adds or removes an ADR
- The change is large (>300 lines or >5 files)
- The change is on a long-lived feature branch and needs review batching

**Always open a PR when:**
- The user has not explicitly authorized direct push for this session
- You're working on `feature/*` or `bugfix/*` branches

When in doubt, open a PR. The cost of a PR (a few minutes of review) is much lower than the cost of an auto-deployed regression.

---

## PR description template

Use this format. Title under 72 chars; details in the body.

```markdown
## Summary

<1-3 bullets of what changed and why>

## Roadmap context

- Phase: <N — name>
- Task: <task title from tasks-and-prompts.md>
- ADRs touched: <list, or "none">
- Audit items addressed: <list, or "none">

## Changes

- <file or area>: <what changed>
- <file or area>: <what changed>

## Test plan

- [ ] `npm run typecheck` green
- [ ] `npm run test` green (count: X passing)
- [ ] Eval harness delta: <MRR / nDCG / P@5 before vs after, or N/A>
- [ ] Manual test: <what you verified locally>
- [ ] Rollback plan: <one sentence — usually `git revert` or "rerun migration N"`>

## Deploy notes

- Schema change? <yes/no — if yes, what's the data-loss surface>
- Env var change? <yes/no — if yes, list the new vars>
- Background job change? <yes/no>
- Breaking API change? <yes/no — if yes, who's affected>
```

The "Deploy notes" section is what saves the next on-call from a 2am surprise.

---

## Branch naming

| Prefix | Use |
|---|---|
| `feature/<slug>` | New features, including roadmap phases (e.g., `feature/phase-0-foundation`) |
| `fix/<slug>` | Bug fixes |
| `refactor/<slug>` | Cleanup, dead code removal |
| `docs/<slug>` | Docs-only |
| `chore/<slug>` | Deps, config, CI |

Avoid generic names like `fix/bug` or `feature/update`. The slug should match the work.

---

## Don'ts

- **Don't commit secrets.** Even briefly. Even in test files. Even commented out. If you accidentally do, rotate the secret and history-rewrite within the same session.
- **Don't `git add -A` blindly.** This repo has many untracked scratchpad files (see `git status` output for the live set). Use `git add <specific files>`.
- **Don't `git push --force` to `main`.** Ever. If you need to undo a bad commit, use `git revert`.
- **Don't `git push --force` to a shared feature branch** without telling the user.
- **Don't skip the typecheck/test gate** because "it's just docs." If your diff includes any `.ts` file, run the gate.
- **Don't merge a PR with red CI.** There is no CI gate on this repo today (manual typecheck/test) — but if a CI workflow appears later, treat its failures as binding.
- **Don't squash-merge multi-task PRs into one commit.** The per-task history is the audit trail; squashing erases the trace of what landed when.