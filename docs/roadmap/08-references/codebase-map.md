# Codebase Map

**Audience:** A new contributor (human or Claude session) who needs to know where things live.
**Companion:** `docs/ARCHITECTURE-QUICK-REF.md` is the higher-level diagram; this document is the file-by-file map.

This is a monorepo with three packages: `shared`, `omnimind-api`, `boardroom-ai`. Plus support directories for evals, tests, scripts, docs, and the `.claude/` configuration. Everything is TypeScript on Node 22+, built via Turborepo + pnpm 10.32.1.

```
boardroom-platform/
├── packages/
│   ├── shared/                # Types, Zod schemas, constants, pure utils
│   ├── omnimind-api/          # Memory + data backend (Express + Prisma + Postgres)
│   └── boardroom-ai/          # Frontend + orchestration (React + Express + SSE)
├── docs/                      # Product spec, ADRs, prompts, contracts, roadmap
├── eval/                      # Eval runners + scenarios + rubrics
├── tests/e2e/                 # End-to-end test flows
├── scripts/                   # Deploy checks, backups, seeding
├── .claude/                   # Claude Code instructions + per-package CLAUDE.md
├── turbo.json                 # Turborepo build pipeline
├── docker-compose.yml         # Local dev: Postgres + both services
└── .env.example               # Environment variable documentation
```

---

## packages/shared

**Owns:** TypeScript types, Zod validation schemas, constants, pure utilities. **No business logic. No I/O. Only `zod` as a runtime dep.**

```
packages/shared/src/
├── types/                # 19 type files (interface-based)
├── validation/           # 16 Zod schema files
├── constants/            # 5 config files (as const)
├── utils/                # 4 pure utility files
├── __tests__/            # Unit tests for utils + schemas
└── index.ts              # Barrel export for @boardroom/shared
```

**Key conventions** (enforced via `docs/FRAGILE-ZONES.md` §7):
- `interface` for data shapes, not `type` aliases.
- TypeScript `enum` keyword (matching Prisma enum names).
- camelCase for all field names.
- All IDs are `string`. All timestamps are `Date`.
- Every Zod schema has a companion TypeScript interface — change one, change both.

**Imported as `@boardroom/shared`** from both other packages. The build emits `dist/` with `composite: true` for project references; the Dockerfile copies that dist into both services' `node_modules` because pnpm symlinks don't survive multi-stage Docker builds.

---

## packages/omnimind-api

**Owns:** all persistent data, the memory validation pipeline, hybrid retrieval, background cortex jobs. Express + Prisma + PostgreSQL (with pgvector + pg_trgm + btree_gin). The "brain."

**Per-package rules** are in `packages/omnimind-api/CLAUDE.md`.

```
packages/omnimind-api/
├── prisma/
│   ├── schema.prisma             # 32 models — source of truth for the data layer
│   └── migrations/               # Prisma migrations (currently using db push)
├── src/
│   ├── index.ts                  # Express server entrypoint
│   ├── routes/                   # 17 route files
│   │   ├── memories.routes.ts
│   │   ├── people.routes.ts goals.routes.ts projects.routes.ts tasks.routes.ts
│   │   ├── decisions.routes.ts commitments.routes.ts
│   │   ├── user-profile.routes.ts context.routes.ts
│   │   ├── cortex.routes.ts        # Phase 2 — live: weekly memo, patterns, contradictions
│   │   ├── relationships.routes.ts # Entity-graph traversal
│   │   ├── outcome-review.routes.ts
│   │   ├── custom-personas.routes.ts
│   │   ├── auth.routes.ts oauth.routes.ts subscription.routes.ts
│   │   ├── health.routes.ts
│   │   └── _disabled/              # Quarantined dead routes (memory-graph,
│   │                               # memory-health, embedding-monitoring,
│   │                               # memory-maintenance) — excluded from build
│   ├── services/                 # 13+ service files (business logic by domain)
│   │   ├── memory.service.ts entity.service.ts decision.service.ts
│   │   ├── commitment.service.ts user-profile.service.ts
│   │   ├── context-assembler.service.ts     # cross-entity search per persona
│   │   ├── embedding.service.ts embedding-queue.ts incremental-embedding.service.ts
│   │   ├── semantic-dedup.service.ts
│   │   ├── relationship.service.ts          # entity-graph queries
│   │   ├── outcome-review.service.ts simulation.service.ts auth.service.ts
│   │   ├── cortex-memo.service.ts cortex-patterns.service.ts cortex-contradictions.service.ts
│   │   └── _disabled/                       # Quarantined mem0 integration artifacts
│   ├── memory/
│   │   └── validation/                      # Pipeline: schema -> temporal -> budget
│   │       └── pipeline.ts
│   ├── retrieval/                # Hybrid search engine
│   │   ├── semantic-search.ts    # pgvector cosine via raw SQL
│   │   ├── fulltext-search.ts    # tsvector FTS (per-query inline computation)
│   │   ├── trigram-search.ts     # pg_trgm fuzzy
│   │   ├── structured-filter.ts  # Domain/tag/status filters
│   │   ├── ranker.ts             # 4-signal weighted fusion
│   │   └── context-packager.ts   # Per-persona top-7-10 packet
│   ├── middleware/               # auth (API key), validate (Zod), error-handler, rate-limiter
│   ├── jobs/
│   │   └── cortex-scheduler.ts   # node-cron: weekly memo (Sun 6pm), patterns (Mon 3am),
│   │                             # contradictions (Tue 9pm)
│   └── lib/
│       ├── db.ts logger.ts env.ts prompt-loader.ts
├── tests/unit/                   # Vitest unit tests
├── Dockerfile                    # Multi-stage: build shared first, prisma generate,
│                                 # copy generated client from pnpm store, prisma@6.19.3 in runner
└── docker-entrypoint.sh          # CREATE EXTENSION vector + pg_trgm; prisma db push;
                                  # node dist/index.js
```

