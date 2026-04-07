# BoardRoom AI + OmniMind Platform

An executive decision intelligence suite. Multi-persona AI analysis + persistent cognitive memory layer.

## Quick Start

```bash
# Prerequisites: Node.js 20+, Docker

# 1. Clone and install
npm install

# 2. Start PostgreSQL + both services
docker compose up

# 3. Or run services locally (requires local Postgres)
cp .env.example .env  # Edit with your API keys
npm run dev
```

## Architecture

```
boardroom-platform/
├── packages/shared/        # Types, Zod schemas, constants
├── packages/omnimind-api/  # Memory & data layer (Express + Prisma)
├── packages/boardroom-ai/  # UI + persona orchestration (React + Express)
├── docs/                   # Specs, contracts, prompts, tasks
└── eval/                   # Golden test suite
```

**OmniMind** owns all persistent data. **BoardRoom** owns UX and persona orchestration. They communicate via HTTP.

## Documentation

- [Master Framework](docs/MASTER-FRAMEWORK.md) — Complete product + technical spec
- [Decisions Log](docs/DECISIONS.md) — All architectural decisions with rationale
- [Task Index](docs/tasks/_TASK-INDEX.md) — Current work status and dependencies
- [API Contracts](docs/contracts/) — Service-to-service API agreements

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start all services (Turborepo) |
| `npm run build` | Build all packages |
| `npm run test` | Run all tests |
| `npm run typecheck` | Type-check all packages |
