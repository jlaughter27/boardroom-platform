# Project Context — Read This First

**Audience:** Claude (new session), human dev (new contributor), or anyone returning after time away.
**Purpose:** The minimum context dump to make sense of every other doc in this roadmap.
**Length budget:** Under 5 minutes to read.

---

## What is omnimind?

Omnimind is the persistent, intelligent memory backend for **BoardRoom AI**, a decision-intelligence product for solo founders, indie hackers, and consultants. Together they form the BoardRoom Platform.

- **BoardRoom AI** (frontend + orchestration) — React + Express. Owns UX, persona dispatch (7 personas: Optimist/Critic/Alternate/Technician/Questionnaire/Doer/CEO), SSE streaming, agent runtime.
- **OmniMind API** (data + intelligence) — Express + Prisma + PostgreSQL. Owns ALL persistent state, hybrid retrieval, validation pipeline, background cortex jobs.
- **Shared package** — TypeScript types, Zod schemas, constants, pure utils. No business logic.

**Inviolable boundary:** BoardRoom never touches the database directly. Every data operation is HTTP to OmniMind via `omnimind-client.ts`.

## Current state (2026-04)

- **Phase 1 complete.** Both services live on Railway.
- **708 tests passing.** Typecheck green.
- **Sophistication:** 6.5/10 — above MVP RAG, below production memory platform.
- **Functionality:** Core memory CRUD ✅, hybrid retrieval ✅, persona dispatch ✅, cortex jobs ✅, OAuth ✅. Missing: eval harness, entity extraction, observability, MCP, SDK, markdown export, multi-user rooms (stubbed), password reset.
- **Scale ceiling:** ~500-1000 active users on current architecture.

## The 13 ADRs (architectural non-negotiables)

Pulled from `docs/DECISIONS.md`. Don't re-litigate without explicit user approval.

| ADR | Decision | Don't revisit unless |
|---|---|---|
| 001 | Custom ~200-line agent runtime, no frameworks | Series A |
| 002 | Anthropic Claude only (Sonnet 4.6 + Haiku 4.5), no multi-model | 5,000+ paying users |
| 003 | PostgreSQL + pgvector, no separate vector DB | 10M+ vectors |
| 004 | No knowledge graph in v1 (re-evaluating in this roadmap) | 500+ memories/user |
| 008 | Native Anthropic tool_use, no MCP for internal tool calls | v2 migration |
| 009 | node-cron in-process, no Redis/BullMQ | 500+ users OR jobs >30s |
| 011 | OpenAI text-embedding-3-small (1536-dim) for embeddings | Cost/quality review |

The full 13 ADRs are in `docs/DECISIONS.md`; a copy lives in [`08-references/adrs/`](08-references/adrs/).

## Stack at a glance

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere (ES2022, strict, commonjs) |
| Build | Turborepo, pnpm 10.32.1 |
| API | Express 4.21 |
| Frontend | React 19 + Tailwind + CVA + Framer Motion |
| State | Zustand 5.0 |
| Database | PostgreSQL 16 + Prisma 6.3 |
| DB Extensions | pgvector, pg_trgm, tsvector |
| LLM | Anthropic SDK (Claude Sonnet 4.6 + Haiku 4.5) |
| Embeddings | OpenAI text-embedding-3-small (1536-dim) |
| Auth | JWT httpOnly cookie (BoardRoom), API key + timing-safe (OmniMind) |
| Background | node-cron (no Redis, no BullMQ) |
| Testing | Vitest + custom eval runners |
| Deploy | Railway, auto-deploy on push |

## What this roadmap is solving

Five problem categories, all addressed in this roadmap:

1. **Mem0 integration** — the original feature work, 6 phases of memory enhancements
2. **Known issues** — observable bugs and ADR-acknowledged limitations
3. **Landmines** — hidden risks (`prisma db push --accept-data-loss`, embedding queue silent loss, JWT rotation, etc.)
4. **Eventual issues** — what breaks at 6, 12, 24 months
5. **Make-it-10 features** — MCP server, SDK, markdown export, observability suite, deep KG, persona marketplace

## Mental model: the 5 layers

```
LAYER 1: Persistent storage (Postgres)
   ↓
LAYER 2: Validation pipeline (Zod → temporal → budget)
   ↓
LAYER 3: Retrieval (4-signal hybrid → 5-signal with entity boost)
   ↓
LAYER 4: Persona orchestration + cortex (background intelligence)
   ↓
LAYER 5: External interfaces (HTTP API today; future: MCP, SDK, markdown sync)
```

Every roadmap phase touches exactly one or two layers. Knowing which helps you reason about blast radius.

## Red flags to watch for in any session

- Anyone proposing direct DB access from BoardRoom → STOP, route via HTTP
- Anyone proposing a new LLM provider → STOP, ADR-002 says no
- Anyone bypassing Zod validation → STOP, CLAUDE.md rule #10
- Anyone editing schema and running `prisma db push` without baseline migration → STOP, this is the #1 landmine
- Anyone adding business logic to `packages/shared/` → STOP, types and validation only
- Anyone adding a framework dep (LangChain, LangGraph, CrewAI) → STOP, ADR-001 says no

## Where to go next

- **For your task:** [`../_meta/CONTEXT-LOAD-ORDER.md`](../_meta/CONTEXT-LOAD-ORDER.md) tells you exactly which 2-3 docs to read for whatever you're doing
- **For the master plan:** [`04-roadmap/ROADMAP-OVERVIEW.md`](04-roadmap/ROADMAP-OVERVIEW.md)
- **For status right now:** [`../STATUS/CURRENT-PHASE.md`](../STATUS/CURRENT-PHASE.md)
