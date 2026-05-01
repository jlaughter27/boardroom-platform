# Context Load Order

**Purpose:** A deeper version of CLAUDE-WORKFLOW.md's Step 1 — for non-trivial tasks, the exact list of files to load.

---

## Universal pre-read (every session, ~1 KB)

1. `STATUS/CURRENT-PHASE.md` — what's in flight
2. `STATUS/BLOCKERS.md` — what's stuck

If both are empty, you're starting fresh. Read `PROJECT-CONTEXT.md` next.

---

## Task-specific load orders

### Picking up Phase 0 (Foundation cleanup)
1. `04-roadmap/PHASE-0-foundation/README.md`
2. `04-roadmap/PHASE-0-foundation/tasks-and-prompts.md`
3. `02-current-state/DEAD-CODE.md` (for the searchVector + scratchpad targets)
4. `06-risks-and-mitigations/DATA-RISKS.md` (because Phase 0 touches schema)

### Picking up Phase 0.5 (Eval harness)
1. `04-roadmap/PHASE-0.5-eval-harness/README.md`
2. `04-roadmap/PHASE-0.5-eval-harness/tasks-and-prompts.md`
3. `03-research/ai-memory-sota.md` § "evaluation"
4. `02-current-state/CAPABILITIES-INVENTORY.md` § "retrieval"

### Picking up Phase 1 (Schema alignment)
1. `04-roadmap/PHASE-1-schema-alignment/README.md`
2. `04-roadmap/PHASE-1-schema-alignment/tasks-and-prompts.md`
3. `06-risks-and-mitigations/DATA-RISKS.md`
4. `08-references/codebase-map.md` § "schema.prisma"

### Picking up Phase 2 (Pattern extraction + ADD/UPDATE/DELETE/NOOP)
1. `04-roadmap/PHASE-2-pattern-extraction/README.md`
2. `04-roadmap/PHASE-2-pattern-extraction/tasks-and-prompts.md`
3. `03-research/mem0-decomposition.md` (for the write-decision loop semantics)
4. `06-risks-and-mitigations/OPERATIONAL-RISKS.md` § "embedding queue"

### Picking up Phase 3 (HNSW + RRF)
1. `04-roadmap/PHASE-3-hnsw-rrf/README.md`
2. `04-roadmap/PHASE-3-hnsw-rrf/tasks-and-prompts.md`
3. `03-research/ai-memory-sota.md` § "indexing" + § "fusion"

### Picking up any later phase (4 through 16)
Same pattern: `04-roadmap/PHASE-N/README.md` → `tasks-and-prompts.md`. Cross-references named in those files.

### Designing a make-it-10 feature
1. `05-features-to-10/FEATURE-INDEX.md`
2. The specific feature spec
3. `01-foundations/CONSTRAINTS.md` (sanity-check against ADRs)

### Risk audit
1. `06-risks-and-mitigations/RISK-REGISTER.md`
2. `06-risks-and-mitigations/6-MONTH-FORECAST.md`
3. `02-current-state/LANDMINES.md`

### Architecture decision
1. `01-foundations/CONSTRAINTS.md`
2. `01-foundations/ADR-INDEX.md`
3. The specific ADR copy in `08-references/adrs/`

### "What does omnimind do today?"
1. `02-current-state/CAPABILITIES-INVENTORY.md`
2. `02-current-state/ARCHITECTURE-MAP.md`

### "What's broken / missing?"
1. `02-current-state/KNOWN-ISSUES.md`
2. `02-current-state/TECH-DEBT.md`
3. `02-current-state/LANDMINES.md`

### "Where is X in the codebase?"
1. `08-references/codebase-map.md`

---

## Don't load everything at once

If you find yourself wanting to read the whole `02-current-state/` folder "to be safe," stop. Pick the one file that matches your task. The summaries inside each file are calibrated to be enough.

If a task genuinely needs more context than the load order specifies, that's signal that either (a) the task scope is wrong, or (b) the load-order map needs updating. In case (b), update this file and `STATUS/DECISIONS-LOG.md`.
