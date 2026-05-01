# Phase 0 — Foundation Cleanup

**Time budget:** 0.5 weeks (3-4 focused days)
**Confidence:** HIGH
**Owner:** Solo dev
**Blast radius:** Low — additive cleanup, no behavior change

---

## What this phase is

A small, mechanical cleanup pass that removes dead code, archives scratchpads, and wires the cross-service log drain. The point is to give every subsequent phase a clean baseline so PR diffs stop including "and also clean up this thing."

Three concrete outcomes:

1. **Repo hygiene** — root-level scratchpads (`AUDIT_REPORT.md`, `SCRATCHPAD_AUDIT.md`, `COMMITTEE_PLANNING.md`, etc.) move to `docs/_archive/2026-04-pre-roadmap/`. Editor files (`.brv/`, `.claude/launch.json`, `.vscode/settings.json`) get gitignored. Five `MEM0_*.md` planning docs get archived.
2. **Schema dead code** — drop the `searchVector Unsupported("tsvector")?` column from `MemoryEntry`. It's declared in `prisma/schema.prisma:202` but nothing reads or writes it. The actual FTS code in `retrieval/fulltext-search.ts` computes `to_tsvector('english', ...)` inline. See `02-current-state/LANDMINES.md` (the searchVector mention under L1 — `searchVector` doesn't have its own landmine ID; it's part of the broader `db push --accept-data-loss` failure surface).
3. **Log drain wired** — Better Stack or Axiom free tier with `x-request-id` propagation across both services. Without this, Phase 5a (LLM batch) is debugging-blind.

## Why now

Every later phase touches the schema, services, or routes. Going in with 13.6k LOC of `_disabled/` code, 12 stray markdown files at repo root, and a phantom column produces three real costs: noisy `git status`, stale grep results that mislead Claude, and a rotting prompt that grows worse the longer it sits.

This phase is *not* the big `_disabled/` purge — that's Phase 9, intentionally separated so it can be merged independently after the mem0 core ships. Phase 0 is just the minimum to clean up before the eval harness goes in.

## Prereqs

- None. This is the entry point.

## Exit criteria

| Criterion | How to verify |
|---|---|
| `git status` is clean (no untracked scratchpads at repo root) | `git status` shows no `AUDIT_REPORT.md`, `SCRATCHPAD_AUDIT.md`, `migration_state.md`, `MEM0_*.md` |
| `searchVector` column dropped from schema and DB | `prisma/schema.prisma` no longer contains `searchVector`; `\d memory_entries` in psql shows no `search_vector` column |
| Editor files gitignored | `.gitignore` includes `.brv/`, `.claude/launch.json`, `.vscode/settings.json` |
| Log drain wired | A test log line from each service appears in Better Stack/Axiom dashboard, with matching `x-request-id` |
| `npm run typecheck` green across all packages | Exit code 0 |
| `npm run test` green (708+ tests still pass) | Exit code 0 |
| pgvector version recorded | `docs/DEPLOYMENT-RUNBOOK.md` has a "Database extensions" section listing `pgvector >= 0.5.0` (or notes the upgrade need) |

## Dependencies

- **Downstream blocker:** Phase 0.5 needs the log drain in place to instrument eval runs.
- **Downstream blocker:** Phase 3 (HNSW) needs the verified pgvector version.
- **Downstream blocker:** Phase 5a (LLM batch) needs cross-service correlation IDs.

## Time budget detail

| Task | Hours |
|---|---|
| Archive scratchpads + gitignore editor files | 0.5 |
| Drop `searchVector` column (schema + migration + deploy) | 1.0 |
| Verify pgvector version + document | 0.5 |
| Wire log drain (Better Stack pino transport on both services) | 1.5 |
| Hand-label 10 retrieval queries (seed for Phase 0.5) | 1.0 |
| Verification + commit | 0.5 |
| **Total** | **~5 hours focused** |

## Cross-references

- Validator's "this week" actions: `docs/research/mem0-memory-architectures/stage5-validation/final-recommendation.md` §9
- Dead-column reference: `02-current-state/LANDMINES.md` (covered under L1 — `searchVector` is one of the trigger paths for the `db push --accept-data-loss` landmine)
- pgvector version requirement: `docs/research/mem0-memory-architectures/stage5-validation/final-recommendation.md` §5

---

**Constraints reminder:** Respect ADR-001 (no frameworks), ADR-002 (Anthropic only), ADR-003 (pgvector only), ADR-009 (node-cron only). All prompts in `docs/prompts/*.system.md`. All LLM tool outputs Zod-validated.
