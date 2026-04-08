# FRONTEND POLISH ORCHESTRATOR — Pre-Launch UI Hardening

> **Usage**: Paste into Claude Code (Opus). Fresh session.
> **Purpose**: Fix all frontend issues from audits + comprehensive UX polish.
> **Duration**: ~5-6 hours. Modifies client code only (no server changes).
> **Scope**: Error/loading states, type safety, duplicate types, D3 typing,
>   store hardening, onboarding persistence, code splitting, heading consistency.

---

Read .claude/CLAUDE.md first. You are the FRONTEND POLISH AGENT.

**Protocol per task:**
1. BRIEF: State what you're fixing, which files.
2. BUILD: Write the code. Match existing Tailwind patterns (gray-950 background,
   gray-900 cards, blue-600 accents, text-white/gray-400 text).
3. VALIDATE: `npm run typecheck` in boardroom-ai after each task.

**Commit after EACH task.** Message format:
`fix(frontend): description — FE-POLISH-{N}`

**Stop conditions:**
- TypeScript won't compile → revert, move to next task
- Never delete working components. Extend, don't replace.
- Don't change server code. This is client-only.

---

## CONTEXT: Frontend Architecture

**92 files** in `packages/boardroom-ai/client/src/`:
- 10 pages, 46 components, 6 Zustand stores, 7 hooks, 1 API client (715 lines)
- All dark theme: gray-950/900 backgrounds, no light mode
- Tailwind CSS only, no CSS modules or styled-components
- Types from `@boardroom/shared` (already imported for entities, personas, cortex, etc.)
- SSE streaming via async generator in api.ts, consumed in session.store.ts
- D3 dynamically imported in RelationshipGraph.tsx (d3-force, d3-selection, d3-zoom)
- Zustand stores: auth (has error), session (has error), entities (NO error),
  memory (NO error), cortex (NO error), ui (no API calls)

**Shared UI components already exist:**
- `LoadingSpinner.tsx` — animated spinner (sm/md/lg)
- `ErrorBanner.tsx` — dismissible error banner
- `EmptyState.tsx` — empty state with icon
- `ErrorBoundary.tsx` — React error boundary
- `Modal.tsx` — generic modal

---

## TASK 1: Add Error State to Stores (entities, memory, cortex)

**Problem:** 3 stores handle API calls but have no error state. When APIs fail,
the UI shows nothing — no error message, no retry option. Users think the app
is broken or empty.

### 1a. `packages/boardroom-ai/client/src/stores/entities.store.ts`

Add `error: string | null` and `clearError()` to the state interface.
Wrap ALL API calls in try/catch. On catch, set error message.
On successful fetch, clear error.

```typescript
interface EntitiesState {
  // ... existing fields ...
  error: string | null;
  clearError: () => void;
  // ... existing methods ...
}

// In each method:
fetchGoals: async () => {
  try {
    set({ isLoading: true, error: null });
    const goals = await api.listGoals();
    set({ goals, isLoading: false });
  } catch (err) {
    set({ error: (err as Error).message, isLoading: false });
  }
},
```

Apply same pattern to ALL create/update/delete methods. On mutation failure,
set error but don't clear the existing data (user can still see what they had).

### 1b. `packages/boardroom-ai/client/src/stores/memory.store.ts`

Same pattern. Add `error: string | null`. Replace console.error calls with
`set({ error: message })`. Clear error on successful operations.

### 1c. `packages/boardroom-ai/client/src/stores/cortex.store.ts`

Same pattern. Has 5 loading flags but no error tracking. Add `error: string | null`.
Wrap `fetchMemo`, `fetchPatterns`, `fetchContradictions`, `generateMemo`,
`scanContradictions` in try/catch.

**Validate:** `npm run typecheck`.

---

## TASK 2: Wire Error States Into Pages

**Problem:** Even after Task 1, pages need to display the error state.

### 2a. `DashboardPage.tsx`