**Key files to know about:**
- `prisma/schema.prisma` — 32 models. Every data model question starts here. See `docs/MASTER-FRAMEWORK.md` §4 for the full model reference.
- `src/memory/validation/pipeline.ts` — every memory write goes through this; never raw Prisma inserts for memories.
- `src/retrieval/ranker.ts` — fusion weights live here (semantic 0.25 / FTS 0.25 / trigram 0.20 / structured 0.30).
- `src/jobs/cortex-scheduler.ts` — node-cron jobs. ADR-009 says no Redis/BullMQ.

---

## packages/boardroom-ai

**Owns:** the persona orchestration runtime, UI, JWT auth, SSE streaming, agent runtime. React + Express. The "advisors."

```
packages/boardroom-ai/
├── server/src/
│   ├── index.ts                  # Express entrypoint with strict middleware ordering
│   ├── routes/                   # 11 route files
│   │   ├── auth.routes.ts sessions.routes.ts
│   │   ├── onboarding.routes.ts onboarding-bootstrap.routes.ts
│   │   ├── entities.routes.ts                  # proxies to OmniMind
│   │   ├── cortex.routes.ts custom-personas.routes.ts
│   │   ├── calendar.routes.ts integrations.routes.ts subscription.routes.ts
│   │   ├── health.routes.ts
│   ├── agents/                   # Custom ~200-line agent runtime (ADR-001)
│   │   ├── agent.ts                            # Core execute loop (Anthropic tool_use)
│   │   ├── orchestrator.ts                     # Persona dispatch + routing
│   │   ├── streaming.ts                        # SSE helpers
│   │   ├── memory-extractor.ts                 # Extracts memories from outputs
│   │   └── sufficiency.ts                      # Response quality scoring
│   ├── personas/
│   │   ├── context-strategy.ts                 # Per-persona context selection
│   │   └── mode-router.ts                      # decide / stress-test / plan / brainstorm
│   ├── services/                 # OmniMind HTTP client, Google Calendar, Stripe, etc.
│   ├── tools/                    # Tool registry (web-search, calculator, document-read)
│   ├── middleware/               # JWT auth, validate, rate-limiters, subscription
│   ├── transcription/            # Audio -> text helpers
│   └── lib/                      # env, logger
├── client/src/
│   ├── App.tsx main.tsx index.css
│   ├── pages/                    # 10 page components (dashboard, decision, settings, etc.)
│   ├── components/
│   │   ├── ui/                   # Design system (Button, Input, Card, CVA variants)
│   │   ├── shared/               # Layout, Sidebar, LoadingSpinner
│   │   ├── dashboard/            # Widgets, dashboard layout
│   │   ├── decision/             # Decision session UI
│   │   ├── memory/               # Memory list/detail
│   │   ├── onboarding/           # Single-shot profile extraction flow
│   │   ├── settings/             # Settings + integrations panels
│   │   └── integrations/         # OAuth flow components
│   ├── stores/                   # 8 Zustand stores
│   ├── hooks/                    # 11 custom hooks
│   ├── lib/                      # api client, cn helper, motion utils
│   └── styles/tokens.css         # CSS custom properties (design system)
└── Dockerfile
```

**Key files to know about:**
- `server/src/index.ts` — middleware order is load-bearing (`docs/FRAGILE-ZONES.md` §2). Never reorder blocks 1-7.
- `server/src/agents/agent.ts` — the ~200-line runtime. ADR-001 says no LangChain/CrewAI/LangGraph here.
- `server/src/services/omnimind-client.ts` — every HTTP call to OmniMind. Resilience layer (retry + circuit breaker) configured via `OMNIMIND_*` env vars.
- `client/src/styles/tokens.css` — design tokens. Edit here, not in component-local CSS.
- The 7 persona prompt files live in `docs/prompts/*.system.md` and are loaded at runtime via `prompt-loader.ts`. Edit prompts in markdown, not in TypeScript.

