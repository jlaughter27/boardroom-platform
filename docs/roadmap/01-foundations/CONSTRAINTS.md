# Constraints — The Non-Negotiables

**Audience:** Claude or human about to make any architectural choice.
**Purpose:** The exact set of rules every roadmap phase, every feature, every PR must respect. Don't re-litigate.

---

## ADRs (architectural decisions, full list in `08-references/adrs/`)

| ID | Decision | Don't revisit unless |
|---|---|---|
| ADR-001 | Custom ~200-line agent runtime, no frameworks (no LangChain, LangGraph, CrewAI) | Series A |
| ADR-002 | Anthropic Claude only (Sonnet 4.6 + Haiku 4.5). No multi-model routing. No OpenAI/Voyage/Google for LLM calls | 5,000+ paying users |
| ADR-003 | PostgreSQL + pgvector. No separate vector DB (Pinecone, Weaviate, Qdrant) | 10M+ vectors total |
| ADR-004 | No knowledge graph in v1 (re-evaluating in this roadmap; recursive CTE on existing tables = pragmatic answer) | 500+ memories/user, sustained |
| ADR-005 | Persona prompts live in `docs/prompts/*.system.md`, loaded at runtime via prompt-loader.ts | Never |
| ADR-006 | Soft-delete on all entity tables (`deletedAt DateTime?`). No hard deletes | Never |
| ADR-007 | Claude Code (Opus) is the sole build agent. DeepSeek split is RETIRED | Never |
| ADR-008 | Native Anthropic tool_use blocks for internal tool calls. NOT MCP (for the agent's own tool layer) | v2 migration |
| ADR-009 | node-cron in-process for background jobs. No Redis, no BullMQ | 500+ users OR jobs >30s OR horizontal scaling |
| ADR-010 | Subscription middleware fails open (billing errors don't block users) | Active fraud / abuse |
| ADR-011 | OpenAI text-embedding-3-small (1536-dim) for embeddings | Cost/quality review or model deprecation |
| ADR-012 | Zod validation at all system boundaries; schemas in `packages/shared/src/validation/` | Never |
| ADR-013 | BoardRoom NEVER touches Postgres directly. All data via OmniMind HTTP API only | Never |

## Service boundaries (from CLAUDE.md)

| Service | Owns | Never owns |
|---|---|---|
| BoardRoom AI | Persona orchestration, UI state, session flow, streaming | Persistent data, entity validation, cross-session state |
| OmniMind API | All persistent data, entity relationships, validation, background intelligence | Persona logic, UI components, streaming mechanics |
| Shared package | Types, Zod schemas, constants, pure utilities | Business logic, state management, I/O |

## Code quality rules (from CLAUDE.md + global rules)

- **Files** under 800 lines (target 200-400)
- **Functions** under 50 lines
- **Nesting** ≤4 levels
- **Coverage** ≥80%
- **Naming**: `camelCase` vars/fns, `PascalCase` types/components, `UPPER_SNAKE_CASE` constants
- **Booleans**: prefix with `is`, `has`, `should`, `can`
- **Hooks**: prefix with `use`
- **No mutation**; create new objects
- **No hardcoded values**; use constants or config
- **No silent error swallowing**; handle explicitly
- **Validate inputs at every system boundary**

## Stack lock-in

| Layer | Locked to |
|---|---|
| Language | TypeScript ES2022 strict commonjs |
| Build | Turborepo + pnpm 10.32.1 |
| Runtime | Node 20+ |
| API framework | Express 4.21 (NOT Fastify, NOT Hono) |
| Frontend | React 19 + Tailwind + CVA + Framer Motion |
| State (frontend) | Zustand 5.0 |
| Database | PostgreSQL 16 |
| ORM | Prisma 6.3 (Prisma CLI pinned at 6.19.3 — 7.x has breaking schema changes) |
| Migration | `prisma db push` today; transitioning to `prisma migrate deploy` in Phase 14 (DEC-004) |
| Testing | Vitest + custom eval runners |
| Deploy | Railway (auto-deploy on push to `main`) |
| Auth (BoardRoom) | JWT in httpOnly cookie (`boardroom_token`, 7d expiry, bcrypt 12 rounds) |
| Auth (OmniMind) | API key in `x-api-key` header, timing-safe compare |

## Known limitations to accept (don't try to fix without scope review)

- No CI/CD gate — manual typecheck/test before push
- In-memory rate limiting — resets on restart, no cross-instance coordination
- Public domain for service-to-service calls (Railway private networking pending)
- Subscription middleware fails open
- No monitoring/alerting beyond health checks (correlation IDs ARE propagated)
- Single Railway instance per service (no horizontal scaling)
- `prisma db push` instead of proper migration history (Phase 14 fixes)

## Anti-patterns (CLAUDE.md)

1. Direct DB access from BoardRoom
2. Bypassing Zod validation
3. Hardcoded persona logic in TypeScript (use markdown prompts)
4. Ignoring Goal→Project→Task relationships
5. Siloed persona analysis without shared context
