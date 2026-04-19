# Phase 9 — Tasks and Prompts

Eight atomic tasks; ~10 hours over 1.5 days.

| # | Task | File paths touched | Success criterion | Time |
|---|---|---|---|---|
| 9.1 | Delete `_disabled/` dirs + tsconfig | `packages/omnimind-api/src/services/_disabled/`, `routes/_disabled/`, `tests/unit/services/_disabled/`, `packages/shared/src/utils/_disabled/`, `__tests__/_disabled/`, `tsconfig.json` | All gone; typecheck green | 0.5h |
| 9.2 | Delete 7 active-but-unused files | 7 specific files in `omnimind-api` | All gone; typecheck green | 1h |
| 9.3 | Remove broken `package.json` scripts | `packages/omnimind-api/package.json` | 4 scripts removed | 0.25h |
| 9.4 | Move `QUALITY_EVALUATION_PROMPT` | `docs/prompts/quality-evaluation.system.md` (new), `packages/boardroom-ai/server/src/services/llm-quality-scorer.service.ts` | Prompt loads via prompt-loader | 0.5h |
| 9.5 | Remove silent inline-prompt fallbacks | `gmail.service.ts`, `simulation.service.ts` | Both fail loudly if prompt missing | 0.5h |
| 9.6 | Update CURRENT-STATE + omnimind-api/CLAUDE.md | `docs/CURRENT-STATE.md`, `packages/omnimind-api/CLAUDE.md` | Reflect post-Phase-9 reality | 0.75h |
| 9.7 | Write ADR-014, 015, 016 | `docs/roadmap/08-references/adrs/ADR-014.md` etc. | All 3 written, each <500 words | 6h |
| 9.8 | Final verify | n/a | typecheck + test + build all green | 1h |

---

## Task 9.1 — Delete `_disabled/` dirs + tsconfig cleanup

**Prompt:**

> Per code-quality audit §F:
>
> ```bash
> git rm -r packages/omnimind-api/src/services/_disabled/
> git rm -r packages/omnimind-api/src/routes/_disabled/
> git rm -r packages/omnimind-api/tests/unit/services/_disabled/
> git rm -r packages/shared/src/utils/_disabled/
> git rm -r packages/shared/src/__tests__/_disabled/
> ```
>
> Open `packages/omnimind-api/tsconfig.json`. Find the `exclude` array. Remove these lines:
>
> ```json
> "src/services/_disabled/**",
> "src/routes/_disabled/**"
> ```
>
> Run `npm run typecheck` — must pass. If it fails, something in active code referenced a `_disabled/` file (the audit verified zero references, but verify again).
>
> Run `npm run test` — must pass.

---

## Task 9.2 — Delete 7 active-but-unused files

**Prompt:**

> Per code-quality audit §A.2 — these files compile but no production code path imports them:
>
> ```bash
> git rm packages/omnimind-api/src/services/incremental-embedding.service.ts
> git rm packages/omnimind-api/src/services/semantic-dedup.service.ts
> git rm packages/omnimind-api/src/retrieval/semantic-search-guard.ts
> git rm packages/omnimind-api/src/jobs/memory-cleanup.job.ts
> git rm packages/omnimind-api/src/jobs/memory-cleanup-scheduler.ts
> git rm packages/omnimind-api/src/lib/migration-manager.ts
> git rm packages/omnimind-api/src/lib/redlock.ts
> ```
>
> Verify zero imports remain: `grep -r "incremental-embedding\|semantic-dedup\|semantic-search-guard\|memory-cleanup\.job\|memory-cleanup-scheduler\|migration-manager\|redlock" packages/ --include="*.ts"` returns empty.
>
> Run `npm run typecheck` — must pass. If anything fails, the audit was wrong about the file being unused; investigate before forcing.

---

## Task 9.3 — Remove broken `package.json` scripts

**Prompt:**

> Open `packages/omnimind-api/package.json`. Remove these scripts (they reference now-deleted `_disabled/` paths):
>
> - `test:integration`
> - `test:security`
> - `test:performance`
> - `test:rollback`
>
> Verify the remaining scripts still work: `npm run test`, `npm run typecheck`, `npm run build`, `npm run dev`.

