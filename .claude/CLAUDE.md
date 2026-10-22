# BoardRoom AI + OmniMind Platform — Claude Code Instructions

## What This Is

Executive decision intelligence suite for solo founders, indie hackers, and consultants. Two integrated services in one monorepo:

- **BoardRoom AI** — React frontend + Express orchestration server. Owns UX, persona dispatch, SSE streaming, agent runtime.
- **OmniMind API** — Express + Prisma + PostgreSQL. Owns ALL persistent data. Memory validation, hybrid retrieval, background jobs. Accessed by BoardRoom via HTTP only.
- **Shared** — TypeScript interfaces, Zod schemas, constants, pure utilities. Zero business logic.

7-persona system (Optimist, Critic, Alternate, Technician, Questionnaire, Doer, CEO) with persistent cognitive memory, hybrid retrieval (vector + FTS + trigram), and a custom ~200-line agent runtime (no LangChain/CrewAI/LangGraph).

**Current state (2026-10-22):** delivery phases through 7.5 are merged (`main` = `c2c6fca`, CI green) and **Phase 8 — Dev roadmap** is active (`docs/roadmap/PHASE-8-ROADMAP.md`; active items in `docs/STATUS/CURRENT-PHASE.md`). BoardRoom AI and OmniMind API auto-deploy to Railway, but no deploy since PR #22 (`cdef1ef`) has been verified; the third service, `omnimind-mcp`, has never been launched. Open blockers: `docs/STATUS/BLOCKERS.md`.

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
8. **No other LLM providers in v1.** Anthropic Claude only (Sonnet 5.5 + Haiku 4.5, ids only from `MODEL_IDS`). See ADR-002. Sonnet 5.5 rules: no `temperature`, no `thinking:{type:'disabled'}`, no forced `tool_choice`, no prefill; Haiku never receives `output_config` (guarded centrally).
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
| LLM | Anthropic SDK 0.131 (Claude Sonnet 5.5 + Haiku 4.5 via `shared/constants/model-config.ts`; prompt-cached system blocks; effort set explicitly) |
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
4. Check `docs/02-reference/DECISIONS.md` for the 14 architectural decisions — don't re-litigate settled decisions.
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
│   │   ├── prisma/schema.prisma    # 43 models, source of truth
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
└── .env.example                    # 81 env vars documented, each once (incl. OMNIMIND_MCP_* front door)
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

**43 models** in `packages/omnimind-api/prisma/schema.prisma` (`grep -c '^model ' packages/omnimind-api/prisma/schema.prisma`). Model groups:

| Group | Models |
|-------|--------|
| Auth/Team | User, Team, TeamMember |
| Sessions | Room, Participant, Session, TranscriptEntry, AdvisorMessage, MeetingOutput |
| Memory | MemoryEntry (with vector(1536) embedding) |
| Decisions | Decision, DecisionAssumption, DecisionSession |
| Commitments | Commitment |
| Entities | Person, Goal, Project, Task |
| Links | MemoryEntityLink, GoalProjectLink, ProjectPersonLink, ProjectTaskLink, DecisionProjectLink, TaskDependency, CommitmentLink |
| Profile | UserProfile, ContextCapsule |
| Cortex | ThinkingPattern, ContradictionAlert, WeeklyMemo, OutcomeReviewNudge, WeeklyDigest |
| Personas | CustomPersona |
| Billing | Subscription, OAuthToken |
| MCP / agents | Tenant, Agent, McpAuditLog, McpToken, McpOauthIdentity |
| Ops | EmbeddingOutbox, LlmUsage, IdempotencyKey |

**Important patterns:**
- Multiple models use `deletedAt DateTime?` for soft deletes — all queries must filter `WHERE deletedAt IS NULL`
- `MemoryEntry.embedding` is `Unsupported("vector(1536)")` — requires pgvector extension, queried via raw SQL
- IVFFlat index with `vector_cosine_ops` for semantic search
- Migration history: `prisma/migrations/0_init` is the baseline snapshot; entrypoint runs `migrate deploy` and resolves the baseline automatically on legacy `db push` databases (see `prisma/migrations/README.md`)

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
2. `prisma/scripts/detect-baseline.cjs` → `migrate resolve --applied` baselines (existing DBs only) → `prisma migrate deploy`
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

