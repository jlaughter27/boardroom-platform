# Phase 0 — Testing and Rollback

## Verification per task

| Task | Verification |
|---|---|
| 0.1 archive scratchpads | `git status` clean of stray MDs at repo root; `ls docs/_archive/2026-04-pre-roadmap/` shows the 12 archived files; `cat .gitignore | grep -E "\.brv|\.claude/launch|\.vscode/settings"` matches all three lines |
| 0.2 drop searchVector | `psql $DATABASE_URL -c "\d memory_entries"` shows no `search_vector` column; `grep -r searchVector packages/ --include="*.ts"` returns zero matches; `npm run test -w packages/omnimind-api` green |
| 0.3 pgvector version | `cat docs/DEPLOYMENT-RUNBOOK.md | grep -A 5 "Database extensions"` shows the version; if `<0.5.0`, a TODO with Railway support link is present |
| 0.4 log drain | After a real cross-service request, the Better Stack/Axiom dashboard shows two log lines from different `service` tags with the same `requestId` value |
| 0.5 seed queries | `cat eval/scenarios/seed-queries.json | jq 'length'` returns 10; each entry has `id`, `query`, `userId`, `expectedTopK`, `category` |
| 0.6 final | `npm run typecheck && npm run test` exits 0; one clean commit with all 6 tasks |

## Smoke test after deploy

1. Hit `https://omnimind-api-production.up.railway.app/health` → expect 200.
2. Hit `https://boardroom-ai-production-1092.up.railway.app/health` → expect 200.
3. Log in to BoardRoom UI, load the dashboard. Confirm no errors in browser console.
4. Search for any memory in the UI. Confirm results render — this exercises FTS, which now no longer touches `searchVector`.
5. Open Better Stack dashboard. Confirm log lines from both services with shared `requestId` for the dashboard load.

## Rollback per task

| Task | Rollback procedure | Time |
|---|---|---|
| 0.1 archive scratchpads | `git revert <commit>`. Files come back to repo root. No data risk. | 2 min |
| 0.2 drop searchVector | Re-add `searchVector Unsupported("tsvector")?` to schema; push. Prisma `db push` re-creates the column as nullable. No data was in it. | 5 min |
| 0.3 pgvector docs | Edit `DEPLOYMENT-RUNBOOK.md`, remove the section. Doc-only change. | 1 min |
| 0.4 log drain | Remove `LOGTAIL_SOURCE_TOKEN` env var in Railway, redeploy. Logger falls back to console. No data risk. | 3 min |
| 0.5 seed queries | Delete `eval/scenarios/seed-queries.json`. Phase 0.5 starts from scratch. | 1 min |
| 0.6 commit | `git revert <hash>` and force-push only if no one else has pulled. Otherwise add a fix-forward commit. | 5 min |

## What to do if Better Stack/Axiom signup blocked

If signup fails or the org policy blocks third-party SaaS, fall back to writing logs to a Railway-volumed file (`/data/logs/{service}.jsonl`). Phase 13 (full observability) will revisit. Phase 5a (LLM batch) becomes harder to debug but not impossible — fall back to grep + correlation IDs.

## Don't ship unless

- `npm run typecheck` green
- `npm run test` green (708+ tests pass; same number as pre-Phase-0)
- Both Railway services healthy after deploy
- One real cross-service log line visible in the drain dashboard with matching `requestId`