---

## Task 9.4 — Move `QUALITY_EVALUATION_PROMPT` to markdown

**Prompt:**

> Per code-quality audit Tech Debt #6: `packages/boardroom-ai/server/src/services/llm-quality-scorer.service.ts` lines 19-44 inline a `QUALITY_EVALUATION_PROMPT` constant. Violates CLAUDE.md rule 5.
>
> 1. Copy the prompt text from the inline string.
> 2. Create `docs/prompts/quality-evaluation.system.md` with that text. Add a header explaining the purpose.
> 3. Edit `llm-quality-scorer.service.ts`: remove the inline constant; replace with `await loadSystemPrompt('quality-evaluation')`.
> 4. Run `npm run test -w packages/boardroom-ai/server`. Tests for the scorer must still pass.

---

## Task 9.5 — Remove silent inline-prompt fallbacks

**Prompt:**

> Per code-quality audit Tech Debt #7: two services have try/catch fallbacks to inline prompt strings when the markdown file load fails:
>
> - `packages/boardroom-ai/server/src/services/gmail.service.ts:144`
> - `packages/boardroom-ai/server/src/services/simulation.service.ts:54`
>
> Open each. Remove the catch + inline string. Let `loadSystemPrompt` throw if the file is missing — better to fail loudly than to drift on a stale fallback.
>
> Verify the markdown files referenced actually exist in `docs/prompts/` (they should). Run tests.

---

## Task 9.6 — Update docs

**Prompt:**

> 1. Open `docs/CURRENT-STATE.md`. Replace stale "Sprint 8 / Phase 0 in progress" content with current reality:
>
>    ```md
>    # Current State
>
>    Mem0 core complete (Phases 0 through 9). Both services live on Railway.
>
>    ## What ships
>    - Foundation cleanup (Phase 0)
>    - Critical security + data fixes (Phase 0.25)
>    - Retrieval eval harness with non-regression gate (Phase 0.5)
>    - Schema alignment + bi-temporal-lite (Phase 1)
>    - Pattern-only entity extraction + ADD/UPDATE/NOOP write loop with MemoryWriteEvent durability (Phase 2)
>    - HNSW + RRF (Phase 3)
>    - Recursive-CTE graph traversal (Phase 4)
>    - LLM entity + relationship augmentation, nightly batch with hard cost cap (Phase 5a)
>    - LLM consolidation upgrade for boundary cases (Phase 5b)
>    - Entity-aware ranker boost (Phase 6)
>    - Recency + access-count ranker (Phase 7a)
>    - Tech debt cleanup (Phase 9)
>
>    ## Deferred (with named triggers)
>    - Phase 7b — Outcome feedback (trigger: ≥200 Decision.outcome populated + MemoryCitation table)
>    - Phase 8 — Cross-encoder reranker (trigger: eval MRR <0.6 + Railway ≥4GB RAM)
>
>    ## Up next
>    - Phase 10: Memory MCP server
>    - Phase 11: Markdown export + git sync
>    - Phase 12: Public TypeScript SDK
>    - Phase 13: Observability suite
>    - Phase 14: Migration history (proper baseline)
>    ```
>
> 2. Open `packages/omnimind-api/CLAUDE.md`. Find the section that mentions "Disabled / quarantined code" or `_disabled/`. Delete it — the directory no longer exists.
>
> 3. Verify counts: per code-quality audit final stats, after Phase 9 the largest active file is `omnimind-client.ts` (494 LOC). Update any "files >800 LOC" references in CLAUDE.md.

---

## Task 9.7 — Write ADR-014, 015, 016

**Prompt:**

