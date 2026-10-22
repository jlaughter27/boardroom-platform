# BoardRoom AI — Project Brief

> Paste this at the start of any Claude session working on this codebase.

## What This Is

BoardRoom AI is an **executive decision intelligence suite**. It gives solo founders and operators a personal board of AI advisors that remember everything — every decision, every goal, every person, every commitment.

Two services, one monorepo:

- **BoardRoom AI** — React frontend + Express server. Runs the persona system (7 AI advisors with distinct roles), manages decision sessions, handles auth, serves the UI.
- **OmniMind API** — Express + Prisma + PostgreSQL. The persistent memory and data layer. Owns ALL data. BoardRoom talks to it via HTTP with API key auth.
- **Shared** — TypeScript types, Zod schemas, constants. Imported as `@boardroom/shared`. No business logic here.

## Who It's For

Solo founders, indie hackers, consultants making 5-15 strategic decisions per week. Think "Otter.ai for executive thinking" — it captures, structures, and challenges your decisions with full context recall.

## The Persona System (Core Product)

Every decision session runs through multiple AI personas in parallel:

| Persona | Role | Model |
|---------|------|-------|
| Optimist | Finds how goals CAN work | Haiku 4.5 |
| Critic | Identifies weaknesses/pitfalls | Haiku 4.5 |
| Alternate | Well-researched alternatives | Sonnet 5.5 |
| Technician | Technical feasibility | Haiku 4.5 |
| Questionnaire | Pre-flight clarifying questions | Haiku 4.5 |
| Doer | Actionable task breakdown | Haiku 4.5 |
| CEO | Synthesizes all outputs into final brief | Sonnet 5.5 |

Persona prompts live in `docs/prompts/*.system.md`. The agent runtime is custom (~200 lines), no LangChain/CrewAI.

## Current State (as of 2026-10-22)

- **Phase:** Phase 8 — Dev roadmap (`docs/roadmap/PHASE-8-ROADMAP.md`). Phases 5.5 through 7.5 are merged; `main` is `c2c6fca` (PR #24) and CI on main is green (run 39868876211). Active items: `docs/STATUS/CURRENT-PHASE.md`.
- **Deployed** on Railway: BoardRoom AI and OmniMind API (auto-deploy on push to `main`), plus a third service, OmniMind MCP, that has **never been launched**. The deploys since PR #22 (`cdef1ef`) are **unverified** from the sandbox.
- **Frontend**: `https://boardroom-ai-production-1092.up.railway.app`
- **OmniMind API**: `https://omnimind-api-production.up.railway.app`
- **Database**: Railway-hosted PostgreSQL with pgvector + pg_trgm extensions, 43 Prisma models
- **Auth**: JWT via httpOnly cookies (BoardRoom); API key + `x-api-key` (BoardRoom → OmniMind); per-user `omt_` tokens or OAuth JWTs (MCP clients)
- **Open blockers:** `docs/STATUS/BLOCKERS.md`

## Stack

- TypeScript everywhere. pnpm workspaces. Turborepo. Three deployable services: `boardroom-ai`, `omnimind-api`, `omnimind-mcp`.
- Express APIs. React 19 + Tailwind + Motion frontend, Base UI primitives (ADR-015).
- PostgreSQL + Prisma. Extensions: pgvector, pg_trgm, tsvector.
- Anthropic Claude (Sonnet 5.5 + Haiku 4.5; model ids come only from `MODEL_IDS` in `packages/shared/src/constants/model-config.ts`). OpenAI for embeddings only.
- Light and dark themes. Design tokens in CSS custom properties (`packages/boardroom-ai/client/src/styles/tokens.css`).

## Key Docs to Read Next

| Need | Read |
|------|------|
| Active phase and items | `docs/STATUS/CURRENT-PHASE.md` |
| The plan | `docs/roadmap/PHASE-8-ROADMAP.md` |
| Architecture & file paths | `docs/01-orientation/ARCHITECTURE-QUICK-REF.md` |
| What breaks easily | `docs/02-reference/FRAGILE-ZONES.md` |
| Deployment & Railway config | `docs/03-operations/DEPLOYMENT-RUNBOOK.md` |
| What's deployed right now | `docs/01-orientation/CURRENT-STATE.md` |
| Full product spec | `docs/02-reference/MASTER-FRAMEWORK.md` |
| Architectural decisions | `docs/02-reference/DECISIONS.md` |
| Dev rules & conventions | `.claude/CLAUDE.md` |
| API contracts | `docs/contracts/boardroom-api.contract.md` + `docs/contracts/omnimind-api.contract.md` |
