# UI PHASE C — INTELLIGENCE LAYER + FINAL POLISH

> **Usage**: Paste into Claude Code (Opus). Fresh session.
> **Purpose**: Add the proactive intelligence layer, smart navigation,
>   loading choreography, responsive tuning, accessibility, and performance
>   optimization that transforms a good UI into a premium product.
> **Duration**: ~4-5 hours.
> **Scope**: Client code only. No server changes. No new API endpoints.
> **Prereqs**: Phase A (design system) and Phase B (page rebuilds) complete.

---

Read .claude/CLAUDE.md first. You are the INTELLIGENCE & POLISH AGENT.

**Context**: Phase A created the design system foundation. Phase B rebuilt every
page with the new components, tokens, motion primitives, and visual design.
The app now looks premium. Your job is to make it FEEL intelligent — proactive,
contextual, responsive, and performant.

This phase is what separates "nice-looking SaaS" from "this app understands me."

**Commit after EACH task.** Message format:
`feat(ui): description — UI-C-{N}`

---

## TASK 1: Notification & Alert System

Create `packages/boardroom-ai/client/src/components/shared/NotificationCenter.tsx`

### Current state
Phase B added a notification bell in the `AppHeader.tsx` with a dropdown.
This task builds the full notification system behind it.

### Build spec

**Notification store:** `packages/boardroom-ai/client/src/stores/notification.store.ts`

```typescript
interface Notification {
  id: string;
  type: 'outcome_review' | 'contradiction' | 'cognitive_load' | 'pattern' | 'memo' | 'system';
  title: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: Date;
  read: boolean;
  actionUrl?: string;     // Where to navigate on click
  actionLabel?: string;   // "Review Now", "View Details", etc.
  entityId?: string;      // ID of the related entity
}

interface NotificationStore {
  notifications: Notification[];
  unreadCount: number;
  isOpen: boolean;

  // Methods
  toggle(): void;
  markRead(id: string): void;
  markAllRead(): void;
  dismiss(id: string): void;
  addNotification(n: Omit<Notification, 'id' | 'timestamp' | 'read'>): void;
  fetchNotifications(): Promise<void>;
}
```

**fetchNotifications logic:**
This is a CLIENT-SIDE aggregator — no new API endpoint needed.

**IMPORTANT**: This store should NOT import or subscribe to other Zustand stores
directly (that creates coupling and infinite re-render loops). Instead, create a
`useNotificationAggregator` hook that runs in `Layout.tsx`:

```typescript
// hooks/useNotificationAggregator.ts
// This hook reads from existing stores and pushes into notification store.
// It runs once on mount + whenever source data changes.

export function useNotificationAggregator() {
  const { contradictions, patterns, latestMemo } = useCortexStore();
  const { addNotification, notifications } = useNotificationStore();

  useEffect(() => {
    // 1. Cortex contradictions → notifications
    // 2. Cortex patterns → notifications
    // 3. Cortex memo → notification
    // Deduplicate by entityId to avoid re-adding on re-render
  }, [contradictions, patterns, latestMemo]);

  // Outcome reviews require an API call (not in any store):
  useEffect(() => {
    api.getPendingReviews().then(reviews => {
      reviews.forEach(r => addNotification({ /* ... */ }));
    });
  }, []);
}
```

Call `useNotificationAggregator()` inside `Layout.tsx` (NOT inside the store).

**Data sources:**
1. From `useCortexStore` (already fetched state, no re-fetch):
   - If `contradictions` have ACTIVE items → create contradiction notifications
   - If `patterns` were recently detected → create pattern notifications
   - If `latestMemo` was generated today → create memo notification
2. From `api.getPendingReviews()` (direct API call in the hook):
   - Each pending review → outcome_review notification
3. From `useCognitiveLoad` hook (computed from entities store):
   - If warnings exist → cognitive_load notifications

**NotificationCenter.tsx:**
- Dropdown panel from the bell icon (already in AppHeader from Phase B)
- Panel: `bg-bg-elevated border border-line rounded-xl shadow-lg`
  `max-h-[400px] overflow-y-auto w-[360px]`
- Header: "Notifications" + `<Badge>` unread count + "Mark all read" link
- Each notification item:
  - Left: colored icon based on type (bell=outcome, warning-triangle=contradiction,
    brain=pattern, chart=cognitive, sparkle=memo)
  - Right: title (bold if unread) + description (1 line) + relative time
  - Click: navigate to `actionUrl`, mark read, close panel
  - Hover: `bg-bg-hover`
  - Unread: left border `border-l-2 border-accent`
