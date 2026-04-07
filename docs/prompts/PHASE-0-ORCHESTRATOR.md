# PHASE 0 BUILD ORCHESTRATOR — BoardRoom AI + OmniMind Platform

> **Usage**: Paste this entire prompt into Claude Code (Opus) to execute Phase 0.
> **Prereqs**: Monorepo scaffold, Prisma schema, shared types already exist.
> **Last validated**: 2026-04-07 against actual codebase state.

---

Read .claude/CLAUDE.md, then read docs/contracts/omnimind-api.contract.md,
then read docs/MASTER-FRAMEWORK.md sections 3-4 (lines 127-797).

You are the BUILD ORCHESTRATOR for the BoardRoom AI + OmniMind platform.
You will execute Phase 0 as a sequential chain of build tasks. You will
NOT write application code yourself. You will delegate ALL implementation
to subagents and ALL validation to separate subagent validators.

## WHAT ALREADY EXISTS (DO NOT REBUILD)

These are DONE. Read them, import from them, never recreate them:

- `/package.json`, `turbo.json`, `tsconfig.base.json` — monorepo scaffold
- `/docker-compose.yml`, `.env.example`, `.gitignore` — infra config
- `packages/shared/package.json`, `packages/omnimind-api/package.json`,
  `packages/boardroom-ai/package.json` — workspace configs
- `packages/shared/src/types/*.ts` — 8 type files (Memory, Person, Goal,
  Project, Task, Decision, Commitment, UserProfile, Persona, Modes, API)
- `packages/shared/src/constants/memory-config.ts` — fully implemented
- `packages/omnimind-api/prisma/schema.prisma` — 543-line production schema
- `packages/boardroom-ai/server/src/agents/streaming.ts` — SSE helper
- `packages/boardroom-ai/server/src/middleware/auth.ts` — JWT auth
- Express scaffolds for both services (health endpoints working)

## EXISTING CONVENTIONS (MATCH THESE EXACTLY)

Read 2-3 existing type files before writing anything. The patterns are:

- `interface` for data shapes (NOT `type` aliases)
- TypeScript `enum` keyword (NOT const objects) — matches Prisma enums
- `camelCase` for all field names (Prisma uses @map for snake_case DB columns)
- All IDs are `string`
- All timestamps are `Date`
- Imports from `@boardroom/shared` (workspace dependency)
- Services are pure functions (data in → data out), routes handle HTTP
- All DB queries include `where: { userId }` — no exceptions

---

## PROTOCOL

For EACH task in the sequence, execute this cycle:

### STEP 1 — BRIEF

Before delegating, you (the orchestrator) will:
- Read the task specification below
- Read every file listed in "MUST READ FIRST"
- Prepare a clear briefing with: what to build, what patterns to follow,
  what NOT to do, and how to verify

### STEP 2 — BUILD (Subagent: builder)

Delegate to a subagent with the full briefing.
The builder subagent:
- Creates/modifies ONLY the files specified
- Runs `npx tsc --noEmit` before finishing (TypeScript tasks)
- Runs `npx vitest run` if tests were created
- Returns: files created/modified, warnings, assumptions

### STEP 3 — VALIDATE (Single combined validator subagent)

After the builder finishes, deploy ONE read-only validator that checks
ALL THREE dimensions in a single pass. It may NOT edit files.

The validator checks:

**A. Type & Schema Compliance:**
- Run `npx tsc --noEmit` — must pass clean
- All types imported from `@boardroom/shared`, never redefined locally
- Zod schemas match their companion TypeScript interfaces
- All function signatures have explicit return types
- No `any` types unless justified in a comment

**B. Contract & Spec Compliance:**
- Read `docs/contracts/omnimind-api.contract.md`
- Endpoints match contract exactly (method, path, request/response shape)
- Business rules from MASTER-FRAMEWORK.md implemented (userId scoping,
  validation pipeline order, token budgets, source weighting)
- Nothing built that wasn't in the spec (no scope creep)

**C. Pattern & Integration Consistency:**
- File naming matches existing conventions
- Import paths consistent with monorepo structure
- Error handling matches existing patterns
- Test file covers happy path + at least 1 edge case

**Report format:** PASS with notes, or FAIL with specific file:line issues.

### STEP 4 — VERDICT

Review the validator report.

IF PASS:
  Run `npx tsc --noEmit` from workspace root as final gate.
  If clean: commit with `git add` (specific files) then
  `git commit -m "TASK-XXX: <description>"`
  Report checkpoint. Move to next task.

