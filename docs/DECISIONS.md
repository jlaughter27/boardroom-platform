# Architectural Decision Log

All architectural decisions are logged here with rationale. Check before proposing alternatives.

## ADR-001: Custom Agent Runtime Over Frameworks
**Date:** 2026-04-06 | **Status:** Accepted
**Decision:** Build ~200-line custom agent runtime. No LangChain, CrewAI, LangGraph.
**Rationale:** 1-2 dev team, <100 users at launch, fan-out/fan-in pattern doesn't need graph cycles. Full stack trace visibility. Zero abstraction leakage. Revisit at Series A.
**Alternatives rejected:** LangGraph (TypeScript SDK immature, 2-3 week migration cost), CrewAI (too opinionated).

## ADR-002: Claude-Only Model Provider for v1
**Date:** 2026-04-06 | **Status:** Accepted
**Decision:** Anthropic Claude (Sonnet 4.6 + Haiku 4.5) only. No multi-model routing.
**Rationale:** Single prompt format, single compliance regime, single failure mode. DeepSeek is 87% cheaper but China-hosted (compliance risk). Haiku covers "cheap" roles adequately.
**Revisit when:** 5,000+ paying users and dedicated ML ops engineer.

## ADR-003: PostgreSQL + pgvector (No Separate Vector DB)
**Date:** 2026-04-06 | **Status:** Accepted
**Decision:** All data in one PostgreSQL instance with pgvector, pg_trgm, tsvector extensions.
**Rationale:** One database. No operational overhead of Pinecone/Weaviate. pgvector sufficient up to ~10M vectors. Hybrid retrieval (structured + FTS + trigram + semantic) in same DB.

## ADR-004: Knowledge Graph Deferred
**Date:** 2026-04-06 | **Status:** Accepted
**Decision:** No knowledge graph in v1. Use tags + join table links + hybrid retrieval.
**Rationale:** Current memory count ~10-50 per room. Graph pays off at 500+ memories (~12-18 months). cross-ref.json schema stays empty. Revisit when retrieval metrics degrade.

## ADR-005: Keep Room Model, Add DecisionSession Alongside
**Date:** 2026-04-06 | **Status:** Accepted
**Decision:** Room is the root aggregate. Don't remove it. Add DecisionSession as sibling.
**Rationale:** Memory, sessions, messages all hang off Room. Removing it is a rewrite with data loss risk. Adding alongside is zero-migration-risk.

## ADR-006: Monorepo with Turborepo
**Date:** 2026-04-06 | **Status:** Accepted
**Decision:** Single monorepo (packages/shared, packages/omnimind-api, packages/boardroom-ai).
**Rationale:** 1-2 devs. Single PR shows full picture. Shared types as binding contract. Independent Dockerfiles for independent deployment. Revisit when team exceeds 3 devs.

## ADR-007: Two-Agent Build Workflow
**Date:** 2026-04-07 | **Status:** Accepted
**Decision:** Claude Code (Opus) handles architecture + business logic. DeepSeek v3.2 (OpenCode) handles types, schemas, utils, tests, eval data.
**Rationale:** Parallel work lanes with zero file conflicts. DeepSeek tasks completable from task file alone. Claude reviews all DeepSeek output before building on it. Contract-first prevents drift.
