# Phase 0 — Tasks and Prompts

Six atomic tasks, ~5 hours total. Each can be picked up by a fresh Claude session with the prompt provided.

| # | Task | File paths touched | Success criterion | Time |
|---|---|---|---|---|
| 0.1 | Archive scratchpads + gitignore editor files | `.gitignore`, `docs/_archive/2026-04-pre-roadmap/` | `git status` clean of stray MD; editor files ignored | 30 min |
| 0.2 | Drop `searchVector` column | `packages/omnimind-api/prisma/schema.prisma`, new migration | Column gone from DB + schema; tests still pass | 60 min |
| 0.3 | Verify and document pgvector version | `docs/DEPLOYMENT-RUNBOOK.md` | Version recorded; Phase 3 prereq known | 30 min |
| 0.4 | Wire log drain (Better Stack or Axiom) | `packages/omnimind-api/src/lib/logger.ts`, `packages/boardroom-ai/server/src/lib/logger.ts`, Railway env | Test log appears in dashboard with `x-request-id` | 90 min |
| 0.5 | Hand-label 10 seed retrieval queries | `eval/scenarios/seed-queries.json` (new file) | 10 queries with expected top-3 memory IDs | 60 min |
| 0.6 | Verify + commit | n/a | Typecheck + tests green; one clean commit | 30 min |

---

## Task 0.1 — Archive scratchpads + gitignore editor files

**Prompt:**

