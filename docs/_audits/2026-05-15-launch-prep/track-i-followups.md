# Track I Follow-ups

**Date:** 2026-05-15
**Owner:** future Wave 3 work (likely Track H + new mini-track)
**Status:** open
**Context:** Filed at the end of Track I (pre-existing TS errors).
The three errors listed in `WAVE-3-DEV-PROMPT.md` (validation-helpers
× 4, omnimind-client AbortSignal × 1, llm-quality-scorer AbortSignal
× 1) are fixed. Root `pnpm typecheck` now succeeds for `@boardroom/shared`,
`@boardroom/boardroom-ai`, and `@boardroom/omnimind-mcp`. It still
fails for `@boardroom/omnimind-api` due to six additional pre-existing
errors that were NOT in the Track I brief but block the
"`pnpm typecheck` at workspace root produces 0 errors" acceptance
criterion.

These are real merge-debt landmines from recent commits — they
predate the Wave 3 dev prompt and were never flagged because the
omnimind-api package was only typechecked per-package and the
GitHub Actions CI added in Track C still uses per-package commands
(C-FU-01 workaround). Once those are unwound, these errors will
surface on every CI run.

---

## I-FU-01 — Pino-style logger calls in omnimind-api

**Severity:** P1 (blocks root turbo typecheck; 3 call sites)

`src/lib/logger.ts` exports a `console`-based logger with signature
`logger.info(message: string, extra?: Record<string, unknown>)`. Several
recent commits call it pino-style: `logger.info({ key: value }, message)`.
TypeScript correctly rejects the object as a `string`.

Affected sites:
- `src/routes/admin.routes.ts:225` — `logger.info({ keepId, archiveId }, '[admin] Duplicate merge: archived older memory')`
- `src/services/importance-decay.service.ts:19` — `logger.info({ decayed: result, cutoff }, 'Importance decay complete')`
- `src/services/memory.service.ts:68` — `logger.info({ dupeId: dupe.id }, 'Near-duplicate detected — auto-superseding existing memory')`

**Resolution options:**
1. Mechanical: flip each call to `logger.info('message', { extra })`. ~10 minute fix.
2. Strategic: upgrade `logger.ts` to accept either argument order
   (preferred — matches pino convention; the dogfood-memory layer
   uses pino so future contributors will keep tripping this).

## I-FU-02 — `Node16` module resolution requires `.js` import suffix

**Severity:** P1

`src/routes/admin.routes.ts:233` does
`await import('../services/importance-decay.service')`. The package
tsconfig sets `module: "Node16"` / `moduleResolution: "node16"`, which
requires explicit `.js` suffix on relative ESM-style imports. Fix:
add `.js` to that import path. The codebase has not been audited for
other unsuffixed imports (CJS output may have been masking it) — a
follow-up grep run is warranted.

## I-FU-03 — Prisma `Task.completedAt` missing

**Severity:** P1

`src/services/weekly-digest.service.ts:21` filters
`prisma.task.count({ where: { completedAt: { ... } } })`. The current
`Task` model in `prisma/schema.prisma` has no `completedAt` column;
`status: 'DONE'` is the only "done" signal. Either:

1. Add `completedAt DateTime?` to `Task` + migration, and set it
   from the route that transitions a task to `DONE`. This is the
   right long-term move because weekly digests genuinely want a
   "tasks completed THIS week" count.
2. Or rewrite the query to use `status: 'DONE'` + `updatedAt`. Lossy
   (re-opening a task and closing it again will count twice) but
   zero-migration.

## I-FU-04 — `nodemailer` import without dependency

**Severity:** P1

`src/services/weekly-digest.service.ts:78` imports `nodemailer` but
the package is not in `omnimind-api/package.json`. Either:

1. Add `nodemailer` + `@types/nodemailer` to deps. Configure SMTP env
   vars in `.env.example` and `lib/env.ts`. This is the intent of
   the digest feature.
2. Or remove the digest send code path (keep persistence) until the
   transport story is decided. The cron may be calling
   `saveAndSendDigest` without anyone reading the inbox yet.

## I-FU-05 — Re-enable root turbo CI gate once I-FU-01..04 land

**Severity:** P1 (deferred from Track I bonus)

The Track C C-FU-01 workaround in `.github/workflows/ci.yml` uses
per-package typecheck / test scripts to side-step the broken shared
build. The shared build is fixed (this Track I), and boardroom-ai
typechecks clean. Once the omnimind-api errors above are unblocked,
revert the workflow to use root `turbo` commands (`pnpm typecheck`,
`pnpm build`, `pnpm test`) — turbo caching will materially speed up
CI and the per-package list won't silently miss new packages.

Not done in this Track because root typecheck still fails on
omnimind-api; flipping the CI would just move the red light.

## I-FU-06 — Worktree base-branch drift

**Severity:** P2 (process)

The Track I worktree was originally cut from `main` (commit
`403747d`, pre-Wave-2-merge) rather than the dev-prompt's stated
base `claude/review-project-status-VgaJ0`. The dispatch tool should
either:

1. Pass the desired base branch into the worktree creation command
   explicitly, OR
2. Log the base used so the agent can rebase up front (saves a
   round of merge conflicts).

This was recoverable but cost ~10 minutes; if future tracks fan out
from worktrees they will hit the same trap.
