# BoardRoom AI + OmniMind Platform

## What This Is
An executive decision intelligence suite: multi-persona AI analysis
+ persistent cognitive memory layer. Two services, one monorepo.

## Agent Ownership
Claude Code (Opus) is the sole build agent for this project.
Claude owns ALL packages: shared/, omnimind-api/, boardroom-ai/.

Previously, DeepSeek v3.2 was assigned types/schemas/utils/constants.
As of 2026-04-07, that split is RETIRED for speed. Claude now owns
everything, including packages/shared/src/. Existing type files
(written by DeepSeek) are the starting point — EXTEND them, don't
rewrite from scratch. Match existing conventions:
  - Use `interface` for data shapes (not `type` aliases)
  - Use TypeScript `enum` keyword (matching Prisma enums)
  - Use camelCase for all field names
  - All IDs are `string`
  - All timestamps are `Date`

## Architecture (read docs/MASTER-FRAMEWORK.md for full spec)
- `packages/omnimind-api` — Memory & data layer. Express + Prisma + PostgreSQL.
  Owns ALL persistent data. Exposes REST API. Accessed by BoardRoom via HTTP.
- `packages/boardroom-ai` — UI + persona orchestration. React frontend +
  Express server. Owns agent runtime, persona dispatch, streaming.
- `packages/shared` — Types, Zod schemas, constants shared by both services.
  NEVER put business logic here. Types and validation only.

## Critical Rules
1. **Never delete working code to "simplify."** Add alongside. Deprecate later.
2. **OmniMind owns data. BoardRoom owns UX.** No direct DB access from BoardRoom.
3. **All LLM outputs validated with Zod before reaching users.** No exceptions.
4. **Types live in packages/shared.** Import from @boardroom/shared everywhere.
5. **Persona prompts live in docs/prompts/*.system.md.** Code loads them at
   runtime. Edit prompts in markdown, not buried in TypeScript.
6. **Every memory write goes through the validation pipeline.** No raw inserts.
7. **Max 7-10 context items per persona call.** Enforce in context-packager.ts.

## Stack
- TypeScript everywhere. Express APIs. React + Tailwind frontend.
- PostgreSQL + Prisma. Extensions: pg_trgm, vector (pgvector), tsvector.
- Anthropic Claude (Sonnet 4.6 + Haiku 4.5). No other LLM providers in v1.
- Custom agent runtime in boardroom-ai/server/src/agents/ (~200 lines).
  No LangChain, no CrewAI, no LangGraph.

## Before You Write Code
1. Check docs/tasks/_TASK-INDEX.md for current task status + dependencies
2. Check docs/DECISIONS.md for past architectural decisions
3. Check docs/contracts/ for API contracts between services
4. Run `npm run typecheck` and `npm run test` before committing

## Session Workflow
- Start each session with ONE clear task. Reference the task file.
- Use /compact proactively when context feels heavy.
- Use /clear between unrelated tasks. Don't carry state from schema
  work into frontend work.
- If you've been corrected twice on the same issue, /clear and
  restate the problem fresh.

## Subagent Usage
- Before implementing anything touching 3+ files: use an Explore
  subagent first to map the current state.
- For complex multi-file work: use Plan mode (Shift+Tab twice),
  review the plan, then execute step by step.
- After implementation: do a review pass — check against contracts,
  CLAUDE.md rules, and shared types. Report issues, don't silently fix.
- Quick targeted fixes (1 file, <20 lines): handle directly, no subagent.

## Prompting Patterns
- **Starting a task**: "Read docs/tasks/phase-0/TASK-003-validation-pipeline.md
  and plan the implementation."
- **Exploring first**: "Use an Explore agent to map how context.routes.ts
  works before I modify it."
- **Complex work**: "Use an Explore agent to map the retrieval directory,
  then create a plan for the hybrid search implementation."
- **Post-implementation**: "Review the changes I just made against the
  contracts and CLAUDE.md rules. Don't modify files, just report issues."

## Shared Package Conventions
packages/shared/src/ contains types, validation schemas, utils, and
constants. These files were originally scaffolded by DeepSeek. Claude
now owns them. When modifying:
  - EXTEND existing files — don't rewrite from scratch
  - Match existing patterns (interface, enum, camelCase)
  - Zod schemas must structurally match their companion types
  - Constants use `as const` and `readonly` where appropriate
  - Utils are PURE functions — no side effects, no runtime deps
  - NEVER put business logic in shared/ — types and validation only

## Key File Locations
- Database schema: packages/omnimind-api/prisma/schema.prisma
- API contracts: docs/contracts/
- Persona prompts: docs/prompts/
- Eval suite: eval/scenarios/
- Shared types: packages/shared/src/types/
- Agent runtime: packages/boardroom-ai/server/src/agents/
- Memory pipeline: packages/omnimind-api/src/memory/
- Retrieval engine: packages/omnimind-api/src/retrieval/
