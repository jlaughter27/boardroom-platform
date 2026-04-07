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

## ADR-007: Two-Agent Build Workflow (Retired)
**Date:** 2026-04-07 | **Status:** Retired
**Decision:** Originally split between Claude Code + DeepSeek. As of 2026-04-07, Claude Code owns everything. DeepSeek split retired for speed.

## ADR-008: Tool Execution via Anthropic SDK Native Tool Use
**Date:** 2026-04-07 | **Status:** Accepted
**Decision:** Tools are plain TypeScript functions registered in the agent runtime. Persona calls include tool definitions in the Anthropic API request. The agent handles tool_use content blocks, executes the function, returns tool_result, and continues the conversation turn.
**Rationale:** NOT using MCP protocol for v1. MCP is a future migration path for v2. Native tool_use is simpler, fully supported by the Anthropic SDK, and doesn't require a separate server process per tool.
**Alternatives rejected:** MCP servers (operational overhead, premature for 3 tools).

## ADR-009: Background Jobs via node-cron
**Date:** 2026-04-07 | **Status:** Accepted
**Decision:** Weekly memo, pattern detection, and contradiction scan run as cron jobs within the OmniMind Express process. No separate worker. No Redis.
**Rationale:** Sufficient for <100 users. Graceful shutdown via cron.stop() on SIGTERM. Job duration expected <30s per user. Revisit when job duration exceeds 30s or user count exceeds 500.
**Alternatives rejected:** BullMQ + Redis (operational overhead), separate worker process (deployment complexity).

## ADR-010: Google Calendar via OAuth 2.0 + googleapis SDK
**Date:** 2026-04-07 | **Status:** Accepted
**Decision:** Standard OAuth 2.0 authorization code flow. Tokens stored encrypted in a dedicated OAuthToken Prisma model. Refresh token rotation handled automatically by googleapis client. Calendar data is read-only for v1.
**Rationale:** Direct integration via googleapis SDK is well-documented and reliable. Tokens encrypted at rest with ENCRYPTION_KEY env var. Read-only avoids write-permission complexity.
**Alternatives rejected:** iCal import (no real-time sync), CalDAV (complex, less adoption).