Import `ErrorBanner` from shared components. After the loading check, add:
```tsx
const { error: entitiesError, clearError: clearEntitiesError } = useEntitiesStore();
const { error: cortexError, clearError: clearCortexError } = useCortexStore();

// After loading spinner, before widget grid:
{(entitiesError || cortexError) && (
  <ErrorBanner
    message={entitiesError || cortexError || ''}
    onDismiss={() => { clearEntitiesError(); clearCortexError(); }}
  />
)}
```

### 2b. `MemoryExplorerPage.tsx`

Wire memory store error into the page layout:
```tsx
const { error, clearError } = useMemoryStore();
// Add ErrorBanner above the 2-column layout
```

### 2c. `PeopleDirectoryPage.tsx`

Wire entities store error. Also add a loading state for the directory tab
(currently only the map tab has loading):
```tsx
const { isLoading, error, clearError } = useEntitiesStore();

// Directory tab — before the people grid:
{isLoading && <LoadingSpinner />}
{error && <ErrorBanner message={error} onDismiss={clearError} />}
```

### 2d. `IntegrationsPage.tsx`, `CustomPersonasPage.tsx`, `DecisionLabPage.tsx`

These already have error states. Verify they work with the updated stores.
No changes needed if they already display errors.

**Validate:** `npm run typecheck`.

---

## TASK 3: Consolidate Duplicate Types

**Problem:** 3 types defined in multiple files with different shapes. This
causes silent type mismatches and makes the codebase fragile.

### 3a. AuthUser — 2 identical definitions

**In:** `lib/api.ts` lines 122-126, `stores/auth.store.ts` lines 4-8

**Fix:** Move to `@boardroom/shared` if not already there. If AuthUser already
exists in shared, delete both local definitions and import. If not, create:

```typescript
// packages/shared/src/types/auth.types.ts (or extend existing)
export interface AuthUser {
  userId: string;
  email: string;
  name: string;
}
```

Update both api.ts and auth.store.ts to import from `@boardroom/shared`.

### 3b. SessionSummary — 3 definitions, one has wrong mode type

**In:**
- `lib/api.ts` lines 183-190 — `mode: UserMode` ✅
- `pages/DecisionLabPage.tsx` lines 7-14 — `mode: UserMode` ✅
- `components/dashboard/RecentDecisions.tsx` lines 5-12 — `mode: string` ❌

**Fix:** Create `SessionSummary` in shared (or api.ts as single source), delete
all 3 local definitions, import everywhere. Ensure mode is `UserMode`, not `string`.

### 3c. SubscriptionData — 2 definitions with incompatible shapes

**In:**
- `components/settings/SubscriptionSettings.tsx` lines 4-12 — 7 fields (full)
- `components/shared/TrialBanner.tsx` lines 4-7 — 2 fields (minimal)

**Fix:** Create one `SubscriptionData` in shared with all 7 fields. Update
TrialBanner to use the same type (it only reads `status` and `trialEndsAt`,
which is fine — it just ignores the extra fields).

**Validate:** `npm run typecheck`.

---

## TASK 4: Fix D3 Typing in RelationshipGraph.tsx

**Problem:** 11 instances of `as any` / `: any` due to dynamically imported D3.
The component works but is a type safety black hole.

### 4a. `packages/boardroom-ai/client/src/components/memory/RelationshipGraph.tsx`

**Strategy:** D3 is dynamically imported via `Promise.all([import('d3-force'), ...])`.
The modules arrive as `any`. Fix by declaring typed interfaces for graph nodes/edges
and adding type annotations to the D3 callback parameters.

Create local interfaces at top of file:
```typescript
import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3-force';

interface GraphNode extends SimulationNodeDatum {
  id: string;
  label: string;
  size: number;
  domain: string;
  type: string;
}

interface GraphEdge extends SimulationLinkDatum<GraphNode> {
  weight: number;
  type: string;
}
```

