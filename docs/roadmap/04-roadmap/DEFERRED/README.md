# Deferred Items

**Audience:** Claude or human encountering a "we're not doing X" decision and wanting to know when X comes back.
**Purpose:** Every deferred capability has a named, measurable trigger to flip it back to ACTIVE.

---

## Currently deferred

| ID | Capability | Trigger | Estimated work | Spec |
|---|---|---|---|---|
| DEF-001 | **Outcome-weighted ranker (Phase 7b)** | `Decision.outcome` populated on ≥200 decisions across users AND `MemoryCitation` link table exists | 4-6 weeks | [phase-7b-outcome-feedback.md](phase-7b-outcome-feedback.md) |
| DEF-002 | **Cross-encoder reranker (Phase 8)** | Eval harness shows top-5 MRR <0.6 AND Railway plan ≥4GB RAM AND 24h soak passes | 3 weeks | [phase-8-reranker.md](phase-8-reranker.md) |
| DEF-003 | **Pronoun resolution** | A specific persona's eval shows >10% answer-quality regression traceable to pronoun ambiguity | 4-6 weeks | [pronoun-resolution.md](pronoun-resolution.md) |
| DEF-004 | **MemGPT-style hierarchical memory tiers** | Never (wrong product, wrong scale per research) | N/A | [memgpt-tiers.md](memgpt-tiers.md) |
| DEF-005 | **HyDE / query expansion (default)** | Eval identifies a specific query class where HyDE lifts MRR ≥10% | 1-2 weeks (gated to that class only) | [hyde-query-expansion.md](hyde-query-expansion.md) |
| DEF-006 | **Bi-temporal transaction-time axis** | A user files a real "what did the system *believe* about X on date Y" support ticket ≥3 times | 2-3 weeks | [bi-temporal-transaction-axis.md](bi-temporal-transaction-axis.md) |
| DEF-007 | **Feature-flag DB tables** | Horizontal scaling (>1 Railway instance) | 2 weeks | [feature-flag-tables.md](feature-flag-tables.md) |
| DEF-008 | **Performance monitoring tables (custom)** | Dropped — use OTel/Datadog instead (Phase 13) | N/A | N/A |
| DEF-009 | **Audit tables (memory access log)** | SOC 2 Type 1 customer requirement OR forensic incident requires it | 2 weeks | [audit-tables.md](audit-tables.md) |
| DEF-010 | **Redis (any purpose)** | >1 Railway instance OR cron jobs >30s OR >500 active users | depends on use | N/A |
| DEF-011 | **Separate vector DB (Pinecone/Weaviate/Qdrant)** | >10M vectors total OR pgvector p99 query latency >500ms sustained | 4 weeks | N/A |
| DEF-012 | **Hosted memory service (Zep / Letta / mem0 cloud)** | Never in v1 (ADR-001 + cost) | N/A | N/A |
| DEF-013 | **LangGraph checkpointer / Store** | Never (ADR-001) — borrow vocabulary only | N/A | N/A |
| DEF-014 | **Persona marketplace (alternative-deferral)** | This is **PLANNED** as `04-roadmap/PHASE-17-persona-marketplace/`. The deferral spec only applies if Phase 17 is later descoped (see [persona-marketplace.md](persona-marketplace.md) for the conditions). | 4-6 weeks | [persona-marketplace.md](persona-marketplace.md) |
| DEF-015 | **Multi-user collaborative rooms** | Roadmap re-prioritization (Phase 4+ in original product spec) | 6-8 weeks | [multi-user-rooms.md](multi-user-rooms.md) |

## How to flip a deferred item back to ACTIVE

1. **Check the trigger** — is the named condition actually met? Use measured data, not vibes.
2. **Open `STATUS/DECISIONS-LOG.md`** — add a `DEC-N` entry stating the trigger has fired and the item is being un-deferred.
3. **Promote to a real phase** — give it a Phase number, create `04-roadmap/PHASE-N-{slug}/` with full README + tasks + testing.
4. **Update this file** — move the row from "Currently deferred" to "Resumed" (add a section).
5. **Update `04-roadmap/ROADMAP-OVERVIEW.md`** — slot the new phase into the timeline.
6. **Update `STATUS/CURRENT-PHASE.md`** — if it's the next active phase.

## How to add a NEW deferred item

If during execution a capability gets pushed off:

1. Create a spec file in `04-roadmap/DEFERRED/{slug}.md` — keep it short (300-500 words): what it is, why deferred, what trigger flips it back, estimated work.
2. Add a row to the table above.
3. Add a `DEC-N` entry to `STATUS/DECISIONS-LOG.md` documenting the deferral and rationale.

## Anti-patterns

- **Vague triggers** ("when scale demands it"). Every trigger is measurable: a number, a customer count, a metric threshold, a specific event.
- **Permanent deferrals without ADR backing** — if we're saying "never," it's an ADR-grade decision. Write it.
- **Re-debating deferred items mid-execution** — if a phase calls for HyDE and HyDE is deferred, you don't re-litigate; you mark a blocker and route the question to the user.
