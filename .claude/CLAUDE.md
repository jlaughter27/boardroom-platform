# BoardRoom AI + OmniMind Platform — Claude Code Instructions

## What This Is

Executive decision intelligence suite for solo founders, indie hackers, and consultants. Two integrated services in one monorepo:

- **BoardRoom AI** — React frontend + Express orchestration server. Owns UX, persona dispatch, SSE streaming, agent runtime.
- **OmniMind API** — Express + Prisma + PostgreSQL. Owns ALL persistent data. Memory validation, hybrid retrieval, background jobs. Accessed by BoardRoom via HTTP only.
- **Shared** — TypeScript interfaces, Zod schemas, constants, pure utilities. Zero business logic.

7-persona system (Optimist, Critic, Alternate, Technician, Questionnaire, Doer, CEO) with persistent cognitive memory, hybrid retrieval (vector + FTS + trigram), and a custom ~200-line agent runtime (no LangChain/CrewAI/LangGraph).

**Current state:** Phase 1 complete. Both services live on Railway. Phase 2 spec'd but not coded.

---

## ⚡ Active Roadmap (READ THIS FIRST FOR ANY ONGOING WORK)

The single source of truth for what to work on, why, and how is the **operator-ready roadmap** at:

**[`docs/roadmap/`](../docs/roadmap/)** — built and validated by an 18-agent pipeline (4 researchers + 4 auditors + 8 builders + 3 reviewers + 1 final validator) on 2026-04-18.

**For any new session:**
1. Read [`docs/STATUS/CURRENT-PHASE.md`](../docs/STATUS/CURRENT-PHASE.md) (active phase + active task pointer)
2. Read [`docs/_meta/CLAUDE-WORKFLOW.md`](../docs/_meta/CLAUDE-WORKFLOW.md) (which 2-3 files to load for your task type)
3. Then load only the files that doc tells you to load. **Do not** read the entire `docs/` tree.

**For a tour of the plan:** [`docs/roadmap/04-roadmap/ROADMAP-OVERVIEW.md`](../docs/roadmap/04-roadmap/ROADMAP-OVERVIEW.md)
**For risk-first lens:** [`docs/roadmap/06-risks-and-mitigations/RISK-REGISTER.md`](../docs/roadmap/06-risks-and-mitigations/RISK-REGISTER.md)
**For known issues + landmines:** [`docs/roadmap/02-current-state/`](../docs/roadmap/02-current-state/)

The older `MEM0_*` planning docs (MEM0_INTEGRATION_PLAN, MEM0_RE_INTEGRATION_PLAN, MEM0_FINAL_DEV_ROADMAP, MEM0_RISK_MITIGATION_PLAN, MEM0_USAGE_EXAMPLES) are SUPERSEDED by the roadmap. They will be archived to `docs/_archive/` in a separate workstream — earlier versions are retrievable from git history if needed.

End of every session: update `docs/STATUS/CHANGELOG.md` and `STATUS/CURRENT-PHASE.md` per [`07-claude-instructions/HANDOFF-TEMPLATE.md`](../docs/_meta/HANDOFF-TEMPLATE.md).

---

## Architecture & Service Boundaries

```
Browser → BoardRoom AI (React + Express, port 3001)
              ↓ HTTP (x-api-key auth)
         OmniMind API (Express + Prisma, port 3333)
              ↓ Prisma Client
         PostgreSQL (pgvector + pg_trgm + tsvector)
```

**Inviolable boundary:** BoardRoom NEVER touches the database directly. All data operations go through OmniMind's REST API via `omnimind-client.ts`.

---

## Agent Ownership

Claude Code (Opus) is the sole build agent. Claude owns ALL packages: shared/, omnimind-api/, boardroom-ai/.

The DeepSeek v3.2 split is RETIRED (ADR-007). Existing type files in shared/ were originally scaffolded by DeepSeek — EXTEND them, don't rewrite from scratch.

---

## Critical Rules