---

## docs/

```
docs/
├── PROJECT-BRIEF.md              # 1-page session-start context
├── CURRENT-STATE.md              # Living deployment status
├── ARCHITECTURE-QUICK-REF.md     # Compressed architecture map
├── FRAGILE-ZONES.md              # What breaks easily + lessons
├── DEPLOYMENT-RUNBOOK.md         # Railway ops
├── MASTER-FRAMEWORK.md           # Full product + tech spec (~80kb, 21k words)
├── DECISIONS.md                  # 13 ADRs (canonical source of truth)
├── tasks/                        # Phase-based task specs (_TASK-INDEX.md is master)
├── contracts/                    # API contracts between services
│   ├── boardroom-api.contract.md
│   └── omnimind-api.contract.md
├── prompts/                      # 7 core + 6 specialized + 7 cortex personas
│   ├── optimist.system.md critic.system.md alternate.system.md
│   ├── technician.system.md questionnaire.system.md doer.system.md ceo.system.md
│   ├── memory-extractor.system.md commitment-extraction.system.md
│   ├── cortex-memo.system.md cortex-patterns.system.md cortex-contradictions.system.md
│   └── ...
├── architecture/                 # Deep-dive architecture docs
├── schemas/                      # Data model specs (companion to schema.prisma)
├── research/                     # All research artifacts (mem0 + 2026 roadmap)
└── roadmap/                      # This roadmap
    ├── 01-foundations/ 02-current-state/ 03-research/ (this folder)
    ├── 04-roadmap/ 05-features-to-10/ 06-risks-and-mitigations/
    ├── 07-claude-instructions/ 08-references/ (this folder)
    └── PROJECT-CONTEXT.md README.md
```

---

## eval/, tests/, scripts/

```
eval/
├── runners/                      # 3 runner files (retrieval, personas, e2e)
├── scenarios/                    # 9 scenario files
└── rubrics/                      # 4 rubric files

tests/
└── e2e/flows/                    # End-to-end flows

scripts/                          # Deploy checks, backups, seeding (e.g., pre-deploy-check.sh)
```

Eval commands:
- `npm run eval:retrieval` — retrieval quality.
- `npm run eval:personas` — persona distinctiveness.
- `npm run eval:e2e` — full flow.
- `npm run eval:all` — all evaluations.
- `npm run pre-deploy` — calls `scripts/pre-deploy-check.sh`.

Test commands:
- `npm run typecheck` — TypeScript across all packages.
- `npm run test` — Vitest across all packages (708+ tests as of writing).
- `npm run test:e2e` — end-to-end.

---

## .claude/ and per-package CLAUDE.md files

```
.claude/
├── CLAUDE.md                     # Repo-level Claude Code instructions
└── ...
```

Plus:
- `packages/omnimind-api/CLAUDE.md` — service-level rules for the omnimind-api package (ownership, routes, DB conventions).
- `CLAUDE.md` (root) — principal architect's guidelines (cognitive cohesion, service boundaries, anti-patterns).

These files override default Claude Code behavior. Read them before any non-trivial change.

---

## Where to find things — fast lookup

| Looking for... | Path |
|---|---|
| Database schema | `packages/omnimind-api/prisma/schema.prisma` |
| ADRs | `docs/DECISIONS.md` (canonical), `docs/roadmap/08-references/adrs/` (copies) |
| Persona prompts | `docs/prompts/*.system.md` |
| Types and Zod schemas | `packages/shared/src/types/`, `packages/shared/src/validation/` |
| OmniMind HTTP client | `packages/boardroom-ai/server/src/services/omnimind-client.ts` |
| Agent runtime (the ~200 lines) | `packages/boardroom-ai/server/src/agents/agent.ts` |
| Hybrid retrieval pipeline | `packages/omnimind-api/src/retrieval/` |
| Memory validation pipeline | `packages/omnimind-api/src/memory/validation/pipeline.ts` |
| Cortex cron jobs | `packages/omnimind-api/src/jobs/cortex-scheduler.ts` |
| Frontend design tokens | `packages/boardroom-ai/client/src/styles/tokens.css` |
| Eval scenarios | `eval/scenarios/` |
| Pre-deploy check | `scripts/pre-deploy-check.sh` |
| Env var documentation | `.env.example` |

For deeper structural detail beyond this map, see `docs/ARCHITECTURE-QUICK-REF.md` and `docs/MASTER-FRAMEWORK.md`.
