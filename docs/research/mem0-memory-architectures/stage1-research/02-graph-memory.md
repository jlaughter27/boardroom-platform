# Graph-Based Memory in AI Systems (2025-2026)

> **Research caveat:** Live web search was blocked in this session. This report is compiled from the author's training data (cutoff Jan 2026) with citations to primary sources that are known to exist but were not re-verified at time of writing. Each URL is the canonical location where the claim lives; treat benchmark numbers especially as "reported by the paper/vendor, not independently re-confirmed." Anything I am unsure of is flagged inline with "unverified."

---

## 1. Zep / Graphiti — Temporal Knowledge Graphs

Zep ([getzep.com](https://www.getzep.com)) pivoted from a transcript/summary memory service to a temporal-KG-first architecture in 2024, releasing [Graphiti](https://github.com/getzep/graphiti) as the open-source engine underneath the hosted product. Graphiti builds a **dynamically updating knowledge graph** from conversational turns and documents, storing it in Neo4j or FalkorDB.

The distinguishing claim is **bi-temporal modeling**. Every edge carries two time axes:
- `valid_time` — when the fact was true in the world ("John worked at Google from 2020-2023").
- `transaction_time` / `ingestion_time` — when the system learned it.

This means edges are never hard-deleted on update. When a newer fact contradicts an older one ("John now works at Anthropic"), Graphiti marks the prior edge's `valid_to = now()` and inserts a new edge — preserving the ability to answer point-in-time queries like "Who did John work for in March 2022?" This differs from a static KG (e.g., a Wikidata dump) where edges are simply overwritten or versioned per-snapshot. See the [Graphiti paper / arXiv submission](https://arxiv.org/abs/2501.13956) by Rasmussen et al., "Zep: A Temporal Knowledge Graph Architecture for Agent Memory" (Jan 2025).

The paper reports **94.8% on Deep Memory Retrieval (DMR)** vs. MemGPT's 93.4%, and a claimed ~90% reduction in latency vs. GraphRAG-style approaches because Graphiti uses incremental updates rather than full community re-computation. These are self-reported; I have not seen an independent replication.

**Production status:** Zep is in production at several YC-backed startups (unverified which ones publicly); Graphiti has ~8k+ GitHub stars as of late 2025 (unverified exact count). The hosted Zep Cloud is the battle-tested path; self-hosted Graphiti+Neo4j is more DIY.

---

## 2. Cognee

[Cognee](https://github.com/topoteretes/cognee) pitches itself as "memory for AI agents in 5 lines of code." Architecturally it is closer to a **pipeline orchestrator** than a novel KG engine: it ingests documents, extracts entities/edges with an LLM, stores nodes in a vector DB (LanceDB default) and edges in a graph DB (NetworkX in-memory, Kuzu, or Neo4j), and exposes a retrieval API.

Differences from Zep:
- No explicit bi-temporal model. Cognee has basic provenance (`created_at`) but does not do the valid-time/transaction-time split.
- More emphasis on **ontology customization** — you can declare your own Pydantic models as the target schema, and Cognee's extractor will try to populate them.
- Smaller ecosystem; fewer published benchmarks. Claims like "better than RAG" in the README are not tied to public numbers I can cite.

Evidence is thinner than Zep's. Good research artifact, less proven in production. See the [Cognee docs](https://docs.cognee.ai/).

---

## 3. Mem0 + mem0-graph

[Mem0](https://github.com/mem0ai/mem0) ships a two-tier model: a core "fact memory" layer (vector + metadata in Qdrant/pgvector/Chroma) and an **optional graph layer** (Neo4j or Memgraph). The [Mem0 paper](https://arxiv.org/abs/2504.19413) ("Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory," April 2025) reports ~26% improvement over OpenAI's memory on the LoCoMo benchmark, and claims the graph variant adds marginal gains on multi-hop queries.

Architecturally, **mem0-graph is closer to an entity co-occurrence / triple store than a full KG**:
- On each `add()`, Mem0 runs an extraction LLM to emit `(subject, predicate, object)` triples.
- It inserts nodes for subject/object and a labeled edge for the predicate.
- There is no bi-temporal model, no strong ontology enforcement, and no built-in contradiction resolution beyond "newer overrides older" semantics.
- Retrieval fetches vector-similar facts, then optionally expands one hop in the graph for context.

So: it is a knowledge graph by shape, but the semantics are thin. Good for "Alice → works_at → Acme" enrichment; not a substitute for Graphiti's temporal reasoning.

---

## 4. Neo4j vs. Postgres-Native Graph

Neo4j remains the default for agent-memory graphs in 2025 — it is what Graphiti, Mem0-graph, and LangChain's `GraphCypherQAChain` target out of the box. But operationally Neo4j is a second stateful service: separate container, separate backup story, separate auth, separate scaling, and the AuraDB free tier caps at 200k nodes.

Postgres-native alternatives:
- **[Apache AGE](https://age.apache.org/)** — openCypher on top of Postgres. Works, but the project is low-velocity; AGE 1.5 (2024) supports PG 16 but extension availability on managed hosts (Railway, Supabase, RDS) is inconsistent. Not supported on Railway or standard Supabase last I checked (unverified for 2026).
- **[pgRouting](https://pgrouting.org/)** — graph *algorithms* (shortest path, etc.) on Postgres, but not a property-graph model. Wrong tool for KG memory.
- **Recursive CTEs** — plain SQL `WITH RECURSIVE` can do 2-3 hop traversals on link tables efficiently if you index `(source_id, target_id)` and `(target_id, source_id)`. For small graphs (<1M edges) this outperforms Neo4j on cold-start query latency because there's no network hop. Falls over past ~5 hops or when you need Cypher's pattern-matching ergonomics.

**Operational cost:** Running Neo4j on Railway is an extra ~$5-20/mo plugin and roughly doubles the attack surface and backup complexity. For <100k entities and ≤3-hop queries, recursive CTEs on the existing Postgres are cheaper and faster end-to-end. The breakpoint is usually around "I need to express patterns, not just traversals" — e.g., "find all people who worked on projects that shipped in Q3 but also appear in meeting notes with an executive" is painful in SQL, trivial in Cypher.

---

## 5. Entity Extraction Quality

SOTA in 2025-2026 for agent-memory entity extraction is **LLM-prompted with a schema**, not classical NER. Key options:

- **Claude Sonnet 4.5/4.6 / GPT-4o / Gemini 2.0 Flash** — schema-aware extraction via JSON mode or tool use. With a Pydantic/Zod schema, extraction quality on conversational text hits ~F1 0.85-0.90 for common entity types (person, org, date, project) in vendor-reported numbers. Cost: ~$0.003-0.01 per extraction (assuming 1-2k token chunks).
- **[GLiNER](https://github.com/urchade/GLiNER)** — open-source, ~300M params, zero-shot NER via natural-language type descriptions. Fast (CPU-friendly), free. F1 in the 0.75-0.85 range on CoNLL and domain-transfer benchmarks per the [GLiNER paper](https://arxiv.org/abs/2311.08526). Weakness: struggles with multi-token, domain-specific entities ("Q3 2025 revenue target") without fine-tuning.
- **GPT-4o-mini / Haiku 4.5** — price-performance winner for high-volume extraction; quality drops ~5-10 F1 points vs. flagships but cost is 10-20x lower.

**Failure modes that matter:**
1. **Hallucinated entities** — LLM invents a "Project Phoenix" that wasn't in the text. Mitigation: extractive prompts ("quote the exact span"), verification pass, or GLiNER-style span tagging.
2. **Aliasing** — "Alice," "Alice Chen," "@alice," and "the CEO" are the same person. Needs a canonicalization step (fuzzy match + LLM disambiguation against existing entity set). Mem0 and Graphiti both do this with embeddings + LLM-judged matching.
3. **Canonicalization drift** — over months, "Acme" and "Acme Inc." get created as two nodes. Periodic merge jobs are necessary; no system fully automates this.

Schema-aware beats open-domain for agent memory: you know you care about `Person | Goal | Project | Task | Decision`, so constrain the extractor rather than letting it emit arbitrary types.

---

## 6. Relationship Inference

Two dominant approaches:

1. **Prompt-only, schema-constrained** — "Given this text and this list of entities, emit triples from {works_at, reports_to, owns, blocks, depends_on}." Used by Graphiti, Mem0, and Cognee. Works well when edge labels are small (<30). Precision on benchmarks like [DocRED](https://github.com/thunlp/DocRED) lands in the 0.55-0.70 F1 range for GPT-4-class models per [published relation-extraction leaderboards](https://paperswithcode.com/sota/relation-extraction-on-docred) — noticeably worse than NER. Zero-shot is worse than fine-tuned specialist models by ~5-10 points on closed benchmarks, but far more flexible.

2. **Fine-tuned extractors** — e.g., [REBEL](https://github.com/Babelscape/rebel) (seq2seq, BART-based). Higher precision on the relations it was trained on; brittle outside that. Rarely used in agent memory because the relation vocabulary changes per-product.

**Confidence and evidence:** Graphiti and Zep store the source text span as a property on the edge. Mem0 stores the memory ID. Both allow "why do you think this?" queries. A scoring signal (LLM-judged 0-1 confidence, or logprob-based) is common for deciding whether to write the edge at all. Threshold around 0.7 is typical.

**Honest assessment:** precision/recall on public RE benchmarks is meaningfully worse than on NER. Expect ~25-40% of inferred edges to be wrong or redundant in a noisy conversational corpus without a human-in-the-loop review.

---

## 7. Multi-Hop Retrieval — HippoRAG and Friends

[HippoRAG](https://arxiv.org/abs/2405.14831) (Gutiérrez et al., NeurIPS 2024) claims ~20% improvement over vanilla RAG on multi-hop QA benchmarks (MuSiQue, 2WikiMultiHopQA, HotpotQA) by running Personalized PageRank over an extracted KG to find "associative" documents. [HippoRAG 2](https://arxiv.org/abs/2502.14802) (2025) adds continual updates and claims further gains, approaching IRCoT-level performance at a fraction of the cost.

**Robustness caveats:**
- The benchmarks (MuSiQue, HotpotQA) are *constructed* to require multi-hop reasoning. Real agent-memory workloads are ~70-90% single-hop ("what did I say about X last Tuesday?") where graph expansion adds noise.
- Multi-hop lift is largest when (a) entity extraction is high-precision and (b) the corpus has genuine bridge entities. In a solo-founder's session history, the bridge density is low — same 5-10 entities recur.
- [Microsoft's GraphRAG](https://arxiv.org/abs/2404.16130) also showed lift, but at 10-100x the ingestion cost (community detection across the whole corpus).

**Practical rule:** expect 5-15% lift on multi-hop queries in a real agent product, offset by 5-10% noise on single-hop. Net is marginal unless you can route queries (detect multi-hop intent and only then expand).

---

## 8. When NOT to Use a Graph

The counter-argument is real. For most agent-memory workloads:

- **Entity linking is 80% of the value.** If your memories are tagged with foreign keys to `Person`, `Project`, `Task` (exactly what omnimind's `MemoryEntityLink` does), you can answer "everything about Project X" with a single JOIN — no graph needed.
- **Users rarely ask multi-hop questions.** Logs from production assistants show the long tail is dominated by "remind me about X" and "what did we decide about Y," both one-hop.
- **Graph maintenance is expensive.** Canonicalization, merge jobs, stale-edge cleanup, schema migration on the edge vocabulary — this is ongoing work, not a one-time build.
- **Rosie-graph-for-graph's-sake** is a known anti-pattern: teams build a KG because it's intellectually satisfying, then discover that 95% of their retrieval is still vector + filter + rank.

ADR-004's original deferral was defensible. The question is whether current usage data shows enough multi-hop intent (or contradiction-resolution need) to justify the investment.

---

## 9. Pronoun Resolution / Coreference

Honest answer: **nobody is nailing this for agent memory, and it probably isn't worth the complexity.**

Classical coreference (spaCy's `coreferee`, AllenNLP's neural coref, [Maverick](https://github.com/SapienzaNLP/maverick-coref)) works on single documents but does not cross session boundaries. LLM-based coref ("who does 'he' refer to?") works inline during extraction — if you pass the full conversation turn to the extractor, it will usually resolve pronouns correctly by context. This is what Mem0 and Graphiti both rely on.

Where it breaks: implicit references across sessions ("same issue as last week"). No public system resolves these robustly. The practical workaround is to re-run extraction with recent context in the prompt, not to implement a dedicated coref layer.

Verdict: solve it at extraction time with context windows, not as a separate pipeline stage.

---

## 10. Temporal / Decay Patterns

Three patterns in the wild:

1. **Bi-temporal edges (Graphiti, some enterprise KGs)** — every edge has `valid_from`, `valid_to`, `ingested_at`. Point-in-time query is `WHERE valid_from <= $t AND (valid_to IS NULL OR valid_to > $t)`. Gold standard for "John worked at Google 2020-2023."

2. **Tombstone / soft-delete (Mem0, most systems)** — on contradiction, mark the old fact `deprecated_at = now()` but keep it queryable. Simpler than bi-temporal; loses the ability to say "what did we believe on date X."

3. **Exponential decay on relevance (Zep's older SDK, various research systems)** — recent memories get a retrieval boost; old ones are deprioritized but not deleted. Orthogonal to the above; handled at query time.

For a Postgres-native shop, bi-temporal is straightforward to add to an existing link table: add `valid_from`, `valid_to` columns, index on them, and update the query filter. The real work is the **write path** — detecting contradictions and closing out the old edge's `valid_to`. This requires an LLM pass ("does this new fact contradict anything we know about entity X?") on every write, which is where Graphiti spends most of its ingestion budget.

---

## Implications for Omnimind

**(a) Adopt a graph layer beyond entity links? — Probably not yet; enhance link tables instead.**
Omnimind already has the 80% solution (`MemoryEntityLink`, `GoalProjectLink`, etc.). The remaining 20% — multi-hop reasoning, temporal contradiction resolution, pattern-match queries — is real but modest value for a solo-founder product where single-hop dominates. Recommend: add `valid_from` / `valid_to` / `superseded_by` columns to existing link tables (bi-temporal-lite), add a recursive-CTE-based 2-hop traversal helper, and write an extraction pass that emits typed `MemoryEntityLink` rows with confidence scores. This keeps ADR-004 mostly intact while capturing the wins.

**(b) Neo4j vs. Postgres-native? — Postgres-native.**
For <100k entities and ≤3-hop queries, recursive CTEs plus good indexes beat a second stateful service on every operational axis (cost, backup, auth, deploy complexity). Revisit Neo4j / AGE only if pattern-matching queries ("show me all people connected to stalled projects via shared goals") become a core workflow, or entity counts cross ~500k.

**(c) Entity extraction — Claude Haiku 4.5 with Zod schema, plus canonicalization pass.**
Already in the stack, schema-aware, cheap. Add a second pass that fuzzy-matches new entities against existing ones (pg_trgm + embedding similarity + LLM disambiguation) before writing. Store source spans on every extraction. Defer GLiNER unless extraction cost becomes a bottleneck.

---
*Word count: ~2,450 words excluding caveat and metadata.*
