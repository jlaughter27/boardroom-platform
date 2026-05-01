# Phase 9 — Purge `_disabled/` and Standardize

**Time budget:** 1.5 days
**Confidence:** HIGH
**Owner:** Solo dev
**Blast radius:** Low — deletes already-quarantined code; everything is in git history

---

## What this phase is

The dedicated, scoped tech-debt sprint that closes out the mem0 core arc. Per code-quality audit §G, this is justified as its own phase because:

- The `_disabled/` quarantine is real, sizable (13.6k LOC), and has been deferred for weeks.
- Several findings are load-bearing (half-wired RLS, inline prompts) and bias every future change.
- `package.json` script references to deleted files will trip a fresh contributor on day one.

**Tight scope** (per code-quality audit §F checklist — DO NOT expand):

1. Delete the 25 `_disabled/` files (13,659 LOC) across 5 directories.
2. Delete 7 active-but-unused service files (1,710 LOC) — `incremental-embedding`, `semantic-dedup`, `semantic-search-guard`, `memory-cleanup.job`, `memory-cleanup-scheduler`, `migration-manager`, `redlock`.
3. Remove broken `package.json` scripts (`test:integration`, `test:security`, `test:performance`, `test:rollback`) that reference deleted paths.
4. Move `QUALITY_EVALUATION_PROMPT` from `llm-quality-scorer.service.ts` (inline) to `docs/prompts/quality-evaluation.system.md`.
5. Remove silent inline-prompt fallbacks in `gmail.service.ts:144` and `simulation.service.ts:54`.
6. Move root-level scratchpad MDs (already done in Phase 0; verify this is still clean).
7. Update `omnimind-api/CLAUDE.md` to remove the "Disabled / quarantined code" section.
8. Update `docs/CURRENT-STATE.md` to reflect the post-mem0-core reality.
9. Write three ADRs: ADR-014 (mem0 integration strategy), ADR-015 (eval harness as gate), ADR-016 (bi-temporal link tables and supersession semantics).

**Explicitly NOT in scope** (per code-quality audit §G "What does NOT justify a dedicated phase"):

- The 75 `any` occurrences (Tech Debt #21) — fix opportunistically as files are touched.
- The 11 missing service unit tests (§B.1) — gate on PR (any PR touching those services adds the missing test).
- Standardizing logger/prompt-loader to shared (Tech Debt #22, #23) — defer to Phase 12 (SDK) when shared is more carefully versioned.
- The `db-audit.ts` deletion — already done in Phase 0.25.

## Why now

Per validator §2 row 9 and code-quality audit §G: this is "clean up the mess" before moving to the post-mem0-core build phases (10+). Doing it before Phase 10 (MCP server) means the SDK-facing surface is clean.

Per ROADMAP-OVERVIEW: Phase 9 is the final mem0-core phase, T+13.5w to T+14w.

## Prereqs

- All of Phase 0, 0.25, 0.5, 1, 2, 3, 4, 5a, 5b, 6, 7a complete and stable
- Eval harness green
- No active branches with `_disabled/` references

## Exit criteria

| Criterion | How to verify |
|---|---|
| All 25 `_disabled/` files gone | `find packages -path '*/_disabled/*' -type f` returns empty |
| `_disabled/` exclude lines removed from `tsconfig.json` | `grep _disabled packages/omnimind-api/tsconfig.json` returns empty |
| 7 active-but-unused files gone | None of the 7 paths exist; `npm run typecheck` still passes |
| Broken `package.json` scripts removed | `grep -E "test:(integration|security|performance|rollback)" packages/omnimind-api/package.json` returns empty |
| `QUALITY_EVALUATION_PROMPT` lives in markdown | `docs/prompts/quality-evaluation.system.md` exists; `llm-quality-scorer.service.ts` loads via `loadSystemPrompt` |
| No silent inline-prompt fallbacks remain | `gmail.service.ts` and `simulation.service.ts` throw if their prompt file is missing |
| 3 ADRs written and committed | `08-references/adrs/ADR-{014,015,016}.md` all exist |
| `npm run typecheck && npm run test && npm run build` all green | Exit 0 |
| `docs/CURRENT-STATE.md` updated to "Phase 9 complete; mem0 core shipped" | doc reads correctly |
| `omnimind-api/CLAUDE.md` no longer mentions disabled code | grep returns empty |

## Dependencies

- **Upstream:** Everything in the mem0 core (Phases 0-7a)
- **Downstream:** Phase 10+ benefits from clean baseline

## Time budget detail

Per code-quality audit §G recommendation: **1.5 days total**, broken down per the §F checklist.

| Task | Hours |
|---|---|
| 9.1 — Delete 25 `_disabled/` files + tsconfig cleanup | 0.5 |
| 9.2 — Delete 7 active-but-unused files; verify typecheck | 1 |
| 9.3 — Remove broken `package.json` scripts | 0.25 |
| 9.4 — Move `QUALITY_EVALUATION_PROMPT` to markdown | 0.5 |
| 9.5 — Remove silent inline-prompt fallbacks | 0.5 |
| 9.6 — Update `CURRENT-STATE.md` + `omnimind-api/CLAUDE.md` | 0.75 |
| 9.7 — Write ADR-014, ADR-015, ADR-016 | 6 |
| 9.8 — Final verify (typecheck + test + build) | 1 |
| **Total** | **~10 hours / 1.5 days** |

## Risks accepted

- **Deleting `_disabled/` is irreversible without git history** — but git history is the safety net. Document that anyone who wants to resurrect a quarantined file can `git log --all -- packages/omnimind-api/src/services/_disabled/<file>` to find it.
- **Some `_disabled/` code might have been useful reference.** Acceptable — 13.6k LOC of stale code is more confusing than helpful. Reference material lives in `docs/research/` going forward.
- **ADRs are commitments** — once written, future phases must reference them. Keep them tight: each ADR should be < 500 words.

## Cross-references

- Code-quality audit: `docs/research/omnimind-roadmap-2026/wave1-audit/code-quality-audit.md` §A (dead code), §F (Phase 9 checklist), §G (justification)
- Validator plan: `docs/research/mem0-memory-architectures/stage5-validation/final-recommendation.md` §2 row 9, §4 (ADR triggers)
- Already addressed in earlier phases: `searchVector` drop (Phase 0), `db-audit.ts` deletion (Phase 0.25), root scratchpads (Phase 0)
- Closes out mem0 core arc; gates Phase 10+

---

**Constraints reminder:** Respect ADR-001 (no frameworks), ADR-002 (Anthropic only), ADR-003 (pgvector only), ADR-009 (node-cron only). All prompts in `docs/prompts/*.system.md`. All LLM tool outputs Zod-validated.
