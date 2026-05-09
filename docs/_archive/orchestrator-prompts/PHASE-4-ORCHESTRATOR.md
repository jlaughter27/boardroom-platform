# PHASE 4 BUILD ORCHESTRATOR — Intelligence Layer + Scale Features

> **Usage**: Paste this entire prompt into Claude Code (Opus) to execute Phase 4.
> **Prereqs**: Phases 0-3 complete (OmniMind API, persona system, dashboard, agentic upgrades).
> **Last validated**: 2026-04-07 against actual codebase state + Phase 3 planned outputs.

---

Read .claude/CLAUDE.md, then read docs/contracts/omnimind-api.contract.md,
then read docs/contracts/boardroom-api.contract.md,
then read docs/MASTER-FRAMEWORK.md sections on External Cortex (§8) and Phase 4 roadmap (Scale & Expand).

You are the BUILD ORCHESTRATOR for Phase 4 of the BoardRoom AI + OmniMind platform.
Phase 4 is the INTELLIGENCE + SCALE phase. You are completing the retrieval engine
(semantic search has been a stub since Phase 0), adding user-definable personas,
improving synthesis quality, building decision simulations, and creating the
dynamic widget + relationship visualization systems that make the product sticky.

Phase 4 targets the 10→500 user milestone per the roadmap.

You will execute Phase 4 as a sequential chain of build tasks. You will
NOT write application code yourself. You will delegate ALL implementation
to subagents and ALL validation to separate subagent validators.

## WHAT ALREADY EXISTS (DO NOT REBUILD)

