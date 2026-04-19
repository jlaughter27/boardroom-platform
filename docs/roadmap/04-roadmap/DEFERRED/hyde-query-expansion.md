# DEF-005 — HyDE / Query Expansion (as default)

**Capability:** Hypothetical Document Embeddings (HyDE) — for an incoming query, generate a hypothetical answer with a small LLM, embed THAT, and use the synthetic embedding for vector search instead of (or alongside) the raw query embedding. Variants: query expansion via LLM-generated paraphrases; multi-query fan-out then dedupe.

**Status:** DEFERRED as a default. Not deferred for narrow per-query-class application.

**Trigger to flip back to ACTIVE:**
The eval harness identifies a **specific query class** where HyDE lifts MRR ≥10% over plain query embedding. "Class" is a labeled bucket in the eval harness — e.g., "abstract questions about feelings/values," "queries that don't share vocabulary with stored memories." If such a class is identified, ship HyDE GATED to that class only.

**Work estimate when triggered:** 1-2 weeks (gated to the identified class).

Breakdown:
- 0.5 week: classifier — small, fast prompt that tags the incoming query into one of N classes. Cache aggressively
- 0.5-1 week: HyDE pipeline — for matched class, prompt Haiku for a 3-5 sentence hypothetical answer; embed; semantic-search using synthetic embedding; merge with FTS + trigram results via RRF (no special handling)
- 0.5 week: eval + rollout

**Why deferred as default:**

HyDE adds **one LLM call per query** to the user-facing latency budget (~200-500ms even with Haiku). At our query volume × the latency cost, this is a meaningful UX hit. It also shifts query semantics from the user's actual intent to the LLM's interpretation of intent — useful for vague queries, harmful for precise ones (e.g., "show me memories from March 14" gets paraphrased and loses the date specificity).

The wave 1 research is consistent: HyDE outperforms naive embedding **on specific query classes** (abstract, vocabulary-mismatched, exploratory). It underperforms or is neutral on factual, named-entity, or temporally-anchored queries. Shipping HyDE as default trades wins on one class for losses on another.

The honest answer is to **measure first**. Until the eval harness identifies a winning class, this is premature.

**Cheaper substitutes already in place:**
- Query expansion via FTS dictionaries (built into Postgres `tsvector` with `to_tsquery`'s `OR` operator)
- The hybrid retrieval combining semantic + FTS + trigram catches lexically-similar memories without HyDE
- Phase 6's entity boost handles the named-entity case directly

**References:**
- HyDE original paper: Gao et al. 2022 — `arxiv.org/abs/2212.10496`
- `eval/scenarios/` — where the per-class diagnosis would live
- `packages/omnimind-api/src/retrieval/semantic-search.ts` — integration site if/when triggered

**Anti-pattern to avoid:** "Let's add HyDE because it's a known best practice." The known best practice is "measure your retrieval, then add HyDE if measurement justifies it." We have an eval harness specifically to make this decision data-driven.
