# DEF-004 — MemGPT-Style Hierarchical Memory Tiers

**Capability:** Implement a hierarchy of memory tiers (working memory, recall memory, archival memory) with explicit eviction policies between tiers, paged context windows, and self-edit operations à la MemGPT/Letta.

**Status:** DEFERRED — likely permanently. Closest to a "wrong product, wrong scale" deferral in the entire register.

**Trigger to flip back to ACTIVE:** **Never planned.** No measurable trigger. Re-evaluation requires explicit founder decision overriding the wave 1 research recommendation.

**Work estimate if ever triggered:** 6-10 weeks (full rewrite of the memory subsystem).

**Why deferred (essentially permanently):**

Per the wave 1 research and the cited MemGPT/Letta postmortems:

1. **Wrong product fit.** MemGPT's tier hierarchy is designed for stateful agents that reason over a context window thousands of times longer than what fits in the model. OmniMind serves request-response sessions where a 7-10 item context cap is sufficient and intentional (CLAUDE.md rule 7). The user is the conductor, not a 24/7 agent; tiered memory solves a problem we don't have.

2. **Wrong scale.** The tier complexity pays off above ~50,000 memories per agent. Our cap at 200/user × 2000 users = 400k total but ~200/agent — well within hybrid retrieval's sweet spot.

3. **Wrong cost profile.** Tier transitions involve LLM-driven self-edit operations on every transition. At our user count, this would multiply LLM spend with no measurable retrieval-quality lift over our hybrid + ranker approach.

4. **Architectural collision with ADRs.** MemGPT's "loop until ready" reasoning pattern conflicts with ADR-001 (custom ~200-line agent runtime; no framework loops). Adopting it would either bloat our runtime past its size budget or import a framework we explicitly rejected.

**What we DO take from MemGPT:**
- The vocabulary ("recall memory," "archival memory") for documentation
- The temporal-update philosophy (Phase 7a recency boost is in this spirit)
- The self-edit awareness (Phase 5b LLM consolidation is a small, gated version)

**References:**
- Wave 1 research wave1-research findings on hosted memory backends
- ADR-001 (no frameworks) — strict no-MemGPT/Letta integration
- DEF-012 (hosted memory service) is a related deferral covering the same territory