- Empty: "All caught up!" with checkmark icon
- Motion: `slideUp` on open, `staggerItem` for each notification
- Close: click outside or Escape key

**Wire into AppHeader.tsx:**
- Bell icon: show `<Badge>` dot (not count) when unreadCount > 0
  - Dot: small red circle, `bg-danger`, 8px, positioned top-right of bell
  - Subtle pulse animation when new notifications arrive
- Click bell: toggle NotificationCenter

**Validate:** `npm run typecheck`.

---

## TASK 2: Contextual AI Nudges

Create `packages/boardroom-ai/client/src/components/shared/AINudge.tsx`

### Purpose
Proactive, contextual nudges that appear on specific pages when the AI
detects something the user should know. These are NOT notifications (which
are global). These are page-specific, contextual, and actionable.

### Build spec

**AINudge component:**
```typescript
interface AINudgeProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
  dismissKey: string;  // localStorage key to remember dismissal
  variant?: 'info' | 'suggestion' | 'warning';
}
```

- Styled: `<Card>` with left accent border (info=accent, suggestion=success, warning=warning)
- Icon: sparkle/brain icon for AI suggestions
- Small "AI Insight" label in `text-xs text-accent uppercase tracking-wide`
- Title + description
- Action button: `<Button variant="ghost" size="sm">`
- Dismiss X: stores dismissKey in a Zustand persist store (NOT localStorage directly
  since Phase A components avoid that — use Zustand with a simple in-memory set,
  and also persist to the UI store's `dismissedQuestions` Set)
- Entry animation: `slideUp` with 500ms delay (appear after page content loads)

**Nudge instances to create:**

1. **Dashboard nudge** — "You haven't run a decision analysis in 7+ days"
   (check last session date from entities store decisions array)
   - Action: "Start a Decision" → navigate to `/decisions`

2. **Dashboard nudge** — "Your weekly memo is available"
   (check cortex store latestMemo date)
   - Action: "Read Memo" → scroll to memo widget

3. **Decision Session nudge** — "Consider running a simulation on your chosen path"
   (show in Phase 3 after synthesis, if no simulation has been run)
   - Action: "Run Simulation" → scroll to simulation button

4. **Memory Explorer nudge** — "You have {N} memories without entity links"
   (count memories with no linked entities)
   - Action: "Review Unlinked" → filter to unlinked memories

5. **People Directory nudge** — "Adding more people improves decision context"
   (show when < 3 people)
   - Action: "Add Person" → open add modal

**Place nudges** at the top of each relevant page, below the header,
above the main content. Use `AnimatePresence` so dismissed nudges
smoothly exit.

**Validate:** `npm run typecheck`.

---

## TASK 3: Smart Navigation Shortcuts

### 3a. Keyboard shortcuts system

Create `packages/boardroom-ai/client/src/hooks/useKeyboardShortcuts.ts`

Register a global keyboard shortcut system (beyond just Cmd+K):

| Shortcut | Action | Context |
|----------|--------|---------|
| `Cmd+K` | Command palette | Global (already done in Phase A) |
| `Cmd+N` | New Decision Session | Global |
| `Cmd+Shift+G` | Go to Goals (Dashboard) | Global |
| `Cmd+Shift+M` | Go to Memory | Global |
| `Cmd+Shift+D` | Go to Decisions | Global |
| `Cmd+Shift+P` | Go to People | Global |
| `Cmd+/` | Show keyboard shortcuts help | Global |
| `Escape` | Close modal / panel / palette | Global |

**Implementation:**
- Single `useEffect` in `App.tsx` or `Layout.tsx` that listens for keydown
- Check `e.metaKey || e.ctrlKey` for cross-platform
- Prevent default on all registered shortcuts
- Use `useNavigate()` from react-router for navigation shortcuts

### 3b. Shortcuts help modal

Create `packages/boardroom-ai/client/src/components/shared/ShortcutsModal.tsx`

- Triggered by `Cmd+/` or from command palette ("Keyboard Shortcuts")
- Modal: `<Card>` overlay with `scaleIn` animation
- Grid of shortcuts: key combo (in `<kbd>` styled elements) + description
- `<kbd>` styling: `bg-bg-hover border border-line rounded px-1.5 py-0.5 text-xs font-mono`
- Close on Escape or click outside

### 3c. Breadcrumb enhancements

Update `AppHeader.tsx` breadcrumbs:

- On `/decisions/:id` pages: show "Decision Lab > {question truncated to 40 chars}"
- Breadcrumb items are clickable links (navigate back)
- Current page: `text-text-primary`, parent pages: `text-text-secondary hover:text-accent`
- Separator: `/` or `›` in `text-text-tertiary`

**Validate:** `npm run typecheck`.

---

## TASK 4: Loading Choreography

Replace abrupt loading → content transitions with choreographed sequences.

### 4a. Page-level loading

Each page that fetches data should transition through:
1. **Skeleton phase** (0-300ms): Show skeleton layout immediately
2. **Content reveal** (300ms+): When data arrives, crossfade from skeleton to content
   using `AnimatePresence mode="wait"`:
   ```tsx
   <AnimatePresence mode="wait">
     {isLoading ? (
       <motion.div key="skeleton" {...fadeIn}><SkeletonLayout /></motion.div>
     ) : (
       <motion.div key="content" {...fadeIn}><ActualContent /></motion.div>
     )}
   </AnimatePresence>
   ```

Apply to: DashboardPage, DecisionLabPage, MemoryExplorerPage,
PeopleDirectoryPage, SettingsPage, CustomPersonasPage, IntegrationsPage.

### 4b. Streaming text choreography

In `DecisionSessionPage.tsx`, improve the persona streaming experience:

- When dispatch starts: persona cards appear one at a time (staggered 200ms each),
  not all simultaneously. First card slides in, starts streaming, then second, etc.
  (The actual SSE stream handles the real-time text — this is just the card appearance)
- Each card during streaming: subtle background pulse animation
  (`animate={{ backgroundColor: ['var(--color-bg-surface)', 'var(--color-bg-elevated)', 'var(--color-bg-surface)'] }}`)
  with `transition={{ duration: 2, repeat: Infinity }}`
- When a persona completes: brief green flash on the card border, then settle to normal
- When all complete: "Synthesize" button appears with `scaleIn` + attention pulse

### 4c. Synthesis reveal

When synthesis streams in:
- Panel slides up from bottom with a dramatic `slideUp` (slightly slower, 400ms)
- Each section reveals progressively as the streaming text fills them
- When synthesis completes: brief celebration — the accent gradient border does
  a single shimmer animation (gradient position shift from left to right)

### 4d. Toast choreography

Ensure the toast system (from Phase A) is used consistently:
- Entity created → success toast: "{Entity} created" with check icon
- Entity deleted → info toast: "{Entity} deleted" with undo action
- Save successful → success toast: "Changes saved"
- API error → error toast: error message with "Retry" action
- Simulation complete → success toast: "Simulation complete — view results"

Go through every API call across all stores and pages. Add toast notifications
for every user-initiated mutation (create, update, delete, generate, scan).
Import `useToastStore` and call `addToast()` in the appropriate `.then()` or
`.catch()` handlers.

**Validate:** `npm run typecheck`.

---

## TASK 5: Responsive Design Pass

The app must work on tablets (768px+) and look acceptable on large phones (640px+).
Desktop-first is fine, but nothing should break or be unusable below 1024px.

### 5a. Breakpoint audit

Check every page for responsive issues:

**Sidebar:**
- Below `lg` (1024px): sidebar should auto-collapse to icon-only mode (64px)
- Below `md` (768px): sidebar becomes a slide-over drawer (off-screen by default),
  triggered by hamburger menu in AppHeader
- Overlay: `bg-black/50` backdrop on mobile when drawer is open
- Close on navigation (route change) or click outside

**Grids:**
- Dashboard widgets: 1 col below `md`, 2 col at `lg`
- Person cards: 1 col below `sm`, 2 col at `md`, 3 col at `lg`
- Persona cards (Decision Session): 1 col below `md`, 2 col at `md`, 3 col at `lg`
- Integration cards: 1 col below `md`, 2 col at `md`

**Decision Session:**
- On mobile, the 3-phase flow should be fully vertical — no side-by-side layouts
- Persona cards: stack vertically
- Synthesis panel: full-width
- Action bar: full-width, buttons stack if needed

**Memory Explorer:**
- Below `lg`: switch from side-by-side to stacked layout
  (list on top, detail below) or use a slide-over panel for detail
- Detail panel: full-width on mobile

**Settings:**
- Below `md`: hide the in-page sidebar nav, show all sections stacked vertically
  with section headers as large text dividers

### 5b. Touch targets

Ensure all interactive elements meet minimum 44x44px touch targets on mobile:
- Buttons: already handled by size variants
- Toggle switches: ensure adequate padding
- Sidebar nav items: minimum height 44px
- Card click areas: full card should be clickable where appropriate

### 5c. Command palette on mobile

- Replace `Cmd+K` hint in header with a search icon button
- Command palette: full-screen overlay on mobile (not centered modal)
- Input auto-focuses with keyboard up

**Validate:** `npm run typecheck`. Manually test at 375px, 768px, 1024px, 1440px widths
using browser dev tools.

---

## TASK 6: Accessibility Pass

### 6a. ARIA landmarks and roles

- `<main>` wraps the content area (should be in Layout.tsx already)
- `<nav>` wraps the sidebar navigation
- `<header>` wraps the AppHeader
- Modal dialogs: `role="dialog"` + `aria-modal="true"` + `aria-labelledby`
- Command palette: `role="dialog"` (cmdk handles internal ARIA)
- Toast container: `role="status"` + `aria-live="polite"`
- Notification panel: `role="region"` + `aria-label="Notifications"`

### 6b. Focus management

- **Modals**: trap focus inside. On open, focus first focusable element.
  On close, return focus to trigger element.
  Create or use a `useFocusTrap` hook.
- **Command palette**: focus trapped inside (cmdk handles this — verify)
- **Sidebar drawer (mobile)**: focus trapped when open
- **Tab key**: logical tab order through all pages. Verify no focus traps
  in unexpected places.

### 6c. Screen reader support

- All icon-only buttons: add `aria-label` (e.g., sidebar collapse, notification bell,
  edit/delete buttons on cards)
- Images/SVGs: `aria-hidden="true"` for decorative, `aria-label` for meaningful
- Loading states: `aria-busy="true"` on containers while loading
- Dynamic content (streaming text): `aria-live="polite"` on streaming containers
- Error messages: `role="alert"` on error banners

### 6d. Keyboard navigation

- All interactive elements reachable via Tab
- Enter/Space activates buttons
- Escape closes modals/dropdowns/command palette
- Arrow keys navigate within tab lists, dropdown menus
- Skip-to-content link: add hidden link at top of page
  ```tsx
  <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute
    focus:top-4 focus:left-4 focus:z-50 bg-accent text-white px-4 py-2 rounded-md">
    Skip to content
  </a>
  ```

### 6e. Color contrast verification

- `text-text-primary` (#f0f0f5) on `bg-bg-surface` (#111118): verify ≥ 4.5:1
- `text-text-secondary` (#9595ad) on `bg-bg-surface` (#111118): verify ≥ 4.5:1
  (if fails, bump secondary to #a0a0b8 or similar)
- `text-text-tertiary` (#5e5e76): this is for decorative text only, NOT
  critical information. Verify it's never used for labels users need to read.
- All `<Badge>` text on their backgrounds: verify contrast
- `accent` (#6366f1) on `bg-bg-surface`: verify for interactive elements

Use a programmatic check: create a temporary script or just eyeball the
WCAG contrast ratios for the key pairs above. Adjust tokens if any fail.

### 6f. Reduced motion

Add to `styles/tokens.css`:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

In Motion components, respect the preference:
```typescript
// lib/motion.ts - add:
export const useReducedMotion = () => {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
};
```

**Validate:** `npm run typecheck`.

---

## TASK 7: Performance Optimization

### 7a. Code splitting verification

Verify that lazy loading (already in App.tsx) is working correctly:
- Each page route should be a separate chunk
- The command palette should be lazy-loaded (it's heavy with cmdk)
- The relationship graph (D3) should be lazy-loaded
- EmailScanner should be lazy-loaded

Check `App.tsx` — if any of these aren't lazy, add `React.lazy()` + `Suspense`:
```tsx
const CommandPalette = React.lazy(() => import('./components/ui/CommandPalette'));
const RelationshipGraph = React.lazy(() => import('./components/people/RelationshipGraph'));
```

### 7b. Memoization pass

Identify expensive renders and add `React.memo`, `useMemo`, `useCallback` where needed:

- `PersonaCard.tsx`: wrap in `React.memo` — re-renders on every streaming tick.
  Memoize everything except the streaming text section.
- `MemoryCard.tsx`: wrap in `React.memo` — list can have 20+ items
- `GoalHierarchy.tsx` tree nodes: `React.memo` each node
- `RelationshipGraph.tsx`: `useMemo` on graph data transformation
- `DashboardConfigurator.tsx`: `useCallback` on drag/reorder handlers
- `ProactiveQuestions.tsx`: `useMemo` on the question generation logic
  (runs every render currently)
- `useCognitiveLoad.ts`: `useMemo` on the warning calculations

### 7c. Image/asset optimization

- SVG empty state illustrations (from Phase A): ensure they're inline SVG,
  not separate file imports, so they don't cause extra network requests
- Font loading: verify `display=swap` on Google Fonts import to prevent FOIT
  (flash of invisible text)
- No external images in the current app — if any are added, use lazy loading

### 7d. Bundle analysis (informational)

Run `npx vite-bundle-visualizer` (or equivalent) and report:
- Total bundle size
- Largest chunks
- Any unexpected large dependencies
- Recommendation: if bundle > 500KB gzipped, identify what to tree-shake or lazy-load

**Note:** Don't install vite-bundle-visualizer as a permanent dependency.
Use `npx` for a one-time check. If it fails to run, skip and just report
the lazy-loading status.

**Validate:** `npm run typecheck`. `npm run build` (verify production build succeeds).

---

## TASK 8: Micro-interactions & Delight

Small touches that make the app feel alive and crafted.

### 8a. Hover effects

Audit all cards and interactive elements for consistent hover states:
- Cards: `hover:border-accent/30 hover:shadow-glow` transition (from `<Card hover>`)
- Buttons: already handled by cva variants
- Nav items: `hover:bg-bg-hover` transition
- Table/list rows: `hover:bg-bg-hover` with smooth transition

### 8b. Active/pressed states

- Buttons: `active:scale-[0.98]` (in cva variants — verify)
- Cards that are clickable: subtle `active:scale-[0.99]` on press
- Toggle switches: spring animation on the knob (from Phase B — verify)

### 8c. Status transitions

When entity status changes (via store update):
- Animate the `<Badge>` with a brief color flash using Motion:
  ```tsx
  <motion.div
    key={status}
    initial={{ scale: 1.2, opacity: 0.5 }}
    animate={{ scale: 1, opacity: 1 }}
    transition={{ type: 'spring', stiffness: 500 }}
  >
    <Badge variant={statusVariant}>{status}</Badge>
  </motion.div>
  ```

### 8d. Number counters

Where counts change (notification badge, entity counts, progress percentages):
- Animate number transitions using Motion's `animate` with `useMotionValue` + `useTransform`:
  ```tsx
  // Simple animated counter
  const AnimatedCount = ({ value }: { value: number }) => {
    const motionValue = useMotionValue(0);
    const rounded = useTransform(motionValue, (v) => Math.round(v));
    useEffect(() => { animate(motionValue, value, { duration: 0.5 }); }, [value]);
    return <motion.span>{rounded}</motion.span>;
  };
  ```
- Apply to: notification unread count, entity counts in headers, progress bar values

### 8e. Skeleton shimmer upgrade

If the Phase A `<Skeleton>` is a simple `animate-pulse`, upgrade to a shimmer effect:
```css
/* In tokens.css or index.css */
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.skeleton-shimmer {
  background: linear-gradient(
    90deg,
    var(--color-bg-hover) 25%,
    var(--color-bg-active) 50%,
    var(--color-bg-hover) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
```

Update `<Skeleton>` component to use `skeleton-shimmer` class.

**Validate:** `npm run typecheck`.

---

## TASK 9: Final Integration Test

This is the verification task. Do NOT skip.

### 9a. Full app walkthrough

Mentally (or actually) walk through the complete user journey:

1. **Load `/login`** — gradient mesh, form, branded left panel
2. **Register** — form validates, toast on error, redirect on success
3. **Onboarding** — 5 steps with transitions, progress bar, extraction, celebration
4. **Dashboard** — greeting, widget grid with stagger, proactive questions, nudges
5. **Navigate via sidebar** — active indicator slides, page transitions
6. **Cmd+K** — command palette opens, search works, navigate to Decision Lab
7. **Decision Lab** — session list with filters, stagger animation
8. **New Decision** — mode selection, analyze, persona streaming, synthesis, simulation
9. **Memory Explorer** — search, filter chips, memory cards, detail panel
10. **People Directory** — grid, add modal, relationship graph
11. **Settings** — section nav, form inputs, save with toast
12. **Custom Personas** — create, edit, toggle active, delete
13. **Integrations** — connect/disconnect, coming soon badges
14. **Notification bell** — check for notifications, mark read
15. **Keyboard shortcuts** — Cmd+/ shows help, shortcuts work

### 9b. Verify no regressions

- `npm run typecheck` — MUST pass with 0 errors
- `npm run build` — MUST produce a successful production build
- No console errors in dev mode (check browser console)

### 9c. Verify design token compliance

Search the entire client codebase for violations:
```bash
# Should return 0 results (or only in tokens.css itself):
grep -rn 'bg-gray-' packages/boardroom-ai/client/src/ --include='*.tsx' --include='*.ts' | grep -v 'tokens.css' | grep -v 'tailwind.config'
grep -rn 'text-gray-' packages/boardroom-ai/client/src/ --include='*.tsx' --include='*.ts' | grep -v 'tokens.css' | grep -v 'tailwind.config'
grep -rn 'border-gray-' packages/boardroom-ai/client/src/ --include='*.tsx' --include='*.ts' | grep -v 'tokens.css' | grep -v 'tailwind.config'
grep -rn '#[0-9a-fA-F]\{6\}' packages/boardroom-ai/client/src/ --include='*.tsx' | grep -v 'tokens.css' | grep -v '.svg'
```

Report any remaining violations. Fix them if < 20. If > 20, list the top files.

### 9d. Component inventory

Count and report:
- Total UI components in `components/ui/`: [count]
- Total design tokens in `tokens.css`: [count]
- Total motion presets in `lib/motion.ts`: [count]
- Total keyboard shortcuts registered: [count]
- Pages with skeleton loading: [count]/10
- Pages with error handling: [count]/10
- Pages with empty states: [count]/10
- Pages wrapped in PageWrapper: [count]/10

**Validate:** `npm run typecheck`. `npm run build`.

---

## FINAL: PHASE C REPORT

```markdown
# UI Phase C Report — Intelligence Layer + Final Polish
Date: [date]

## Completed
1. [PASS/FAIL] Notification system (store, center, bell integration)
2. [PASS/FAIL] Contextual AI nudges (5 nudge instances across pages)
3. [PASS/FAIL] Smart navigation (keyboard shortcuts, shortcuts modal, breadcrumbs)
4. [PASS/FAIL] Loading choreography (skeleton→content, streaming, toasts)
5. [PASS/FAIL] Responsive design (sidebar drawer, grid breakpoints, touch targets)
6. [PASS/FAIL] Accessibility (ARIA, focus management, contrast, reduced motion)
7. [PASS/FAIL] Performance (code splitting, memoization, bundle check)
8. [PASS/FAIL] Micro-interactions (hover, press, status transitions, counters, shimmer)
9. [PASS/FAIL] Final integration test (walkthrough, typecheck, build, token audit)

## Metrics
- Typecheck: [PASS/FAIL]
- Production build: [PASS/FAIL]
- Design token violations remaining: [count]
- Accessibility issues: [count]
- Estimated bundle size: [size]

## Component Inventory
- UI components: [count]
- Design tokens: [count]
- Motion presets: [count]
- Keyboard shortcuts: [count]
- Pages with full state handling (load/error/empty/data): [count]/10

## Notes
- [Any issues, trade-offs, or recommendations for future work]
```

---

## EXECUTION ORDER

1. Task 1 — Notification system (60 min)
2. Task 2 — AI nudges (45 min)
3. Task 3 — Smart navigation (30 min)
4. Task 4 — Loading choreography (45 min)
5. Task 5 — Responsive design (45 min)
6. Task 6 — Accessibility (30 min)
7. Task 7 — Performance optimization (30 min)
8. Task 8 — Micro-interactions (30 min)
9. Task 9 — Final integration test (20 min)

Begin Task 1 now. Commit after each task. Go.
