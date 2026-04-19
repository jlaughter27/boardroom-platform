# Repo Tour — If You've Never Seen This Codebase

You're here because you're new (a fresh Claude session, a new contributor, or you're returning after a long absence). Read this top to bottom. It's the orientation that lets every other doc make sense.

If you only have 5 minutes, also read `docs/PROJECT-BRIEF.md` for the product framing.

---

## What this is

**BoardRoom Platform** is an executive decision-intelligence suite for solo founders, indie hackers, and consultants. Two services in one monorepo:

- **BoardRoom AI** — React frontend + Express orchestration server. Owns UX, the persona system (7 AI advisors with distinct roles), JWT auth, SSE streaming, and the custom agent runtime.
- **OmniMind API** — Express + Prisma + PostgreSQL. Owns ALL persistent data, hybrid retrieval, the memory validation pipeline, and background cortex jobs.

They communicate via HTTP with a shared API key (`OMNIMIND_API_KEY`). **BoardRoom never touches Postgres directly** — that's an architectural rule (ADR-013), not a convention.

A third package, `shared`, holds TypeScript interfaces, Zod schemas, constants, and pure utilities. No business logic, no I/O.

---

## Top-level layout

```
boardroom-platform/
├── packages/
│   ├── shared/                 # Types, Zod schemas, constants, pure utils
│   ├── omnimind-api/           # Memory + data backend
│   └── boardroom-ai/           # Frontend + orchestration
├── docs/
│   ├── PROJECT-BRIEF.md        # 1-page session-start
│   ├── ARCHITECTURE-QUICK-REF.md
│   ├── FRAGILE-ZONES.md        # What breaks easily
│   ├── DEPLOYMENT-RUNBOOK.md
│   ├── DECISIONS.md            # 13 ADRs
│   ├── MASTER-FRAMEWORK.md     # Full spec, ~80kb
│   ├── prompts/                # 7 core + 6 specialized + 7 cortex personas (.system.md)
│   ├── contracts/              # API contracts between services
│   ├── tasks/                  # Phase task specs
│   ├── architecture/           # Deep-dive architecture docs
│   ├── research/               # Research artifacts (mem0 + 2026 roadmap)
│   └── roadmap/                # This roadmap (where you are now)
├── eval/                       # Eval runners + scenarios + rubrics
├── tests/e2e/                  # End-to-end flows
├── scripts/                    # pre-deploy-check.sh, backups, seeding
├── .claude/CLAUDE.md           # Repo-level Claude Code rules
├── turbo.json                  # Turborepo pipeline
├── pnpm-workspace.yaml         # Workspace package list
├── docker-compose.yml          # Local dev (Postgres + both services)
└── .env.example                # 21 env vars documented
```

A more detailed file-by-file map is in `08-references/codebase-map.md`.

---

## How a request flows

Trace a typical decision session from user click to persisted memory:

1. **User types a question** in the React UI (`packages/boardroom-ai/client/src/`). The UI calls `POST /api/sessions/:id/analyze` (the `/api` prefix gets stripped by middleware).
2. **BoardRoom server** (`packages/boardroom-ai/server/src/routes/sessions.routes.ts`) authenticates via JWT cookie (`boardroom_token`), then hands to the orchestrator.
3. **Orchestrator** (`packages/boardroom-ai/server/src/agents/orchestrator.ts`) loads the persona prompts from `docs/prompts/*.system.md`, then asks the OmniMind HTTP client for context.
4. **OmniMind client** (`packages/boardroom-ai/server/src/services/omnimind-client.ts`) calls `POST /context/assemble` on the OmniMind API. The client has a built-in retry + circuit breaker layer (configured via `OMNIMIND_*` env vars).
5. **OmniMind API** (`packages/omnimind-api/src/routes/context.routes.ts`) validates the request, then runs the **hybrid retrieval pipeline** (`src/retrieval/`): structured filter → FTS → trigram → semantic → ranker.ts → context-packager.ts. Returns the top 7-10 most relevant memory items, scoped per-persona.
6. **Orchestrator** dispatches the question + context to **6 personas in parallel** via the agent runtime (`server/src/agents/agent.ts`, the ~200-line runtime that uses Anthropic's native `tool_use` content blocks per ADR-008). Each persona's response is Zod-validated.
7. **CEO persona** runs last, sees all 6 outputs, synthesizes a final brief.
8. **Response streams to the client via SSE** (`server/src/agents/streaming.ts`).
9. **Memory extraction** runs as a follow-up: the doer extracts memories + commitments from the conversation, the orchestrator POSTs them back to OmniMind via the same HTTP client.
10. **OmniMind validates and writes** through the **memory validation pipeline** (`src/memory/validation/pipeline.ts`): schema check → temporal check → budget check → DB insert. Then a fire-and-forget embedding job.

Two failure modes worth knowing:
- **OmniMind down → BoardRoom degrades, doesn't crash.** The circuit breaker opens after 5 consecutive failures and cools down for 15 seconds. Subscription checks fail-open (ADR-010) so users keep working.
- **Anthropic API failure → persona returns a degraded result, not an error.** The agent runtime catches per-persona failures so one persona crashing doesn't kill the whole session.

---

## Build pipeline

**Turborepo** (`turbo.json`) orchestrates per-package builds. **pnpm 10.32.1** is the package manager. Workspaces are declared in `pnpm-workspace.yaml`.

Build dependency order (load-bearing — see `docs/FRAGILE-ZONES.md` §1):

1. `packages/shared` builds first via `tsc` with `composite: true` for project references. The Dockerfiles delete `tsconfig.tsbuildinfo` before the build because stale incremental info can cause `tsc` to exit 0 without emitting files.
2. `packages/omnimind-api` builds second. Runs `prisma generate` first, then `tsc`. The Dockerfile uses `find` to locate the generated Prisma client deep in pnpm's `.pnpm` virtual store and copies it to a stable path.
3. `packages/boardroom-ai` builds third. Includes Vite for the client + tsc for the server.

In Docker, each package uses **`pnpm deploy --prod --legacy`** to produce a standalone deployment directory with real files (not symlinks). The shared package's `dist/` is then manually overlaid into each service's `node_modules/@boardroom/shared/`.

The OmniMind runner stage installs **`prisma@6.19.3`** globally (do not change to `npx prisma` — npx grabs the latest, and Prisma 7 broke the `datasource` syntax). The runner's `docker-entrypoint.sh` then:

1. `CREATE EXTENSION IF NOT EXISTS vector` and `pg_trgm`.
2. `prisma db push --skip-generate --accept-data-loss`.
3. `node dist/index.js`.

Both services build in ~60 seconds on Railway. Both auto-deploy on push to `main`. **There is no CI gate** — typecheck and tests are manual pre-push (`docs/CURRENT-STATE.md` known-limitation #1).

---

## Tests + evals

**Vitest** runs unit + integration tests across all packages. As of writing: 708+ tests.

```
npm run typecheck       # TypeScript across all packages
npm run test            # Vitest unit + integration
npm run test:e2e        # Playwright end-to-end flows
npm run eval:retrieval  # Retrieval quality
npm run eval:personas   # Persona distinctiveness
npm run eval:e2e        # Full flow eval
npm run eval:all        # All evaluations
npm run pre-deploy      # scripts/pre-deploy-check.sh
```

The roadmap adds a **35-query labeled retrieval eval harness** in Phase 0.5 (`final-recommendation.md`) that becomes a CI-style non-regression gate via `pre-deploy-check.sh`.

---

## Environments

| Env | Where | What |
|---|---|---|
| **Local dev** | `docker-compose up` from repo root. | Spins up Postgres + both services. Edit code locally; vite + nodemon auto-reload. |
| **Staging** | Not currently configured. The roadmap's ops phases add this. | Goal: a Railway environment that mirrors prod and runs the eval harness on every PR. |
| **Production** | Railway (`https://boardroom-ai-production-1092.up.railway.app` + `https://omnimind-api-production.up.railway.app`). | Single instance per service. Auto-deploy on push to `main`. PostgreSQL via Railway plugin. |

Both production services are healthy as of the last update (`docs/CURRENT-STATE.md`). Health endpoints: `/health` on each service, returns `{"status":"ok",...}`.

---

## Where to find...

| You need... | Look at... |
|---|---|
| **Secrets** | Railway dashboard env vars. Mirror in `.env` for local dev (use `.env.example` as the template). **Never** commit `.env`. |
| **Config** | `.env.example` (documented). Required vars are validated at startup; missing vars `process.exit(1)`. |
| **Persona prompts** | `docs/prompts/*.system.md`. Loaded at runtime via `prompt-loader.ts`. Edit the markdown, not TypeScript. |
| **Types and schemas** | `packages/shared/src/types/` (interfaces) and `packages/shared/src/validation/` (Zod). Companion files — change one, change both. |
| **Database schema** | `packages/omnimind-api/prisma/schema.prisma`. 32 models. Source of truth. |
| **Migrations** | `packages/omnimind-api/prisma/migrations/`. Currently using `prisma db push`; Phase 14 of ops roadmap adds `migrate deploy` history. |
| **The agent runtime** | `packages/boardroom-ai/server/src/agents/agent.ts` (~200 lines). ADR-001 says no LangChain/CrewAI/LangGraph. |
| **The hybrid retrieval pipeline** | `packages/omnimind-api/src/retrieval/` (semantic, fulltext, trigram, structured, ranker, context-packager). |
| **The memory validation pipeline** | `packages/omnimind-api/src/memory/validation/pipeline.ts`. Every memory write goes through this. |
| **Cortex jobs (cron)** | `packages/omnimind-api/src/jobs/cortex-scheduler.ts`. node-cron, ADR-009. |
| **API contracts** | `docs/contracts/boardroom-api.contract.md` and `docs/contracts/omnimind-api.contract.md`. |
| **Architectural decisions** | `docs/DECISIONS.md` (canonical) and `docs/roadmap/01-foundations/ADR-INDEX.md` (index). |
| **What breaks easily** | `docs/FRAGILE-ZONES.md`. Read before touching Docker, middleware ordering, Prisma, env vars. |
| **Deployment runbook** | `docs/DEPLOYMENT-RUNBOOK.md`. Railway commands, env vars, common build issues. |
| **What's deployed right now** | `docs/CURRENT-STATE.md`. Living document; should be updated after every meaningful deploy. |
| **The roadmap** | `docs/roadmap/`. You're here. Start with `PROJECT-CONTEXT.md`. |

---

## Three rules that override everything

These come from `.claude/CLAUDE.md` and the principal architect's guidelines (`CLAUDE.md` at the repo root). When in doubt:

1. **OmniMind owns data. BoardRoom owns UX.** No direct DB access from BoardRoom. Every data read or write goes through the OmniMind HTTP API. (ADR-013.)
2. **All LLM outputs validated with Zod before reaching users.** No exceptions. (ADR-012.)
3. **Persona prompts live in `docs/prompts/*.system.md`.** Code loads them at runtime via `prompt-loader.ts`. Edit prompts in markdown, not TypeScript. (ADR-005.)

If you find yourself wanting to bend any of these, stop and write an ADR proposal first.

---

## What "phase" means

The product has shipped Phases 0-3 (foundation, multi-persona, cortex, integrations). Phase 4 (collaboration / multi-user rooms) is stubbed but not coded. The roadmap in `docs/roadmap/04-roadmap/` is the next ~16-22 calendar weeks of memory-stack work plus parallel ops/security/data/interfaces work tracked in higher-numbered phases.

The canonical scope and sequencing for memory-stack work lives in `docs/research/mem0-memory-architectures/stage5-validation/final-recommendation.md`. The synthesis docs in `docs/roadmap/03-research/` distill the underlying research into roadmap-ready form.

---

## What to do this session

If you're a new Claude session and don't have a specific task:

1. Read `docs/PROJECT-BRIEF.md` (1 page).
2. Skim `docs/ARCHITECTURE-QUICK-REF.md` (architecture diagram + monorepo structure).
3. Skim `.claude/CLAUDE.md` and the per-package `packages/*/CLAUDE.md` files.
4. Skim `docs/DECISIONS.md` so you know which arguments are settled.
5. Glance at `docs/FRAGILE-ZONES.md` so you don't accidentally break Docker.
6. Then ask the user what they actually want.

If you have a specific task: read `docs/tasks/_TASK-INDEX.md` for the master list, then the relevant `docs/tasks/phase-{n}/TASK-*.md` file, then start.

Welcome to the repo.
