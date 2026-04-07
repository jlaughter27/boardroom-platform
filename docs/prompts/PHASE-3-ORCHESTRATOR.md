# PHASE 3 BUILD ORCHESTRATOR — Agentic Upgrades + External Cortex

> **Usage**: Paste this entire prompt into Claude Code (Opus) to execute Phase 3.
> **Prereqs**: Phase 0 (OmniMind API), Phase 1 (persona system), Phase 2 (dashboard) complete.
> **Last validated**: 2026-04-07 against actual codebase state.

---

Read .claude/CLAUDE.md, then read docs/contracts/omnimind-api.contract.md,
then read docs/contracts/boardroom-api.contract.md,
then read docs/MASTER-FRAMEWORK.md sections on External Cortex (§8) and Phase 3 roadmap.

You are the BUILD ORCHESTRATOR for Phase 3 of the BoardRoom AI + OmniMind platform.
Phase 3 is the AGENTIC UPGRADES phase. You are transforming a multi-persona decision tool
into a cognitive co-pilot — one that uses tools, learns thinking patterns, detects
contradictions, and proactively delivers intelligence. This phase also prepares for launch.

You will execute Phase 3 as a sequential chain of build tasks. You will
NOT write application code yourself. You will delegate ALL implementation
to subagents and ALL validation to separate subagent validators.

## WHAT ALREADY EXISTS (DO NOT REBUILD)

