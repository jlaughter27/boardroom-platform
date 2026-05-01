# DEF-014 — Persona Marketplace (alternative-scenario deferral)

**Capability:** Git-installable, signed, sandboxed personas distributed by third parties. See `04-roadmap/PHASE-17-persona-marketplace/README.md` for the active phase spec.

**Status:** DEFERRED in alternative scenarios.

> **Important:** Phase 17 ships the persona marketplace as part of this roadmap. This deferred-spec entry exists to capture the **alternative scenarios where Phase 17 is itself deferred** (i.e., descoped, postponed, or replaced).

**When this deferral applies (i.e., reasons to NOT ship Phase 17):**

1. **<5 customer requests for marketplace.** If by Phase 17's scheduled start the demand signal is weak (no customers asking for third-party personas, no internal evidence that more personas drive retention), reclassify Phase 17 as deferred. Trigger to flip back: ≥5 customer requests OR a strategic pivot to multi-tenant on this dimension.

2. **Unresolved security risk.** If Phase 17's prerequisites (sigstore integration, tool restriction enforcement, sandboxing eval) reveal an unresolvable security boundary issue — e.g., a way for a malicious persona to escape `tools_denied` via the LLM runtime — then defer until the security model is solved.

3. **Engineering bandwidth.** If Phase 16-18 take materially longer than budgeted and cumulative delay risks the >2000-user milestone slipping past Phase 19's exit criteria, sacrifice Phase 17 to protect the scale path.

**Trigger to flip back to ACTIVE (re-promote Phase 17):**
- ≥5 customer requests in a recent 90-day window, OR
- A strategic decision to make BoardRoom multi-tenant in this dimension (e.g., partnerships with a community organization that wants to publish a curated persona set)

**Work estimate when triggered:** 4-6 weeks (same as Phase 17's active spec).

**Why this alternative-deferral spec exists:**

The roadmap allocates Phase 17 explicitly. But customer-facing scope decisions can change quarterly. This spec preserves the deferral pathway so that if Phase 17 is descoped after-the-fact, there's a one-page reference for "what we agreed to push off and the trigger to bring it back."

**Substitutes if marketplace is deferred:**
- The `CustomPersona` table already exists (Phase 1+); users can author personas via the API directly (curl POST). No discovery, no signing, no install flow — just per-user custom prompts. This covers the power-user case at zero additional engineering.
- A small handful of Anthropic/BoardRoom-curated "guest personas" can be pre-loaded via seed migrations as a thin substitute for community personas.

**References:**
- `docs/roadmap/04-roadmap/PHASE-17-persona-marketplace/README.md` — full active spec
- `docs/research/omnimind-roadmap-2026/wave1-research/04-external-interfaces.md` §6 — research basis
- Original ROADMAP-OVERVIEW DEFERRED row (DEF-014)