> You are working on the BoardRoom + OmniMind monorepo at `/Users/Joshua/windsurf boradroom test/boardroom-platform edit`. Run `git status` to see the untracked scratchpad files at the repo root.
>
> Create a new directory `docs/_archive/2026-04-pre-roadmap/` and move these files into it (use `git mv` if they're tracked, plain `mv` if untracked):
>
> - `AUDIT_REPORT.md`
> - `CLAUDE_ARCHITECT.md`
> - `COMMITTEE_PLANNING.md`
> - `SCRATCHPAD_AUDIT.md`
> - `SEC-004_VERIFICATION.md`
> - `migration_state.md`
> - `migration_summary_report.md`
> - `implementation_state.json`
> - `migration_artifacts/` (whole folder)
> - `packages/omnimind-api/mem0-test-deployment-simulation-report.md`
> - `docs/MEM0_FINAL_DEV_ROADMAP.md`
> - `docs/MEM0_INTEGRATION_PLAN.md`
> - `docs/MEM0_RE_INTEGRATION_PLAN.md`
> - `docs/MEM0_RISK_MITIGATION_PLAN.md`
> - `docs/MEM0_USAGE_EXAMPLES.md`
>
> Keep `docs/REALITY-BASELINE.md` where it is.
>
> Add to the root `.gitignore`:
> ```
> .brv/
> .claude/launch.json
> .vscode/settings.json
> ```
>
> Do NOT delete `CLAUDE.md` or `.claude/CLAUDE.md` — those are project instructions and stay tracked.
>
> Verify with `git status` that the only remaining untracked items are intended (e.g., the new `docs/_archive/` directory, the modified `.gitignore`).

---

## Task 0.2 — Drop the `searchVector` dead column

**Prompt:**

> Open `packages/omnimind-api/prisma/schema.prisma` and find the `MemoryEntry` model around line 200. Remove the line:
>
> ```prisma
> searchVector   Unsupported("tsvector")?   @map("search_vector")
> ```
>
> Verify nothing in the codebase reads or writes this column by running `grep -r "searchVector\|search_vector" packages/ --include="*.ts" --include="*.prisma"`. The only matches should be in archived migrations and the schema line you just removed.
>
> Create a new migration file at `packages/omnimind-api/prisma/migrations/20260418_drop_search_vector/migration.sql`:
>
> ```sql
> ALTER TABLE "memory_entries" DROP COLUMN IF EXISTS "search_vector";
> -- Drop any indexes that referenced the column (none expected, but defensive)
> DROP INDEX IF EXISTS "memory_entries_search_vector_idx";
> ```
>
> Run `npx prisma generate` from `packages/omnimind-api/` to regenerate the client. Run `npm run typecheck` from the repo root. Run `npm run test` from `packages/omnimind-api/`.
>
> Do NOT yet apply this migration to production — that happens via Railway redeploy. The local Postgres should pick it up via the existing `prisma db push` in the docker-entrypoint, which will now drop the column.

---

## Task 0.3 — Verify and document pgvector version

**Prompt:**

> SSH or `railway connect` to the production OmniMind Postgres database. Run:
>
> ```sql
> SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector', 'pg_trgm');
> ```
>
> Record both versions. Then open `docs/DEPLOYMENT-RUNBOOK.md` and add a new H2 section near the top called `## Database extensions`. Document:
>
> - `vector` (pgvector) version
> - `pg_trgm` version
> - The fact that Phase 3 (HNSW migration) requires `vector >= 0.5.0` for `CREATE INDEX CONCURRENTLY` support
> - If the version is `<0.5.0`, file a TODO with a Railway support link to upgrade
>
> Commit just the `DEPLOYMENT-RUNBOOK.md` change.

---

## Task 0.4 — Wire log drain on both services

**Prompt:**

> Sign up for Better Stack (https://betterstack.com) or Axiom (https://axiom.co) free tier. Create a new "Source" of type "Node.js (Pino)". Copy the source token.
>
> In Railway, add the env var `LOGTAIL_SOURCE_TOKEN` (or `AXIOM_TOKEN` + `AXIOM_DATASET`) to BOTH services: `boardroom-ai-production-1092` and `omnimind-api-production`.
>
> Open `packages/omnimind-api/src/lib/logger.ts`. It currently exports a pino logger. Add a Better Stack transport when `LOGTAIL_SOURCE_TOKEN` is set:
>
> ```ts
> import pino from 'pino';
>
> const transport = process.env.LOGTAIL_SOURCE_TOKEN
>   ? pino.transport({
>       target: '@logtail/pino',
>       options: { sourceToken: process.env.LOGTAIL_SOURCE_TOKEN },
>     })
>   : undefined;
>
> export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }, transport);
> ```
>
> Repeat for `packages/boardroom-ai/server/src/lib/logger.ts`.
>
> Add `@logtail/pino` to the `dependencies` in both services' `package.json` (or `@axiomhq/pino` if you chose Axiom). Run `pnpm install` from the repo root.
>
> Verify the `x-request-id` middleware (already present per CLAUDE.md changelog 2026-04-15) is included in every log line. If not, add `req.id` to the logger child via `logger.child({ requestId: req.id })` in the request middleware.
>
> Deploy both services. Make a real request that crosses the seam (login → load dashboard). Verify in the Better Stack dashboard that you see two log lines from different services with the same `requestId`.

---

## Task 0.5 — Seed 10 retrieval queries for Phase 0.5

**Prompt:**

> Create `eval/scenarios/seed-queries.json`. Use Joshua's actual session history as ground truth. For 10 questions Joshua has asked the system (or that he might plausibly ask), record:
>
> ```json
> [
>   {
>     "id": "q-001",
>     "query": "what did I decide about pricing for the BoardRoom launch",
>     "userId": "<Joshua's userId>",
>     "expectedTopK": ["mem_xxx", "mem_yyy", "mem_zzz"],
>     "category": "single-hop",
>     "notes": "Should pull the pricing decision memory plus its supporting context"
>   }
> ]
> ```
>
> Categories: `single-hop`, `multi-entity`, `temporal`. Aim for 7 single-hop, 2 multi-entity, 1 temporal as the seed (Phase 0.5 expands this to 35).
>
> Get the `expectedTopK` memory IDs by running queries against production via the OmniMind `/memories/search` endpoint and capturing the IDs that *should* have come back (Joshua's judgment).
>
> This file becomes the seed for the Phase 0.5 eval harness.

---

## Task 0.6 — Verify and commit

**Prompt:**

> From the repo root, run:
>
> ```
> npm run typecheck
> npm run test
> ```
>
> Both must exit 0. If anything fails, stop and diagnose.
>
> Stage everything: `git add -A`. Review the diff. Commit with:
>
> ```
> chore(phase-0): foundation cleanup — archive scratchpads, drop searchVector, wire log drain
>
> - Move 12 root-level scratchpad MDs and migration_artifacts/ to docs/_archive/2026-04-pre-roadmap/
> - Drop unused `searchVector tsvector` column from MemoryEntry (migration 20260418_drop_search_vector)
> - Add Better Stack pino transport to both services with x-request-id correlation
> - Document pgvector version in DEPLOYMENT-RUNBOOK.md
> - Seed 10 retrieval queries in eval/scenarios/seed-queries.json
> - .gitignore .brv/, .claude/launch.json, .vscode/settings.json
> ```
>
> Push to `main`. Watch Railway auto-deploy logs to confirm both services come up healthy.