**packages/shared/src/** — All types, Zod schemas, constants, utils

**packages/omnimind-api/** — Full Express + Prisma + PostgreSQL:
- Memory CRUD + sync validation pipeline
- Entity CRUD (people, goals, projects, tasks, decisions, commitments, user-profile)
- Hybrid retrieval engine (structured + FTS + trigram + semantic stub)
- Context assembler for persona calls

**packages/boardroom-ai/server/** — Full Express server:
- OmniMind client (`services/omnimind-client.ts` — 204 lines)
- Agent runtime (`agents/agent.ts` — 87 lines, `agents/orchestrator.ts` — 151 lines)
- Persona dispatch + CEO synthesis (SSE streaming)
- Auth, sessions, entities proxy, onboarding routes
- Session-to-memory extraction, commitment tracker, cost tracker
- Rate limiter, prompt cache

**packages/boardroom-ai/client/** — Full React 19 dashboard:
- 7 pages: Dashboard, DecisionLab, DecisionSession, MemoryExplorer, PeopleDirectory, Onboarding, Settings
- 25+ components, 5 Zustand stores, typed API client with SSE
- react-router-dom v7, Tailwind dark theme

**Agent runtime architecture** (critical — understand before modifying):
- `agent.ts`: `Agent` class with `reason()` and `reasonStreaming()` methods.
  Takes system prompt + messages, calls Anthropic SDK, validates response with Zod.
  Currently has NO tool use support — this is what Task 2 adds.
- `orchestrator.ts`: `CEOOrchestrator` manages `SessionState`, fires personas in parallel
  via `Promise.allSettled()`, runs CEO synthesis, handles questionnaire/doer flows.
- `streaming.ts`: `initSSE()` + `streamClaudeResponse()` helpers.

**Prisma schema** includes: User, Room, Session, MemoryEntry, Decision, DecisionAssumption,
Commitment, Person, Goal, Project, Task, UserProfile, ContextCapsule, join tables.
Decision model has `status` (DecisionStatus enum: OPEN, DECIDED, REVIEWED, REVISED),
`chosenPath`, `rationale`, `outcome`, `outcomeRating` fields.

## CONVENTIONS

Same as Phases 0-2. Additionally for Phase 3:
- Background jobs use `node-cron` (add as dependency). No Redis/Bull for v1.
- Tool definitions use Anthropic SDK's native tool_use format — NOT MCP protocol.
  MCP is a future migration path. For v1, tools are plain functions in the agent runtime.
- External API calls (Serper, Google, Stripe) go through dedicated service files
  in `packages/boardroom-ai/server/src/services/`.
- OAuth tokens stored in a dedicated `OAuthToken` Prisma model (encrypted at rest).
- New shared types follow existing conventions: `interface`, `enum`, camelCase, string IDs, Date timestamps.

---

## PROTOCOL

Same as Phase 0/1/2. For each task:

### STEP 1 — BRIEF
Read task spec + MUST READ FIRST files. Prepare delegation briefing.

### STEP 2 — BUILD (Subagent: builder)
Delegate with full briefing. Builder creates/modifies ONLY specified files.
Runs `npx tsc --noEmit` before finishing. Runs any tests.

### STEP 3 — VALIDATE (Single combined validator subagent, read-only)

**A. Type & Build Compliance:**
- `npx tsc --noEmit` passes clean
- All data types imported from `@boardroom/shared`
- All API response parsing uses Zod schemas
- No `any` types without justification

**B. Contract Compliance:**
- New endpoints match existing contract patterns (auth headers, error shapes, pagination)
- OmniMind endpoints use `x-api-key` + `x-user-id` headers
- BoardRoom endpoints use JWT httpOnly cookie auth
- SSE event formats match established patterns

**C. Pattern & Integration Consistency:**
- New services follow existing service patterns (omnimind-client.ts as reference)
- New routes follow existing route patterns (entities.routes.ts as reference)
- New frontend components follow existing patterns (Tailwind, Zustand stores, api.ts client)
- Agent runtime modifications are backwards-compatible (existing persona dispatch still works)
- Background jobs are graceful (handle shutdown, don't block event loop)

### STEP 4 — VERDICT
PASS → commit. FAIL → re-deploy builder with corrections (max 2 cycles).

### STEP 5 — CHECKPOINT
Report files, validator findings, warnings. Proceed.

---

## CONTEXT MANAGEMENT

- Run `/compact` after completing Task 3 (before External Cortex work)
- Run `/compact` again after completing Task 5 (before Calendar/Stripe)

---

## STOP CONDITIONS

Pause and report if:
- A validator fails 2 correction cycles
- Agent runtime changes break existing persona dispatch
- An external API (Serper, Google, Stripe) requires config not available in env
- A Prisma migration conflicts with existing data
- Background job system introduces memory leaks or unhandled promise rejections
- New npm dependency exceeds 500KB or has known vulnerabilities

---

## DESIGN DECISIONS

Before Task 1, record these ADRs in `docs/DECISIONS.md`:

**ADR-008: Tool Execution via Anthropic SDK Native Tool Use**
Tools are plain TypeScript functions registered in the agent runtime.
Persona calls include tool definitions in the Anthropic API request.
The agent handles `tool_use` content blocks, executes the function,
returns `tool_result`, and continues the conversation turn.
NOT using MCP protocol for v1 (migration path for v2).

**ADR-009: Background Jobs via node-cron**
Weekly memo, pattern detection, and contradiction scan run as cron jobs
within the BoardRoom Express process. No separate worker. No Redis.
Graceful shutdown via `cron.stop()` on SIGTERM. Sufficient for <100 users.
Revisit when job duration exceeds 30s or user count exceeds 500.

**ADR-010: Google Calendar via OAuth 2.0 + googleapis SDK**
Standard OAuth 2.0 authorization code flow. Tokens stored encrypted
in a dedicated `OAuthToken` Prisma model (NOT in UserProfile — no metadata
field exists there). Refresh token rotation handled automatically by
googleapis client. Calendar data is read-only for v1 (no creating events
from BoardRoom).

---

## TASK SEQUENCE

Execute in EXACT order. Do not skip. Do not parallelize.

---

### TASK 1: SHARED TYPES + CONTRACT EXTENSIONS

**GOAL:** Add all new types, schemas, and constants needed for Phase 3 features.
Extend both API contracts with new endpoints. This task touches shared/ only
(plus contract docs). No business logic.

**MUST READ FIRST:**
- `packages/shared/src/types/` — all existing type files
- `packages/shared/src/constants/persona-config.ts`
- `packages/shared/src/validation/` — existing schema patterns
- `docs/MASTER-FRAMEWORK.md` §8 (External Cortex feature specs)

**BUILD:**

- `packages/shared/src/types/tool.types.ts`
    ```typescript
    export interface ToolDefinition {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;  // JSON Schema
      personaPermissions: PersonaId[];       // which personas may invoke
    }

    export interface ToolInvocation {
      toolName: string;
      input: Record<string, unknown>;
      personaId: PersonaId;
      sessionId: string;
    }

    export interface ToolResult {
      toolName: string;
      output: string;
      durationMs: number;
      cached: boolean;
    }

    export type ToolName = 'web_search' | 'calculator' | 'document_read';
    ```

- `packages/shared/src/types/cortex.types.ts`
    ```typescript
    export interface ThinkingPattern {
      id: string;
      userId: string;
      pattern: string;          // human-readable description
      patternType: PatternType;
      evidenceCount: number;
      confidence: number;       // 0-1
      firstDetected: Date;
      lastDetected: Date;
      trend: 'improving' | 'stable' | 'worsening' | null;
      createdAt: Date;
      updatedAt: Date;
    }

    export enum PatternType {
      BIAS = 'BIAS',
      STRENGTH = 'STRENGTH',
      BEHAVIORAL_CYCLE = 'BEHAVIORAL_CYCLE',
      DECISION_STYLE = 'DECISION_STYLE'
    }

    export interface ContradictionAlert {
      id: string;
      userId: string;
      description: string;
      entityA: { type: string; id: string; title: string };
      entityB: { type: string; id: string; title: string };
      severity: 'low' | 'medium' | 'high';
      status: ContradictionStatus;
      detectedAt: Date;
      resolvedAt: Date | null;
      resolution: string | null;
    }

    export enum ContradictionStatus {
      ACTIVE = 'ACTIVE',
      ACCEPTED_TENSION = 'ACCEPTED_TENSION',
      RESOLVED = 'RESOLVED',
      DISMISSED = 'DISMISSED'
    }

    export interface WeeklyMemo {
      id: string;
      userId: string;
      weekStart: Date;
      weekEnd: Date;
      decisionsMade: number;
      decisionsByCategory: Record<string, number>;
      patternsNoticed: string[];
      activeContradictions: string[];
      upcomingPressurePoints: string[];
      thinkingQualityScore: number;   // 0-10
      scoreChange: number;            // delta from last week
      recommendedFocus: string[];
      fullMemoText: string;           // rendered markdown
      generatedAt: Date;
    }

    export interface OutcomeReviewNudge {
      id: string;
      userId: string;
      decisionId: string;
      decisionTitle: string;
      nudgeType: '30_day' | '90_day';
      scheduledFor: Date;
      sentAt: Date | null;
      completedAt: Date | null;
      status: 'pending' | 'sent' | 'completed' | 'skipped';
    }
    ```

- `packages/shared/src/types/calendar.types.ts`
    ```typescript
    export interface CalendarEvent {
      id: string;
      title: string;
      startTime: Date;
      endTime: Date;
      allDay: boolean;
      source: 'google' | 'manual';
      externalId: string | null;     // Google Calendar event ID
      description: string | null;
      location: string | null;
    }

    export interface CalendarSyncStatus {
      connected: boolean;
      lastSyncAt: Date | null;
      calendarId: string | null;
      error: string | null;
    }
    ```

- `packages/shared/src/types/subscription.types.ts`
    ```typescript
    export enum SubscriptionStatus {
      TRIALING = 'TRIALING',
      ACTIVE = 'ACTIVE',
      PAST_DUE = 'PAST_DUE',
      CANCELED = 'CANCELED',
      EXPIRED = 'EXPIRED'
    }

    export interface Subscription {
      id: string;
      userId: string;
      stripeCustomerId: string;
      stripeSubscriptionId: string;
      status: SubscriptionStatus;
      plan: 'pro';                   // single plan for v1
      priceMonthly: number;          // 2900 = $29.00
      trialEndsAt: Date | null;
      currentPeriodEnd: Date;
      canceledAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }
    ```

- Add `OAuthToken` interface to `packages/shared/src/types/calendar.types.ts`:
    ```typescript
    export interface OAuthToken {
      id: string;
      userId: string;
      provider: string;
      accessToken: string;
      refreshToken: string | null;
      expiresAt: Date | null;
      scope: string | null;
      calendarId: string | null;
      createdAt: Date;
      updatedAt: Date;
    }
    ```

- Add Zod schemas for ALL new types in `packages/shared/src/validation/`:
    - `tool.schema.ts` — ToolDefinitionSchema, ToolInvocationSchema, ToolResultSchema
    - `cortex.schema.ts` — ThinkingPatternSchema, ContradictionAlertSchema, WeeklyMemoSchema, OutcomeReviewNudgeSchema
    - `calendar.schema.ts` — CalendarEventSchema, CalendarSyncStatusSchema
    - `subscription.schema.ts` — SubscriptionSchema

- Add constants in `packages/shared/src/constants/`:
    - `tool-config.ts`:
      ```typescript
      export const TOOL_PERMISSIONS: Record<ToolName, PersonaId[]> = {
        web_search: ['alternate', 'technician', 'ceo'],
        calculator: ['technician', 'critic', 'ceo'],
        document_read: ['technician', 'alternate', 'critic', 'ceo'],
      } as const;

      export const TOOL_LIMITS = {
        maxInvocationsPerPersona: 3,
        maxInvocationsPerSession: 10,
        searchResultsLimit: 5,
        documentMaxChars: 10000,
      } as const;
      ```
    - `cortex-config.ts`:
      ```typescript
      export const CORTEX_CONFIG = {
        memoSchedule: '0 18 * * 0',       // Sunday 6 PM
        patternScanSchedule: '0 3 * * 1', // Monday 3 AM
        contradictionScanSchedule: '0 4 * * 1', // Monday 4 AM
        minSessionsForPatterns: 10,        // need 10+ sessions before patterns
        minSessionsForMemo: 5,             // need 5+ sessions for weekly memo
        patternConfidenceThreshold: 0.6,
        contradictionSeverityThreshold: 0.5,
        memoMaxDecisionsToAnalyze: 50,
        outcomeReviewDays: [30, 90],
      } as const;

      export const COGNITIVE_LOAD = {
        maxActiveTasksBeforeWarning: 15,
        maxOverdueBeforeAlert: 3,
        maxDeadlinesThisWeekBeforeWarning: 5,
      } as const;
      ```

- Update `packages/shared/src/index.ts` to export all new types, schemas, constants.

- Extend `docs/contracts/omnimind-api.contract.md` — append these sections:
    ```markdown
    ## Cortex — Thinking Patterns
    ### GET /cortex/patterns
    Query params: limit, offset
    Response 200: PaginatedResponse<ThinkingPattern>

    ### POST /cortex/patterns/scan
    Trigger pattern detection scan. Returns detected patterns.
    Response 200: { patterns: ThinkingPattern[], newCount: number }

    ## Cortex — Contradictions
    ### GET /cortex/contradictions
    Query params: status (ACTIVE|RESOLVED|DISMISSED), limit, offset
    Response 200: PaginatedResponse<ContradictionAlert>

    ### POST /cortex/contradictions/scan
    Trigger cross-project contradiction scan.
    Response 200: { contradictions: ContradictionAlert[], newCount: number }

    ### PATCH /cortex/contradictions/:id
    Update status (resolve, dismiss, accept tension).
    Request: { status: ContradictionStatus, resolution?: string }
    Response 200: ContradictionAlert

    ## Cortex — Weekly Memo
    ### GET /cortex/memo/latest
    Response 200: WeeklyMemo | null

    ### GET /cortex/memo/history
    Query params: limit, offset
    Response 200: PaginatedResponse<WeeklyMemo>

    ### POST /cortex/memo/generate
    Trigger on-demand memo generation.
    Response 200: WeeklyMemo

    ## Outcome Reviews
    ### GET /outcome-reviews
    Query params: status (pending|sent|completed), limit, offset
    Response 200: PaginatedResponse<OutcomeReviewNudge>

    ### POST /outcome-reviews/:id/complete
    Request: { outcome: string, outcomeRating: number, wouldDecideSame: boolean }
    Response 200: OutcomeReviewNudge (status: completed)
    Also updates Decision.outcome and Decision.outcomeRating via linked decisionId.
    ```

- Extend `docs/contracts/boardroom-api.contract.md` — append these sections:
    ```markdown
    ## Tools (proxied)
    Tool invocations happen internally during persona dispatch.
    No direct client endpoints for tools — they're part of the agent runtime.
    Cost tracking includes tool invocation costs.

    ## Calendar
    ### GET /calendar/status
    Response 200: CalendarSyncStatus

    ### GET /calendar/auth-url
    Response 200: { url: string }  // Google OAuth consent URL

    ### GET /calendar/callback?code=...
    OAuth callback. Stores tokens. Redirects to /settings.

    ### GET /calendar/events
    Query params: start (ISO), end (ISO)
    Response 200: CalendarEvent[]

    ### POST /calendar/disconnect
    Removes stored tokens. Response 200: { status: "disconnected" }

    ## Cortex (proxied from OmniMind)
    ### GET /cortex/patterns — proxy
    ### GET /cortex/contradictions — proxy
    ### PATCH /cortex/contradictions/:id — proxy
    ### GET /cortex/memo/latest — proxy
    ### GET /cortex/memo/history — proxy
    ### POST /cortex/memo/generate — proxy

    ## Outcome Reviews (proxied from OmniMind)
    ### GET /outcome-reviews — proxy
    ### POST /outcome-reviews/:id/complete — proxy

    ## Subscription
    ### GET /subscription
    Response 200: Subscription | null

    ### POST /subscription/checkout
    Creates Stripe Checkout session.
    Response 200: { checkoutUrl: string }

    ### POST /subscription/webhook
    Stripe webhook handler (signature verified).
    Handles: checkout.session.completed, invoice.paid,
    invoice.payment_failed, customer.subscription.deleted

    ### POST /subscription/cancel
    Response 200: { canceledAt: string, activeUntil: string }
    ```

- Add new Prisma models by extending `packages/omnimind-api/prisma/schema.prisma`:
    ```prisma
    model ThinkingPattern {
      id             String      @id @default(cuid())
      userId         String
      pattern        String
      patternType    PatternType
      evidenceCount  Int         @default(1)
      confidence     Float       @default(0.5)
      trend          String?
      firstDetected  DateTime    @default(now())
      lastDetected   DateTime    @default(now())
      createdAt      DateTime    @default(now())
      updatedAt      DateTime    @updatedAt
      @@index([userId])
    }

    enum PatternType {
      BIAS
      STRENGTH
      BEHAVIORAL_CYCLE
      DECISION_STYLE
    }

    model ContradictionAlert {
      id            String              @id @default(cuid())
      userId        String
      description   String
      entityAType   String
      entityAId     String
      entityATitle  String
      entityBType   String
      entityBId     String
      entityBTitle  String
      severity      String              @default("medium")
      status        ContradictionStatus @default(ACTIVE)
      detectedAt    DateTime            @default(now())
      resolvedAt    DateTime?
      resolution    String?
      @@index([userId, status])
    }

    enum ContradictionStatus {
      ACTIVE
      ACCEPTED_TENSION
      RESOLVED
      DISMISSED
    }

    model WeeklyMemo {
      id                    String   @id @default(cuid())
      userId                String
      weekStart             DateTime
      weekEnd               DateTime
      decisionsMade         Int      @default(0)
      decisionsByCategory   Json     @default("{}")
      patternsNoticed       String[] @default([])
      activeContradictions  String[] @default([])
      upcomingPressurePoints String[] @default([])
      thinkingQualityScore  Float    @default(0)
      scoreChange           Float    @default(0)
      recommendedFocus      String[] @default([])
      fullMemoText          String
      generatedAt           DateTime @default(now())
      @@index([userId, weekStart])
      @@unique([userId, weekStart])
    }

    model OutcomeReviewNudge {
      id            String   @id @default(cuid())
      userId        String
      decisionId    String
      decisionTitle String
      nudgeType     String              // "30_day" | "90_day"
      scheduledFor  DateTime
      sentAt        DateTime?
      completedAt   DateTime?
      status        String   @default("pending")  // pending | sent | completed | skipped
      @@index([userId, status])
      @@index([scheduledFor])
    }

    model Subscription {
      id                    String             @id @default(cuid())
      userId                String             @unique
      stripeCustomerId      String             @unique
      stripeSubscriptionId  String             @unique
      status                SubscriptionStatus @default(TRIALING)
      plan                  String             @default("pro")
      priceMonthly          Int                @default(2900)
      trialEndsAt           DateTime?
      currentPeriodEnd      DateTime
      canceledAt            DateTime?
      createdAt             DateTime           @default(now())
      updatedAt             DateTime           @updatedAt
    }

    enum SubscriptionStatus {
      TRIALING
      ACTIVE
      PAST_DUE
      CANCELED
      EXPIRED
    }

    model OAuthToken {
      id              String   @id @default(cuid())
      userId          String
      provider        String   @default("google")  // "google" for v1
      accessToken     String                       // encrypted
      refreshToken    String?                      // encrypted
      expiresAt       DateTime?
      scope           String?
      calendarId      String?                      // primary calendar ID
      createdAt       DateTime @default(now())
      updatedAt       DateTime @updatedAt
      @@unique([userId, provider])
    }
    ```

- Run `npx prisma generate` and `npx prisma migrate dev --name phase3-cortex-tools` after schema changes.

**DO NOT:**
- Add business logic to shared/
- Modify existing types (only add new ones)
- Change existing Prisma models (only add new ones)

**VERIFY:**
- `npx tsc --noEmit` clean
- Prisma migration runs without errors
- All new types have corresponding Zod schemas
- Contract docs are valid markdown with consistent formatting
- Shared index.ts exports everything

---

### TASK 2: TOOL USE IN AGENT RUNTIME

**GOAL:** Add native Anthropic tool_use to the agent runtime. Three tools:
web search (Serper API), calculator (math.js), document reader (file content).
Persona-level permission model. Existing persona dispatch still works unchanged
for personas with no tools.

**MUST READ FIRST:**
- `packages/boardroom-ai/server/src/agents/agent.ts` (current Agent class — 87 lines)
- `packages/boardroom-ai/server/src/agents/orchestrator.ts` (CEOOrchestrator — 151 lines)
- `packages/shared/src/constants/tool-config.ts` (permissions + limits from Task 1)
- Anthropic SDK docs: tool_use content blocks, tool_result messages

**BUILD:**

- `packages/boardroom-ai/server/src/tools/tool-registry.ts`
    Tool registry. Maps tool names to implementations.
    ```typescript
    interface ToolHandler {
      definition: AnthropicToolDefinition;  // { name, description, input_schema }
      execute(input: Record<string, unknown>): Promise<string>;
    }

    class ToolRegistry {
      private tools: Map<string, ToolHandler>;
      register(handler: ToolHandler): void;
      getToolsForPersona(personaId: PersonaId): AnthropicToolDefinition[];
      execute(name: string, input: Record<string, unknown>): Promise<ToolResult>;
    }
    ```
    Enforces per-persona permissions from TOOL_PERMISSIONS.
    Enforces per-session invocation limits from TOOL_LIMITS.

- `packages/boardroom-ai/server/src/tools/web-search.tool.ts`
    Calls Serper API (`https://google.serper.dev/search`).
    Env var: `SERPER_API_KEY`.
    Input: `{ query: string, numResults?: number }`.
    Output: formatted string with title + snippet + URL for top N results.
    If SERPER_API_KEY is not set, returns "Web search not configured" (graceful degradation).

- `packages/boardroom-ai/server/src/tools/calculator.tool.ts`
    Uses `mathjs` (add as dependency) for safe expression evaluation.
    Input: `{ expression: string }`.
    Output: string result.
    Catches evaluation errors, returns human-readable error message.

- `packages/boardroom-ai/server/src/tools/document-read.tool.ts`
    Reads a document from OmniMind memories by ID or searches by title.
    Input: `{ memoryId?: string, searchQuery?: string }`.
    Uses OmniMind client to fetch memory content.
    Output: memory title + content (truncated to TOOL_LIMITS.documentMaxChars).

- Modify `packages/boardroom-ai/server/src/agents/agent.ts`:
    **CRITICAL: Do not break existing `reason()` or `reasonStreaming()` methods.**

    Add a new method: `reasonWithTools(params)` that:
    1. Accepts optional `tools: AnthropicToolDefinition[]` parameter
    2. Calls Anthropic SDK with tools in the request
    3. If response contains `tool_use` content blocks:
       a. Execute each tool via ToolRegistry
       b. Append `tool_result` messages
       c. Call Anthropic again with tool results
       d. Repeat until model returns text (or max 3 tool rounds)
    4. Final text response validated with Zod as before
    5. Returns `{ response: PersonaResponse, toolInvocations: ToolResult[] }`

    If no tools provided, behaves identically to existing `reason()`.

- Modify `packages/boardroom-ai/server/src/agents/orchestrator.ts`:
    In the persona dispatch loop, for each persona:
    1. Check if persona has tool permissions (via ToolRegistry)
    2. If yes, call `agent.reasonWithTools()` with persona's allowed tools
    3. If no, call existing `agent.reason()` (unchanged path)
    4. Track tool invocations in session cost tracking

    **The CEO synthesis call should also support tools** (CEO has access to all 3).

- `packages/boardroom-ai/server/src/tools/index.ts`
    Initializes ToolRegistry, registers all 3 tools, exports singleton.

- Install `mathjs` as dependency.

**PATTERN:**
- Tool execution is synchronous from the persona's perspective (the LLM waits for tool results)
- Tool results are injected as `tool_result` role messages per Anthropic SDK spec
- Max 3 tool-use rounds per persona call (prevent infinite loops)
- Tool invocations are logged for cost tracking (each tool call = tracked event)
- If a tool fails, the error message is returned as the tool result (let the LLM handle it)
- Personas WITHOUT tool access see no change in behavior

**DO NOT:**
- Implement MCP protocol (tools are plain functions, not MCP servers)
- Add tool UI to the frontend (tools are invisible to users — they enhance persona analysis)
- Break streaming for personas that DON'T use tools
- Add tools to Optimist persona (it should reason from memory context only)

**VERIFY:**
- `npx tsc --noEmit` clean
- Existing persona dispatch still works (test with optimist — no tools)
- Technician persona can invoke calculator tool
- CEO persona can invoke web_search tool
- Tool invocation count respects limits
- Missing SERPER_API_KEY doesn't crash (graceful fallback)

---

### TASK 3: DECISION OUTCOME REVIEW LOOP

**GOAL:** Close the feedback loop. When a user makes a decision, schedule
30-day and 90-day review nudges. The nudge asks "What happened? Would you
decide the same way?" Responses update the Decision record and feed into
pattern detection.

**MUST READ FIRST:**
- `packages/shared/src/types/cortex.types.ts` (OutcomeReviewNudge from Task 1)
- `packages/shared/src/types/decision.types.ts` (Decision, DecisionStatus)
- `packages/omnimind-api/prisma/schema.prisma` (Decision model + OutcomeReviewNudge model)
- `packages/boardroom-ai/server/src/agents/orchestrator.ts` (where sessions complete)

**BUILD:**

- `packages/omnimind-api/src/routes/outcome-review.routes.ts`
    CRUD for OutcomeReviewNudge:
    - `GET /outcome-reviews` — list nudges for user (filter by status)
    - `GET /outcome-reviews/pending` — nudges where scheduledFor <= now AND status = pending
    - `POST /outcome-reviews/:id/complete` — marks complete, updates linked Decision
    - `POST /outcome-reviews/:id/skip` — marks skipped
    Mount in OmniMind server index.ts.

- `packages/omnimind-api/src/services/outcome-review.service.ts`
    ```typescript
    class OutcomeReviewService {
      // Called when a Decision moves to DECIDED status
      scheduleReviews(userId: string, decisionId: string, decisionTitle: string): Promise<void>
      // Creates 2 nudges: 30-day and 90-day

      // Called by cron or on login — marks pending nudges as "sent"
      getPendingNudges(userId: string): Promise<OutcomeReviewNudge[]>

      // Completes review: updates nudge + patches Decision record
      completeReview(nudgeId: string, outcome: string, rating: number, wouldRepeat: boolean): Promise<void>
    }
    ```

- Hook into Decision lifecycle: when a decision's status changes to DECIDED
  (via `PATCH /decisions/:id`), call `outcomeReviewService.scheduleReviews()`.
  Modify the existing decision PATCH route in OmniMind to trigger this.

- `packages/boardroom-ai/server/src/routes/outcome-review.routes.ts`
    Proxy routes to OmniMind:
    - `GET /outcome-reviews` → proxy
    - `GET /outcome-reviews/pending` → proxy
    - `POST /outcome-reviews/:id/complete` → proxy
    - `POST /outcome-reviews/:id/skip` → proxy

- Add OmniMind client methods: `getOutcomeReviews()`, `getPendingReviews()`,
  `completeReview()`, `skipReview()`.

- `packages/boardroom-ai/client/src/components/dashboard/OutcomeReviewBanner.tsx`
    Shows pending outcome reviews at top of dashboard (below ProactiveQuestions).
    Each review card: decision title, days since decision, "Review Now" / "Skip" buttons.
    "Review Now" opens a modal with:
    - "What happened?" textarea
    - "Rate the outcome" (1-5 stars)
    - "Would you make the same decision?" (yes/no/unsure)
    Max 2 review banners at a time (don't overwhelm).

- `packages/boardroom-ai/client/src/components/dashboard/OutcomeReviewModal.tsx`
    Modal for completing a review. Calls API on submit.

- Update `DashboardPage.tsx`: add OutcomeReviewBanner between ProactiveQuestions and CalendarStrip.

- Update API client (`lib/api.ts`): add outcome review methods.

- Update entities store or create a small `review.store.ts` for pending reviews.

**PATTERN:**
- Reviews are PASSIVE nudges, not interrupts. They show on dashboard load, dismissible.
- The 30/90 day schedule is from the DECIDED date, not creation date.
- Outcome data feeds into pattern detection (Task 4) — the more reviews completed,
  the better pattern detection works.
- If user has no pending reviews, the banner doesn't render (no empty state needed).

**DO NOT:**
- Send email notifications (Phase 4 feature)
- Build a standalone outcome review page (dashboard banner is sufficient)
- Auto-populate outcomes from session data (user must reflect manually)

**VERIFY:**
- Decision PATCH to DECIDED creates 2 nudges (30-day, 90-day)
- Pending nudges surface on dashboard after scheduled date
- Completing review updates both nudge and linked Decision
- Skipping a review removes it from pending list
- `npx tsc --noEmit` clean

**>>> RUN /compact HERE BEFORE PROCEEDING <<<**

---

### TASK 4: EXTERNAL CORTEX — WEEKLY MEMO + PATTERN DETECTION

**GOAL:** The intelligence layer. A weekly "State of Your Thinking" memo
generated by Sonnet, plus thinking pattern detection that analyzes decisions
over time. Both run as background cron jobs and surface in the dashboard.

**MUST READ FIRST:**
- `packages/shared/src/types/cortex.types.ts` (WeeklyMemo, ThinkingPattern)
- `packages/shared/src/constants/cortex-config.ts` (schedules, thresholds)
- `docs/MASTER-FRAMEWORK.md` §8 (External Cortex — Feature 1 + Feature 4)
- `packages/omnimind-api/prisma/schema.prisma` (new models from Task 1)

**BUILD:**

- `packages/omnimind-api/src/routes/cortex.routes.ts`
    ```
    GET  /cortex/patterns            — list patterns (paginated)
    POST /cortex/patterns/scan       — trigger pattern scan
    GET  /cortex/memo/latest         — most recent memo
    GET  /cortex/memo/history        — all memos (paginated)
    POST /cortex/memo/generate       — trigger memo generation
    ```
    Mount in OmniMind server.

- `packages/omnimind-api/src/services/cortex-memo.service.ts`
    Weekly memo generation:
    1. Fetch last 7 days of DecisionSessions (from Session model or Decision model)
    2. Fetch active goals, overdue tasks, upcoming deadlines
    3. Fetch latest thinking patterns
    4. Fetch active contradictions
    5. Construct Sonnet prompt with all data (use `MODEL_MAP.sonnet`)
    6. Parse structured memo response
    7. Calculate thinking quality score (heuristic: decisions made + outcomes tracked +
       goals with metrics + review completion rate — overdue tasks — unresolved contradictions)
    8. Store as WeeklyMemo record
    9. Return memo

    Prompt template for memo generation (store in `docs/prompts/cortex-memo.system.md`):
    Instruct Sonnet to produce a structured analysis matching the WeeklyMemo shape.
    Include the memo structure from MASTER-FRAMEWORK §8 Feature 4.

- `packages/omnimind-api/src/services/cortex-patterns.service.ts`
    Pattern detection:
    1. Fetch last 90 days of completed Decision records (with outcomes where available)
    2. Check minimum threshold (CORTEX_CONFIG.minSessionsForPatterns)
    3. If threshold met: call Sonnet with decision history
    4. Prompt asks for: biases, strengths, behavioral cycles, decision styles
    5. Parse response into ThinkingPattern records
    6. Upsert: if pattern already exists (fuzzy match on description), update evidenceCount + lastDetected
    7. If new, create with confidence from LLM
    8. Return all patterns

    Prompt template: `docs/prompts/cortex-patterns.system.md`

- `packages/omnimind-api/src/jobs/cortex-scheduler.ts`
    Cron job scheduler using `node-cron`:
    ```typescript
    import cron from 'node-cron';

    export function startCortexScheduler() {
      // Weekly memo — Sunday 6 PM
      cron.schedule(CORTEX_CONFIG.memoSchedule, async () => {
        // For each user with enough sessions, generate memo
      });

      // Pattern scan — Monday 3 AM
      cron.schedule(CORTEX_CONFIG.patternScanSchedule, async () => {
        // For each user with enough sessions, run pattern detection
      });
    }

    export function stopCortexScheduler() {
      // Graceful shutdown — call on SIGTERM
    }
    ```
    Start scheduler in OmniMind server startup. Register shutdown hook.

- Install `node-cron` as dependency in omnimind-api.

- Add BoardRoom proxy routes: `packages/boardroom-ai/server/src/routes/cortex.routes.ts`
    Proxy all cortex endpoints to OmniMind.

- Add OmniMind client methods: `getPatterns()`, `triggerPatternScan()`,
  `getLatestMemo()`, `getMemoHistory()`, `triggerMemoGeneration()`.

- Update API client (`lib/api.ts`): add cortex methods.

- `packages/boardroom-ai/client/src/stores/cortex.store.ts`
    ```typescript
    interface CortexState {
      latestMemo: WeeklyMemo | null;
      patterns: ThinkingPattern[];
      isLoadingMemo: boolean;
      isLoadingPatterns: boolean;
      fetchLatestMemo(): Promise<void>;
      fetchPatterns(): Promise<void>;
      generateMemo(): Promise<void>;
    }
    ```

- `packages/boardroom-ai/client/src/components/dashboard/WeeklyMemoCard.tsx`
    Dashboard card showing latest weekly memo summary.
    Shows: thinking quality score (visual meter), key patterns, recommended focus.
    "View Full Memo" expands to show fullMemoText (rendered markdown).
    If no memo yet: "Not enough data yet. Keep making decisions!"

- `packages/boardroom-ai/client/src/components/dashboard/CortexInsightsPanel.tsx`
    Dashboard panel showing:
    - Top 3 thinking patterns (with trend arrows)
    - Active contradictions count (links to cortex page)
    - Thinking quality trend (last 4 weeks mini-chart)
    Compact layout — sits in dashboard sidebar or below calendar strip.

- Update `DashboardPage.tsx` layout:
    ProactiveQuestions → OutcomeReviewBanner → WeekCalendarStrip → WeeklyMemoCard →
    GoalHierarchy (main) + CortexInsightsPanel (sidebar or below)

**PATTERN:**
- Memo generation is expensive (~$0.10 Sonnet call). Only run weekly, or on-demand.
- Pattern detection requires minimum session threshold. Don't surface empty state.
- Cron jobs iterate over ALL users — use pagination, not `findMany` without limit.
- Cron jobs have try/catch per user — one user's failure doesn't block others.
- Memos are immutable once generated. No editing.

**DO NOT:**
- Build a full "Cortex" page (dashboard widgets are sufficient for v1)
- Add real-time pattern detection (batch only)
- Send email notifications for memos (dashboard only for v1)
- Use streaming for memo generation (batch, not interactive)

**VERIFY:**
- Memo generation endpoint returns valid WeeklyMemo structure
- Pattern scan produces at least 1 pattern from test data
- Cron scheduler starts and stops cleanly
- Dashboard shows memo card and insights panel
- `npx tsc --noEmit` clean

---

### TASK 5: EXTERNAL CORTEX — CONTRADICTION SCAN + COGNITIVE LOAD

**GOAL:** Cross-project contradiction detection and cognitive load warnings.
Contradictions surface conflicts between active projects/goals. Cognitive load
warnings alert when the user is overcommitted.

**MUST READ FIRST:**
- `packages/shared/src/types/cortex.types.ts` (ContradictionAlert)
- `packages/shared/src/constants/cortex-config.ts` (COGNITIVE_LOAD thresholds)
- `docs/MASTER-FRAMEWORK.md` §8 (External Cortex — Feature 2)

**BUILD:**

- `packages/omnimind-api/src/services/cortex-contradictions.service.ts`
    Cross-project contradiction detection:
    1. Fetch all active goals + projects for user
    2. For each pair of active projects, extract assumptions (from linked decisions/memories)
    3. Call Haiku (cheap, fast) to check for contradictions between each pair
       (batch: send 3-5 pairs per call to reduce API costs)
    4. Parse response: for each detected contradiction, create ContradictionAlert
    5. Dedup: if similar contradiction already exists (ACTIVE), update instead of creating new
    6. Return new + existing active contradictions

    Prompt template: `docs/prompts/cortex-contradictions.system.md`
    Keep prompt short — Haiku is doing comparison, not deep analysis.

- Add contradiction scan to `cortex-scheduler.ts`:
    Monday 4 AM — runs contradiction scan for all users with 2+ active projects.

- Add OmniMind routes to `cortex.routes.ts`:
    ```
    GET   /cortex/contradictions         — list (filter by status)
    POST  /cortex/contradictions/scan    — trigger scan
    PATCH /cortex/contradictions/:id     — resolve/dismiss/accept
    ```

- Add BoardRoom proxy routes for contradictions.
- Add OmniMind client methods for contradictions.
- Update API client with contradiction methods.

- `packages/boardroom-ai/client/src/hooks/useCognitiveLoad.ts`
    Computed from entities store:
    ```typescript
    interface CognitiveLoadWarning {
      type: 'overloaded' | 'too_many_overdue' | 'deadline_cluster';
      message: string;
      severity: 'warning' | 'critical';
    }

    function useCognitiveLoad(): CognitiveLoadWarning[] {
      // Check: active tasks > COGNITIVE_LOAD.maxActiveTasksBeforeWarning
      // Check: overdue tasks > COGNITIVE_LOAD.maxOverdueBeforeAlert
      // Check: deadlines this week > COGNITIVE_LOAD.maxDeadlinesThisWeekBeforeWarning
    }
    ```

- `packages/boardroom-ai/client/src/components/dashboard/CognitiveLoadBanner.tsx`
    Displays cognitive load warnings at top of dashboard (above ProactiveQuestions).
    Color-coded: amber for warning, red for critical.
    Dismissible per session.

- `packages/boardroom-ai/client/src/components/dashboard/ContradictionCard.tsx`
    Shows active contradictions in CortexInsightsPanel.
    Each card: description, entity A vs entity B, severity badge.
    Actions: "Resolve" (opens modal) | "Accept Tension" | "Dismiss"

- Update DashboardPage layout:
    CognitiveLoadBanner → ProactiveQuestions → OutcomeReviewBanner →
    WeekCalendarStrip → WeeklyMemoCard → GoalHierarchy + CortexInsightsPanel

- Update cortex.store.ts: add contradiction state and methods.

**PATTERN:**
- Contradiction scan uses Haiku (cheap) not Sonnet. Batch comparisons.
- Cognitive load is client-side heuristic — no LLM call needed.
- "Accept Tension" means user acknowledges the conflict but it's intentional.
- Contradictions feed into weekly memo (Task 4 references them).

**DO NOT:**
- Build real-time contradiction detection on every memory write (batch only for v1)
- Implement relationship circles / force-directed graph (deferred)
- Add enhanced memory linking beyond what exists

**VERIFY:**
- Contradiction scan detects at least 1 contradiction from test data with conflicting projects
- Resolve/dismiss/accept updates status correctly
- Cognitive load warnings appear when thresholds exceeded
- CognitiveLoadBanner dismisses and doesn't reappear in same session
- `npx tsc --noEmit` clean

**>>> RUN /compact HERE BEFORE PROCEEDING <<<**

---

### TASK 6: GOOGLE CALENDAR OAUTH INTEGRATION

**GOAL:** Connect user's Google Calendar. Show real calendar events alongside
task deadlines in the calendar strip. Read-only for v1.

**MUST READ FIRST:**
- `packages/shared/src/types/calendar.types.ts` (CalendarEvent, CalendarSyncStatus)
- `packages/boardroom-ai/client/src/components/dashboard/WeekCalendarStrip.tsx`
- `packages/boardroom-ai/client/src/components/dashboard/DayColumn.tsx`

**BUILD:**

- `packages/boardroom-ai/server/src/services/google-calendar.service.ts`
    Uses `googleapis` SDK (add as dependency).
    ```typescript
    class GoogleCalendarService {
      // Generate OAuth consent URL
      getAuthUrl(userId: string): string

      // Exchange code for tokens, store in OAuthToken model (encrypted)
      handleCallback(userId: string, code: string): Promise<void>

      // Fetch events for date range
      getEvents(userId: string, start: Date, end: Date): Promise<CalendarEvent[]>

      // Check connection status
      getStatus(userId: string): Promise<CalendarSyncStatus>

      // Remove stored tokens
      disconnect(userId: string): Promise<void>
    }
    ```

    OAuth config from env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
    Token storage: encrypt access/refresh tokens with `ENCRYPTION_KEY` env var,
    store in `OAuthToken` model (NOT UserProfile — it has no metadata field).
    If Google env vars not set, all methods return graceful "not configured" responses.

- `packages/boardroom-ai/server/src/routes/calendar.routes.ts`
    ```
    GET  /calendar/status          — connection status
    GET  /calendar/auth-url        — OAuth consent URL
    GET  /calendar/callback        — OAuth callback (redirects to /settings)
    GET  /calendar/events          — events for date range (query: start, end)
    POST /calendar/disconnect      — remove connection
    ```
    Mount in BoardRoom server.

- Update `packages/boardroom-ai/client/src/lib/api.ts`:
    Add calendar methods: `getCalendarStatus()`, `getCalendarAuthUrl()`,
    `getCalendarEvents(start, end)`, `disconnectCalendar()`.

- Update `WeekCalendarStrip.tsx`:
    Fetch calendar events for the visible week alongside tasks/commitments.
    Merge into day items. Calendar events shown with a distinct icon/color
    (e.g., blue calendar icon vs green task checkmark).

- Update `DayColumn.tsx`:
    Render CalendarEvent items alongside existing deadline items.
    Calendar events show time (e.g., "10:00 AM — Team Standup").

- `packages/boardroom-ai/client/src/components/settings/CalendarSettings.tsx`
    Settings section for Google Calendar:
    - If not connected: "Connect Google Calendar" button → opens auth URL
    - If connected: "Connected to [email]" + "Disconnect" button + last sync time
    - If not configured (server returns "not configured"): "Google Calendar integration
      not available" (don't show connect button)

- Update `SettingsPage.tsx`: add CalendarSettings section after Preferences.

- Install `googleapis` as dependency in boardroom-ai.

**PATTERN:**
- OAuth tokens are ENCRYPTED at rest. Never log tokens.
- If Google API errors (rate limit, expired token), show stale data with
  "Last synced: X minutes ago" warning. Don't crash.
- Token refresh happens automatically via googleapis client library.
- Calendar is READ-ONLY. No creating/modifying/deleting events from BoardRoom.
- If env vars not set, the entire feature is invisible (no broken UI).

**DO NOT:**
- Implement calendar event creation (read-only for v1)
- Build a full calendar page (enhance existing strip only)
- Store calendar events in the database (fetch on-demand from Google API)
- Implement iCal import

**VERIFY:**
- OAuth flow completes (if Google credentials configured)
- Calendar events merge correctly into WeekCalendarStrip
- Settings shows connection status
- Disconnect removes tokens
- Missing env vars = feature hidden, no errors
- `npx tsc --noEmit` clean

---

### TASK 7: STRIPE INTEGRATION + LAUNCH READINESS

**GOAL:** Payment integration with Stripe. 14-day free trial. Subscription gating.
Final polish for v1.0 launch readiness.

**MUST READ FIRST:**
- `packages/shared/src/types/subscription.types.ts` (Subscription, SubscriptionStatus)
- `packages/omnimind-api/prisma/schema.prisma` (Subscription model from Task 1)

**BUILD:**

- `packages/boardroom-ai/server/src/services/stripe.service.ts`
    Uses `stripe` SDK (add as dependency).
    ```typescript
    class StripeService {
      // Create Checkout session for new subscription
      createCheckout(userId: string, email: string): Promise<{ checkoutUrl: string }>

      // Handle webhook events
      handleWebhook(payload: Buffer, signature: string): Promise<void>
      // Events: checkout.session.completed, invoice.paid,
      // invoice.payment_failed, customer.subscription.deleted

      // Cancel subscription (at period end)
      cancelSubscription(userId: string): Promise<{ canceledAt: Date, activeUntil: Date }>

      // Get subscription status
      getSubscription(userId: string): Promise<Subscription | null>
    }
    ```

    Config from env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`.
    If not set, subscription endpoints return null (all features unlocked — dev mode).

- `packages/boardroom-ai/server/src/routes/subscription.routes.ts`
    ```
    GET  /subscription              — current subscription
    POST /subscription/checkout     — create Stripe Checkout session
    POST /subscription/webhook      — Stripe webhook (raw body, signature verification)
    POST /subscription/cancel       — cancel at period end
    ```
    Mount in BoardRoom server.
    **Webhook route MUST use raw body parser** (not JSON) for signature verification.

- `packages/boardroom-ai/server/src/middleware/subscription.middleware.ts`
    Middleware that checks subscription status:
    - TRIALING or ACTIVE → proceed
    - PAST_DUE → proceed but add warning header
    - CANCELED/EXPIRED/null → redirect to checkout (or return 402)

    Apply to session-creating routes only (not auth, not health, not settings).
    In dev mode (no STRIPE_SECRET_KEY), middleware is a no-op.

- Modify user registration flow: when a new user registers, if Stripe is configured,
  create a Subscription record with status=TRIALING and trialEndsAt=now+14 days.
  If Stripe not configured, skip (dev mode).

- Add OmniMind service for subscription CRUD (or manage in BoardRoom directly since
  Subscription is tied to billing, not memory. **Design decision: Subscription lives in
  BoardRoom's own DB or in OmniMind?** Put it in OmniMind since that's where all persistent
  data lives per architecture rule. BoardRoom proxies as usual.)

- Add OmniMind client methods: `getSubscription()`, `createSubscription()`,
  `updateSubscription()`.

- Add OmniMind route: `packages/omnimind-api/src/routes/subscription.routes.ts`
    Internal CRUD for Subscription model. Expose to BoardRoom only.

- Update API client: `getSubscription()`, `createCheckout()`, `cancelSubscription()`.

- `packages/boardroom-ai/client/src/components/settings/SubscriptionSettings.tsx`
    Settings section for billing:
    - Trial: "You have X days left in your free trial" + "Upgrade Now" button
    - Active: "Pro Plan — $29/month" + next billing date + "Cancel" button
    - Canceled: "Your access ends on [date]" + "Resubscribe" button
    - Past due: "Payment failed" warning + "Update Payment" link (Stripe portal)
    - Dev mode (subscription null): "All features unlocked (development mode)"

- Update `SettingsPage.tsx`: add SubscriptionSettings section.

- `packages/boardroom-ai/client/src/components/shared/TrialBanner.tsx`
    Persistent banner at top of app (inside Layout, above page content):
    - Shows during TRIALING: "X days left in your free trial — Upgrade"
    - Shows during PAST_DUE: "Payment failed — Update billing"
    - Hidden for ACTIVE or dev mode

- Update `Layout.tsx`: add TrialBanner at top of main content area.

- Install `stripe` as dependency in boardroom-ai.

- **Launch readiness checklist** (validator checks all):
    - [ ] All env vars documented in `.env.example` (add any new ones from Phase 3)
    - [ ] Health endpoints return correct status for both services
    - [ ] Error boundaries catch and display errors gracefully
    - [ ] Rate limits enforced on session creation
    - [ ] Cost tracking records all LLM + tool invocations
    - [ ] Subscription gating works (trial → expired blocks session creation)
    - [ ] `npm run build` produces production bundles without errors
    - [ ] `npx tsc --noEmit` clean for entire workspace
    - [ ] All Prisma migrations apply cleanly on fresh database
    - [ ] Docker Compose starts both services + PostgreSQL

**PATTERN:**
- Stripe webhook MUST verify signature. Never trust unverified webhooks.
- Trial starts on registration, not on first use.
- Cancellation takes effect at period end (not immediately).
- In dev mode (no Stripe env vars), everything is unlocked. No broken UI.
- Subscription data in OmniMind (consistent with "OmniMind owns all data" rule).

**DO NOT:**
- Build a landing page (separate project, not part of the app)
- Implement multiple pricing tiers (single $29/month pro plan for v1)
- Add annual billing option
- Implement refunds or proration logic (use Stripe's built-in handling)
- Build a billing history page (Stripe's customer portal handles this)

**VERIFY:**
- Stripe Checkout creates a session and returns URL (if configured)
- Webhook handling updates subscription status correctly
- Trial banner shows correct remaining days
- Subscription gating blocks session creation when expired
- Dev mode (no Stripe keys) unlocks everything silently
- Full production build succeeds: `npm run build`
- `npx tsc --noEmit` clean for entire workspace
- `.env.example` includes ALL env vars from Phases 0-3

---

## EXECUTION INSTRUCTIONS

Begin with Task 1 now. Follow the protocol exactly. Do not skip validation.
Do not ask for permission between tasks unless you hit a STOP condition.
Report each task completion with the checkpoint format, then proceed.

Run `/compact` at the marked points (after Task 3 and after Task 5).

Record ADRs 008, 009, 010 in `docs/DECISIONS.md` before starting Task 1 implementation.

**New dependencies this phase:** `node-cron`, `mathjs`, `googleapis`, `stripe`
Install each when its task begins. Don't install all upfront.

**Env vars this phase** (document in `.env.example`):
- `SERPER_API_KEY` — web search tool (optional, graceful fallback)
- `GOOGLE_CLIENT_ID` — Google Calendar OAuth (optional)
- `GOOGLE_CLIENT_SECRET` — Google Calendar OAuth (optional)
- `GOOGLE_REDIRECT_URI` — OAuth callback URL (optional)
- `ENCRYPTION_KEY` — for encrypting OAuth tokens at rest
- `STRIPE_SECRET_KEY` — Stripe API (optional, dev mode if absent)
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signature
- `STRIPE_PRICE_ID` — Stripe price ID for pro plan

Go.