1. **Never delete working code to "simplify."** Add alongside. Deprecate later.
2. **OmniMind owns data. BoardRoom owns UX.** No direct DB access from BoardRoom.
3. **All LLM outputs validated with Zod before reaching users.** No exceptions.
4. **Types live in packages/shared.** Import from `@boardroom/shared` everywhere.
5. **Persona prompts live in `docs/prompts/*.system.md`.** Code loads them at runtime via prompt-loader.ts. Edit prompts in markdown, not buried in TypeScript.
6. **Every memory write goes through the validation pipeline** (`src/memory/validation/pipeline.ts`). No raw Prisma inserts for memory.
7. **Max 7-10 context items per persona call.** Enforced in `context-packager.ts`.
8. **No other LLM providers in v1.** Anthropic Claude only (Sonnet 4.6 + Haiku 4.5). See ADR-002.
9. **No framework deps for agent orchestration.** Custom runtime only. See ADR-001.
10. **Zod schemas must match companion TypeScript interfaces.** If you change one, change both.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript everywhere (ES2022, strict, commonjs) |
| Build | Turborepo (monorepo), pnpm 10.32.1 |
| API servers | Express 4.21 |
| Frontend | React 19 + Tailwind + CVA + Framer Motion |
| State | Zustand 5.0 |
| Database | PostgreSQL 16 + Prisma 6.3 |
| DB Extensions | pgvector, pg_trgm, tsvector |
| LLM | Anthropic SDK (Claude Sonnet 4.6 + Haiku 4.5) |
| Embeddings | OpenAI text-embedding-3-small (1536-dim) |
| Auth | JWT httpOnly cookies (BoardRoom), API key + timing-safe compare (OmniMind) |
| Background | node-cron (no Redis, no BullMQ) |
| Testing | Vitest (unit + e2e), custom eval runners |
| Deploy | Railway (auto-deploy on push to main) |

---

## Before You Write Code

1. **Check `docs/STATUS/CURRENT-PHASE.md` FIRST** — it tells you the active phase + active task. The roadmap is the source of truth for ongoing work.
2. Follow the load-order in `docs/_meta/CONTEXT-LOAD-ORDER.md` for your task type (only ~2-3 files needed per task).
3. Read this file completely if it's your first session in this repo.
4. Check `docs/02-reference/DECISIONS.md` for the 13 architectural decisions — don't re-litigate settled decisions.
5. Check `docs/contracts/` for API contracts between services.
6. Read `docs/02-reference/FRAGILE-ZONES.md` if touching Docker, middleware ordering, Prisma, or env vars.
7. The older `docs/tasks/_TASK-INDEX.md` is HISTORICAL; the live task index is `docs/STATUS/PHASE-PROGRESS-TRACKER.md`.
6. Run `npm run typecheck` and `npm run test` before committing.

### Quick context docs (read in order for fastest ramp-up):
1. `docs/01-orientation/PROJECT-BRIEF.md` — 1-page product context
2. `docs/01-orientation/CURRENT-STATE.md` — What's live, what's next
3. `docs/01-orientation/ARCHITECTURE-QUICK-REF.md` — File tree, data flows, auth
4. `docs/02-reference/FRAGILE-ZONES.md` — What breaks easily
5. `docs/03-operations/DEPLOYMENT-RUNBOOK.md` — Railway config, env vars, common issues

### Full spec (when you need the deep context):
- `docs/02-reference/MASTER-FRAMEWORK.md` — 80kb, 21k words, complete product + architecture spec

---

## Monorepo Structure

