# OmniMind API — Memory & Data Layer

## This Service's Job
Store, validate, organize, retrieve, and surface user memories, entities,
and context. BoardRoom calls this service via HTTP. This is the brain.

## What I Own
- All persistent data (memories, people, goals, projects, tasks, user profiles)
- Memory validation pipeline (sync + async)
- Hybrid retrieval engine (structured -> FTS -> trigram -> semantic)
- Context assembly for personas (cross-entity search + persona-specific packets)
- Memory curator (batch: links, abstractions, contradictions)

## What I Do NOT Own
- Persona logic, LLM calls for analysis, agent orchestration (-> BoardRoom)
- Frontend components (-> BoardRoom client)
- User authentication (-> BoardRoom handles JWT, passes user_id to me)

## Entity Routes (complete list)
Every first-class entity has its own route + service file:
- memories (memories.routes.ts + memory.service.ts)
- people (people.routes.ts + entity.service.ts)
- goals (goals.routes.ts + entity.service.ts)
- projects (projects.routes.ts + entity.service.ts)
- tasks (tasks.routes.ts + entity.service.ts)
- decisions (decisions.routes.ts + decision.service.ts)
- commitments (commitments.routes.ts + commitment.service.ts)
- user-profile (user-profile.routes.ts + user-profile.service.ts)
- context (context.routes.ts + context-assembler.service.ts)
- health (health.routes.ts)
- cortex (cortex.routes.ts + cortex-{memo,patterns,contradictions}.service.ts) — Phase 2, live
- outcome-reviews (outcome-review.routes.ts + outcome-review.service.ts)
- relationships (relationships.routes.ts + relationship.service.ts)
- oauth, subscription, custom-personas, auth — supporting routes

If adding a new entity, you need: type in shared/, Zod schema in shared/,
route file, service file, Prisma model, and contract update.

## Disabled / quarantined code
`src/services/_disabled/` and `src/routes/_disabled/` hold mem0 integration
artifacts and dead orphan routes (memory-graph, memory-health,
embedding-monitoring, memory-maintenance). They reference Prisma models that
don't exist and were broking typecheck. See repo-root audit plan for context.
Excluded from build/typecheck via `tsconfig.json`.

## API Contract
See docs/contracts/omnimind-api.contract.md for every endpoint spec.
Do not add endpoints not in the contract without updating the contract first.

## Database
- Prisma schema: prisma/schema.prisma
- Extensions required: pg_trgm, vector, btree_gin
- RLS: All queries MUST include user_id filter. No cross-user data access.
- Migrations: `npx prisma migrate dev --name description`

## Memory Pipeline (src/memory/)
Every write flows: Route -> sync validation (schema + temporal + budget)
-> write to DB -> async jobs (classify, contradiction scan, auto-tag).
LLMs PROPOSE memory operations. Deterministic code VALIDATES and APPLIES.

## Retrieval Pipeline (src/retrieval/)
Query -> structured filter -> FTS -> trigram -> semantic -> rank/merge -> cap at 10
-> context-packager builds persona-specific packets.

## Running
- `npm run dev` — starts on port 3333
- `npm run test` — runs all tests
- `npm run test:unit` — unit tests only
- `npm run db:migrate` — apply migrations
- `npm run db:seed` — seed with test data