14 ADRs in `docs/02-reference/DECISIONS.md` (ADR-001 … ADR-014). The critical ones:

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
| 0 — Foundation | ✅ Complete | Prisma schema (43 models as of 2026-10-22), CRUD, validation, retrieval, Docker, agent runtime |
| 1 — Multi-Persona | ✅ Complete | 7 personas, dispatch, streaming, synthesis, extraction, eval |
| 2 — Cortex Intelligence | ✅ Complete | Pattern detection (cron Mon 03:00), weekly memos (cron Sun 18:00), contradiction alerts (cron Mon 04:00), simulation — schedules are `CORTEX_CONFIG` in `shared/constants/cortex-config.ts`, server local time. Routes + services + prompts + UI all wired. |
| 3 — Integrations | ✅ Partial | Google Calendar, Gmail, Stripe billing, custom personas — routes + services exist and are mounted |
| 4+ — Collaboration | 📋 Future | Multi-user rooms (stub: `// app.use('/rooms', roomsRouter)` in index.ts), scaling |
| 5.5 – 7.5 — Hardening, research backlog, MCP front door, UI foundation | ✅ Merged | 5.5 closeout `0475664` (PR #16); 5.7 audit remediation + Phase 6 in PR #20 `89fad1d`; Phase 7 PR #21 `77607bf`; Phase 7.5 PR #22 `cdef1ef`. Mapping to the memory-system roadmap phases 0–19: `docs/STATUS/PHASE-PROGRESS-TRACKER.md` → "Shipped phases → roadmap phases". |
| 8 — Dev roadmap | 🧭 Active (from 2026-10-22) | M0 contain → M1 verified production + tenant-safe one memory → M2 dogfood day 1 (2026-11-12) → M3 ops floor → M4 verdict. Plan: `docs/roadmap/PHASE-8-ROADMAP.md`. |

Task specs live in `docs/tasks/phase-{n}/TASK-*.md` (historical; `docs/tasks/_TASK-INDEX.md` is the old index). Live per-item status: `docs/STATUS/PHASE-PROGRESS-TRACKER.md`.

---

## Phase 6 (2026-10-02) — what changed

- Prompt caching + Sonnet 5.5 everywhere; per-call `LlmUsage` rows → cost widget (`/usage/llm/summary`).
- Decision loop closed: `POST /sessions/:id/decide` (required forecast) → `OutcomeReviewModal` shows it → `GET /decisions/calibration` (Brier, reliability) after 20 reviews.
- Debate protocol: independent round 1 → anonymized rebuttals for dissenters → disagreement ledger → CEO `ledgerResolutions` + server-computed `droppedConsiderations`. `premortem` mode.
- Memory: deterministic core-context block, nightly reflection capsules, `asOf` temporal validity, `supersedes` consolidation with provenance, commitment nudges, interactive memo, unlinked mentions + backlinks + link writers, people duplicates, hybrid `POST /memories/search`, `Idempotency-Key`.
- Ops: OTel behind `OTEL_EXPORTER_OTLP_ENDPOINT`, `::` bind for Railway private networking, backup service (`services/backup/`), labeled retrieval eval gated in CI (`retrieval-eval` job), persona distinctiveness eval.
- Contracts: `docs/contracts/PHASE-6-CONTRACTS.md`, `docs/contracts/omnimind-api.contract.md`.

## Known Limitations (as of 2026-10-18)

1. **CI gate exists since 2026-10-02** (`.github/workflows/ci.yml`: frozen install, typecheck incl. client, tests, audit, Docker builds, labeled retrieval eval on pgvector) but Railway still auto-deploys `main` on push regardless of CI status — enable branch protection requiring the `verify` + `docker` checks.
2. **In-memory rate limiting** — resets on restart, no cross-instance coordination. The Redis-backed alternative was quarantined under `_disabled/` (decision: revisit when scaling beyond 1 instance).
3. **Public domain for service-to-service calls** — `OMNIMIND_API_URL` is the public Railway domain. Should be Railway private networking (cuts an internet round-trip per request, eliminates public surface). Pending Railway config change.
4. ~~`prisma db push` instead of proper migration history.~~ Fixed 2026-10-02 (`0_init` + `migrate deploy`).
5. Subscription middleware fails open when OmniMind is unreachable.
6. No monitoring/alerting beyond health checks. Correlation IDs (`x-request-id`) ARE propagated across the seam since 2026-04-15 — log aggregation can join on them.
7. Single Railway instance per service (no horizontal scaling).
8. Agent identity verification (`x-agent-key`) is opt-in (`OMNIMIND_REQUIRE_AGENT_KEY=false` by default); the legacy unverified header triple still works for solo mode. **Should be set to `true` once the hosted MCP gateway (`omnimind-mcp-gateway`, scope `mcp:delegate`) is the only MCP writer** — delegated identity already requires a verified agent key, so the unverified fast-path then protects nothing and only lets a spoofed `x-agent-id` bypass scope enforcement.
9. Ministry domain remains gated (`MINISTRY_DEFERRED` 503); the encryption-at-rest write path is wired and unit-tested behind the gate.
10. `includeEntities: commitments|tasks` is accepted by `/context/for-persona` but those tables are not yet searched by the assembler (`ScoredResult.type` has no task/commitment member).
11. The retrieval-eval CI job's first real run (PR #20, 2026-10-03, mock embeddings) passed with a thin margin on the gated leg: for-persona recall@10 0.520 vs gate 0.5, MRR 0.440 vs 0.35; `/memories/search` recall@10 0.535, MRR 0.549; the `update` slice is the weakest (recall@10 0.27). The run is deterministic (hash-seeded vectors), so the margin is stable, not flaky. Thresholds ratchet upward only after three green runs on `main` per `docs/runbooks/retrieval-eval.md`.
12. Reflection and commitment-nudge jobs, OTel export, private networking and the backup service all need Railway env/config (see the runbook checklist).
13. **No push-based freshness for MCP clients.** MCP's `notifications/resources/updated` / `list_changed` exist but no shipping chat client (Claude.ai, ChatGPT, Cursor, …) turns them into an assistant turn or auto-reads resources, so "all platforms stay up to date" means **turn-time reads**: the server's `instructions` and the `session_start` prompt tell hosts to call `status_get` / `memory_search` at the start of relevant turns, and a write from any client is visible to every other client on its next turn, not before. Phase 12 (outbox/webhooks) pushes to agents and UIs we control, not to third-party chat clients. See `docs/runbooks/omnimind-mcp.md` §8.
14. **OAuth is resource-server only — and it is the only way in for ChatGPT and most Claude.ai organizations.** ChatGPT's connector dialog offers OAuth or "No authentication" and has no header / API-key field, so per-user `omt_` tokens can never be used from ChatGPT; claude.ai's *Request headers* section (`authorization` = `Bearer omt_…`, sent verbatim) is a beta for a limited set of organizations, and Claude Desktop can otherwise only reach the hosted URL through the `claude_desktop_config.json` `mcp-remote` bridge. The MCP service validates JWTs from the single configured issuer (`OMNIMIND_MCP_OAUTH_ISSUER` / `_JWKS_URL` / `_AUDIENCE`, RFC 9728 PRM at `/.well-known/oauth-protected-resource`, RFC 8707 audience binding), reads `email` / `email_verified` from the token or — when the token lacks them — from the issuer's `userinfo_endpoint` (`OMNIMIND_MCP_OAUTH_USERINFO=false` disables), auto-links the user read-only to their oldest owned tenant by verified e-mail, and otherwise returns `401 unlinked` until an admin links the subject with `POST /mcp/identities {issuer, subject, userId, tenantId, scopes?}` (widen later with `PATCH /mcp/identities/:id`). There is **no built-in authorization server** and no consent-time scope picker; client registration (CIMD, which Claude and ChatGPT prefer; DCR, deprecated in MCP spec 2026-07-28 but still used by ChatGPT/Cursor/Gemini CLI/Copilot Studio; static clients) is the issuer's job — recipe in `docs/runbooks/omnimind-mcp.md` §9 (ADR-014 spike).

## Resilience layer (omnimind-client.ts)

Configured via env vars (all optional with sensible defaults):

| Env var | Default | Purpose |
|---|---|---|
| `OMNIMIND_TIMEOUT_MS` | 10000 | AbortController timeout per request |
| `OMNIMIND_RETRY_MAX` | 3 | Max attempts for GET/HEAD on 502/503/504 + network errors |
| `OMNIMIND_BREAKER_THRESHOLD` | 5 | Consecutive 5xx/network failures before circuit opens |
| `OMNIMIND_BREAKER_COOLDOWN_MS` | 15000 | OPEN → HALF_OPEN cooldown |

4xx never retries and never trips the breaker. Breaker state is exposed via `omnimindClient.breaker.toJSON()`.

---

## Memory Layer (OmniMind-MCP)

`packages/omnimind-mcp` is the MCP server that gives external agents structured access to the OmniMind memory store. It is **not** part of the BoardRoom AI service — it's a separate process (third Railway service, `packages/omnimind-mcp/Dockerfile`, CI `docker` matrix) connecting directly to OmniMind API via HTTP.

**Full protocol:** `docs/MEMORY-PROTOCOL.md`  
**Operator runbook (deploy → token → per-client install → verify):** `docs/runbooks/omnimind-mcp.md`  
**Agent configs:** `docs/agent-configs/` (hosted + legacy stdio for Claude.ai/Desktop, Claude Code, ChatGPT, Cursor, Windsurf, Gemini CLI, VS Code/Copilot, Zed)  
**Smoke tests:** `docs/agent-configs/SMOKE-TESTS.md`  
**Keygen:** `docs/agent-configs/keygen-commands.sh`

### MCP Architecture

```
External clients (Claude.ai / Desktop, Claude Code, ChatGPT, Cursor, Windsurf, Gemini CLI, VS Code, Zed)
    ↓ Streamable HTTP to https://<mcp-host>/mcp — Authorization: Bearer omt_<per-user token>  (or an OAuth JWT; stdio for local runs)
omnimind-mcp server (Railway service `omnimind-mcp`, port = PORT/3334, binds `::`)
    ↓ credential → principal once per session, as the gateway (x-agent-key, scope mcp:delegate):
    ↓   omt_ → POST /mcp/tokens/introspect · JWT (jose: iss/aud/exp) → POST /mcp/identities/resolve
    ↓ then every call: x-api-key + x-agent-key + x-mcp-principal: token:<id>|oauth:<id>
OmniMind API (port 3333, private network) — agentId = principal.agentName, scopes = token ∩ (gateway − mcp:delegate)
    ↓ Prisma
PostgreSQL
```

One hosted URL serves every user and client; the process identity is the **gateway** agent — the agent row behind `OMNIMIND_MCP_AGENT_KEY`, whose scopes are the *ceiling* for every token, so it carries `mcp:delegate` + all seven grantable scopes (`MCP_GATEWAY_CEILING_SCOPES` in shared) — and each session is re-attributed to the token's principal (`mcp-token:<slug>-<id>` is what lands in `agent_id`). The hosted gateway does not read `OMNIMIND_MCP_AGENT_NAME` / `_TENANT_ID` / `_SCOPES` / `_SOURCE_WEIGHT` or `OMNIMIND_MCP_USER_ID`; those are for the legacy static bearer, stdio, `bench` and `smoke`. A personal instance can still run single-identity (legacy static bearer `OMNIMIND_MCP_API_KEY` + its own `OMNIMIND_MCP_STATIC_AGENT_KEY`, or stdio with an `omk_` agent key).

### 20 Available Tools (annotated, structured output, cursor pagination, `idempotencyKey` on writes — see `docs/MEMORY-PROTOCOL.md`)

| Tool | Scope Required | Purpose |
|------|---------------|---------|
| `memory_write` | `memory:write` | Write content — fact extractor runs automatically (`OMNIMIND_MCP_WRITE_EXTRACT=async` defers it) |
| `memory_search` | `memory:read` | Hybrid search (semantic + FTS + trigram) |
| `search` | `memory:read` | ChatGPT-shaped read-only wrapper over `memory_search` (`readOnlyHint: true`; Deep Research path) |
| `fetch` | `memory:read` | ChatGPT-shaped read-only by-id read of one memory (`readOnlyHint: true`) |
| `memory_supersede` | `memory:write` | Replace an existing memory by ID |
| `decision_log` | `decision:write` | Log a resolved decision with rationale |
| `task_upsert` | `task:write` | Create or update a task |
| `task_status` | `memory:read` | Get a task's current status |
| `task_list` | `memory:read` | List tasks by project/status |
| `task_complete` | `task:write` | Mark a task done |
| `task_block` | `task:write` | Mark a task blocked with reason |
| `project_status` | `memory:read` | Get project health snapshot |
| `project_summary` | `memory:read` | Get project + recent decisions |
| `person_get` | `memory:read` | Look up a person by name |
| `commitment_log` | `commitment:write` | Log a commitment to someone |
| `commitment_list` | `memory:read` | List open commitments |
| `status_get` | `memory:read` | Composite: decisions + tasks + blockers + commitments (+ `commitmentsDueSoon`) |
| `memory_reflect` | `memory:write` | Regenerate an entity's ContextCapsule now |
| `memory_consolidate` | `memory:write` | Near-duplicate pairs (dry-run default); supersede on apply |
| `graph_neighborhood` | `memory:read` | BFS over backlinks (≤2 hops, 60 nodes) |

### Running MCP

```bash
# Hosted HTTP gateway (what Railway runs — packages/omnimind-mcp/Dockerfile, CMD node dist/index.js http).
# Clients authenticate with per-user omt_ tokens minted in BoardRoom → Settings → Connected AI tools.
# Order of operations: OMNIMIND_ADMIN_KEY on the API → keygen the gateway → tenant owners → deploy this
# (docs/runbooks/omnimind-mcp.md §0–§7). The gateway identity is the agent row behind the key; the
# OMNIMIND_MCP_AGENT_NAME/_TENANT_ID/_SCOPES/_SOURCE_WEIGHT vars are NOT read in this mode.
PORT=3334 \
OMNIMIND_API_URL=http://omnimind-api.railway.internal:3333 \
OMNIMIND_API_KEY=<service key> \
OMNIMIND_MCP_AGENT_KEY=<omk_ key of omnimind-mcp-gateway: mcp:delegate + all seven grantable scopes> \
OMNIMIND_MCP_TOKEN_AUTH=true \
OMNIMIND_MCP_ALLOWED_HOSTS=omnimind-mcp-production.up.railway.app \
OMNIMIND_MCP_TRUST_PROXY=true \
OMNIMIND_MCP_PUBLIC_URL=https://omnimind-mcp-production.up.railway.app/mcp \
OMNIMIND_MCP_APP_URL=https://boardroom-ai-production-1092.up.railway.app \
ANTHROPIC_API_KEY=<key> \
node packages/omnimind-mcp/dist/index.js http
# Optional OAuth resource-server mode: OMNIMIND_MCP_OAUTH_ISSUER / _JWKS_URL / _AUDIENCE (audience == PUBLIC_URL);
# set OMNIMIND_MCP_OAUTH_ISSUER on BoardRoom too so the snippets go OAuth-first, and MCP_OAUTH_ALLOWED_ISSUERS on the API.
# Legacy single-user HTTP: OMNIMIND_MCP_TOKEN_AUTH=false + OMNIMIND_MCP_API_KEY=<one static inbound bearer>
#   + the process identity vars + OMNIMIND_MCP_STATIC_AGENT_KEY=<that identity's omk_ key>.

# Connect a client (same URL + header for Cursor, Windsurf, Gemini CLI, VS Code, Zed; Claude.ai only via OAuth or the Request-headers beta; ChatGPT via OAuth only):
claude mcp add --transport http --scope user omnimind https://omnimind-mcp-production.up.railway.app/mcp \
  --header "Authorization: Bearer omt_…"

# Stdio (local checkout, single identity — Claude Desktop / Claude Code without the hosted URL)
OMNIMIND_MCP_AGENT_NAME=claude-code-josh \
OMNIMIND_MCP_TENANT_ID=josh-business \
OMNIMIND_MCP_SCOPES="memory:read,memory:write,decision:write,task:write,project:write,commitment:write,code:write" \
OMNIMIND_MCP_SOURCE_WEIGHT=1.0 \
OMNIMIND_MCP_AGENT_KEY=<omk_ key from keygen> \
OMNIMIND_API_URL=https://omnimind-api-production.up.railway.app \
OMNIMIND_API_KEY=<key> \
node packages/omnimind-mcp/dist/index.js

# Smoke test (registration: 20 tools, 3 prompts, 4 resource templates)
node packages/omnimind-mcp/dist/index.js smoke

# memory_write latency bench: N in-process REAL writes (stdio env incl. AGENT_NAME/TENANT_ID + --user) and the
# server-side p95 from GET /mcp/audit/stats; warns above 20 s → set OMNIMIND_MCP_WRITE_EXTRACT=async. Target p95 < 10 s.
# --cleanup is on by default (archives the bench rows); --yes is required outside NODE_ENV=development.
node packages/omnimind-mcp/dist/index.js bench --n 10 --user <user id> [--yes]

# Generate an agent key (run once, store in 1Password; needs OMNIMIND_ADMIN_KEY — POST /mcp/agents is admin-gated).
# Gateway: --agent omnimind-mcp-gateway --scopes "mcp:delegate,memory:read,memory:write,decision:write,task:write,project:write,commitment:write,code:write"  (the ceiling for every token)
# Create-only: re-running for an existing name is 409 and stores nothing — rotate with the ON CONFLICT SQL keygen prints (runbook §1).
node packages/omnimind-mcp/dist/index.js keygen --agent <name> --tenant <id> --scopes '<list>' --source-weight <float>
```

### Dogfooding Rules (applies to Claude Code sessions in this repo)

Every Claude Code session working in this repo SHOULD use the memory layer:
- **Start of session:** call `status_get`, then `memory_search` for the domain being worked on
- **Decisions made:** call `decision_log`
- **Tasks identified:** call `task_upsert`
- **End of session:** call `memory_write` with a context summary of what was done and what's next

The system is only useful if it's used. Inconsistent use = stale data = broken trust.

### Ministry Domain Rule (non-negotiable)

`domain: 'ministry'` content uses Ollama `bge-base-en-v1.5` for embeddings. If Ollama is unavailable, the write is refused — it does NOT fall back to OpenAI. This is intentional (data sovereignty). Never work around it.

### Three Tenants

| Tenant ID | Contents |
|-----------|----------|
| `josh-personal` | Personal goals, relationships, non-work decisions |
| `josh-business` | Business strategy, projects, technical architecture |
| `tgfc-ministry` | Ministry projects, pastoral data (local embeddings only) |

Cross-tenant reads are not possible from MCP tools. Each agent key and each personal `omt_` token is bound to exactly one tenant; on the hosted gateway the tenant comes from the token, not from the process env.