Then replace each `(d: any)` with `(d: GraphNode)` or `(d: GraphEdge)` as appropriate.
Replace `as any` casts on forceSimulation/forceLink with proper generic types.

**Note:** Check if `@types/d3-force`, `@types/d3-selection`, `@types/d3-zoom` are
in devDependencies. If not, install them:
```bash
cd packages/boardroom-ai && npm install -D @types/d3-force @types/d3-selection @types/d3-zoom
```

If the dynamic import pattern makes full typing impossible, at minimum:
- Type the callback parameters (replace `: any` with `: GraphNode` / `: GraphEdge`)
- Add `// @ts-expect-error — D3 dynamic import lacks types` where `as any` is unavoidable
- Reduce from 11 type violations to 2-3 justified suppressions

**Validate:** `npm run typecheck`.

---

## TASK 5: Fix DecisionSessionPage Weak Typing

**Problem:** Lines 58-59 use `as Record<string, any>` and `as any` for session
hydration from the API response.

### 5a. `packages/boardroom-ai/client/src/pages/DecisionSessionPage.tsx`

**Lines 58-59:**
```typescript
// CURRENT:
personaResponses: session.personaResponses as Record<string, any>
synthesis: session.ceoSynthesis as any

// FIX:
personaResponses: session.personaResponses as Record<string, PersonaResponse>
synthesis: session.ceoSynthesis as SynthesisReport | null
```

Import `PersonaResponse` and `SynthesisReport` from `@boardroom/shared`.
If these types don't exist in shared yet, check — they should have been added
in earlier phases. If not, create them based on what the API actually returns.

**Validate:** `npm run typecheck`.

---

## TASK 6: Standardize Page Heading Sizes

**Problem:** 5 pages use text-3xl, 5 pages use text-2xl. No consistent hierarchy.

**Convention to establish:**
- **Page title (h1):** `text-2xl font-bold text-white` — all pages
- **Section headers (h2):** `text-lg font-semibold text-gray-200`
- **Card titles (h3):** `text-base font-medium text-white`

### 6a. Update pages that use text-3xl to text-2xl:

- `DashboardPage.tsx` — change text-3xl to text-2xl
- `LoginPage.tsx` — keep text-3xl (this is the brand title, exception is fine)
- `MemoryExplorerPage.tsx` — change text-3xl to text-2xl
- `OnboardingPage.tsx` — change text-3xl to text-2xl (or keep for welcome screen)
- `PeopleDirectoryPage.tsx` — change text-3xl to text-2xl

**Note:** LoginPage and OnboardingPage can keep text-3xl since they're
standalone screens (not inside the sidebar layout). All sidebar-layout pages
should use text-2xl for consistency.

**Validate:** Visual consistency — all sidebar pages use same heading size.

---

## TASK 7: Onboarding Intermediate Persistence

**Problem:** Onboarding collects data across 5 steps but only saves on final
completion. If the user refreshes mid-onboarding, all data is lost.

### 7a. `packages/boardroom-ai/client/src/hooks/useOnboarding.ts`

**Strategy:** Persist onboarding data to sessionStorage after each step update.
On hook initialization, restore from sessionStorage if available.

```typescript
const STORAGE_KEY = 'boardroom_onboarding_draft';

// On init:
const [data, setData] = useState<OnboardingData>(() => {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : defaultData;
  } catch {
    return defaultData;
  }
});

// On update:
const updateData = useCallback((partial: Partial<OnboardingData>) => {
  setData(prev => {
    const next = { ...prev, ...partial };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  });
}, []);

// On complete (after all API calls succeed):
sessionStorage.removeItem(STORAGE_KEY);
```

**Also persist the current step number** so users return to where they left off:
```typescript
const [step, setStep] = useState<number>(() => {
  try {
    return parseInt(sessionStorage.getItem(STORAGE_KEY + '_step') || '0', 10);
  } catch { return 0; }
});

// On step change:
const next = () => {
  const nextStep = step + 1;
  setStep(nextStep);
  sessionStorage.setItem(STORAGE_KEY + '_step', String(nextStep));
};
```