> Per validator §2 row 9, write three ADRs. Each <500 words. Format follows existing ADRs in `docs/roadmap/08-references/adrs/`.
>
> **ADR-014 — Mem0 Integration Strategy: Pattern-First, LLM-Augmented, No Framework Dependency**
>
> Sections:
> - Status: Accepted (2026-04-XX)
> - Context: We considered (a) full mem0 framework adoption, (b) custom pattern-only, (c) LLM-only. Per ADR-001 (no frameworks), (a) is rejected; per cost analysis, (c) is too expensive at scale.
> - Decision: Hybrid. Pattern-only for the deterministic write loop and entity extraction (Phase 2); LLM augmentation runs as a nightly batch with hard cost cap for the gap-filling cases (Phase 5a) and on PENDING_REVIEW boundary cases (Phase 5b).
> - Consequences: Predictable cost ceiling. Modest precision (~70% on the 100-pair fixture is the gate). Path to scale clear: tune via eval before LLM-ifying further. Reversible behind env flags.
> - Alternatives considered: full LLM (cost), full pattern (precision ceiling), Zep / Letta hosted (ADR-001).
>
> **ADR-015 — Retrieval Eval Harness as Non-Regression Gate**
>
> Sections:
> - Status: Accepted (2026-04-XX)
> - Context: Phases 3-7a all touch retrieval; without a measurement, every change ships on intuition.
> - Decision: 35 hand-labeled queries (20 single-hop, 10 multi-entity, 5 temporal). MRR / nDCG@10 / P@5 computed per slice. Pre-deploy gate fails on >3% regression.
> - Consequences: Slower iteration on retrieval changes (each requires a baseline check). But every retrieval claim is provable. Trade-off accepted.
> - Alternatives considered: full LLM-judge (too slow, expensive); 100-query set (over-investment for current scale).
>
> **ADR-016 — Bi-Temporal Link Tables and Supersession Semantics**
>
> Sections:
> - Status: Accepted (2026-04-XX)
> - Context: Memories evolve; relationships expire; supersession is a real product concept.
> - Decision: Add `validFrom`, `validTo`, `supersededBy` to 6 link tables (Phase 1). Memory supersession is copy-on-write (Phase 2): old row marked SUPERSEDED, new row created with `supersedes` pointer. Bi-temporal filter applied via helper `withTemporalFilter()` (Phase 4).
> - Consequences: Query-site discipline required (validator §1 top-3 risk). Mitigation: helper function + code-review checklist. Rollback path: `scripts/rollback-mem0-supersession.sql`.
> - Alternatives considered: full bi-temporal with transaction-time axis (defer until SOC-2 driver); in-place mutation (loses history).
>
> Save to `docs/roadmap/08-references/adrs/ADR-014.md`, `ADR-015.md`, `ADR-016.md`. Update the ADR index in `08-references/adrs/README.md` (or wherever the index lives).

---

## Task 9.8 — Final verify

**Prompt:**

> 1. From repo root: `npm run typecheck` — must exit 0.
> 2. `npm run test` — must exit 0 (708+ tests, possibly more after the mem0 phases).
> 3. `npm run build` — must exit 0.
> 4. `git status` — verify only the intended files are modified / deleted.
> 5. Commit:
>
>    ```
>    chore(phase-9): purge _disabled/ + write closing ADRs
>
>    - Delete 25 _disabled/ files (13,659 LOC) across services, routes, tests, shared
>    - Delete 7 active-but-unused files (1,710 LOC): incremental-embedding,
>      semantic-dedup, semantic-search-guard, memory-cleanup.{job,scheduler},
>      migration-manager, redlock
>    - Remove broken package.json scripts: test:integration, test:security,
>      test:performance, test:rollback
>    - Move QUALITY_EVALUATION_PROMPT to docs/prompts/quality-evaluation.system.md
>    - Remove silent inline-prompt fallbacks in gmail.service.ts and simulation.service.ts
>    - Update CURRENT-STATE.md and omnimind-api/CLAUDE.md to reflect post-mem0-core reality
>    - Write ADR-014 (mem0 strategy), ADR-015 (eval harness), ADR-016 (bi-temporal + supersession)
>
>    Mem0 core arc complete. Next phases: 10 (MCP), 11 (markdown export), 12 (SDK), 13 (observability), 14 (migration history).
>    ```
>
> 6. Push. Verify Railway deploys both services healthy.
> 7. Run `npm run eval:retrieval` against production. Confirm metrics within 3% of post-Phase-7a baseline. (No reason for Phase 9 to change retrieval — it's pure deletion of unused code — but always verify.)
> 8. Update `STATUS/CURRENT-PHASE.md` to "Phase 9 complete; mem0 core shipped. Ready for Phase 10 (MCP server)."
