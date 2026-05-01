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
| Alternate | Well-researched alternatives | Sonnet 4.6 |
| Technician | Technical feasibility | Haiku 4.5 |
| Questionnaire | Pre-flight clarifying questions | Haiku 4.5 |
| Doer | Actionable task breakdown | Haiku 4.5 |
| CEO | Synthesizes all outputs into final brief | Sonnet 4.6 |

Persona prompts live in `docs/prompts/*.system.md`. The agent runtime is custom (~200 lines), no LangChain/CrewAI.

## Current State (as of 2026-04-08)

- **Deployed** on Railway (both services live, health checks green)
- **Frontend**: `https://boardroom-ai-production-1092.up.railway.app`
- **OmniMind API**: `https://omnimind-api-production.up.railway.app`
- **Database**: Railway-hosted PostgreSQL with pgvector + pg_trgm extensions
- **Phase**: All code through Phase 1 is built. Phase 2 features are spec'd but not coded.
- **Auth**: JWT via httpOnly cookies. Email/password registration.

## Stack

- TypeScript everywhere. pnpm workspaces. Turborepo.
- Express APIs (both services). React + Tailwind + Framer Motion frontend.
- PostgreSQL + Prisma. Extensions: pgvector, pg_trgm, tsvector.
- Anthropic Claude (Sonnet 4.6 + Haiku 4.5). OpenAI for embeddings only.
- Dark theme UI. Design tokens in CSS custom properties.

## Key Docs to Read Next

| Need | Read |
|------|------|
| Architecture & file paths | `docs/ARCHITECTURE-QUICK-REF.md` |
| What breaks easily | `docs/FRAGILE-ZONES.md` |
| Deployment & Railway config | `docs/DEPLOYMENT-RUNBOOK.md` |
| What's deployed right now | `docs/CURRENT-STATE.md` |
| Full product spec | `docs/MASTER-FRAMEWORK.md` |
| Architectural decisions | `docs/DECISIONS.md` |
| Dev rules & conventions | `.claude/CLAUDE.md` |
| API contracts | `docs/contracts/boardroom-api.contract.md` + `omnimind-api.contract.md` |