IF FAIL:
  Re-deploy builder with ONLY the corrections needed.
  Re-run validator.
  Maximum 2 correction cycles. If still failing after 2, STOP.

### STEP 5 — CHECKPOINT

After every committed task, report:
- Files built (names + line counts)
- Validator findings
- Warnings or assumptions
- Commit hash confirmation
Then proceed. Do NOT ask for permission unless you hit a STOP condition.

---

## CONTEXT MANAGEMENT

- Run `/compact` after completing Task 4 (before server setup tasks)
- Run `/compact` again after completing Task 6 (before retrieval engine)
- If any single task takes more than 3 correction cycles, `/compact`
  before the next task

---

## STOP CONDITIONS

Pause and report if:
- A validator fails 2 correction cycles
- A design decision isn't covered in the framework or contract
- The spec contradicts itself
- A dependency is missing (npm package, env var, external service)
- You need to modify an existing type file in a way that breaks
  other existing code

---

## TASK SEQUENCE

Execute in EXACT order. Do not skip. Do not parallelize.

---

### TASK 1: COMPLETE VALIDATION SCHEMAS (extend existing stubs)

**GOAL:** Fill in the 5 Zod schema files that are currently empty stubs.
These are the runtime validation layer for all API boundaries.

**MUST READ FIRST:**
- `packages/shared/src/types/memory.types.ts`
- `packages/shared/src/types/entities.types.ts`
- `packages/shared/src/types/decision.types.ts`
- `packages/shared/src/types/commitment.types.ts`
- `packages/shared/src/types/persona.types.ts`
- `packages/shared/src/types/api.types.ts`
- `packages/shared/src/types/user-profile.types.ts`

**BUILD (extend these files — they contain `export {};` stubs):**

- `packages/shared/src/validation/memory.schema.ts`
    Zod schemas for: MemoryClass, MemoryStatus, Confidence, SourceType (as z.enum),
    MemorySchema (full Memory shape), CreateMemoryRequestSchema, UpdateMemoryRequestSchema
    (Partial of create, all optional except nothing required).

- `packages/shared/src/validation/entities.schema.ts`
    PersonSchema, CreatePersonRequestSchema, UpdatePersonRequestSchema.
    GoalSchema, CreateGoalRequestSchema, UpdateGoalRequestSchema.
    ProjectSchema, CreateProjectRequestSchema, UpdateProjectRequestSchema.
    TaskSchema, CreateTaskRequestSchema, UpdateTaskRequestSchema.

- `packages/shared/src/validation/decision.schema.ts`
    DecisionOptionSchema, AssumptionSchema, DecisionSchema,
    CreateDecisionRequestSchema, UpdateDecisionRequestSchema.

- `packages/shared/src/validation/commitment.schema.ts`
    CommitmentSchema, CreateCommitmentRequestSchema, UpdateCommitmentRequestSchema.

- `packages/shared/src/validation/persona.schema.ts`
    PersonaResponseSchema, SynthesisReportSchema, QuestionnaireResponseSchema.

- Update `packages/shared/src/validation/index.ts` barrel exports.

