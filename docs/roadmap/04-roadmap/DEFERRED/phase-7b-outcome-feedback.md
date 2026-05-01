# DEF-001 — Outcome-Weighted Ranker (Phase 7b)

**Capability:** Boost retrieval ranking for memories that have been cited by decisions whose outcomes turned out well, and demote those associated with bad outcomes. The fifth signal in the ranker after relevance, recency, entity, and access count — a feedback loop closing "what we remembered" against "what worked."

**Status:** DEFERRED.

**Trigger to flip back to ACTIVE:**
- `Decision.outcome` field populated on **≥200 decisions across users**, AND
- A `MemoryCitation` link table exists (currently no schema for "which memories influenced which decisions" — Phase 4 graph-traversal phase touches related territory but doesn't create this table)

Both conditions are measurable. Without (1), there's no signal to learn from. Without (2), there's nothing to weight.

**Work estimate when triggered:** 4-6 weeks.

Breakdown:
- 1 week: design and ship the `MemoryCitation` link table schema migration (memoryId, decisionId, weight, createdAt, source: 'auto'|'manual')
- 1 week: backfill citations from existing decisions via a one-shot LLM job (extract per-decision the memories that informed it from the saved context payloads — this requires the context payloads to have been retained, which Phase 5a/5b began addressing)
- 1 week: add the outcome signal to `ranker.ts` behind a feature flag `RANKER_OUTCOME_SIGNAL_ENABLED`; weight TBD via eval tuning
- 1-2 weeks: eval-driven tuning. Baseline MRR + click-through; A/B with the new signal on; iterate weights until MRR lift is statistically significant
- 1 week: production rollout, observability dashboards for the signal, documentation

**Why deferred (not "never"):**

The signal is theoretically powerful — outcomes are the highest-quality training signal we have access to. But the **data isn't there yet**. The audit found `Decision.outcome` is populated on a single-digit percentage of decisions today; there's no UX prompt to record outcomes; and the `MemoryCitation` table doesn't exist. Building the ranker before the data exists means weeks of design effort against synthetic or near-empty data.

The right sequence is: ship the outcome-capture UX first (which falls out of the cortex review nudges in Phase 2), wait for the data to accumulate, then ship the ranker.

**References:**
- `docs/research/omnimind-roadmap-2026/wave1-research/` — original deferral rationale
- `docs/roadmap/04-roadmap/ROADMAP-OVERVIEW.md` — confirmed deferred
- `packages/omnimind-api/src/retrieval/ranker.ts` — where the new signal lands
- Existing signals to combine with: relevance (cosine sim), recency (Phase 7a exp-decay), entity boost (Phase 6), access count (Phase 7a log)

**Dependencies on other phases:**
- Phase 4 (graph traversal) — implicit; relating memories to decisions is graph-shaped
- Phase 7a (recency/access) — must ship first; outcome is the 5th signal in the same ranker
- Phase 14 (observability) — dashboards for measuring signal lift
- Phase 18 (LlmUsage) — tangentially useful for weighting decisions where outcome captured cost as well as result

**Anti-pattern to avoid when triggering:** Don't ship outcome weighting without an offline eval showing MRR lift. The signal is noisy (outcomes are confounded with many factors); naive weighting can hurt retrieval quality.
