# Phase E Playbook — Stub Cleanup

> **Status:** ARMED. Will fire when `tests/e2e/phase-e-stub-cleanup-due.test.ts` reports the tripwire is overdue (30 days post-Phase-D merge).
> **Generated:** 2026-05-01 (Phase D exit)
> **Owner:** Whichever Claude session picks up the work after the tripwire fires.

---

## Trigger

The tripwire test `tests/e2e/phase-e-stub-cleanup-due.test.ts`:

1. Looks up the most recent merge commit on main whose subject contains `"Phase D"` (case-insensitive)
2. Computes that date + 30 days
3. If today ≥ that date AND `git grep -l -E '^> Moved to .*<!-- AGENT_REDIRECT_ONLY -->' -- 'docs/' ':!docs/_inventory/'` returns ≥1 file → test FAILS

When the test fails, Phase E is overdue. Open a Phase E PR within a week.

## Phase E goal

Delete the 23 redirect stubs left by Phase D. The stubs were scaffolding for inbound references that pointed at old paths; 30 days is the grace window for any latecomer to update their refs. After Phase E, all references must point at canonical post-Phase-D paths.

## Pre-flight (run from main, after fetch)

```bash
git checkout main && git pull --ff-only
# 1. Confirm tripwire actually fires
pnpm exec vitest run tests/e2e/phase-e-stub-cleanup-due.test.ts
# Expected: FAIL (stubCount > 0)

# 2. Enumerate stubs (should be 23)
git grep -l -E '^> Moved to .*<!-- AGENT_REDIRECT_ONLY -->' -- 'docs/' ':!docs/_inventory/' | wc -l

# 3. List them by old path → new path (for the PR description)
git grep -E '^> Moved to ' -- 'docs/' ':!docs/_inventory/' | head -25

# 4. Find any LIVE inbound refs that still target an old path (these break after stub deletion)
for stub in $(git grep -l -E '^> Moved to .*<!-- AGENT_REDIRECT_ONLY -->' -- 'docs/' ':!docs/_inventory/'); do
  echo "=== inbound to $stub ==="
  git grep -l "$stub" -- ':!docs/_inventory/' ':!_archive/' ':!docs/_archive/' | grep -v "^$stub$"
done
```

If step 4 returns ANY files, those need their refs updated FIRST (in Phase E commit 1). The stub deletion is then safe.

## Phase E commit sequence

### Commit 0 (conditional): update remaining live inbound refs

For each file flagged by pre-flight step 4, edit the reference to point at the canonical post-Phase-D path. Use the move table below.

| Stub at (old path) | Canonical (new path) |
|---|---|
| `docs/PROJECT-BRIEF.md` | `docs/01-orientation/PROJECT-BRIEF.md` |
| `docs/CURRENT-STATE.md` | `docs/01-orientation/CURRENT-STATE.md` |
| `docs/ARCHITECTURE-QUICK-REF.md` | `docs/01-orientation/ARCHITECTURE-QUICK-REF.md` |
| `docs/MASTER-FRAMEWORK.md` | `docs/02-reference/MASTER-FRAMEWORK.md` |
| `docs/DECISIONS.md` | `docs/02-reference/DECISIONS.md` |
| `docs/FRAGILE-ZONES.md` | `docs/02-reference/FRAGILE-ZONES.md` |
| `docs/DEPLOYMENT-RUNBOOK.md` | `docs/03-operations/DEPLOYMENT-RUNBOOK.md` |
| `docs/DEPLOY-RAILWAY.md` | `docs/03-operations/DEPLOY-RAILWAY.md` |
| `docs/REALITY-BASELINE.md` | `docs/03-operations/REALITY-BASELINE.md` |
| `docs/FRONTEND-POLISH-REPORT.md` | `docs/_reports/FRONTEND-POLISH-REPORT.md` |
| `docs/PHASE-5-REPORT.md` | `docs/_reports/PHASE-5-REPORT.md` |
| `docs/REMEDIATION-REPORT.md` | `docs/_reports/REMEDIATION-REPORT.md` |
| `docs/REMEDIATION-2-REPORT.md` | `docs/_reports/REMEDIATION-2-REPORT.md` |
| `docs/roadmap/STATUS/CURRENT-PHASE.md` | `docs/STATUS/CURRENT-PHASE.md` |
| `docs/roadmap/STATUS/CHANGELOG.md` | `docs/STATUS/CHANGELOG.md` |
| `docs/roadmap/STATUS/DECISIONS-LOG.md` | `docs/STATUS/DECISIONS-LOG.md` |
| `docs/roadmap/STATUS/BLOCKERS.md` | `docs/STATUS/BLOCKERS.md` |
| `docs/roadmap/STATUS/PHASE-PROGRESS-TRACKER.md` | `docs/STATUS/PHASE-PROGRESS-TRACKER.md` |
| `docs/roadmap/07-claude-instructions/CLAUDE-WORKFLOW.md` | `docs/_meta/CLAUDE-WORKFLOW.md` |
| `docs/roadmap/07-claude-instructions/CONTEXT-LOAD-ORDER.md` | `docs/_meta/CONTEXT-LOAD-ORDER.md` |
| `docs/roadmap/07-claude-instructions/PROMPT-TEMPLATES.md` | `docs/_meta/PROMPT-TEMPLATES.md` |
| `docs/roadmap/07-claude-instructions/HANDOFF-TEMPLATE.md` | `docs/_meta/HANDOFF-TEMPLATE.md` |
| `docs/roadmap/07-claude-instructions/SESSION-END-CHECKLIST.md` | `docs/_meta/SESSION-END-CHECKLIST.md` |