```
boardroom-platform/
├── packages/
│   ├── shared/src/                 # Types, Zod schemas, constants, utils
│   │   ├── types/                  # 19 type files (interface-based)
│   │   ├── validation/             # 16 Zod schema files
│   │   ├── constants/              # 5 config files (as const)
│   │   ├── utils/                  # 4 pure utility files
│   │   └── index.ts                # Barrel export
│   │
│   ├── omnimind-api/
│   │   ├── prisma/schema.prisma    # 26 models, source of truth
│   │   ├── src/
│   │   │   ├── routes/             # 17 route files
│   │   │   ├── services/           # 13 service files
│   │   │   ├── memory/validation/  # Pipeline: schema → temporal → budget
│   │   │   ├── retrieval/          # semantic, fulltext, trigram, packager
│   │   │   ├── middleware/         # auth, validate, error-handler, rate-limiter
│   │   │   ├── jobs/               # cortex-scheduler (node-cron)
│   │   │   └── lib/                # db, logger, env, prompt-loader
│   │   ├── Dockerfile
│   │   └── docker-entrypoint.sh
│   │
│   └── boardroom-ai/
│       ├── server/src/
│       │   ├── routes/             # 10 route files
│       │   ├── agents/             # agent.ts, orchestrator, streaming, extraction
│       │   ├── services/           # omnimind-client, google-calendar, stripe, etc.
│       │   ├── personas/           # context-strategy, mode-router
│       │   ├── middleware/         # auth (JWT), validate, rate-limiters, subscription
│       │   ├── tools/              # web-search, calculator, document-read
│       │   └── lib/                # env, logger
│       ├── client/src/
│       │   ├── pages/              # 10 page components
│       │   ├── components/         # 70+ components (ui/, shared/, dashboard/, decision/, memory/)
│       │   ├── stores/             # 8 Zustand stores
│       │   ├── hooks/              # 11 custom hooks
│       │   ├── lib/                # api client, cn helper, motion utils
│       │   └── styles/tokens.css   # CSS custom properties (design system)
│       └── Dockerfile
│
├── docs/
│   ├── 01-orientation/             # First-touch onboarding (PROJECT-BRIEF, CURRENT-STATE, ARCHITECTURE-QUICK-REF)
│   ├── 02-reference/               # Durable reference (MASTER-FRAMEWORK, DECISIONS, FRAGILE-ZONES, MASTER-DEV-PLAN, MASTER-DREAM-ROADMAP)
│   ├── 03-operations/              # Runbooks (DEPLOYMENT-RUNBOOK, DEPLOY-RAILWAY, REALITY-BASELINE)
│   ├── _reports/                   # Historical reports (FRONTEND-POLISH, PHASE-5, REMEDIATION x2)
│   ├── STATUS/                     # Live session-state (CURRENT-PHASE, CHANGELOG, DECISIONS-LOG, BLOCKERS, PHASE-PROGRESS-TRACKER)
│   ├── _meta/                      # Agent meta (CLAUDE-WORKFLOW, CONTEXT-LOAD-ORDER, PROMPT-TEMPLATES, HANDOFF-TEMPLATE, SESSION-END-CHECKLIST)
│   ├── _archive/                   # Frozen content (orchestrator-prompts, research-wave-3-reviews)
│   ├── roadmap/                    # OmniMind memory-system roadmap (151-file pipeline output)
│   ├── tasks/                      # Phase-based task specs (historical; live index is in STATUS/)
│   ├── contracts/                  # API service contracts
│   ├── prompts/                    # Runtime persona prompts (*.system.md loaded by code)
│   └── research/                   # Research outputs (wave1, wave2, wave-1-research)
│
├── eval/                           # Eval runners + scenarios + rubrics
├── tests/e2e/                      # End-to-end test flows
├── scripts/                        # Deploy checks, backups, seeding
├── turbo.json                      # Build pipeline config
├── docker-compose.yml              # Local dev: postgres + both services
└── .env.example                    # 21 env vars documented
```

---

## Shared Package Conventions

`packages/shared/src/` contains types, validation schemas, utils, and constants. When modifying:

- **EXTEND existing files** — don't rewrite from scratch
- Use `interface` for data shapes (not `type` aliases)
- Use TypeScript `enum` keyword (matching Prisma enums)
- Use `camelCase` for all field names
- All IDs are `string`, all timestamps are `Date`
- Zod schemas must structurally match their companion types
- Constants use `as const` and `readonly` where appropriate
- Utils are PURE functions — no side effects, no runtime deps
- **NEVER put business logic in shared/** — types and validation only
- The only runtime dependency is `zod`

---

## Database (Prisma)

**32 models** in `packages/omnimind-api/prisma/schema.prisma`. Key model groups:

| Group | Models |
|-------|--------|
| Auth/Team | User, Team, TeamMember |
| Sessions | Room, Participant, Session, TranscriptEntry, AdvisorMessage, MeetingOutput |
| Memory | MemoryEntry (with vector(1536) embedding) |
| Decisions | Decision, DecisionAssumption |
| Commitments | Commitment |
| Entities | Person, Goal, Project, Task |
| Links | MemoryEntityLink, GoalProjectLink, ProjectPersonLink, ProjectTaskLink, DecisionProjectLink, TaskDependency |
| Profile | UserProfile, ContextCapsule |
| Cortex | ThinkingPattern, ContradictionAlert, WeeklyMemo, OutcomeReviewNudge |
| Personas | CustomPersona |
| Billing | Subscription, OAuthToken |

**Important patterns:**
- Multiple models use `deletedAt DateTime?` for soft deletes — all queries must filter `WHERE deletedAt IS NULL`
- `MemoryEntry.embedding` is `Unsupported("vector(1536)")` — requires pgvector extension, queried via raw SQL
- IVFFlat index with `vector_cosine_ops` for semantic search
- `prisma db push` used in production (no baseline migration yet)

---

## Persona System

### 7 Core Personas (17 system prompt files in `docs/prompts/*.system.md`):
1. **Optimist** — Opportunities, growth potential, positive framing
2. **Critic** — Risks, failure modes, devil's advocate
3. **Alternate** — Unconventional approaches, reframing
4. **Technician** — Implementation details, feasibility, technical debt
5. **Questionnaire** — Probing questions, uncovered assumptions
6. **Doer** — Action plans, timelines, next steps
7. **CEO** — Final synthesis across all personas (runs last, sees all outputs)

### 6 Specialized Personas (extraction + processing):
- email-extractor, memory-extractor, commitment-extraction
- onboarding-goals, onboarding-projects, sufficiency-check

### 7 Cortex Personas (intelligence layer):
- cortex-memo, cortex-patterns, cortex-contradictions, cortex-simulation, etc.

### User Modes (route to different persona subsets):
- `decide` — All 7 personas
- `stress-test` — Critic + Questionnaire + Alternate emphasis
- `plan` — Doer + Technician emphasis
- `brainstorm` — Optimist + Alternate emphasis

---

## Agent Runtime

Custom ~200-line runtime in `packages/boardroom-ai/server/src/agents/agent.ts`. Key files:

- `agent.ts` — Core execution loop (Anthropic SDK tool_use → execute → tool_result → continue)
- `orchestrator.ts` — Persona dispatch + routing logic
- `streaming.ts` — SSE streaming helpers
- `memory-extractor.ts` — Extracts memories from session outputs
- `sufficiency.ts` — Sufficiency scoring for response quality

**Tool execution:** Native Anthropic SDK `tool_use` content blocks (ADR-008). NOT MCP. Tools are plain TypeScript functions registered in `tools/tool-registry.ts`.

---

## Retrieval Engine

Hybrid search in `packages/omnimind-api/src/retrieval/`:

1. `semantic-search.ts` — pgvector cosine similarity (vector(1536))
2. `fulltext-search.ts` — tsvector FTS
3. `trigram-search.ts` — pg_trgm fuzzy matching
4. `structured-filter.ts` — SQL filters (domain, tags, status)
5. `context-packager.ts` — Combines all results, limits to 7-10 items per persona call
6. `ranker.ts` — Reranks results for persona relevance

---

## Auth System

| Layer | Mechanism | Details |
|-------|-----------|---------|
| BoardRoom → Browser | JWT in httpOnly cookie | Cookie name: `boardroom_token`, 7-day expiry, bcrypt 12 rounds |
| BoardRoom → OmniMind | API key in `x-api-key` header | Timing-safe comparison, shared secret |
| OmniMind health | No auth | `/health` endpoint is public |
| Subscription | Middleware on protected routes | Fails open (billing errors don't block users) |

---

## Environment Variables

### Required per service:

| Variable | boardroom-ai | omnimind-api | Notes |
|----------|:---:|:---:|-------|
| `PORT` | auto | auto | Railway injects this. Read first in code. |
| `JWT_SECRET` | ✅ | — | Signs/verifies JWT tokens |
| `OMNIMIND_API_KEY` | ✅ | ✅ | Must match exactly between services |
| `OMNIMIND_API_URL` | ✅ | — | Currently public Railway domain |
| `ANTHROPIC_API_KEY` | ✅ | ✅ | Claude Sonnet + Haiku |
| `OPENAI_API_KEY` | — | ✅ | Embeddings only |
| `ENCRYPTION_KEY` | — | ✅ (prod) | OAuth token encryption |
| `DATABASE_URL` | — | auto | Railway Postgres plugin |

Both services validate required vars at startup and `process.exit(1)` if any are missing.

See `.env.example` for the full 21-variable list with defaults.

---

## Deployment (Railway)

**Both services auto-deploy on push to `main`.** No CI gate — tests are manual.

| Service | URL | Health |
|---------|-----|--------|
| BoardRoom AI | `boardroom-ai-production-1092.up.railway.app` | `/health` |
| OmniMind API | `omnimind-api-production.up.railway.app` | `/health` |

### Docker builds have strict ordering requirements:
1. Shared package must build before either service
2. `rm -f tsconfig.tsbuildinfo` before `tsc` (stale incremental cache trap)
3. Prisma client extracted from pnpm virtual store via `find`
4. `pnpm deploy --legacy --prod` for real (non-symlink) node_modules
5. Prisma CLI pinned to `6.19.3` (7.x has breaking schema changes)

### OmniMind entrypoint sequence:
1. `CREATE EXTENSION IF NOT EXISTS vector` + `pg_trgm`
2. `prisma db push --skip-generate --accept-data-loss`
3. `node dist/index.js`

**Read `docs/02-reference/FRAGILE-ZONES.md` before touching any Docker or middleware code.**

---

## Express Middleware Ordering (boardroom-ai)

**This order is load-bearing. Do not rearrange.**

```
1. Global middleware (helmet, CORS, JSON parser, cookie parser)
2. API prefix rewriting (/api/* → /*)
3. Static file serving + SPA fallback (production only)
4. Public routes (health, auth, OAuth callbacks)
5. Auth wall (JWT middleware)
6. Protected routes (sessions, settings, etc.)
7. Error handler (must be last)
```

If you add a new top-level API route, add it to the SPA fallback exclusion list or it gets served `index.html`.

---

## Testing & Evaluation

### Commands:
```bash
npm run typecheck          # TypeScript across all packages
npm run test               # Vitest across all packages (708+ tests)
npm run test:e2e           # End-to-end test flows
npm run eval:retrieval     # Retrieval quality evaluation
npm run eval:personas      # Persona distinctiveness evaluation
npm run eval:e2e           # Full flow evaluation
npm run eval:all           # All evaluations
npm run pre-deploy         # scripts/pre-deploy-check.sh
```

### Test locations:
- Unit tests: colocated in each package
- E2E tests: `tests/e2e/flows/`
- Eval scenarios: `eval/scenarios/` (9 scenario files)
- Eval rubrics: `eval/rubrics/` (4 rubric files)
- Eval runners: `eval/runners/` (3 runner files)

---

## Session Workflow

1. Start each session with ONE clear task. Reference the task file from `docs/tasks/`.
2. Read the relevant context docs before coding (see "Before You Write Code" above).
3. Use `/compact` proactively when context feels heavy.
4. Use `/clear` between unrelated tasks. Don't carry state from schema work into frontend work.
5. If you've been corrected twice on the same issue, `/clear` and restate the problem fresh.

---

## Subagent Usage

- **Before implementing anything touching 3+ files:** Use an Explore subagent first to map the current state.
- **For complex multi-file work:** Use Plan mode (Shift+Tab twice), review the plan, then execute step by step.
- **After implementation:** Do a review pass — check against contracts, CLAUDE.md rules, and shared types. Report issues, don't silently fix.
- **Quick targeted fixes (1 file, <20 lines):** Handle directly, no subagent needed.

---

## Prompting Patterns

```
Starting a task:
  "Read docs/tasks/phase-0/TASK-003-validation-pipeline.md and plan the implementation."

Exploring first:
  "Use an Explore agent to map how context.routes.ts works before I modify it."

Complex work:
  "Use an Explore agent to map the retrieval directory, then create a plan for the hybrid search implementation."

Post-implementation review:
  "Review the changes I just made against the contracts and CLAUDE.md rules. Don't modify files, just report issues."
```

---

## Architectural Decisions (Summary)

13 ADRs in `docs/02-reference/DECISIONS.md`. The critical ones:

| ADR | Decision | Don't Revisit Unless |
|-----|----------|---------------------|
| 001 | Custom agent runtime, no frameworks | Series A |
| 002 | Claude-only, no multi-model routing | 5,000+ paying users |
| 003 | PostgreSQL + pgvector, no separate vector DB | 10M+ vectors |
| 004 | No knowledge graph in v1 | 500+ memories per user |
| 008 | Native tool_use, no MCP | v2 migration |
| 009 | node-cron, no Redis/BullMQ | 500+ users or jobs >30s |
| 011 | OpenAI embeddings (1536-dim) | Cost/quality review |

---

## Phase Status

| Phase | Status | Scope |
|-------|--------|-------|
| 0 — Foundation | ✅ Complete | Prisma schema (34 models), CRUD, validation, retrieval, Docker, agent runtime |
| 1 — Multi-Persona | ✅ Complete | 7 personas, dispatch, streaming, synthesis, extraction, eval |
| 2 — Cortex Intelligence | ✅ Complete | Pattern detection (cron Mon 3am), weekly memos (cron Sun 6pm), contradiction alerts (cron Tue 9pm), simulation. Routes + services + prompts + UI all wired. |
| 3 — Integrations | ✅ Partial | Google Calendar, Gmail, Stripe billing, custom personas — routes + services exist and are mounted |
| 4+ — Collaboration | 📋 Future | Multi-user rooms (stub: `// app.use('/rooms', roomsRouter)` in index.ts), scaling |

Task specs live in `docs/tasks/phase-{n}/TASK-*.md`. Check `docs/tasks/_TASK-INDEX.md` for the master index.

---

## Known Limitations (as of 2026-04-15)

1. **No CI/CD gate** — manual typecheck/test before push. No `.github/workflows/`.
2. **In-memory rate limiting** — resets on restart, no cross-instance coordination. The Redis-backed alternative was quarantined under `_disabled/` (decision: revisit when scaling beyond 1 instance).
3. **Public domain for service-to-service calls** — `OMNIMIND_API_URL` is the public Railway domain. Should be Railway private networking (cuts an internet round-trip per request, eliminates public surface). Pending Railway config change.
4. `prisma db push` instead of proper migration history.
5. Subscription middleware fails open when OmniMind is unreachable.
6. No monitoring/alerting beyond health checks. Correlation IDs (`x-request-id`) ARE propagated across the seam since 2026-04-15 — log aggregation can join on them.
7. Single Railway instance per service (no horizontal scaling).

## Resilience layer (omnimind-client.ts)

Configured via env vars (all optional with sensible defaults):

| Env var | Default | Purpose |
|---|---|---|
| `OMNIMIND_TIMEOUT_MS` | 10000 | AbortController timeout per request |
| `OMNIMIND_RETRY_MAX` | 3 | Max attempts for GET/HEAD on 502/503/504 + network errors |
| `OMNIMIND_BREAKER_THRESHOLD` | 5 | Consecutive 5xx/network failures before circuit opens |
| `OMNIMIND_BREAKER_COOLDOWN_MS` | 15000 | OPEN → HALF_OPEN cooldown |

4xx never retries and never trips the breaker. Breaker state is exposed via `omnimindClient.breaker.toJSON()`.
