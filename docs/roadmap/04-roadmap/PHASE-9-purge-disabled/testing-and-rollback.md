# Phase 9 — Testing and Rollback

## Verification per task

| Task | Verification |
|---|---|
| 9.1 `_disabled/` gone | `find packages -path '*/_disabled/*' -type f` returns empty; `grep -E '_disabled' packages/omnimind-api/tsconfig.json` returns empty |
| 9.2 7 files gone | None of the 7 paths exist; `grep -r 'incremental-embedding\|semantic-dedup\|semantic-search-guard\|memory-cleanup\|migration-manager\|redlock' packages --include="*.ts"` returns empty |
| 9.3 broken scripts gone | `grep -E "test:(integration|security|performance|rollback)" packages/omnimind-api/package.json` returns empty |
| 9.4 quality eval prompt | `cat docs/prompts/quality-evaluation.system.md` exists; `grep -c QUALITY_EVALUATION_PROMPT packages/boardroom-ai/server/src/services/llm-quality-scorer.service.ts` returns 0 |
| 9.5 inline fallbacks gone | `grep -A 5 'catch.*prompt' packages/boardroom-ai/server/src/services/{gmail,simulation}.service.ts` shows no inline string fallback |
| 9.6 docs updated | `cat docs/CURRENT-STATE.md | grep "Phase 9"` finds it; `omnimind-api/CLAUDE.md` no longer mentions disabled code |
| 9.7 ADRs | `ls docs/roadmap/08-references/adrs/ADR-{014,015,016}.md` all exist; each <500 words (`wc -w`) |
| 9.8 final | `npm run typecheck && npm run test && npm run build` all exit 0; eval within 3% of baseline |

## Smoke test after deploy

1. `/health` on both services → 200.
2. Open BoardRoom UI. Run a few queries. Behavior identical to pre-Phase-9.
3. Open Better Stack — no new error patterns.
4. Verify the LLM quality scorer (used in Phase 5a sufficiency check or wherever it lives) still works — pick a recent persona response that triggered scoring; confirm the new markdown prompt was loaded (look for the "loaded prompt" log line if present).
5. Verify Gmail OAuth still works — disconnect and reconnect a test account; the prompt for Gmail extraction must load from markdown without falling back.
6. Wait 24h. No new errors.

## Rollback per task

| Task | Rollback procedure | Time |
|---|---|---|
| 9.1 `_disabled/` deletion | `git revert <commit>` brings them back. Tsconfig excludes also restored. Verify typecheck still passes (the `_disabled/` files were excluded for a reason — they may not compile). | 10 min |
| 9.2 7 files | `git revert`. They reappear in active source. Typecheck may surface latent issues — fix before re-shipping. | 10 min |
| 9.3 scripts | `git revert`. The broken scripts come back; running them still fails (because the files are deleted). Better fix-forward: keep the scripts removed and add Phase 9 task to remove the test files those scripts pointed to. | 5 min |
| 9.4 quality prompt | `git revert` brings back the inline prompt. Service still works because both paths are valid. Fix forward by re-extracting if revert was wrong. | 5 min |
| 9.5 inline fallbacks | `git revert` brings back the silent fallbacks. Risk: silent prompt drift returns. Better fix-forward: add a logged warning when fallback fires (still not silent). | 5 min |
| 9.6 docs | `git revert`. Doc-only. | 2 min |
| 9.7 ADRs | `git revert`. ADRs gone; future phases lose anchor. Fix-forward: rewrite the ADR with corrections. | 5 min |
| 9.8 final | n/a — verification only. | n/a |

## The "safe rollback" path

For most of Phase 9, fix-forward is safer than revert:

- Deletion phases (9.1, 9.2): if a delete was wrong, `git checkout HEAD~1 -- <file>` restores it specifically. Avoid bulk revert.
- Doc updates (9.6): always fix-forward; doc churn is cheap.
- ADRs (9.7): rewrite, don't revert. ADRs are append-only history.

Full revert is only justified if Phase 9 broke a CI/build step that the existing tests don't cover. In that case `git revert` then add the missing test before re-shipping.

## Special concerns

### Hidden imports of deleted files

The audit verified zero imports, but verification was static. Runtime dynamic imports (e.g., `await import(\`./services/\${name}\`)`) might miss the grep. If a runtime error appears post-deploy mentioning a deleted file:

1. Check Better Stack for the error trace.
2. Locate the dynamic import call site.
3. Restore the specific file from git history (`git show HEAD~1:<path> > <path>`).
4. File a follow-up ADR to remove the dynamic import pattern.

### `_disabled/` had useful test fixtures

If a test file outside `_disabled/` happened to import a fixture from inside `_disabled/`, the test will fail post-delete. Mitigation: typecheck + test pass is the gate (both must succeed before deploy).

### ADRs reference future Phase numbers

ADR-016 references Phase 14 (migration history). ADR-015 references Phase 13 (observability). That's fine — ADRs are forward-looking. But verify the Phase numbers used in the ADR text match the actual roadmap before committing.

### Eval baseline shift

Phase 9 is pure code deletion — no behavior change expected. If eval shows >3% shift:

1. The deleted code WAS being used (audit was wrong).
2. Investigate which file. `git log -p <file>` shows last activity; `grep -r <function_name>` may find a missed reference.
3. Restore the file; update the audit (and `02-current-state/`) to reflect reality.

### CURRENT-STATE.md drift

`docs/CURRENT-STATE.md` has been historically stale (audit Tech Debt #18). Make sure the new version is accurate before committing — Joshua should read it end-to-end one final time.

## Don't ship unless

- All 8 verification items pass
- `npm run typecheck && npm run test && npm run build` exit 0
- Eval harness within 3% of baseline (no behavior change expected)
- All 3 ADRs written, each <500 words, format matches existing ADRs
- `git status` shows only intended deletions
- 24h stable in production before declaring "mem0 core shipped"
- Bonus: a final read of `CURRENT-STATE.md` end-to-end by Joshua personally — this doc is the ground truth others use
