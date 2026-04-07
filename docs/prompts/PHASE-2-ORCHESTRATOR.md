# PHASE 2 BUILD ORCHESTRATOR — Executive Dashboard

> **Usage**: Paste this entire prompt into Claude Code (Opus) to execute Phase 2.
> **Prereqs**: Phase 0 (OmniMind API + retrieval) and Phase 1 (persona system + agent runtime) complete.
> **Last validated**: 2026-04-07 against actual codebase state.

---

Read .claude/CLAUDE.md, then read packages/boardroom-ai/CLAUDE.md,
then read docs/contracts/boardroom-api.contract.md,
then read docs/MASTER-FRAMEWORK.md section 5 (Dashboard & UX).

You are the BUILD ORCHESTRATOR for Phase 2 of the BoardRoom AI + OmniMind platform.
Phase 2 is the FRONTEND phase. You are building the executive dashboard —
the reason users pay for this product. This is NOT a chatbot skin.
It is an executive suite organized around OUTCOMES, not conversations.

You will execute Phase 2 as a sequential chain of build tasks. You will
NOT write application code yourself. You will delegate ALL implementation
to subagents and ALL validation to separate subagent validators.

## WHAT ALREADY EXISTS (DO NOT REBUILD)

**packages/shared/src/** — All types, validation schemas, constants, utils (complete)

**packages/omnimind-api/** — Full Express server with:
- Memory CRUD + sync validation pipeline
- Entity CRUD (people, goals, projects, tasks, decisions, commitments, user-profile)
- Hybrid retrieval engine + context assembler
- All endpoints per docs/contracts/omnimind-api.contract.md

**packages/boardroom-ai/server/** — Full Express server with:
- OmniMind client (`services/omnimind-client.ts`)
- Agent runtime (`agents/agent.ts`, `agents/orchestrator.ts`)
- Persona dispatch + CEO synthesis (SSE streaming)
- Sufficiency scoring, mode routing, prompt loading
- Auth routes (register, login, logout, me)
- Session routes (create, dispatch, synthesize, questionnaire, plan, export)
- Session-to-memory extraction pipeline
- Commitment tracker, export service
- Rate limiter, prompt cache, cost tracker

**packages/boardroom-ai/client/** — Minimal scaffold:
- `App.tsx` — placeholder with title card
- `main.tsx` — React 19 entry point
- `index.css` — Tailwind imports
- `vite.config.ts` — Vite with `/api` proxy to localhost:3001
- `tailwind.config.ts` — basic Tailwind config
- Empty directories: `components/`, `pages/`, `hooks/`, `stores/`, `lib/`
  Subdirs exist: `components/dashboard/`, `components/decision/`,
  `components/memory/`, `components/onboarding/`, `components/shared/`

## TECH STACK FOR THIS PHASE

- React 19 + TypeScript
- Tailwind CSS 3.4 (utility classes only, no custom CSS unless necessary)
- Zustand 5.0 for state management
- Vite 6.1 for build/dev
- Native `fetch` for API calls (no axios)
- `EventSource` or manual SSE parsing for streaming
- No additional UI libraries unless explicitly specified (no MUI, no Chakra)
- Dark theme: `bg-gray-950` base (matches existing App.tsx)

## CONVENTIONS

- Functional components only (no class components)
- Named exports for components, default exports for pages
- `use` prefix for all custom hooks
- Zustand stores: one file per domain (session, ui, entities, auth)
- API calls go through typed client functions in `lib/api.ts`, never raw fetch in components
- All data from OmniMind flows through BoardRoom server — client NEVER calls OmniMind directly
- Loading states, error states, and empty states for every data-fetching component
- Responsive: mobile-first, but desktop is the primary target

---

## PROTOCOL

Same as Phase 0/1. For each task:

### STEP 1 — BRIEF
Read task spec + MUST READ FIRST files. Prepare delegation briefing.

### STEP 2 — BUILD (Subagent: builder)
Delegate with full briefing. Builder creates/modifies ONLY specified files.
Runs `npx tsc --noEmit` before finishing. Runs any tests.

### STEP 3 — VALIDATE (Single combined validator subagent, read-only)

**A. Type & Build Compliance:**
- `npx tsc --noEmit` passes clean (both server and client tsconfigs)
- All data types imported from `@boardroom/shared`
- All API response parsing uses Zod schemas
- No `any` types without justification

**B. Contract Compliance:**
- API calls match `docs/contracts/boardroom-api.contract.md` exactly
- Data shapes match shared types
- Auth token handling matches contract (httpOnly cookie, no localStorage)
- SSE event parsing matches contract format

**C. UI & Pattern Consistency:**
- Tailwind only (no inline styles, no CSS modules unless justified)
- Dark theme consistent (`bg-gray-950`, `text-white`, `text-gray-400`)
- Loading/error/empty states present
- Component files are <200 lines (split if larger)
- Zustand stores follow established patterns

### STEP 4 — VERDICT
PASS → commit. FAIL → re-deploy builder with corrections (max 2 cycles).

### STEP 5 — CHECKPOINT
Report files, validator findings, warnings. Proceed.

---

## CONTEXT MANAGEMENT

- Run `/compact` after completing Task 3 (before Decision Lab)
- Run `/compact` again after completing Task 6 (before Cold Start Wizard)

---

## STOP CONDITIONS

Pause and report if:
- A validator fails 2 correction cycles
- A UI pattern requires a new npm dependency not in package.json
- Client-side routing approach needs a decision (react-router vs file-based)
- An API endpoint from Phase 0/1 doesn't exist or returns unexpected shapes
- Component complexity exceeds 200 lines with no clear split

---

## DESIGN DECISION: ROUTING

Before Task 1, the builder must decide on client-side routing.
Use `react-router-dom` v7 (add as dependency).

Routes:
```
/                    → Dashboard (home)
/decisions           → Decision Lab (session list)
/decisions/:id       → Active decision session
/memory              → Memory Explorer
/people              → People Directory
/settings            → User Settings
/onboarding          → Cold Start Wizard (first-time only)
/login               → Auth (login/register)
```

---

## TASK SEQUENCE

Execute in EXACT order. Do not skip. Do not parallelize.

---

### TASK 1: FOUNDATION — ROUTING, LAYOUT, API CLIENT, STORES

**GOAL:** The app shell. Routing, sidebar navigation, API client,
auth state, and Zustand stores. After this task, you can navigate
between empty pages with a working sidebar.

**MUST READ FIRST:**
- `packages/boardroom-ai/client/src/App.tsx` (current placeholder)
- `packages/boardroom-ai/CLAUDE.md` (frontend section)
- `docs/contracts/boardroom-api.contract.md` (auth endpoints)
- `packages/shared/src/types/api.types.ts`

**BUILD:**

- `packages/boardroom-ai/client/src/lib/api.ts`
    Typed API client. Every function calls BoardRoom server (NOT OmniMind).
    ```typescript
    // Auth
    login(email, password): Promise<{ userId, name }>
    register(email, password, name): Promise<{ userId, name }>
    logout(): Promise<void>
    getMe(): Promise<{ userId, email, name }>

    // Sessions
    createSession(question, mode): Promise<SessionResponse>
    getSession(id): Promise<SessionResponse>
    listSessions(limit?, offset?): Promise<PaginatedResponse<SessionSummary>>
    dispatchPersonas(sessionId): EventSource  // SSE
    synthesize(sessionId): EventSource        // SSE

    // Entities (proxied through BoardRoom to OmniMind)
    getGoals(filters?): Promise<PaginatedResponse<Goal>>
    getProjects(filters?): Promise<PaginatedResponse<Project>>
    getTasks(filters?): Promise<PaginatedResponse<Task>>
    getPeople(filters?): Promise<PaginatedResponse<Person>>
    getDecisions(filters?): Promise<PaginatedResponse<Decision>>
    getCommitments(filters?): Promise<PaginatedResponse<Commitment>>
    getUserProfile(): Promise<UserProfile>

    // Mutations
    createGoal(input): Promise<Goal>
    updateGoal(id, input): Promise<Goal>
    deleteGoal(id): Promise<void>
    // ... same pattern for projects, tasks, people, decisions, commitments
    ```
    Uses `fetch` with `credentials: 'include'` for cookies.
    Base URL from Vite proxy (`/api`).
    All responses typed with shared types.
    Error handling: throw typed errors matching contract error shapes.

- `packages/boardroom-ai/client/src/stores/auth.store.ts`
    ```typescript
    interface AuthState {
      user: { userId: string, email: string, name: string } | null
      isAuthenticated: boolean
      isLoading: boolean
      login(email, password): Promise<void>
      register(email, password, name): Promise<void>
      logout(): Promise<void>
      checkAuth(): Promise<void>  // calls getMe() on app load
    }
    ```

- `packages/boardroom-ai/client/src/stores/entities.store.ts`
    ```typescript
    interface EntitiesState {
      goals: Goal[]
      projects: Project[]
      tasks: Task[]
      people: Person[]
      decisions: Decision[]
      commitments: Commitment[]
      isLoading: boolean
      fetchGoals(): Promise<void>
      fetchProjects(): Promise<void>
      // ... same pattern
      createGoal(input): Promise<Goal>
      updateGoal(id, input): Promise<Goal>
      deleteGoal(id): Promise<void>
      // ... same pattern for all entities
    }
    ```

- `packages/boardroom-ai/client/src/stores/ui.store.ts`
    ```typescript
    interface UIState {
      sidebarCollapsed: boolean
      toggleSidebar(): void
      activeModal: string | null
      openModal(id: string): void
      closeModal(): void
    }
    ```

- `packages/boardroom-ai/client/src/components/shared/Sidebar.tsx`
    Navigation sidebar matching MASTER-FRAMEWORK layout:
    - BoardRoom AI logo/title
    - Dashboard (home)
    - Decision Lab
    - Memory section (Explorer, People)
    - Settings
    Active link highlighting. Collapsible on mobile.

- `packages/boardroom-ai/client/src/components/shared/Layout.tsx`
    App shell: sidebar + main content area.
    Wraps all authenticated pages.

- `packages/boardroom-ai/client/src/pages/LoginPage.tsx`
    Login form + register toggle. Calls auth.store.

- `packages/boardroom-ai/client/src/pages/DashboardPage.tsx`
    Placeholder: "Dashboard — Coming in Task 2"

- `packages/boardroom-ai/client/src/pages/DecisionLabPage.tsx`
    Placeholder: "Decision Lab — Coming in Task 4"

- `packages/boardroom-ai/client/src/pages/MemoryExplorerPage.tsx`
    Placeholder: "Memory Explorer — Coming in Task 5"

- `packages/boardroom-ai/client/src/pages/PeopleDirectoryPage.tsx`
    Placeholder: "People Directory — Coming in Task 5"

- `packages/boardroom-ai/client/src/pages/SettingsPage.tsx`
    Placeholder: "Settings — Coming in Task 7"

- Update `App.tsx` with react-router:
    Protected routes (redirect to /login if not authenticated).
    Layout wrapper for authenticated routes.
    Auth check on mount via `checkAuth()`.

- Install `react-router-dom` as dependency.

**DO NOT:**
- Build any actual page content (just placeholders)
- Add any UI library beyond Tailwind
- Call OmniMind directly from client

**VERIFY:**
- `npx tsc --noEmit` clean
- App renders, sidebar navigation works between placeholder pages
- Login/register form submits correctly (if server running)

---

### TASK 2: GOALS / PROJECTS / TASKS HIERARCHY

**GOAL:** The core value prop UI. Nested tree view: Goals → Projects → Tasks.
Full CRUD inline. This is Feature 1 from the dashboard spec.

**MUST READ FIRST:**
- `docs/MASTER-FRAMEWORK.md` Section 5 (Goals/Projects/Tasks layout diagram)
- `docs/contracts/omnimind-api.contract.md` (entity endpoints)
- `packages/shared/src/types/entities.types.ts`
- `packages/shared/src/validation/entities.schema.ts`

**BUILD:**

- `packages/boardroom-ai/client/src/components/dashboard/GoalHierarchy.tsx`
    Main container. Fetches goals from entities store.
    Renders goals as expandable tree nodes.
    Each goal shows: title, level badge (L0-L3), status, deadline, domain.
    Expand to reveal child goals and linked projects.

- `packages/boardroom-ai/client/src/components/dashboard/GoalNode.tsx`
    Single goal row. Expandable. Shows child goals + projects.
    Inline edit: click title to edit. Click status to cycle.
    Delete button (with confirm).
    "Add Project" button at bottom of expanded section.

- `packages/boardroom-ai/client/src/components/dashboard/ProjectNode.tsx`
    Single project row under a goal. Expandable to show tasks.
    Shows: title, status, deadline, domain, task count.
    Inline edit for title, status, deadline.
    "Add Task" button at bottom.

- `packages/boardroom-ai/client/src/components/dashboard/TaskNode.tsx`
    Single task row under a project.
    Shows: title, status (checkbox-style), owner, deadline, priority.
    Inline edit. Click checkbox to toggle done/pending.

- `packages/boardroom-ai/client/src/components/dashboard/EntityForm.tsx`
    Reusable form component for creating goals/projects/tasks.
    Validates with Zod schemas from shared.
    Renders as modal or inline form (configurable).
    Fields adapt based on entity type.

- `packages/boardroom-ai/client/src/hooks/useEntityCRUD.ts`
    Hook wrapping entities store CRUD operations.
    Returns `{ items, isLoading, create, update, delete, refresh }`.
    Typed generically: `useEntityCRUD<Goal>('goals')`.

- Update `DashboardPage.tsx`:
    Renders `GoalHierarchy` as the primary content.
    "Add Goal" button in header.
    Shows empty state if no goals: "No goals yet. Create your first goal."

**PATTERN:**
- Tree is 3 levels max: Goal → Project → Task
- Relationships are via join tables (GoalProjectLink, ProjectTaskLink).
  The API returns linked items via `?include=children` or `?include=tasks`.
  If those params don't exist yet on the BoardRoom server, add proxy
  routes that call OmniMind with the right params.
- All mutations optimistically update the store, then sync with server.
- Validation on client side with Zod before submitting.

**DO NOT:**
- Implement drag-and-drop reordering (defer to polish phase)
- Build goal analytics or progress tracking
- Add goal-to-goal linking UI (parent goal selection is a simple dropdown)

**VERIFY:**
- `npx tsc --noEmit` clean
- Hierarchy renders with test data (if server running with seed data)
- CRUD operations work: create goal → add project → add task → toggle task done
- Empty state renders correctly
- Loading state shows spinner/skeleton

---

### TASK 3: CALENDAR STRIP + PROACTIVE QUESTIONS

**GOAL:** Calendar strip showing deadlines + proactive agent questions.
Features 2 and 3 from the dashboard spec.

**MUST READ FIRST:**
- `docs/MASTER-FRAMEWORK.md` Section 5 (Calendar Strip + Proactive Questions specs)
- `packages/shared/src/utils/temporal.ts` (isOverdue, daysUntil)

**BUILD:**

- `packages/boardroom-ai/client/src/components/dashboard/WeekCalendarStrip.tsx`
    7-column horizontal strip showing current week (Mon-Sun).
    Today highlighted. Each day shows:
    - Day name + date number
    - Task/deadline count badge
    - First 2-3 items as compact cards (title only, truncated)
    - "Show all" link if more than 3 items
    Data: fetch tasks + commitments with deadlines in the visible week range.
    Navigate: prev/next week arrows.

- `packages/boardroom-ai/client/src/components/dashboard/DayColumn.tsx`
    Single day in the calendar strip.
    Shows deadline items as compact cards.
    Click to expand to full day view (modal or inline).
    Overdue items highlighted in red/amber.

- `packages/boardroom-ai/client/src/components/dashboard/ProactiveQuestions.tsx`
    Card/banner that appears at dashboard load.
    Shows 1-3 gap detection questions:
    - "Project X has no deadline set" → [Set Deadline] [Skip]
    - "Sarah mentioned in 3 sessions but not in people directory" → [Add] [Skip]
    - "Goal Y has no success metrics" → [Define] [Skip]
    Dismissible per-item. Remembers dismissed items in session.

    Data source: call a new BoardRoom server endpoint or compute client-side
    from entities store (check for missing deadlines, empty successMetrics, etc.).
    For v1: compute client-side from entities store. No LLM call needed.

- `packages/boardroom-ai/client/src/hooks/useProactiveQuestions.ts`
    Scans entities store for:
    - Projects/tasks with no deadline
    - Goals with empty successMetrics
    - Overdue commitments
    Returns array of `{ type, message, entityId, entityType, actions }`.
    Caps at 3 questions per session (intervention budget).

- Update `DashboardPage.tsx`:
    Layout: ProactiveQuestions (top) → WeekCalendarStrip → GoalHierarchy.
    ProactiveQuestions only shows if there are items. No empty card.

**PATTERN:**
- Calendar is date-range based (fetch tasks/commitments with deadlines in range)
- Proactive questions are computed client-side from existing data (no LLM)
- Intervention budget: max 3 questions, tracked in Zustand ui store
- All dates use temporal utils from shared

**DO NOT:**
- Implement Google Calendar integration (Phase 3)
- Implement iCal import
- Make LLM calls for proactive questions (client-side heuristics only)

**VERIFY:**
- Calendar renders current week with correct dates
- Deadlines appear on correct days
- Overdue items are visually distinct
- Proactive questions appear when data has gaps
- Dismissed questions don't reappear in same session

**>>> RUN /compact HERE BEFORE PROCEEDING <<<**

---

### TASK 4: DECISION LAB — SESSION CREATION + PERSONA STREAMING

**GOAL:** The core interaction UI. Create a decision, see personas
stream in, trigger CEO synthesis. This is where the product magic lives.

**MUST READ FIRST:**
- `docs/contracts/boardroom-api.contract.md` (sessions, dispatch, synthesize SSE formats)
- `packages/shared/src/types/persona.types.ts`
- `packages/shared/src/types/modes.types.ts` (MODE_CONFIGS)

**BUILD:**

- `packages/boardroom-ai/client/src/stores/session.store.ts`
    ```typescript
    interface SessionState {
      currentSession: SessionResponse | null
      personaResponses: Record<PersonaId, PersonaResponse>
      synthesis: SynthesisReport | null
      streamingPersonas: Set<PersonaId>  // currently streaming
      isDispatching: boolean
      isSynthesizing: boolean
      sufficiency: SufficiencyScore | null

      createSession(question, mode): Promise<void>
      dispatch(): void               // fires SSE, updates as events arrive
      synthesize(): void              // fires CEO SSE
      checkAmbiguity(): Promise<void>
      reset(): void
    }
    ```

- `packages/boardroom-ai/client/src/hooks/useSSE.ts`
    Generic SSE hook. Connects to an EventSource URL.
    Parses `data: {...}\n\n` events.
    Returns `{ data, isConnected, error, close }`.
    Handles reconnection on disconnect.
    Typed: `useSSE<T>(url: string)`.

- `packages/boardroom-ai/client/src/pages/DecisionLabPage.tsx`
    Session list view. Shows recent sessions as cards.
    "New Decision" button → opens creation flow.

- `packages/boardroom-ai/client/src/pages/DecisionSessionPage.tsx`
    Active session view. Three phases:

    **Phase 1 — Input:**
    Question input (textarea). Mode selector (6 modes as buttons/chips).
    Mode descriptions from MODE_CONFIGS.
    "Analyze" button → creates session + dispatches.
    Optional: "Check Clarity" button → runs sufficiency check first.

    **Phase 2 — Personas Streaming:**
    Grid/column layout showing each persona streaming in.
    Each persona card: name, model badge, streaming text, status (streaming/complete/error).
    All stream simultaneously. Cards fill as deltas arrive.
    Once all complete: "Synthesize" button appears.

    **Phase 3 — Synthesis:**
    CEO synthesis streams in below/above persona cards.
    Structured display: Disagreement Map, Recommendation, Next Actions, Risks.
    "Plan This" button → fires Doer.
    "Export" button → downloads JSON.

- `packages/boardroom-ai/client/src/components/decision/PersonaCard.tsx`
    Single persona response card.
    Shows: persona name, model badge (haiku/sonnet), confidence score.
    Streaming state: animated cursor/dots while streaming.
    Complete state: full response with expandable sections.
    Sections: Situation Reading, Key Assumptions, Analysis, Recommendation,
    Uncertainties, Sources.

- `packages/boardroom-ai/client/src/components/decision/SynthesisPanel.tsx`
    CEO synthesis display.
    Structured: Disagreement Map, Decisive Tradeoff, Recommendation,
    Next 3 Actions, Top Risks, Assumptions to Monitor.
    Each section collapsible. Actions are checkable.

- `packages/boardroom-ai/client/src/components/decision/ModeSelector.tsx`
    Visual mode picker. Shows all 6 modes as cards with icon + description.
    Selected mode highlighted. Maps to MODE_CONFIGS from shared types.

- `packages/boardroom-ai/client/src/components/decision/SufficiencyBanner.tsx`
    Shows after ambiguity check. Displays:
    - Score (visual meter)
    - Assumptions (editable)
    - Suggested questions (if mode 3-4)
    - "Proceed anyway" or "Answer questions" options

**PATTERN:**
- SSE parsing follows the contract event types exactly:
  `persona_start`, `delta`, `persona_complete`, `dispatch_complete`,
  `synthesis_start`, `synthesis_complete`
- Persona cards update reactively as store updates
- Session state persists in Zustand (survives page navigation, not page refresh)
- Mode selector uses MODE_CONFIGS — don't hardcode mode lists

**DO NOT:**
- Build the Questionnaire answer flow UI (stub "Coming soon")
- Build the Doer task creation UI (stub — log to console)
- Build memory extraction confirmation UI (Phase 2 Task 6 or defer)
- Add animation libraries

**VERIFY:**
- Session creation works end-to-end (if servers running)
- Persona cards stream text in real-time
- CEO synthesis renders with all 7 sections
- Mode selector shows all 6 modes with correct descriptions
- Error states handled (persona failure shows error, others continue)

---

### TASK 5: MEMORY EXPLORER + PEOPLE DIRECTORY

**GOAL:** Browse, search, and manage memories. View people and relationships.

**MUST READ FIRST:**
- `docs/contracts/omnimind-api.contract.md` (memories search, people endpoints)
- `packages/shared/src/types/memory.types.ts`
- `packages/shared/src/types/entities.types.ts` (Person)

**BUILD:**

- `packages/boardroom-ai/client/src/pages/MemoryExplorerPage.tsx`
    Two-panel layout:
    Left: search + filter bar + memory list.
    Right: selected memory detail view.

- `packages/boardroom-ai/client/src/components/memory/MemorySearch.tsx`
    Search bar with filters:
    - Text search (q param)
    - Domain filter (dropdown)
    - Memory class filter (WORKING/EPISODIC/SEMANTIC/DECISION)
    - Status filter
    - Date range (since)
    - Sort by (createdAt, importance, updatedAt)

- `packages/boardroom-ai/client/src/components/memory/MemoryList.tsx`
    Scrollable list of memory cards. Paginated (load more on scroll).
    Each card shows: title, domain badge, tags, confidence, importance,
    memory class, created date, status badge.
    Click to select → shows detail in right panel.

- `packages/boardroom-ai/client/src/components/memory/MemoryDetail.tsx`
    Full memory view. All fields displayed.
    Edit button → inline edit mode.
    Delete button → archive (soft delete).
    Shows linked entities (if any).
    Shows decision lineage: "Created during session X" (if sourceRef set).

- `packages/boardroom-ai/client/src/pages/PeopleDirectoryPage.tsx`
    Grid/list of people. Search bar.
    Each person card: name, role, domains, importance, last contact.
    Click to expand: full detail, notes, linked projects, interaction history.
    "Add Person" button.

- `packages/boardroom-ai/client/src/components/memory/PersonCard.tsx`
    Person display card for directory.

- `packages/boardroom-ai/client/src/stores/memory.store.ts`
    ```typescript
    interface MemoryState {
      memories: Memory[]
      selectedMemory: Memory | null
      searchFilters: MemorySearchFilters
      isLoading: boolean
      total: number
      search(filters): Promise<void>
      select(id): void
      updateMemory(id, input): Promise<void>
      archiveMemory(id): Promise<void>
    }
    ```

**PATTERN:**
- Memory search debounced (300ms after last keystroke)
- Pagination via offset/limit (not cursor)
- Domain badges use consistent colors
- Memory class uses distinct icons/colors
- People directory reuses entities store

**DO NOT:**
- Build memory creation UI (memories come from extraction pipeline)
- Build relationship graph visualization (Phase 3)
- Implement memory analytics or stats

**VERIFY:**
- Memory search returns results matching query
- Filters work in combination
- Memory detail shows all fields
- Edit + archive work
- People directory renders with CRUD
- Empty states for all views

---

### TASK 6: ONBOARDING — COLD START WIZARD

**GOAL:** 5-minute Cold Start Wizard that seeds 15-20 memory items
from a structured interview. First-time user experience.

**MUST READ FIRST:**
- `docs/MASTER-FRAMEWORK.md` Section 5 (Cold Start Wizard reference)
- `docs/MASTER-FRAMEWORK.md` Section 10 (Week 5 deliverable)

**BUILD:**

- `packages/boardroom-ai/client/src/pages/OnboardingPage.tsx`
    Multi-step wizard. 5 steps, ~1 minute each.
    Progress bar at top. Back/Next/Skip buttons.
    Redirects here on first login (if no memories exist).

- `packages/boardroom-ai/client/src/components/onboarding/WizardStep.tsx`
    Reusable step container. Title, description, input area, navigation.

- `packages/boardroom-ai/client/src/components/onboarding/steps/`

    **Step 1 — About You:**
    Role, industry, decision frequency.
    Seeds: UserProfile via PATCH /user-profile.

    **Step 2 — Your Goals:**
    "What are you working toward?" Freeform text → parsed into 2-3 goals.
    Uses Haiku to extract structured goals from natural language.
    User confirms/edits before saving.
    Seeds: 2-3 Goal entities.

    **Step 3 — Your Projects:**
    "What projects are you actively working on?"
    Freeform → parsed into projects linked to goals from Step 2.
    Seeds: 2-3 Project entities.

    **Step 4 — Key People:**
    "Who are the key people in your work life?"
    Name + role + relationship fields.
    Seeds: 3-5 Person entities.

    **Step 5 — Your Context:**
    "What's the most important decision you're facing right now?"
    "What keeps you up at night about your work?"
    Freeform → extracted as memories (domain: personal, class: SEMANTIC).
    Seeds: 5-8 Memory entries.

- `packages/boardroom-ai/client/src/hooks/useOnboarding.ts`
    Manages wizard state: current step, collected data, submission status.
    Calls BoardRoom server to create entities and memories.
    Tracks completion in UserProfile (flag: onboardingComplete).

- `packages/boardroom-ai/server/src/routes/onboarding.routes.ts`
    `POST /onboarding/extract-goals` — Haiku call to parse goals from text
    `POST /onboarding/extract-projects` — Haiku call to parse projects
    `POST /onboarding/extract-memories` — Haiku call to extract memories
    `POST /onboarding/complete` — marks onboarding done on user profile

    Each extraction endpoint: takes freeform text, returns structured entities
    for user confirmation. Uses memory-extractor prompt pattern.

- Mount onboarding routes in BoardRoom server index.ts.

- Update `App.tsx` routing:
    If user is authenticated but `!onboardingComplete`, redirect to /onboarding.

**PATTERN:**
- Wizard is linear (no skip-ahead to later steps)
- Each step saves independently (user can close mid-wizard and resume)
- LLM extraction is propose-then-confirm (same pattern as memory extraction)
- All created entities go through normal OmniMind validation pipeline
- Minimum viable: 15 items seeded (2 goals + 2 projects + 3 people + 8 memories)

**DO NOT:**
- Make the wizard optional for existing users with data
- Build a "re-run wizard" feature
- Add complex NLP beyond simple Haiku extraction

**VERIFY:**
- Wizard completes end-to-end (5 steps)
- Entities created in OmniMind after confirmation
- Dashboard shows seeded data after wizard completion
- Subsequent logins skip wizard (onboardingComplete flag)

**>>> RUN /compact HERE BEFORE PROCEEDING <<<**

---

### TASK 7: SETTINGS + POLISH + VISUAL CONSISTENCY PASS

**GOAL:** Settings page, visual polish, and consistency sweep.
This is the last task before public beta.

**MUST READ FIRST:**
- `packages/shared/src/types/user-profile.types.ts`
- All pages created in Tasks 1-6

**BUILD:**

- `packages/boardroom-ai/client/src/pages/SettingsPage.tsx`
    Sections:
    - **Profile:** Name, email, role, industry (editable via user-profile endpoint)
    - **Preferences:** Risk profile sliders (financial, technical, people, strategic 0-1)
    - **Values:** Value hierarchy (reorderable list of strings)
    - **Account:** Change password, logout, delete account (stub the dangerous ones)

- `packages/boardroom-ai/client/src/components/shared/LoadingSpinner.tsx`
    Consistent loading indicator used across all pages.

- `packages/boardroom-ai/client/src/components/shared/EmptyState.tsx`
    Reusable empty state: icon + message + optional action button.
    Used when: no goals, no memories, no sessions, no people.

- `packages/boardroom-ai/client/src/components/shared/ErrorBanner.tsx`
    Reusable error display. Shows API errors in a dismissible banner.

- `packages/boardroom-ai/client/src/components/shared/Modal.tsx`
    Reusable modal wrapper. Used for entity creation, confirmations.

- **Visual Consistency Sweep** (builder reviews all pages):
    - Consistent spacing (Tailwind spacing scale)
    - Consistent text hierarchy (`text-4xl` for page titles, `text-lg` for section heads)
    - Consistent color usage (status badges, domain badges, persona colors)
    - All interactive elements have hover/focus states
    - All buttons have consistent sizing and styling
    - Dark theme throughout (no white backgrounds leaking through)

- **Error Boundary:**
    `packages/boardroom-ai/client/src/components/shared/ErrorBoundary.tsx`
    Catches React render errors. Shows friendly error message.
    Wraps the root app.

- Update `tailwind.config.ts`:
    Add custom colors for: persona colors, status colors, domain colors.
    Define them as CSS variables for consistency.

**DO NOT:**
- Add animations or transitions beyond Tailwind defaults
- Redesign any working page
- Add new features not in the spec

**VERIFY:**
- Settings page renders and saves changes
- All shared components used consistently across pages
- No visual inconsistencies (run through each page)
- Error boundary catches thrown errors gracefully
- `npx tsc --noEmit` clean for entire workspace
- `npm run build` produces a production build without errors

---

## EXECUTION INSTRUCTIONS

Begin with Task 1 now. Follow the protocol exactly. Do not skip validation.
Do not ask for permission between tasks unless you hit a STOP condition.
Report each task completion with the checkpoint format, then proceed.

Run `/compact` at the marked points (after Task 3 and after Task 6).

**Note on frontend testing:** Unit tests for React components are OPTIONAL
in this phase. The validator should focus on TypeScript compilation, visual
consistency, and contract compliance. If the builder wants to add tests
with Vitest + React Testing Library, great — but don't block on test coverage.
The eval suite from Phase 1 covers the backend integration.

Go.