**Note on localStorage restriction:** The system prompt says never use
localStorage in artifacts. This is NOT an artifact — this is a real React app
running on the user's server. sessionStorage is the right choice here
(cleared when the tab closes, which is appropriate for onboarding drafts).

**Validate:** `npm run typecheck`.

---

## TASK 8: Add Route-Based Code Splitting

**Problem:** Vite bundles everything into one chunk (543 kB, exceeds 500 kB).
No lazy loading configured.

### 8a. `packages/boardroom-ai/client/src/App.tsx`

Convert page imports to lazy imports:
```typescript
import { lazy, Suspense } from 'react';
import LoadingSpinner from './components/shared/LoadingSpinner';

// Replace direct imports:
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const DecisionLabPage = lazy(() => import('./pages/DecisionLabPage'));
const DecisionSessionPage = lazy(() => import('./pages/DecisionSessionPage'));
const MemoryExplorerPage = lazy(() => import('./pages/MemoryExplorerPage'));
const PeopleDirectoryPage = lazy(() => import('./pages/PeopleDirectoryPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const CustomPersonasPage = lazy(() => import('./pages/CustomPersonasPage'));
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage'));

// Keep LoginPage and OnboardingPage as eager (needed immediately):
import LoginPage from './pages/LoginPage';
import OnboardingPage from './pages/OnboardingPage';
```

Wrap the route outlet with Suspense:
```tsx
<Suspense fallback={<div className="flex items-center justify-center min-h-screen bg-gray-950"><LoadingSpinner size="lg" /></div>}>
  <Routes>
    {/* ... routes ... */}
  </Routes>
</Suspense>
```

### 8b. Add manual chunk splitting in `vite.config.ts`

```typescript
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'd3': ['d3-force', 'd3-selection', 'd3-zoom'],
        'vendor': ['react', 'react-dom', 'react-router-dom', 'zustand'],
      },
    },
  },
},
```

This separates D3 (only used on relationship graph page) and vendor libs
into their own chunks, reducing the main bundle size.

**Validate:** `npm run typecheck`. Optionally run `npm run build` in boardroom-ai
to verify chunk sizes.

---

## TASK 9: SSE Event Type Safety in Session Store

**Problem:** session.store.ts consumes SSE events but uses weak typing on
event fields. The `BoardRoomSSEEvent` discriminated union exists in shared
but the store doesn't fully leverage it.

### 9a. `packages/boardroom-ai/client/src/stores/session.store.ts`

The SSE event loop should use a proper switch with discriminated union:
```typescript
import type { BoardRoomSSEEvent } from '@boardroom/shared';

for await (const event of api.streamSSE(...)) {
  const typed = event as BoardRoomSSEEvent;
  switch (typed.type) {
    case 'persona_start':
      // typed.personaId and typed.model are now properly typed
      break;
    case 'persona_complete':
      // typed.personaId, typed.response properly typed
      break;
    case 'delta':
      // typed.text properly typed
      break;
    // ... etc
  }
}
```

Remove all `as any`, `as string`, `as Record<string, unknown>` casts on event
fields. The discriminated union narrows the type in each case branch.

**Validate:** `npm run typecheck`.

---

## TASK 10: Add Accessibility Basics

**Problem:** SVGs lack aria attributes, Modal missing role, no page titles.

### 10a. Modal.tsx

Add `role="dialog"` and `aria-modal="true"` to the modal container:
```tsx
<div role="dialog" aria-modal="true" aria-label={title || 'Dialog'}>
```

### 10b. Decorative SVGs

For decorative SVGs (icons next to text), add `aria-hidden="true"`:
```tsx
<svg aria-hidden="true" ...>
```