**packages/shared/src/** — All types, Zod schemas, constants, utils.
Includes Phase 3 additions: tool types, cortex types (ThinkingPattern, ContradictionAlert,
WeeklyMemo, OutcomeReviewNudge), calendar types, subscription types.

**packages/omnimind-api/** — Full Express + Prisma + PostgreSQL:
- Memory CRUD + sync validation pipeline
- Entity CRUD (all entities)
- Hybrid retrieval engine: 4 layers, but **semantic search is a STUB returning `[]`**
- Context assembler with persona-specific tag boosting
- Cortex services: weekly memo generation, pattern detection, contradiction scan (cron jobs)
- Outcome review service
- Subscription CRUD

**packages/boardroom-ai/server/** — Full Express server:
- OmniMind client (extended with cortex, review, subscription methods)
- Agent runtime with tool_use support (3 tools: web_search, calculator, document_read)
- Persona dispatch + CEO synthesis
- All proxy routes (entities, cortex, calendar, subscription, outcome reviews)
- Google Calendar OAuth, Stripe integration

**packages/boardroom-ai/client/** — Full React 19 dashboard:
- 7+ pages with all Phase 2 components
- Phase 3 additions: OutcomeReviewBanner, WeeklyMemoCard, CortexInsightsPanel,
  CognitiveLoadBanner, ContradictionCard, CalendarSettings, SubscriptionSettings, TrialBanner
- 6 Zustand stores (auth, entities, ui, session, memory, cortex)

**Retrieval engine architecture** (critical — this is what Task 1 completes):
- `packages/omnimind-api/src/retrieval/structured-filter.ts` — Layer 1 (weight 0.3) ✓
- `packages/omnimind-api/src/retrieval/fulltext-search.ts` — Layer 2 (weight 0.25) ✓
- `packages/omnimind-api/src/retrieval/trigram-search.ts` — Layer 3 (weight 0.2) ✓
- `packages/omnimind-api/src/retrieval/semantic-search.ts` — Layer 4 (weight 0.25) **STUB**
- `packages/omnimind-api/src/retrieval/ranker.ts` — Weighted merge + dedup + boosts ✓
- `packages/omnimind-api/src/retrieval/context-packager.ts` — Persona-specific filtering ✓

**Docker** uses `pgvector/pgvector:pg16` — pgvector extension is available in PostgreSQL.

**MemoryEntry Prisma model** has NO embedding column yet. Must be added.

**Phase 3 Prisma additions** (already in schema):
- ThinkingPattern, ContradictionAlert, WeeklyMemo, OutcomeReviewNudge
- Subscription, OAuthToken (Google OAuth tokens for calendar + future integrations)

**OAuthToken model** supports multiple providers via `provider` field + `scope` field.
Gmail integration (Task 7) reuses this model with provider='gmail' and different scope.

**Existing persona prompts** (docs/prompts/):
- ceo.system.md, critic.system.md, optimist.system.md, alternate.system.md,
  technician.system.md, doer.system.md, questionnaire.system.md, memory-extractor.system.md

## CONVENTIONS

Same as Phases 0-3. Additionally for Phase 4:
- Embedding model: OpenAI `text-embedding-3-small` (1536 dimensions). Use `OPENAI_API_KEY` env var.
  Fallback to `VOYAGE_API_KEY` if OpenAI unavailable (same interface pattern).
- Vector operations use Prisma raw queries with pgvector operators (`<=>` for cosine distance).
- Custom personas stored in Prisma, loaded at dispatch time alongside built-in prompts.
- Widget configurations stored as JSON in UserProfile or dedicated model.
- D3.js for relationship visualization (add as frontend dependency).

---

## PROTOCOL

Same as Phases 0-3. For each task:

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
- New endpoints follow existing patterns
- OmniMind endpoints use `x-api-key` + `x-user-id` headers
- BoardRoom endpoints use JWT httpOnly cookie auth
- Raw SQL queries are parameterized (no injection risk)

**C. Pattern & Integration Consistency:**
- Retrieval engine changes don't break existing 3 working layers
- Agent runtime changes are backwards-compatible
- New frontend components follow Tailwind dark theme
- Custom persona dispatch integrates with existing tool permission system
- Widget system doesn't break existing dashboard layout

### STEP 4 — VERDICT
PASS → commit. FAIL → re-deploy builder with corrections (max 2 cycles).

### STEP 5 — CHECKPOINT
Report files, validator findings, warnings. Proceed.

---

## CONTEXT MANAGEMENT

- Run `/compact` after completing Task 2 (before synthesis improvements)
- Run `/compact` again after completing Task 5 (before relationship visualization)

---

## STOP CONDITIONS

Pause and report if:
- A validator fails 2 correction cycles
- Semantic search query returns incorrect results (validate with test data)
- Embedding generation takes >2s per memory (latency budget exceeded)
- Custom persona dispatch breaks existing built-in persona flow
- Widget system requires a new state management approach
- pgvector extension fails to activate in PostgreSQL
- D3.js bundle size exceeds 200KB (consider d3-force only)

---

## DESIGN DECISIONS

Before Task 1, record these ADRs in `docs/DECISIONS.md`:

**ADR-011: Embedding Provider — OpenAI text-embedding-3-small**
1536-dimensional embeddings via OpenAI API. Cost: $0.02/1M tokens (~$0.00002 per memory).
Chosen over Voyage (fewer docs, newer) and local models (no GPU in prod).
Embeddings generated async on memory write (don't block the write response).
Stored as Float[] in Prisma / vector(1536) in PostgreSQL via raw query.

**ADR-012: Custom Persona Storage + Dispatch**
Custom personas stored in a `CustomPersona` Prisma model with system prompt text,
model tier selection, tool permissions, and activation status. At dispatch time,
orchestrator loads both built-in (from .md files) and custom (from DB) personas
based on mode config. Custom personas always use Haiku (cost control) unless
user has Pro+ plan (future). Max 3 custom personas per user.

**ADR-013: Widget System — JSON Config, Not Code**
Dashboard widgets defined as JSON configuration objects, not custom React components.
Each widget has a `type` (enum of supported types), `position` (grid coordinates),
`size`, and type-specific `config`. Rendered by a WidgetRenderer component that
maps type → built-in component. No user-uploaded code. Max 8 widgets per dashboard.

---

## TASK SEQUENCE

Execute in EXACT order. Do not skip. Do not parallelize.

---

### TASK 1: PGVECTOR SEMANTIC SEARCH — COMPLETING THE 4TH RETRIEVAL LAYER

**GOAL:** Complete the semantic search layer that has been a stub since Phase 0.
Add embedding column to MemoryEntry, build embedding generation pipeline,
implement cosine similarity search, and integrate with the existing ranker.
This is the single highest-impact improvement to persona response quality.

**MUST READ FIRST:**
- `packages/omnimind-api/src/retrieval/semantic-search.ts` (current STUB — understand interface)
- `packages/omnimind-api/src/retrieval/ranker.ts` (how layer results merge)
- `packages/omnimind-api/src/retrieval/context-packager.ts` (downstream consumer)
- `packages/omnimind-api/prisma/schema.prisma` (MemoryEntry model — no embedding column yet)
- `packages/shared/src/constants/memory-config.ts` (RETRIEVAL_CONFIG, SOURCE_WEIGHTS)

**BUILD:**

- Extend Prisma schema — add embedding column to MemoryEntry:
    ```prisma
    model MemoryEntry {
      // ... existing fields ...
      embedding     Unsupported("vector(1536)")?  @map("embedding")
    }
    ```
    Run migration: `npx prisma migrate dev --name add-embedding-column`

    Then run raw SQL to create the vector index:
    ```sql
    CREATE INDEX IF NOT EXISTS memory_entry_embedding_idx
    ON "MemoryEntry" USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
    ```
    Add this as a post-migration script or in the migration SQL file directly.
    Also ensure pgvector extension is enabled:
    ```sql
    CREATE EXTENSION IF NOT EXISTS vector;
    ```

- `packages/omnimind-api/src/services/embedding.service.ts`
    ```typescript
    class EmbeddingService {
      private client: OpenAI;
      private model = 'text-embedding-3-small';
      private dimensions = 1536;

      // Generate embedding for a single text
      async generateEmbedding(text: string): Promise<number[]>

      // Generate embeddings for multiple texts (batch, max 100)
      async generateBatch(texts: string[]): Promise<number[][]>

      // Generate and store embedding for a memory entry
      async embedMemory(memoryId: string): Promise<void>

      // Backfill: generate embeddings for all memories without one
      async backfillEmbeddings(userId: string, batchSize?: number): Promise<{ processed: number, total: number }>
    }
    ```
    Uses `openai` npm package (add as dependency to omnimind-api).
    Env var: `OPENAI_API_KEY`. If not set, embedding methods return null (graceful degradation).
    Text for embedding: `${memory.title}\n\n${memory.content}` (concatenate title + content).

- Hook embedding generation into memory write pipeline:
    Modify `packages/omnimind-api/src/routes/memories.routes.ts`:
    After successful `POST /memories` and `PATCH /memories/:id`, fire async embedding generation.
    **Do NOT await the embedding** — fire and forget. Memory write returns immediately.
    Use `process.nextTick()` or `setImmediate()` to avoid blocking.

    ```typescript
    // After memory created/updated:
    setImmediate(() => {
      embeddingService.embedMemory(memory.id).catch(err =>
        logger.error('Embedding generation failed', { memoryId: memory.id, err })
      );
    });
    ```

- Complete `packages/omnimind-api/src/retrieval/semantic-search.ts`:
    Replace the stub with actual pgvector cosine similarity search.

    **IMPORTANT:** The existing stub signature is:
    ```typescript
    export async function semanticSearch(
      _userId: string,
      _queryEmbedding: number[],
      _options: { limit?: number },
      _prisma: PrismaClient
    ): Promise<ScoredResult[]>
    ```
    The return type is `ScoredResult[]` (defined in structured-filter.ts).
    The function receives a PRE-GENERATED embedding (number[]), not a text query.
    **Match this exact signature.** The caller handles embedding generation.

    Implementation:
    ```typescript
    export async function semanticSearch(
      userId: string,
      queryEmbedding: number[],
      options: { limit?: number },
      prisma: PrismaClient
    ): Promise<ScoredResult[]> {
      const limit = options.limit ?? 10;

      // Run cosine similarity search via raw query
      const results = await prisma.$queryRaw`
        SELECT id, title, content, domain, tags, importance,
               1 - (embedding <=> ${queryEmbedding}::vector) as similarity
        FROM "memory_entries"
        WHERE "user_id" = ${userId}
          AND embedding IS NOT NULL
          AND status != 'ARCHIVED'
        ORDER BY embedding <=> ${queryEmbedding}::vector
        LIMIT ${limit}
      `;

      // Map to ScoredResult format (match other layers' interface)
      return results.map(r => ({
        id: r.id,
        type: 'memory' as const,
        title: r.title,
        content: r.content,
        relevanceScore: r.similarity,
        source: 'semantic' as const,
        whyIncluded: `Semantic similarity: ${(r.similarity * 100).toFixed(1)}%`,
        tags: r.tags,
        importance: r.importance,
      }));
    }
    ```

- Update the retrieval orchestration layer (wherever `semanticSearch` is called):
    Before calling `semanticSearch`, generate the query embedding:
    ```typescript
    const queryEmbedding = await embeddingService.generateEmbedding(query);
    const semanticResults = queryEmbedding
      ? await semanticSearch(userId, queryEmbedding, { limit }, prisma)
      : [];  // graceful degradation if no API key
    ```
    Find where the 4 layers are called (likely in context-assembler.service.ts or
    a retrieval orchestrator) and add the embedding generation step there.

- Add backfill endpoint to OmniMind:
    `POST /memories/backfill-embeddings` — triggers backfill for user's memories.
    Returns `{ processed: number, total: number, remaining: number }`.
    This is admin/maintenance — called once after migration or on-demand.

- Add backfill proxy route on BoardRoom:
    `POST /memories/backfill-embeddings` → proxies to OmniMind.

- Add `openai` npm package as dependency to omnimind-api:
    ```bash
    npm install openai
    ```

- Add shared types for embedding operations:
    `packages/shared/src/types/embedding.types.ts`
    ```typescript
    export interface EmbeddingResult {
      memoryId: string;
      dimensions: number;
      model: string;
      generatedAt: Date;
    }

    export interface BackfillStatus {
      processed: number;
      total: number;
      remaining: number;
    }
    ```

**PATTERN:**
- Embeddings are generated ASYNC after memory writes (fire-and-forget).
- If OPENAI_API_KEY is not set, semantic search layer returns `[]` (same as current stub behavior).
- The ranker already handles missing layers gracefully (empty results get 0 weight).
- Backfill is a one-time operation after migration. Future writes auto-embed.
- Use `Unsupported("vector(1536)")` in Prisma for the pgvector column type.
  All vector operations use `$queryRaw` (Prisma doesn't natively support pgvector).
- IVFFlat index with 100 lists is appropriate for <100K vectors. Switch to HNSW at scale.

**DO NOT:**
- Block memory writes on embedding generation
- Use Prisma's native types for vector columns (use Unsupported + raw queries)
- Generate embeddings for archived memories
- Add a separate vector database (everything stays in PostgreSQL)
- Change the retrieval weights (0.3/0.25/0.2/0.25 stays as-is)

**VERIFY:**
- Migration runs clean (embedding column added, index created)
- Embedding generation works for a test memory (if OPENAI_API_KEY set)
- Semantic search returns relevant results ranked by cosine similarity
- Existing 3 retrieval layers still work unchanged
- Ranker properly merges all 4 layers with correct weights
- Missing OPENAI_API_KEY doesn't break anything (graceful fallback)
- `npx tsc --noEmit` clean

---

### TASK 2: CUSTOM PERSONA CREATION

**GOAL:** Users can create their own personas beyond the 7 built-in ones.
A custom persona has a name, system prompt, model tier, and optional tool
permissions. Custom personas participate in dispatch alongside built-in ones.
Max 3 custom personas per user.

**MUST READ FIRST:**
- `packages/boardroom-ai/server/src/agents/agent.ts` (Agent class)
- `packages/boardroom-ai/server/src/agents/orchestrator.ts` (persona dispatch loop)
- `packages/shared/src/types/persona.types.ts` (PersonaId, PersonaConfig)
- `packages/shared/src/constants/persona-config.ts` (PERSONA_CONFIGS, MODEL_MAP)
- `docs/prompts/optimist.system.md` (example persona prompt structure)

**BUILD:**

- Add Prisma model:
    ```prisma
    model CustomPersona {
      id              String   @id @default(cuid())
      userId          String
      name            String              // e.g., "Legal Advisor"
      personaId       String              // slug: "legal-advisor" (unique per user)
      systemPrompt    String              // full system prompt text
      modelTier       String   @default("haiku")  // "haiku" or "sonnet"
      maxOutputTokens Int      @default(1500)
      toolPermissions String[] @default([])        // tool names this persona can use
      isActive        Boolean  @default(true)
      description     String?             // short description for mode selector
      icon            String?             // emoji or icon name
      createdAt       DateTime @default(now())
      updatedAt       DateTime @updatedAt
      @@unique([userId, personaId])
      @@index([userId, isActive])
    }
    ```
    Run migration.

- Add shared types:
    `packages/shared/src/types/custom-persona.types.ts`
    ```typescript
    export interface CustomPersona {
      id: string;
      userId: string;
      name: string;
      personaId: string;
      systemPrompt: string;
      modelTier: 'haiku' | 'sonnet';
      maxOutputTokens: number;
      toolPermissions: string[];
      isActive: boolean;
      description: string | null;
      icon: string | null;
      createdAt: Date;
      updatedAt: Date;
    }

    export interface CreateCustomPersonaRequest {
      name: string;
      systemPrompt: string;
      modelTier?: 'haiku' | 'sonnet';
      maxOutputTokens?: number;
      toolPermissions?: string[];
      description?: string;
      icon?: string;
    }
    ```
    Add Zod schemas in `packages/shared/src/validation/custom-persona.schema.ts`.
    Validate: name 2-50 chars, systemPrompt 50-5000 chars, maxOutputTokens 500-3000.

- OmniMind CRUD routes: `packages/omnimind-api/src/routes/custom-personas.routes.ts`
    ```
    GET    /custom-personas         — list user's custom personas
    POST   /custom-personas         — create (max 3 per user, enforce)
    PATCH  /custom-personas/:id     — update
    DELETE /custom-personas/:id     — hard delete
    ```

- BoardRoom proxy routes: `packages/boardroom-ai/server/src/routes/custom-personas.routes.ts`

- OmniMind client methods: `getCustomPersonas()`, `createCustomPersona()`,
  `updateCustomPersona()`, `deleteCustomPersona()`.

- **Modify orchestrator.ts** — this is the critical integration point:
    In `CEOOrchestrator.dispatch()`:
    1. Load built-in persona configs from `PERSONA_CONFIGS` (existing)
    2. **NEW:** Fetch user's active custom personas from OmniMind
    3. For mode routing: built-in personas selected by mode config (unchanged).
       Custom personas participate in ALL modes if active (they're always included).
    4. For each custom persona, create an Agent with:
       - System prompt from DB (not from .md file)
       - Model from `MODEL_MAP[customPersona.modelTier]`
       - Tool permissions from `customPersona.toolPermissions`
    5. Custom persona responses use the same `PersonaResponse` interface.
       The personaId is the custom slug (e.g., "legal-advisor").

    **CRITICAL:** Do NOT modify how built-in personas dispatch. Custom personas
    are ADDITIVE — they fire alongside built-in ones. The CEO synthesis receives
    ALL persona outputs (built-in + custom).

- **Modify CEO synthesis** in orchestrator.ts:
    When formatting persona outputs for CEO, label custom personas clearly:
    ```
    ## Legal Advisor (custom)
    {response JSON}
    ```
    CEO prompt already handles variable persona counts (it reasons over whatever it receives).

- Extend `PersonaId` type to support custom IDs:
    In `packages/shared/src/types/persona.types.ts`, change PersonaId from a union literal
    to include a string escape hatch:
    ```typescript
    export type PersonaId = 'optimist' | 'critic' | 'alternate' | 'technician'
      | 'questionnaire' | 'doer' | 'ceo' | (string & {});
    ```
    This preserves autocomplete for built-in IDs while allowing custom strings.

- Update API client: add custom persona CRUD methods.

- `packages/boardroom-ai/client/src/pages/CustomPersonasPage.tsx`
    List + manage custom personas. Accessible from Settings or sidebar.
    Shows: name, description, model badge, active toggle, edit/delete.
    "Create Persona" button → opens creation form.

- `packages/boardroom-ai/client/src/components/settings/PersonaEditor.tsx`
    Form for creating/editing a custom persona:
    - Name field
    - Description field (1-2 sentences)
    - System prompt textarea (with helper text: "Describe this persona's perspective,
      expertise, and reasoning style. See built-in prompts for examples.")
    - Model tier selector (Haiku recommended, Sonnet costs 3x more)
    - Tool permissions checkboxes (web_search, calculator, document_read)
    - Preview button: fires a test question through the persona (optional, nice-to-have)

- Update routing: add `/personas` route in App.tsx.
- Update Sidebar: add "Custom Personas" link under Settings.
- Update session store + DecisionSessionPage: show custom persona cards alongside built-in ones.

**PATTERN:**
- Custom personas generate a `personaId` slug from the name (lowercase, hyphenated).
- Max 3 custom personas per user (enforce at creation time, return 422 if exceeded).
- Custom personas default to Haiku (cost control). Sonnet available but surfaced as "costs 3x more."
- Custom persona system prompts should follow the same output schema as built-in personas
  (PersonaResponse JSON). Include a boilerplate suffix in the prompt automatically:
  "Respond in JSON matching this schema: {PersonaResponse fields...}"
- Deletion is hard delete (not soft) — custom personas are user-created, not system data.
- If a user has 0 custom personas, the feature is invisible in the dispatch UI.

**DO NOT:**
- Modify built-in persona prompts or configs
- Allow custom personas to use the CEO role (CEO is always the built-in synthesis agent)
- Build a prompt template marketplace or sharing system
- Allow more than 3000 maxOutputTokens (cost guard)
- Add custom personas to MODE_CONFIGS (they participate in all modes)

**VERIFY:**
- Custom persona CRUD works end-to-end
- Custom persona participates in dispatch alongside built-in personas
- CEO synthesis includes custom persona output
- PersonaCard renders custom personas with distinct styling
- Max 3 limit enforced
- Deleting a custom persona doesn't break existing sessions
- `npx tsc --noEmit` clean

**>>> RUN /compact HERE BEFORE PROCEEDING <<<**

---

### TASK 3: IMPROVED SYNTHESIS + OUTCOME-INFORMED REASONING

**GOAL:** Make the CEO synthesis smarter by incorporating past decision outcomes,
user thinking patterns, and structured persona output formatting. This is a
prompt engineering + data flow improvement, not a major architecture change.

**MUST READ FIRST:**
- `docs/prompts/ceo.system.md` (current CEO prompt — understand structure)
- `packages/boardroom-ai/server/src/agents/orchestrator.ts` (synthesize method)
- `packages/shared/src/types/cortex.types.ts` (ThinkingPattern, WeeklyMemo)

**BUILD:**

- **Enhance CEO system prompt** (`docs/prompts/ceo.system.md`):
    Add a new section: "OUTCOME-INFORMED REASONING"
    ```
    ## OUTCOME-INFORMED REASONING

    You will receive past decision outcomes alongside the current question.
    Use them to:
    1. Reference relevant past decisions: "When you faced [similar situation],
       you chose [path] and it resulted in [outcome]."
    2. Calibrate confidence: If past outcomes show systematic overconfidence,
       reduce your confidence scores. If outcomes show good calibration, note it.
    3. Surface patterns: "You tend to [pattern]. In this case, consider whether
       that pattern applies."
    4. Avoid repeated mistakes: If a past decision had a poor outcome due to
       a specific oversight, explicitly check for that same oversight here.

    Past outcomes and patterns will appear in your context under the headers:
    - `## Past Relevant Outcomes` — decisions similar to this one
    - `## Your Thinking Patterns` — detected biases and strengths
    ```

- **Enhance persona output formatting** in orchestrator.ts `synthesize()`:
    Currently: `## ${name}\n${JSON.stringify(response)}`
    Change to a structured format that's easier for CEO to reason over:
    ```typescript
    function formatPersonaForCEO(name: string, response: PersonaResponse): string {
      return `## ${name} (${response.confidence >= 0.7 ? 'high' : response.confidence >= 0.4 ? 'medium' : 'low'} confidence)
    **Reading:** ${response.situationReading}
    **Recommendation:** ${response.recommendation}
    **Key Assumptions:** ${response.keyAssumptions.join('; ')}
    **Uncertainties:** ${response.uncertainties.join('; ')}
    ${response.dissentFlag ? '⚠️ DISSENT: This persona fundamentally disagrees.' : ''}`;
    }
    ```
    This gives CEO structured input instead of raw JSON.

- **Add outcome context to synthesis** in orchestrator.ts:
    Before calling CEO:
    1. Fetch user's past decisions with outcomes (via OmniMind: `GET /decisions?status=REVIEWED&limit=5`)
    2. Fetch user's thinking patterns (via OmniMind: `GET /cortex/patterns?limit=5`)
    3. Construct additional context block:
    ```typescript
    const outcomeContext = pastDecisions.length > 0
      ? `## Past Relevant Outcomes\n${pastDecisions.map(d =>
          `- "${d.title}": Chose ${d.chosenPath}. Outcome: ${d.outcome} (${d.outcomeRating}/5)`
        ).join('\n')}`
      : '';

    const patternContext = patterns.length > 0
      ? `## Your Thinking Patterns\n${patterns.map(p =>
          `- ${p.pattern} (${p.patternType}, confidence: ${p.confidence})`
        ).join('\n')}`
      : '';
    ```
    4. Append to CEO messages before the synthesis call.

- **Add synthesis quality scoring** (post-synthesis):
    After CEO returns SynthesisReport, compute a quality heuristic:
    ```typescript
    function scoreSynthesisQuality(report: SynthesisReport, personaResponses: PersonaResponse[]): number {
      let score = 5; // base
      if (report.disagreementMap.length > 50) score += 1;      // substantive disagreement analysis
      if (report.nextActions.length >= 3) score += 1;            // concrete actions
      if (report.topRisks.length >= 2) score += 0.5;            // risk awareness
      if (report.assumptionsToMonitor.length >= 2) score += 0.5; // assumption tracking
      // Penalize if recommendation is vague
      if (report.recommendation.length < 50) score -= 1;
      // Penalize if didn't address dissenting persona
      const hasDissenters = personaResponses.some(r => r.dissentFlag);
      if (hasDissenters && !report.disagreementMap.includes('dissent')) score -= 1;
      return Math.max(0, Math.min(10, score));
    }
    ```
    Store quality score in the session record for longitudinal tracking.

- Add `synthesisQuality` field to session response types:
    Extend relevant shared types or session store.

- **Enhance persona prompts** — add a line to each persona's .system.md:
    At the end of each persona prompt, add:
    ```
    If past outcomes or thinking patterns are provided in your context, incorporate
    them into your analysis. Reference specific past decisions when relevant.
    ```
    Modify: optimist, critic, alternate, technician system prompts.
    Do NOT modify: questionnaire, doer, memory-extractor (they don't analyze decisions).

- Update OmniMind client: ensure `getDecisions` supports `status` filter and
  `getPatterns` is callable from orchestrator context.

**PATTERN:**
- Outcome data is OPTIONAL. If user has no reviewed decisions, synthesis works as before.
- Pattern data is OPTIONAL. If user has no patterns detected yet, synthesis works as before.
- Quality scoring is a heuristic, not a grade. It's for internal tracking, not shown to users.
- CEO prompt changes are ADDITIVE (new section, existing sections unchanged).
- Persona prompt changes are a single line addition, not a rewrite.

**DO NOT:**
- Rewrite the CEO prompt from scratch (additive changes only)
- Add a separate "quality check" LLM call (too expensive)
- Show synthesis quality score to users (internal metric only)
- Block synthesis if no outcome data available

**VERIFY:**
- Synthesis works with AND without outcome data
- Past decisions appear in CEO context when available
- Thinking patterns appear in CEO context when available
- Formatted persona output is more readable than raw JSON
- Quality score produces reasonable values (5-8 for normal, 8-10 for excellent)
- Existing synthesis behavior unchanged when no outcome/pattern data exists
- `npx tsc --noEmit` clean

---

### TASK 4: LIGHTWEIGHT DECISION SIMULATIONS

**GOAL:** "What happens next?" projections before committing to a decision path.
After CEO synthesis, user can click "Simulate" to see resource, timeline, and
stakeholder impact projections. NOT Monte Carlo — this is LLM reasoning over
structured data.

**MUST READ FIRST:**
- `docs/MASTER-FRAMEWORK.md` §8 (External Cortex — Feature 3: Lightweight Decision Simulations)
- `packages/shared/src/types/cortex.types.ts` (existing cortex types)
- `packages/boardroom-ai/server/src/agents/orchestrator.ts` (where simulation triggers)

**BUILD:**

- Add shared types:
    `packages/shared/src/types/simulation.types.ts`
    ```typescript
    export interface SimulationRequest {
      sessionId: string;
      chosenPath: string;          // which option to simulate
      simulationTypes: SimulationType[];
    }

    export type SimulationType = 'resource' | 'timeline' | 'stakeholder';

    export interface SimulationResult {
      id: string;
      sessionId: string;
      chosenPath: string;
      resourceImpact: ResourceSimulation | null;
      timelineImpact: TimelineSimulation | null;
      stakeholderImpact: StakeholderSimulation | null;
      overallRisk: 'low' | 'medium' | 'high';
      generatedAt: Date;
    }

    export interface ResourceSimulation {
      budgetRequired: string;
      peopleRequired: string;
      gapAnalysis: string;         // what's missing vs current resources
      confidence: number;
    }

    export interface TimelineSimulation {
      estimatedDuration: string;
      milestones: { name: string; date: string; risk: string }[];
      historicalComparison: string;  // "Based on past projects, this will likely take X% longer"
      confidence: number;
    }

    export interface StakeholderSimulation {
      impactedPeople: { name: string; impact: string; action: string }[];
      rippleEffects: string[];       // downstream project impacts
      communicationNeeded: string[];
    }
    ```
    Add Zod schemas.

- `packages/omnimind-api/src/services/simulation.service.ts`
    ```typescript
    class SimulationService {
      async simulate(
        userId: string,
        sessionId: string,
        chosenPath: string,
        types: SimulationType[]
      ): Promise<SimulationResult> {
        // 1. Fetch session + persona responses + CEO synthesis
        // 2. Fetch user's active goals, projects, tasks, people
        // 3. Fetch past decisions with similar characteristics
        // 4. Construct Sonnet prompt with all data
        // 5. Parse structured simulation response
        // 6. Store result
        // 7. Return
      }
    }
    ```
    Prompt template: `docs/prompts/cortex-simulation.system.md`
    Instruct Sonnet to produce structured JSON matching SimulationResult.
    Include: "Base timeline estimates on the user's historical completion rates
    if past project data is available."

- OmniMind route: `POST /cortex/simulate`
    Request: SimulationRequest
    Response: SimulationResult

- BoardRoom proxy: `POST /cortex/simulate`

- Update API client + cortex store with simulation methods.

- `packages/boardroom-ai/client/src/components/decision/SimulationPanel.tsx`
    Shows after CEO synthesis, triggered by "Simulate" button.
    Three sections (toggleable):
    - **Resource Impact:** Budget, people, gap analysis with confidence meter
    - **Timeline:** Milestones as a simple timeline visual, historical comparison note
    - **Stakeholder Impact:** People cards showing who's affected + required actions
    Overall risk badge (low/medium/high) at top.

- `packages/boardroom-ai/client/src/components/decision/SimulationButton.tsx`
    "What happens if...?" button in DecisionSessionPage.
    Appears after CEO synthesis. Dropdown to pick which path to simulate
    (from CEO's recommendation or from alternatives).
    Loading state while simulation runs (~3-5s Sonnet call).

- Update `DecisionSessionPage.tsx`:
    Add SimulationButton after SynthesisPanel.
    Add SimulationPanel below (visible when simulation complete).

**PATTERN:**
- Simulations use Sonnet (needs good reasoning) — ~$0.10 per simulation.
- Only available after CEO synthesis (needs persona + synthesis context).
- Each simulation is one LLM call with all context packed in.
- Results stored per-session for review later.
- If user has no project/people data, simulations are less specific (state this in output).

**DO NOT:**
- Build Monte Carlo or statistical simulations (LLM reasoning only)
- Run simulations automatically (user-triggered only, due to cost)
- Simulate more than one path at a time (one call per path)
- Store simulations as memories (they're session artifacts)

**VERIFY:**
- Simulation endpoint returns structured result
- All 3 simulation types produce output
- SimulationPanel renders correctly
- Loading state works while simulation runs
- Simulation reflects actual user data (goals, projects, people)
- `npx tsc --noEmit` clean

---

### TASK 5: DYNAMIC WIDGET SYSTEM

**GOAL:** Configurable dashboard. Users can choose which widgets to display,
reorder them, and configure widget-specific settings. Replaces the hardcoded
dashboard layout with a flexible grid.

**MUST READ FIRST:**
- `packages/boardroom-ai/client/src/pages/DashboardPage.tsx` (current hardcoded layout)
- `packages/boardroom-ai/client/src/stores/ui.store.ts` (current UI state)

**BUILD:**

- Add shared types:
    `packages/shared/src/types/widget.types.ts`
    ```typescript
    export type WidgetType =
      | 'goal_hierarchy'
      | 'calendar_strip'
      | 'proactive_questions'
      | 'weekly_memo'
      | 'cortex_insights'
      | 'recent_decisions'
      | 'outcome_reviews'
      | 'cognitive_load'
      | 'quick_take';        // mini decision input

    export interface WidgetConfig {
      id: string;
      type: WidgetType;
      position: number;      // 0-based order
      size: 'small' | 'medium' | 'large' | 'full';
      visible: boolean;
      settings: Record<string, unknown>;  // type-specific config
    }

    export interface DashboardLayout {
      userId: string;
      widgets: WidgetConfig[];
      updatedAt: Date;
    }

    export const DEFAULT_WIDGETS: WidgetConfig[] = [
      { id: 'w1', type: 'cognitive_load',       position: 0, size: 'full',   visible: true, settings: {} },
      { id: 'w2', type: 'proactive_questions',  position: 1, size: 'full',   visible: true, settings: {} },
      { id: 'w3', type: 'outcome_reviews',      position: 2, size: 'full',   visible: true, settings: {} },
      { id: 'w4', type: 'calendar_strip',       position: 3, size: 'full',   visible: true, settings: {} },
      { id: 'w5', type: 'weekly_memo',          position: 4, size: 'medium', visible: true, settings: {} },
      { id: 'w6', type: 'cortex_insights',      position: 5, size: 'medium', visible: true, settings: {} },
      { id: 'w7', type: 'goal_hierarchy',       position: 6, size: 'full',   visible: true, settings: {} },
    ];
    ```

- Store layout in UserProfile (extend the model):
    Add `dashboardLayout Json @default("[]")` to UserProfile in Prisma.
    Run migration.

- Persist layout via `PATCH /user-profile` (existing endpoint — no new route needed).

- `packages/boardroom-ai/client/src/components/dashboard/WidgetRenderer.tsx`
    Maps WidgetType → React component:
    ```typescript
    const WIDGET_MAP: Record<WidgetType, React.ComponentType<WidgetProps>> = {
      goal_hierarchy: GoalHierarchy,
      calendar_strip: WeekCalendarStrip,
      proactive_questions: ProactiveQuestions,
      weekly_memo: WeeklyMemoCard,
      cortex_insights: CortexInsightsPanel,
      recent_decisions: RecentDecisions,    // new
      outcome_reviews: OutcomeReviewBanner,
      cognitive_load: CognitiveLoadBanner,
      quick_take: QuickTakeWidget,          // new
    };
    ```
    Renders each widget in a container with consistent sizing based on `size` prop.
    Handles missing/erroring widgets gracefully (error boundary per widget).

- `packages/boardroom-ai/client/src/components/dashboard/DashboardConfigurator.tsx`
    Modal or slide-out panel for configuring the dashboard:
    - Toggle widgets on/off (checkboxes)
    - Reorder via up/down arrow buttons (no drag-and-drop library for v1)
    - Size selector per widget (small/medium/large/full)
    - Reset to default layout button
    Saves layout to UserProfile via API.

- `packages/boardroom-ai/client/src/components/dashboard/RecentDecisions.tsx`
    New widget: shows last 3-5 decision sessions as compact cards.
    Each card: question (truncated), mode badge, date, "View" link.

- `packages/boardroom-ai/client/src/components/dashboard/QuickTakeWidget.tsx`
    New widget: mini decision input. Single text field + "Quick Take" button.
    Creates a session in `quick-take` mode and dispatches immediately.
    Shows persona summary inline (condensed, not full cards).

- Refactor `DashboardPage.tsx`:
    Replace hardcoded component list with:
    ```tsx
    export default function DashboardPage() {
      const layout = useWidgetLayout(); // from ui.store or user profile
      return (
        <div>
          <button onClick={openConfigurator}>Customize Dashboard</button>
          {layout.filter(w => w.visible).sort((a, b) => a.position - b.position).map(widget => (
            <WidgetRenderer key={widget.id} config={widget} />
          ))}
          <DashboardConfigurator />
        </div>
      );
    }
    ```

- `packages/boardroom-ai/client/src/hooks/useWidgetLayout.ts`
    Hook that:
    1. Loads layout from UserProfile (via entities store or dedicated fetch)
    2. Falls back to DEFAULT_WIDGETS if no saved layout
    3. Provides `updateLayout(widgets)` method that persists via PATCH /user-profile
    4. Memoizes layout to avoid re-renders

- Update ui.store: add `configuratorOpen: boolean` state.

**PATTERN:**
- Default layout matches current hardcoded dashboard (no visual change for existing users).
- Layout persisted in UserProfile.dashboardLayout JSON field.
- Each widget is independently error-bounded (one crash doesn't take down dashboard).
- Max 8 widgets visible at once (performance guard).
- Reorder uses position numbers, not drag-and-drop (simpler for v1).

**DO NOT:**
- Add a drag-and-drop library (up/down arrows for v1)
- Allow users to create custom widget types (predefined types only)
- Build widget-specific settings UI (just on/off and size for v1)
- Remove any existing dashboard components (refactor into widgets)

**VERIFY:**
- Dashboard renders with default layout (matches current hardcoded appearance)
- Configurator toggles widgets on/off
- Reorder changes widget positions
- Layout persists across page refreshes
- QuickTakeWidget creates and shows a quick-take session
- RecentDecisions shows last 5 sessions
- `npx tsc --noEmit` clean

**>>> RUN /compact HERE BEFORE PROCEEDING <<<**

---

### TASK 6: RELATIONSHIP VISUALIZATION + ENHANCED MEMORY LINKING

**GOAL:** Visual map of people, projects, and how they connect. Force-directed
graph showing relationship strength, interaction frequency, and shared project
links. Plus enhanced cross-entity linking in the memory explorer.

**MUST READ FIRST:**
- `packages/boardroom-ai/client/src/pages/PeopleDirectoryPage.tsx` (current people view)
- `packages/boardroom-ai/client/src/components/memory/MemoryDetail.tsx` (current memory detail)
- `packages/shared/src/types/entities.types.ts` (Person, Goal, Project)
- `packages/omnimind-api/prisma/schema.prisma` (join tables: ProjectPersonLink, GoalProjectLink)

**BUILD:**

- Install `d3` as frontend dependency (specifically `d3-force`, `d3-selection`, `d3-zoom`).
    Use dynamic import to avoid bloating initial bundle.

- `packages/boardroom-ai/client/src/components/memory/RelationshipGraph.tsx`
    Force-directed graph using D3:
    - **Nodes:** People (circles, sized by importance), Projects (squares, sized by task count)
    - **Edges:** ProjectPersonLink connections, with width = interaction frequency
    - **Colors:** By domain (use existing persona/domain color scheme from Tailwind config)
    - **Interactions:** Click node → show detail panel. Hover → highlight connections.
      Zoom + pan. Double-click person → navigate to PersonCard.
    - **Layout:** Force simulation with charge, center, and link forces.
      Stabilizes after ~2 seconds.
    - **Gated:** Only renders if user has 3+ people entries (per spec).
      Below threshold: show "Add more people to see your relationship map."

- `packages/boardroom-ai/client/src/hooks/useRelationshipData.ts`
    Fetches and computes graph data:
    ```typescript
    interface GraphData {
      nodes: GraphNode[];
      edges: GraphEdge[];
    }
    interface GraphNode {
      id: string;
      type: 'person' | 'project';
      label: string;
      size: number;
      domain: string;
    }
    interface GraphEdge {
      source: string;
      target: string;
      weight: number;
    }
    ```
    Sources: people, projects, join table links.
    Computes edge weights from: shared project count + memory co-mentions.

- Add OmniMind endpoint: `GET /relationships/graph`
    Returns pre-computed graph data for the user:
    - All people + projects as nodes
    - ProjectPersonLink entries as edges
    - Memory co-mentions (people mentioned in same memory) as inferred edges
    - Weight = direct links × 2 + co-mentions × 1

- `packages/omnimind-api/src/services/relationship.service.ts`
    Computes the graph data server-side (keeps join table queries in OmniMind).

- BoardRoom proxy: `GET /relationships/graph`
- OmniMind client + API client: `getRelationshipGraph()`.

- Add RelationshipGraph to PeopleDirectoryPage:
    Tab view: "Directory" | "Relationship Map"
    Directory tab: existing people list.
    Map tab: RelationshipGraph component.

- **Enhanced memory linking** in MemoryDetail:
    - Show "Related Memories" section: fetch memories with shared tags or domain.
      Use existing `GET /memories?tags=...&domain=...` endpoint.
    - Show "Linked Entities" section: if memory has sourceRef pointing to a session,
      show the linked decision. If memory mentions a person name (simple string match),
      show person cards.
    - "Link to..." button: opens a picker to manually link memory to a person, goal, or project.
      Creates a MemoryEntityLink record in OmniMind.

- Add OmniMind routes for memory entity linking:
    `POST /memories/:id/links` — create link to person/goal/project
    `GET /memories/:id/links` — get all entity links for a memory
    `DELETE /memories/:id/links/:linkId` — remove link

- Add as WidgetType in widget.types.ts: `'relationship_map'`
    Add to WIDGET_MAP in WidgetRenderer (renders a compact version in dashboard).

**PATTERN:**
- D3 is dynamically imported (`import('d3-force')`) to avoid bundle bloat.
- Graph renders in a `<canvas>` or `<svg>` element with D3 managing the layout.
- Force simulation runs client-side (data comes pre-computed from server).
- 3-person minimum gate prevents empty/useless graphs.
- Memory linking uses existing MemoryEntityLink model (already in Prisma).

**DO NOT:**
- Use a heavy graph library (D3-force is sufficient)
- Build a full knowledge graph (this is visualization, not storage)
- Allow editing relationships from the graph view (navigate to entity for edits)
- Pre-compute graph on every memory write (compute on-demand when page loads)
- Include more than 50 nodes in the graph (paginate or filter if larger)

**VERIFY:**
- Graph renders with people + projects as nodes
- Edges correctly represent project links
- Click on node shows details
- Graph is gated behind 3+ people
- Memory linking creates/reads/deletes links correctly
- Related memories show in MemoryDetail
- D3 bundle loads only when graph is visible (dynamic import)
- `npx tsc --noEmit` clean

---

### TASK 7: API HUB V1 — EMAIL-TO-MEMORY INTEGRATION

**GOAL:** First external integration. Users connect their email (Gmail) and
the system can extract memories from important emails. This is the foundation
for the API Hub — a framework for ingesting external data into OmniMind.

**MUST READ FIRST:**
- `packages/boardroom-ai/server/src/services/google-calendar.service.ts` (Phase 3 OAuth pattern)
- `packages/omnimind-api/src/services/cortex-memo.service.ts` (how memos are generated)
- `docs/prompts/memory-extractor.system.md` (extraction prompt pattern)

**BUILD:**

- `packages/shared/src/types/integration.types.ts`
    ```typescript
    export type IntegrationType = 'gmail' | 'google_calendar';  // extensible

    export interface Integration {
      id: string;
      userId: string;
      type: IntegrationType;
      status: 'connected' | 'disconnected' | 'error';
      lastSyncAt: Date | null;
      config: Record<string, unknown>;   // type-specific config
      createdAt: Date;
      updatedAt: Date;
    }

    export interface EmailExtraction {
      emailId: string;
      subject: string;
      from: string;
      date: Date;
      proposedMemories: EmailMemoryProposal[];
    }

    export interface EmailMemoryProposal {
      title: string;
      content: string;
      domain: string;
      tags: string[];
      memoryClass: string;
      importance: number;
      linkedPeople: string[];   // names mentioned
    }
    ```
    Add Zod schemas.

- `packages/boardroom-ai/server/src/services/gmail.service.ts`
    Reuses the Google OAuth pattern from calendar service (same OAuthToken model,
    different scope: `https://www.googleapis.com/auth/gmail.readonly`).
    ```typescript
    class GmailService {
      // List recent important emails (filtered)
      async getRecentEmails(userId: string, maxResults?: number): Promise<EmailSummary[]>

      // Get full email content
      async getEmailContent(userId: string, emailId: string): Promise<EmailContent>

      // Extract memories from an email using Haiku
      async extractMemories(userId: string, emailId: string): Promise<EmailExtraction>

      // Check connection status
      getStatus(userId: string): Promise<Integration>

      // OAuth flow (reuse calendar pattern)
      getAuthUrl(userId: string): string
      handleCallback(userId: string, code: string): Promise<void>
      disconnect(userId: string): Promise<void>
    }
    ```
    OAuth reuses the same OAuthToken model (add `scope` differentiation).
    Email filtering: only process emails from the last 7 days, skip newsletters/promotions
    (filter by Gmail categories: PRIMARY and UPDATES only).

- Memory extraction from email uses the same Haiku-based extraction pattern
  as session-to-memory extraction:
    1. Fetch email content
    2. Call Haiku with extraction prompt
    3. Return proposed memories for user confirmation
    4. On confirmation, create memories via OmniMind

    Prompt template: `docs/prompts/email-extractor.system.md`
    ```
    You are analyzing an email to extract important information for the user's
    cognitive memory system. Extract: decisions mentioned, commitments made,
    people referenced, facts stated, deadlines mentioned.

    Return structured JSON array of memory proposals.
    Only extract information that would be valuable for future decision-making.
    Skip pleasantries, scheduling logistics, and boilerplate.
    ```

- BoardRoom routes: `packages/boardroom-ai/server/src/routes/integrations.routes.ts`
    ```
    GET  /integrations                   — list all integrations + status
    GET  /integrations/gmail/auth-url    — OAuth consent URL
    GET  /integrations/gmail/callback    — OAuth callback
    POST /integrations/gmail/disconnect  — disconnect
    GET  /integrations/gmail/emails      — list recent extractable emails
    POST /integrations/gmail/extract     — extract memories from email
    POST /integrations/gmail/confirm     — confirm proposed memories
    ```

- Update API client with integration methods.

- `packages/boardroom-ai/client/src/pages/IntegrationsPage.tsx`
    Integration hub showing all available connectors:
    - Gmail: Connect/Disconnect + status + "Scan Recent Emails" button
    - Google Calendar: already connected (from Phase 3), show status
    - Future: placeholder cards for "Coming Soon" (Slack, Notion, etc.)

- `packages/boardroom-ai/client/src/components/integrations/EmailScanner.tsx`
    Shows recent extractable emails. Each email: subject, from, date, "Extract" button.
    Extract → shows proposed memories → user confirms/edits/rejects → creates memories.
    Same propose-then-confirm pattern as onboarding and session extraction.

- `packages/boardroom-ai/client/src/components/integrations/IntegrationCard.tsx`
    Reusable card for each integration type:
    - Logo + name
    - Status badge (connected/disconnected)
    - Connect/Disconnect button
    - Last sync time

- Update routing: add `/integrations` route in App.tsx.
- Update Sidebar: add "Integrations" link (under Settings or as top-level).

- Add `integrations` as a WidgetType:
    Dashboard widget shows: "3 new emails with extractable insights" → "Review" link.

**PATTERN:**
- Email extraction is PROPOSE-THEN-CONFIRM (never auto-create memories from emails).
- Gmail OAuth reuses the OAuthToken model with different scope.
  Modify OAuthToken to support multiple scopes per provider, or create separate tokens
  for gmail vs calendar (separate `provider` values: 'google_calendar' vs 'gmail').
- Only scan PRIMARY and UPDATES Gmail categories (skip SOCIAL, PROMOTIONS, FORUMS).
- Max 20 emails per scan (recent 7 days).
- Each extraction uses one Haiku call (~$0.001) — cost-effective.
- The integration framework is extensible: IntegrationType union + IntegrationCard pattern
  make adding Slack, Notion, etc. straightforward in future phases.

**DO NOT:**
- Auto-scan emails on a schedule (user-triggered only for v1, cost + privacy)
- Store email content in OmniMind (only store extracted memories)
- Access email bodies without user triggering "Extract" (privacy)
- Send emails or modify Gmail state (read-only)
- Build Slack, Notion, or other integrations (Gmail only for v1)

**VERIFY:**
- Gmail OAuth connects (if credentials configured)
- Email list shows recent emails
- Extraction produces structured memory proposals
- Confirm creates memories in OmniMind
- IntegrationsPage shows correct status for all integrations
- Missing Google credentials gracefully hides Gmail integration
- `npx tsc --noEmit` clean
- Full build: `npm run build` succeeds

---

## EXECUTION INSTRUCTIONS

Begin with Task 1 now. Follow the protocol exactly. Do not skip validation.
Do not ask for permission between tasks unless you hit a STOP condition.
Report each task completion with the checkpoint format, then proceed.

Run `/compact` at the marked points (after Task 2 and after Task 5).

Record ADRs 011, 012, 013 in `docs/DECISIONS.md` before starting Task 1 implementation.

**New dependencies this phase:** `openai` (omnimind-api), `d3` / `d3-force` + `d3-selection` + `d3-zoom` (client)
Install each when its task begins. Don't install all upfront.

**Env vars this phase** (add to `.env.example`):
- `OPENAI_API_KEY` — already listed, used for embeddings now (was optional before)
- No new env vars — Phase 3 already added Google OAuth + Stripe vars.
  Gmail reuses Google OAuth credentials with different scope.

**Schema migrations this phase:**
- Task 1: `add-embedding-column` (vector(1536) on MemoryEntry + ivfflat index)
- Task 2: `add-custom-persona` (CustomPersona model)
- Task 5: `add-dashboard-layout` (dashboardLayout JSON on UserProfile)

Go.
