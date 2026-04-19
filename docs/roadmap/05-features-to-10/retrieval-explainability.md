# Retrieval Explainability

> Constraints reminder: Respect ADRs 001-013. See [`../01-foundations/CONSTRAINTS.md`](../01-foundations/CONSTRAINTS.md).

---

## Problem

When a persona answers a question, OmniMind has just ranked ~30-50 candidate memories down to the 7-10 it actually packed into the prompt. The rank order is computed by `ranker.ts` from four-to-five signals: semantic cosine similarity, full-text search BM25, trigram fuzzy match, structured filter pass-through, and (after Phase 6) entity-link boost.

Today, that whole process is a black box. When the model surfaces a memory the user thinks is irrelevant — or, worse, when it *misses* a memory the user knows exists — there is no way to ask "why this, why not that?" The only diagnostic loop is "stare at the persona answer and guess."

Three downstream costs:

- **User trust erodes** when retrieval looks arbitrary. "Why did it pull up that random old note?" with no answer feels like the system is broken even when the rank was defensible.
- **Debugging is slow.** Engineers can't tell whether a bad answer is a retrieval problem (wrong memories) or a generation problem (right memories, bad prompt).
- **Tuning is blind.** We can't reason about whether to up-weight the trigram signal or down-weight the recency boost without per-result signal contributions.

## Approach

Surface, for any retrieval result, the **per-signal contribution** to its final rank. Show:

- `semantic` — cosine similarity, raw [0, 1]
- `fts` — BM25 score, normalized [0, 1]
- `trigram` — trigram match fraction, raw [0, 1]
- `structured` — pass-through boolean turned into [0, 1] (matched filter / didn't)
- `entity_boost` — multiplier from MemoryEntityLink overlap [1.0, 2.0]
- `recency_boost` — exponential decay term [0, 1]
- `final_score` — the combined number that determined rank

Plus a one-line rationale: "ranked #1 because semantic similarity (0.87) and shared entity boost (linked to Person:Alex Chen, Project:Q2 Pricing) outweighed slightly older creation date."

### Where it lives

Two surfaces, same underlying data:

1. **Power-user / admin mode in the chat UI.** A toggle: "show retrieval signals." When on, every persona answer shows an expandable "Retrieved memories (10)" panel. Each row has the snippet plus the signal bar chart. Click a row to see the full memory + the rationale.

2. **Memory editor UI** (see [memory-editor-ui.md](memory-editor-ui.md)). A "Why was this memory surfaced?" view per persona invocation, accessible from the session detail page.

The toggle is off by default for paid users (clutter), on by default for the team's internal accounts (debugging).

### Implementation

`context-packager.ts` already returns ranked candidates. Extend the return shape to include per-signal scores. Persist the explanation snapshot in a new lightweight table so it can be re-displayed days later without re-running retrieval.

```ts
interface RetrievalExplanation {
  memoryId: string
  finalScore: number
  signals: {
    semantic: number
    fts: number
    trigram: number
    structured: number
    entityBoost: number
    recencyBoost: number
  }
  rationale: string  // human-readable, generated from signals
  rank: number
}
```

The `rationale` string is templated, not LLM-generated — it's deterministic and cheap. Format:

```
Ranked #{rank} because {top_two_signals_with_values}.
{optional_caveat_if_close_to_threshold}
```

## Schema impact

```prisma
model RetrievalExplanation {
  id              String   @id @default(cuid())
  sessionId       String?  // null if MCP-origin
  invocationId    String   // FK to AdvisorMessage or persona-call audit row
  query           String   // the query that produced this set
  retrievedAt     DateTime @default(now())
  totalCandidates Int
  resultsJson     Json     // RetrievalExplanation[] above

  @@index([invocationId])
  @@index([sessionId, retrievedAt])
}
```

Storage cost: ~2-5 KB per persona invocation. Negligible at OmniMind scale; trivially purgeable on a 90-day TTL if it ever isn't.

## API surface

- `GET /v1/retrieval/explanations/:invocationId` — fetch the explanation for a specific persona call
- `GET /v1/retrieval/explanations?sessionId=&limit=` — list explanations for a session

No write endpoints; explanations are produced server-side by `context-packager.ts` and persisted automatically.

## Phases

- post-Phase 14 (observability) — once entity-boost (Phase 6) and the observability foundation are in place, the explanation gains its sixth signal and the feature is most useful. Slot in opportunistically alongside the per-tenant cost controls work in Phase 18.

Estimated effort: ~1-2 weeks (extend ranker, persist explanations, add UI panels).

## Risks

- **Information disclosure.** Showing signal values may reveal internals that competitors could reverse-engineer. Mitigation: low real risk (the algorithm is published in research papers), but feature can be gated behind a "developer" plan if a moat concern emerges.
- **Explanation accuracy drift.** As the ranker evolves, persisted explanations from old invocations no longer match how the same query would rank today. Mitigation: store the ranker version + signal weights in the explanation row; UI displays "computed under ranker v1.3" caveat.
- **UI clutter.** Bar charts in every chat answer overwhelm casual users. Mitigation: opt-in toggle, off by default; collapsible panel; keep the persona answer primary.
- **Performance hit on hot path.** Computing + persisting explanations on every persona call adds latency. Mitigation: persistence is async (fire-and-forget after the response streams); computation reuses values already produced by the ranker.

## Success metrics

- ≥ 30% of power-user / admin sessions use the explanation panel within 30 days of launch
- Mean time to root cause for "wrong memory surfaced" bug reports drops by ≥ 50%
- "I trust the retrieval" survey score increases by ≥ 1 point post-launch (paired with the memory editor)
- Zero performance regressions: p95 persona-call latency unchanged within ±5%

## Dependencies on other features

- **Memory editor UI** (Phase 11) — primary surface for the "why was this surfaced?" view
- **Observability suite** (Phase 13) — explanation rows are queryable from the same dashboard pane as `omnimind.retrieval.latency` metrics
- **Phase 6 entity-boost** ([`../04-roadmap/PHASE-6-entity-ranker-boost/`](../04-roadmap/PHASE-6-entity-ranker-boost/)) — adds the sixth signal; explainability is most valuable after entity boost lands