**PATTERN RULES:**
- `z.coerce.date()` for all Date fields (handles ISO string input from JSON)
- `.describe()` on every field matching the JSDoc/purpose from the type
- Export both schema and inferred type: `export type X = z.infer<typeof XSchema>`
- Inferred types MUST structurally match the interfaces in types/*.ts.
  If they diverge, fix the schema — never modify the type files.
- Match the enum values EXACTLY as they appear in the type files
  (e.g., `z.nativeEnum(MemoryClass)` for TypeScript enums)

**DO NOT:**
- Modify any type files
- Add business rule validation (that's in the pipeline, Task 4)

**VERIFY:** `npx tsc --noEmit` from `packages/shared/` — clean

---

### TASK 2: SHARED UTILITIES & REMAINING CONSTANTS (extend existing stubs)

**GOAL:** Fill in the 3 utility files and 2 constant files that are stubs.

**MUST READ FIRST:**
- `packages/shared/src/constants/memory-config.ts` (the ONE implemented file — follow its pattern)
- `packages/shared/src/types/persona.types.ts` (PersonaConfig, ModelTier)
- `docs/MASTER-FRAMEWORK.md` Section 3 lines 129-148 (persona model assignments)
- `docs/MASTER-FRAMEWORK.md` Section 4 lines 304-312 (cost per query)

**BUILD (extend these files — they contain `export {};` stubs):**

- `packages/shared/src/utils/hashing.ts`
    `sha256Hash(content: string): string` — uses Node crypto, for memory dedup

- `packages/shared/src/utils/temporal.ts`
    `isStale(date: Date, thresholdDays: number): boolean`
    `getRetentionTier(createdAt: Date): 'hot' | 'warm' | 'cold'`
      — uses RETENTION_TIERS from memory-config.ts
    `isOverdue(deadline: Date): boolean`
    `daysUntil(date: Date): number`

- `packages/shared/src/utils/token-counter.ts`
    `estimateTokens(text: string): number` — rough (chars / 4)
    `isWithinBudget(text: string, maxTokens: number): boolean`

- `packages/shared/src/constants/persona-config.ts`
    `PERSONA_CONFIGS: Record<PersonaId, PersonaConfig>` matching Section 3:
      optimist: { model: 'haiku', maxOutputTokens: 2000, systemPromptPath: 'docs/prompts/optimist.system.md' }
      critic: { model: 'haiku', ... }
      alternate: { model: 'sonnet', ... }
      technician: { model: 'haiku', ... }
      questionnaire: { model: 'haiku', maxOutputTokens: 1000, ... }
      doer: { model: 'haiku', maxOutputTokens: 2000, ... }
      ceo: { model: 'sonnet', maxOutputTokens: 3000, ... }
    `MODEL_COSTS` — from Section 4 line 304-312

- `packages/shared/src/constants/rate-limits.ts`
    `RATE_LIMITS` — CEO_MODE_PER_SESSION: 10, SESSIONS_PER_DAY: 5,
      MAX_OUTPUT_TOKENS_PER_PERSONA: 2000

**ALSO BUILD TESTS:**
- `packages/shared/src/__tests__/hashing.test.ts`
- `packages/shared/src/__tests__/temporal.test.ts`
- `packages/shared/src/__tests__/token-counter.test.ts`

Install `vitest` as devDependency in shared package if not present.
Add `"test": "vitest run"` script to shared package.json if missing.

**PATTERN RULES:**
- All functions are pure (no side effects, no imports beyond Node builtins + shared constants)
- All constants are `readonly` / `as const`
- Every function has JSDoc with `@param` and `@returns`
- Follow the memory-config.ts documentation style exactly

**DO NOT:**
- Import from any runtime dependency (no Prisma, no Express)
- Modify Task 1 files or type files

**VERIFY:**
- `npx tsc --noEmit` clean
- `npx vitest run` in packages/shared/ — all pass

---

### TASK 3: OMNIMIND EXPRESS SERVER + MIDDLEWARE

**GOAL:** Upgrade the Express scaffold with proper middleware, structured
logging, auth gate, and rate limiter. The server shell that all routes mount into.

**MUST READ FIRST:**
- `packages/omnimind-api/src/index.ts` (existing scaffold to extend)
- `packages/omnimind-api/src/lib/db.ts` (existing Prisma client)
- `docs/contracts/omnimind-api.contract.md` (health + auth + error sections)
- `packages/shared/src/constants/rate-limits.ts` (from Task 2)

**BUILD:**

- `packages/omnimind-api/src/lib/logger.ts`
    Structured JSON logger: `{ timestamp, level, message, traceId?, ...extra }`
    Exports: `logger.info()`, `logger.warn()`, `logger.error()`
    Uses console for now (structured format, not raw console.log)

- `packages/omnimind-api/src/middleware/auth.ts`
    Validates `x-api-key` header against `OMNIMIND_API_KEY` env var.
    Returns 401 if missing/invalid. Skips for `/health`.

- `packages/omnimind-api/src/middleware/rate-limiter.ts`
    In-memory rate limiter using Map. Per-user (from `x-user-id` header).
    Configurable limits from `@boardroom/shared` constants.
    Returns 429 with `retryAfter` when exceeded.

- `packages/omnimind-api/src/middleware/error-handler.ts`
    Catch-all `(err, req, res, next)` handler.
    Logs error via logger. Returns structured JSON matching contract error shapes.
    Never leaks stack traces when `NODE_ENV=production`.

- Create `packages/omnimind-api/src/routes/health.routes.ts`
    Extract the inline health check from index.ts into a proper Router.
    `GET /health` — returns `{ status, service, timestamp, dbConnected }`.
    Actually pings DB via `prisma.$queryRaw` (the current inline version doesn't).

- Update `packages/omnimind-api/src/index.ts`
    Wire: JSON parser, CORS, helmet, auth middleware, rate limiter,
    health routes, error handler. Listen on `PORT` env var (default 3333).
    Log startup with logger. Disconnect Prisma on SIGTERM.

- `packages/omnimind-api/tests/integration/health.test.ts`
    Test: health returns 200 with expected shape.
    Test: request without x-api-key to non-health path returns 401.

Install any missing deps: `express-rate-limit` is already declared.
Add `supertest` as devDependency for integration tests.

**PATTERN:**
- Every route file exports an Express Router. index.ts mounts them.
- Middleware follows standard Express signature patterns.
- Use logger everywhere — no raw `console.log`.

**DO NOT:**
- Create entity routes (that's Task 5+)
- Create services
- Connect to any external API

**VERIFY:**
- `npx tsc --noEmit` clean
- `npx vitest run` passes
- If Docker is available: `npm run dev` starts server, `curl /health` returns 200

---

### TASK 4: SYNC VALIDATION PIPELINE

**GOAL:** The synchronous validation pipeline that gates every memory write.

**MUST READ FIRST:**
- `docs/MASTER-FRAMEWORK.md` Section 4 lines 566-581 (validation pipeline spec)
- `packages/shared/src/validation/memory.schema.ts` (from Task 1)
- `packages/shared/src/constants/memory-config.ts` (DOMAIN_MEMORY_BUDGETS)

**BUILD:**

- `packages/omnimind-api/src/memory/validation/schema-validator.ts`
    Uses `CreateMemoryRequestSchema` from `@boardroom/shared`.
    Returns: `{ valid: boolean, errors: string[] }`

- `packages/omnimind-api/src/memory/validation/temporal-validator.ts`
    If UPDATE: old entry must have `invalidAt` set.
    `validAt` must be set (default now).
    `invalidAt` must be after `validAt` if both present.
    If `supersededBy` is set, target memory must exist (requires DB check).
    Returns: `{ valid: boolean, errors: string[] }`

- `packages/omnimind-api/src/memory/validation/budget-enforcer.ts`
    Counts memories for userId in the given domain.
    Compares against `DOMAIN_MEMORY_BUDGETS` from `@boardroom/shared`.
    Falls back to `DOMAIN_MEMORY_BUDGETS.default` for unknown domains.
    Returns: `{ valid: boolean, errors: string[], currentCount: number, limit: number }`

- `packages/omnimind-api/src/memory/validation/pipeline.ts`
    Orchestrates all 3 validators in sequence.
    Fast-fail: if any fails, return aggregate errors immediately.
    Measures and returns execution duration.
    Returns: `{ valid: boolean, errors: { field: string, message: string }[], durationMs: number }`

- Unit tests for each validator
- Integration test: create memory violating each rule, verify rejection

**PATTERN:**
- Schema validator + budget enforcer take data + context args (pure where possible)
- Temporal validator needs DB access (for supersededBy check) — inject Prisma client
- Pipeline is sync except the DB check — keep it under 50ms target
- Import ALL limits from `@boardroom/shared/constants`

**DO NOT:**
- Implement async validation (classifier, contradiction scanner) — Phase 1
- Make any LLM calls
- Modify shared/ files

**VERIFY:**
- All unit tests pass
- Integration tests verify each rejection type
- Pipeline completes in <50ms on test data (log duration in test)

**>>> RUN /compact HERE BEFORE PROCEEDING <<<**

---

### TASK 5: MEMORY CRUD ROUTES + SERVICE

**GOAL:** Full CRUD for memories — the core entity. First real business logic.

**MUST READ FIRST:**
- `docs/contracts/omnimind-api.contract.md` (Memories section — all 5 endpoints)
- `packages/shared/src/types/memory.types.ts`
- `packages/shared/src/types/api.types.ts` (CreateMemoryRequest, CreateMemoryResponse)
- `packages/shared/src/validation/memory.schema.ts` (from Task 1)
- `packages/omnimind-api/src/memory/validation/pipeline.ts` (from Task 4)
- `packages/omnimind-api/src/routes/health.routes.ts` (built in Task 3 — router pattern to follow)

**BUILD:**

- `packages/omnimind-api/src/services/memory.service.ts`
    `createMemory(userId, input)` — validate with pipeline, write to DB, return created
    `getMemory(userId, id)` — fetch by id, scoped to userId, 404 if not found
    `searchMemories(userId, filters)` — support: q (basic Prisma contains for now),
      domain, tags, memoryClass, status, since, sortBy, sortOrder, limit, offset.
      Returns `{ items, total, offset, limit }`.
    `updateMemory(userId, id, input)` — partial update, validate, set updatedAt
    `archiveMemory(userId, id)` — set status=ARCHIVED + deletedAt
    `validateMemory(input)` — dry-run validation (no write)

- `packages/omnimind-api/src/routes/memories.routes.ts`
    ```
    POST   /memories          → createMemory
    GET    /memories/:id      → getMemory
    GET    /memories           → searchMemories
    PATCH  /memories/:id      → updateMemory
    DELETE /memories/:id      → archiveMemory
    POST   /memories/validate → validateMemory
    ```
    Every handler: extract userId from `x-user-id` header, validate with Zod,
    call service, return response matching contract shape EXACTLY.
    Validation errors → 422. Not found → 404. Success → 200/201.

- Mount in index.ts: `app.use('/memories', memoriesRouter)`

- `packages/omnimind-api/tests/integration/memories.test.ts`
    Test: full CRUD cycle (create → get → search → update → delete)
    Test: validation rejects missing required fields (422)
    Test: user isolation (user A can't read user B's memory)
    Test: dry-run validate endpoint works

**PATTERN:**
- Service functions never touch req/res — pure data in, data out
- Routes handle HTTP concerns (status codes, headers, error mapping)
- ALL DB queries include `where: { userId }` — NO EXCEPTIONS
- Validation errors return 422 with `{ error: "validation_failed", details: [...] }`
- Not found returns 404 with `{ error: "not_found", message: "..." }`

**DO NOT:**
- Implement FTS/trigram search (that's Task 7's retrieval engine)
- Implement async validation pipeline
- Touch frontend code

**VERIFY:**
- All integration tests pass
- `npx tsc --noEmit` clean
- Manual test if possible: create → get → search → update → delete cycle

---

### TASK 6: REMAINING ENTITY CRUD

**GOAL:** CRUD for People, Goals, Projects, Tasks, Decisions, Commitments,
UserProfile. Follow the EXACT pattern from Task 5.

**MUST READ FIRST:**
- `packages/omnimind-api/src/routes/memories.routes.ts` (THE pattern to copy)
- `packages/omnimind-api/src/services/memory.service.ts` (THE pattern to copy)
- `docs/contracts/omnimind-api.contract.md` (all entity endpoints)
- All validation schemas from Task 1

**BUILD (each follows the memories pattern):**

- `packages/omnimind-api/src/services/entity.service.ts`
    Generic CRUD for Person, Goal, Project, Task.
    Uses Prisma model name as parameter.
    All queries scoped to userId. Soft delete (set deletedAt).

- `packages/omnimind-api/src/routes/people.routes.ts`
    POST/GET/:id/GET-list/PATCH/DELETE

- `packages/omnimind-api/src/routes/goals.routes.ts`
    POST/GET/:id/GET-list/PATCH/DELETE
    GET /:id?include=children — returns goal with child goals

- `packages/omnimind-api/src/routes/projects.routes.ts`
    POST/GET/:id/GET-list/PATCH/DELETE
    GET /:id?include=tasks — returns project with linked tasks

- `packages/omnimind-api/src/routes/tasks.routes.ts`
    POST/GET/:id/GET-list/PATCH/DELETE

- `packages/omnimind-api/src/services/decision.service.ts`
    POST/GET/:id/GET-list/PATCH for Decision
    PATCH handles: status transitions, outcome recording

- `packages/omnimind-api/src/routes/decisions.routes.ts`

- `packages/omnimind-api/src/services/commitment.service.ts`
    POST/GET/:id/GET-list/PATCH for Commitment
    GET-list supports `?overdue=true` filter

- `packages/omnimind-api/src/routes/commitments.routes.ts`

- `packages/omnimind-api/src/services/user-profile.service.ts`
    GET (upsert — create default if none exists)
    PATCH (partial update)

- `packages/omnimind-api/src/routes/user-profile.routes.ts`

- Mount ALL new routers in index.ts

- Integration tests for each entity: create + get + list minimum

**PATTERN:**
- `entity.service.ts` is generic where possible, entity-specific where needed
- `decision.service.ts` and `commitment.service.ts` are standalone (different logic)
- `user-profile.service.ts` uses Prisma upsert
- Same validation → service → response pattern as memories
- Every route validates input with the matching Zod schema from Task 1

**DO NOT:**
- Add retrieval engine logic
- Add memory pipeline integration to entities
- Build any frontend

**VERIFY:**
- Every entity: create → get → list → update → delete cycle works
- User isolation: user A can't access user B's entities
- `npx tsc --noEmit` clean
- All tests pass

**>>> RUN /compact HERE BEFORE PROCEEDING <<<**

---

### TASK 7: HYBRID RETRIEVAL ENGINE

**GOAL:** The 4-layer retrieval system + context packager. This is what
makes memory recall work across overlapping projects.

**MUST READ FIRST:**
- `docs/contracts/omnimind-api.contract.md` (Context section + Retrieval Layer Details)
- `docs/MASTER-FRAMEWORK.md` Section 4 lines 480-601 (context capsules, retrieval flow)
- `packages/shared/src/constants/memory-config.ts` (RETRIEVAL_CONFIG, SECTOR_WEIGHTS, SOURCE_WEIGHTS)
- `packages/shared/src/types/api.types.ts` (ContextForPersonaRequest/Response, ContextItem)

**BUILD:**

- `packages/omnimind-api/src/retrieval/structured-filter.ts`
    Query by: userId, domain, tags, linked entities, date ranges, status.
    Returns scored results (exact matches score 1.0).

- `packages/omnimind-api/src/retrieval/fulltext-search.ts`
    Uses PostgreSQL tsvector/tsquery on memory content + title.
    Returns scored results (ts_rank scoring).
    Uses `prisma.$queryRaw` for the raw SQL.

- `packages/omnimind-api/src/retrieval/trigram-search.ts`
    Uses pg_trgm `similarity()` on memory content.
    Handles fuzzy matching, typos, near-misses.
    Uses `prisma.$queryRaw`.

- `packages/omnimind-api/src/retrieval/semantic-search.ts`
    **STUB** — returns empty array.
    Interface defined: `search(userId, queryEmbedding, limit) => ScoredResult[]`
    Include TODO comment with the pgvector query that will be used.

- `packages/omnimind-api/src/retrieval/ranker.ts`
    Takes results from all 4 layers.
    Deduplicates by memory ID.
    Weighted merge: structured (0.3) + FTS (0.25) + trigram (0.2) + semantic (0.25).
    Boosts: recency (lastAccessedAt within 7 days: +0.1), high importance (>=0.8: +0.1).
    Returns top N results (configurable, default from RETRIEVAL_CONFIG).

- `packages/omnimind-api/src/retrieval/context-packager.ts`
    Takes ranked results + persona type.
    Persona-specific boosting:
      optimist → boost tags: success, opportunity, resource
      critic → boost tags: risk, failure, constraint
      alternate → boost tags: alternative, competitor, unexplored
      technician → boost tags: technical, implementation, timeline
      ceo → no filter, uses maxItemsCEO and tokenBudgetCEO
    Estimates token count via `estimateTokens()` from shared utils.
    Truncates if over budget.
    Returns `ContextForPersonaResponse` matching the contract.

- `packages/omnimind-api/src/services/context-assembler.service.ts`
    Orchestrates: query → all 4 retrieval layers → ranker → packager.
    Also searches entity tables (people, goals, projects, decisions)
    using structured filters and includes them as ContextItems.

- `packages/omnimind-api/src/routes/context.routes.ts`
    `POST /context/for-persona` — full pipeline
    `POST /context/session-summary` — returns 501 (stub for Phase 1)

- Mount context router in index.ts

- Integration tests:
    Seed 15+ memories across 3 domains before tests.
    Test: search for known term returns relevant memory.
    Test: persona-specific packages return different boosted results.
    Test: results capped at RETRIEVAL_CONFIG.maxItemsPerPersona.
    Test: deduplication works (same memory from multiple layers appears once).

**DO NOT:**
- Implement actual embedding generation (semantic-search is a stub)
- Make any LLM calls
- Modify the sync validation pipeline
- Touch frontend code

**VERIFY:**
- FTS query returns correct memory for a known term
- Trigram returns fuzzy matches for misspelled input
- Ranker returns deduplicated, scored, limited results
- Context packager returns different results per persona type
- All tests pass, typecheck clean

---

## EXECUTION INSTRUCTIONS

Begin with Task 1 now. Follow the protocol exactly. Do not skip validation.
Do not ask for permission between tasks unless you hit a STOP condition.
Report each task completion with the checkpoint format, then proceed.

Run `/compact` at the marked points (after Task 4 and after Task 6).

Go.