Commit message: `chore(docs): Phase E pre-cleanup — update N remaining inbound refs to canonical Phase D paths`.

### Commit 1: delete the 23 stubs

```bash
git rm $(git grep -l -E '^> Moved to .*<!-- AGENT_REDIRECT_ONLY -->' -- 'docs/' ':!docs/_inventory/')
git commit -m "chore(docs): Phase E — delete 23 redirect stubs"
```

The `docs/roadmap/STATUS/` directory will retain `PHASE-COMPLETION-CRITERIA.md` (not a stub; left in place during Phase D as out-of-scope per migration map).

The `docs/roadmap/07-claude-instructions/` directory will retain 6 not-promoted files (AGENT-DISPATCH-PATTERNS, COMMIT-AND-PR-CONVENTIONS, COMMON-PITFALLS, EVAL-HARNESS-USAGE, MEMORY-AGENTS-PIPELINE, SESSION-START-CHECKLIST). Same — not stubs, left in place.

### Commit 2 (optional): clean up `docs/_inventory/`

Per migration map convention, `docs/_inventory/` is removed after Phase E exits. If you're confident the audit trail is no longer needed:

```bash
git rm -r docs/_inventory/
git commit -m "chore(docs): Phase E — remove _inventory/ audit trail (Phase A-C planning artifacts)"
```

Trade-off: removing `_inventory/` loses the immediate browseability of the migration map and execution log. Keep if a future audit might want quick access; remove if you trust git history. Default recommendation: KEEP for at least 90 days post-Phase-E, then remove.

### Commit 3: verify and PR-open

```bash
# Tripwire test now passes
pnpm exec vitest run tests/e2e/phase-e-stub-cleanup-due.test.ts
# Expected: PASS (stubCount === 0)

# Doc-links and prompts integrity still pass
python3 scripts/check-doc-links.py
bash scripts/check-prompts-integrity.sh

git push -u origin chore/phase-E-stub-cleanup
gh pr create --base main --title "chore(docs): Phase E — stub cleanup" --body "..."
```

PR title can contain "Phase E" — does NOT need to contain "Phase D" (the §9.3 tripwire grep is already satisfied by Phase D's merge subject).

## Rollback

Stub deletion is reversible: `git revert <merge-sha>` restores all 23 stub files at their old paths. Any commit-0 ref-updates would also be reverted. Stubs and docs are still in PR-D's merge history.

## Anti-drift checks before opening Phase E PR

- [ ] Tripwire test fails on chore branch HEAD (stubCount > 0 means there are stubs to delete)
- [ ] After commit 1, tripwire test passes (stubCount === 0)
- [ ] `python3 scripts/check-doc-links.py` returns OK on the PR branch
- [ ] No remaining inbound ref to any stub-path outside `docs/_inventory/`
- [ ] PR description includes the move table (above) for any future reference-chasing

## Estimated time to execute

- Pre-flight: ~5 min
- Commit 0 (if any inbound refs need updating): 10-30 min depending on count
- Commit 1 (delete stubs): 2 min
- Commit 2 (optional inventory cleanup): 1 min
- Commit 3 (verify + push + PR): 5 min
- **Total: 25 min - 1 hour** depending on whether commit 0 fires

## What this playbook does NOT cover

- Phase D rollback after Phase E merges. If Phase D itself needs reverting for some reason, do that BEFORE Phase E (otherwise the stubs are gone and Phase D revert reintroduces them at old paths but the tree state is half-cleaned up).
- The 13 Cat C/D commits in PR 3. Independent workstream; not gated on Phase E.
- The 7 not-promoted files left in `docs/roadmap/STATUS/` and `docs/roadmap/07-claude-instructions/`. Out of Phase E scope; address separately if user agrees to follow-up promotion.
