# Architecture Quick Reference

> Compressed architecture map for code sessions. For full spec, see `docs/MASTER-FRAMEWORK.md`.

## Service Boundaries (Hard Rule)

```
┌──────────────────────┐       HTTP + API Key       ┌─────────────────────┐
│    BoardRoom AI      │ ─────────────────────────→  │    OmniMind API     │
│  (UI + Orchestration)│                             │  (Data + Memory)    │
│  Port: 3001 / $PORT  │                             │  Port: 3333 / $PORT │
│  React + Express     │                             │  Express + Prisma   │
└──────────────────────┘                             └─────────┬───────────┘
                                                               │
                                                     ┌─────────▼───────────┐
                                                     │    PostgreSQL       │
                                                     │  pgvector + pg_trgm │
                                                     └─────────────────────┘
```

**BoardRoom NEVER touches the database directly.** All data goes through OmniMind's REST API.

## Monorepo Structure

```
boardroom-platform/
├── packages/
│   ├── shared/                        # Types, Zod schemas, constants
│   │   └── src/
│   │       ├── types/                 # TypeScript interfaces
│   │       ├── schemas/               # Zod validation schemas
│   │       ├── constants/             # Enums, config values
│   │       └── utils/                 # Pure functions (no side effects)
│   │
│   ├── omnimind-api/                  # Data layer service
│   │   ├── prisma/
│   │   │   ├── schema.prisma          # ** THE database schema **
│   │   │   └── migrations/            # Prisma migrations
│   │   ├── src/
│   │   │   ├── routes/                # Express route handlers
│   │   │   ├── memory/                # Memory validation pipeline
│   │   │   ├── retrieval/             # Hybrid search engine
│   │   │   ├── middleware/            # Auth (API key), rate limiter
│   │   │   ├── jobs/                  # Cortex scheduler (cron)
│   │   │   └── lib/                   # DB client, logger, env validation
│   │   ├── Dockerfile
│   │   └── docker-entrypoint.sh       # Runs prisma db push + starts server
│   │
│   └── boardroom-ai/                  # Frontend + orchestration service
│       ├── client/
│       │   └── src/
│       │       ├── pages/             # Route-level page components
│       │       ├── components/
│       │       │   ├── ui/            # Design system (Button, Input, Card, etc.)
│       │       │   └── shared/        # Layout, Sidebar, LoadingSpinner
│       │       ├── stores/            # Zustand state stores
│       │       ├── lib/               # API client, motion utils, cn helper
│       │       └── styles/            # tokens.css (design tokens)
│       ├── server/
│       │   └── src/
│       │       ├── routes/            # Express route handlers
│       │       ├── agents/            # ** Custom agent runtime (~200 lines) **
│       │       ├── services/          # OmniMind HTTP client
│       │       ├── middleware/        # JWT auth, subscription check
│       │       └── lib/               # Logger, env validation
│       └── Dockerfile
│
├── docs/
│   ├── MASTER-FRAMEWORK.md            # Full product + tech spec (21k words)
│   ├── DECISIONS.md                   # 13 architectural decision records
│   ├── PROJECT-BRIEF.md               # Session-start context doc
│   ├── contracts/                     # API contracts between services
│   ├── prompts/                       # Persona system prompts (loaded at runtime)
│   ├── tasks/                         # Task specs by phase
│   └── architecture/                  # Architecture detail docs
│
├── .claude/CLAUDE.md                  # Dev rules & conventions (READ THIS)
├── tsconfig.base.json                 # Shared TypeScript config
├── turbo.json                         # Turborepo pipeline
└── pnpm-workspace.yaml               # Workspace package list
```

## Data Flow: Decision Session

```
User types question
  → BoardRoom POST /sessions/:id/analyze
    → Load persona prompts from docs/prompts/*.system.md
    → Context packager: fetch top 7-10 relevant memories from OmniMind
    → Fan-out: dispatch question + context to 6 personas in parallel
    → Each persona response validated with Zod
    → Fan-in: CEO persona synthesizes all 6 outputs
    → Stream final response to client via SSE
    → Extract memories/commitments and POST to OmniMind
```

## Data Flow: Memory Write

```
Memory write request
  → OmniMind POST /memories
    → Zod schema validation
    → Temporal validation (dates make sense)
    → Contradiction check (optional, against existing memories)
    → Insert to PostgreSQL
    → Fire-and-forget: generate embedding via OpenAI
    → Store embedding as vector(1536)
```

## Auth Flows

**BoardRoom (user-facing)**: JWT in httpOnly cookie (`boardroom_token`). 7-day expiry. bcrypt passwords (12 rounds). Auth middleware checks cookie on every protected request.

**OmniMind (service-to-service)**: API key in `x-api-key` header. Shared secret between services (`OMNIMIND_API_KEY` env var). Health endpoint is exempt.

## Key Patterns

- **Types**: Use `interface` for data shapes, `enum` for enums. All in `packages/shared/src/types/`.
- **Validation**: Every LLM output goes through Zod before reaching users. No exceptions.
- **Persona prompts**: Live in `docs/prompts/*.system.md`. Code loads them at runtime. Edit prompts in markdown, not TypeScript.
- **Context limit**: Max 7-10 memory items per persona call. Enforced in context-packager.
- **Agent runtime**: Custom ~200 lines in `boardroom-ai/server/src/agents/`. No LangChain.
- **Frontend state**: Zustand stores in `client/src/stores/`. React Router for routing.
- **Design system**: CSS custom properties in `tokens.css` → Tailwind → Components (CVA for variants).
- **Background jobs**: node-cron in OmniMind for weekly memo, pattern detection, contradiction scan.
