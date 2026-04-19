# DEF-003 — Pronoun Resolution

**Capability:** When a memory contains "he said," "she did," "they decided," resolve the pronouns to specific Person entities so retrieval queries like `"what did Alex say about pricing"` can match memories that reference Alex by pronoun.

**Status:** DEFERRED.

**Trigger to flip back to ACTIVE:**
A specific persona's eval shows >10% answer-quality regression traceable to pronoun ambiguity. "Traceable" means: the persona was given context where the relevant memory used a pronoun, the persona failed to associate it with the asking-about entity, and the eval rubric's per-question diagnosis attributes the failure to pronoun resolution (not generic context-packing weakness).

**Work estimate when triggered:** 4-6 weeks.

This is a hard, unglamorous NLP problem. Realistic breakdown:
- 1 week: eval scenarios that isolate the failure mode (curated queries where pronoun resolution is the only variable)
- 2 weeks: pipeline addition — coreference resolution at memory-write time using a small specialized model (e.g., `coref-spanbert` or an LLM extraction pass). Persist resolved spans alongside the memory text in a sibling field `MemoryEntry.resolvedSpans Json`
- 1-2 weeks: retrieval integration — the FTS index uses both raw text and resolved-text; the entity boost (Phase 6) reads resolved spans
- 1 week: eval-driven tuning + rollout

**Why deferred:**

(a) The cost-benefit is thin in our actual workload. Most memories are extracted from sessions where the entities are explicitly named in the same chunk; pronoun-only references are rare per a quick audit of seeded memories.

(b) Coreference is **expensive at write time** (~50-200ms per memory) and **lossy** (small models hit ~75% accuracy on noisy informal text; LLM extraction is more accurate but multiplies write-path cost).

(c) Better cheaper substitutes exist: prompt the extraction step (Phase 2) to **always rewrite pronouns to names in the canonical content** when context is available. This catches 80% of the value at 0% added retrieval cost. Document this rewrite rule in the extraction prompt; let pronoun resolution proper fight for budget when there's measurable demand.

**References:**
- Wave 1 research catalogued this as a "real but rare" problem; deferred without ADR per the founder's preference for shipping
- `docs/prompts/memory-extractor.system.md` — the rewrite-pronouns-to-names rule could be added here today as a near-zero-cost improvement
- `packages/omnimind-api/src/memory/validation/pipeline.ts` — where the rewrite would land