Check these files and add `aria-hidden="true"` to decorative SVGs:
- MemoryList.tsx (search icon)
- PersonCard.tsx (person icon)
- Sidebar.tsx (nav icons)
- ErrorBanner.tsx (error icon)
- StatusBadge.tsx (status icon)

### 10c. Page titles

Add document title updates in each page component:
```tsx
useEffect(() => {
  document.title = 'Dashboard — BoardRoom AI';
}, []);
```

Or create a `usePageTitle` hook:
```typescript
function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} — BoardRoom AI`;
    return () => { document.title = 'BoardRoom AI'; };
  }, [title]);
}
```

Apply to all 10 pages.

**Validate:** `npm run typecheck`.

---

## TASK 11: API Client Type Tightening

**Problem:** Several API functions use `Record<string, unknown>` for inputs
and responses. This bypasses TypeScript's protection on the client side.

### 11a. Entity CRUD inputs

The entity create/update functions in api.ts accept `Record<string, unknown>`.
Replace with proper input types from shared:

```typescript
// Instead of:
export function createGoal(input: Record<string, unknown>) { ... }

// Use:
export function createGoal(input: Omit<Goal, 'id' | 'createdAt' | 'updatedAt' | 'userId' | 'deletedAt'>) { ... }
```

Apply to all entity CRUD functions (goals, projects, tasks, people, decisions, commitments).

### 11b. Session export response

```typescript
// Instead of:
export function exportSession(id: string) {
  return request<Record<string, unknown>>(...)
}

// Define and use proper type:
export function exportSession(id: string) {
  return request<SessionExport>(...)
}
```

### 11c. Subscription response

```typescript
// Instead of:
export function getSubscription() {
  return request<Record<string, unknown> | null>(...)
}

// Use the shared SubscriptionData type (from Task 3c)
export function getSubscription() {
  return request<SubscriptionData | null>(...)
}
```

**Validate:** `npm run typecheck`. Fix any downstream type errors that surface
(these are REAL type issues that were hidden by `Record<string, unknown>`).

---

## FINAL: FRONTEND POLISH REPORT

After all tasks, create `docs/FRONTEND-POLISH-REPORT.md`:

```markdown
# Frontend Polish Report
Date: [date]
Agent: Claude Code (Opus) — Frontend Polish Agent

## Tasks
1. [PASS/FAIL] Store error states (entities, memory, cortex)
2. [PASS/FAIL] Wire errors into pages
3. [PASS/FAIL] Consolidate duplicate types (3 types)
4. [PASS/FAIL] D3 typing in RelationshipGraph
5. [PASS/FAIL] DecisionSessionPage weak typing
6. [PASS/FAIL] Heading size standardization
7. [PASS/FAIL] Onboarding intermediate persistence
8. [PASS/FAIL] Route-based code splitting
9. [PASS/FAIL] SSE event type safety
10. [PASS/FAIL] Accessibility basics
11. [PASS/FAIL] API client type tightening

## Post-Polish Status
- TypeScript: [COMPILES / ERRORS]
- Bundle size: [main chunk kB] (was 543 kB)
- Type violations (any/unknown): [count remaining]
- Pages with error states: [X/10]
- Pages with loading states: [X/10]

## Remaining (Deferred)
- [List anything skipped]
```

Run `npm run typecheck` as final verification.

---

## EXECUTION ORDER

**Foundation (do first — other tasks depend on these):**
- Task 1 (store error states) — enables Task 2
- Task 3 (consolidate types) — enables Tasks 4, 5, 9, 11

**UX Critical (do next):**
- Task 2 (wire errors into pages)
- Task 7 (onboarding persistence)
- Task 5 (decision page typing)

**Polish (do after):**
- Task 4 (D3 typing)
- Task 6 (heading standardization)
- Task 8 (code splitting)
- Task 9 (SSE type safety)

**Final pass:**
- Task 10 (accessibility)
- Task 11 (API client types)

Begin Task 1 now. Commit after each task. Go.
