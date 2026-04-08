# UI PHASE A — DESIGN FOUNDATION

> **Usage**: Paste into Claude Code (Opus). Fresh session.
> **Purpose**: Build the design system, component library, motion primitives,
>   and layout infrastructure that all pages will use.
> **Duration**: ~5-6 hours.
> **Scope**: Client code only. No server changes.
> **Prereqs**: Frontend Polish orchestrator complete (error states, types, code splitting done).

---

Read .claude/CLAUDE.md first. You are the UI DESIGN SYSTEM AGENT.

**Important**: This is a VISUAL DESIGN pass, not a code-correctness pass.
You are building a premium, polished SaaS product for startup founders,
small business owners, and organizational leaders who need an intelligent
place to roadmap goals, stress-test ideas, and manage decisions.

The current frontend is functional but engineer-grade. Your job is to make
it feel like a $200/month premium tool — confident, clean, intelligent, alive.

**Commit after EACH task.** Message format:
`feat(ui): description — UI-A-{N}`

---

## TARGET USER PERSONA

**Name**: Alex — Startup founder / small business owner / organizational leader
**Needs**: Intelligent goal roadmapping, project tracking, priority drift detection,
  idea stress-testing, detailed dev plans and timelines
**Context**: Uses the app daily. Makes 3-10 decisions per week. Manages 2-5 active
  projects. Has a team of 3-20 people. Wants clarity, not complexity.
**Expectation**: Premium SaaS feel — think Linear, Notion, or Vercel dashboard quality.
  Not enterprise ugly. Not consumer toy.

---

## TASK 1: Install Dependencies

```bash
cd packages/boardroom-ai
npm install motion@^11 cmdk class-variance-authority clsx tailwind-merge
# D3 types already installed — skip: @types/d3-force, @types/d3-selection, @types/d3-zoom
```

**Packages:**
- `motion@^11` — Animation library (formerly framer-motion). Import from `motion/react`. Must be v11+ for `motion/react` exports.
- `cmdk` — Command palette (Cmd+K). Headless, accessible, fast.
- `class-variance-authority` (cva) — Variant-driven component styling.
- `clsx` + `tailwind-merge` — Conditional + deduped Tailwind classes.

**Validate:** `npm run typecheck`.

---

## TASK 2: Design Token System

Create `packages/boardroom-ai/client/src/styles/tokens.css`

This is the single source of truth for all visual decisions. Every component
references these tokens — never hardcode hex values or arbitrary Tailwind classes.

```css
:root {
  /* === COLOR SYSTEM === */

  /* Background layers (dark-first, layered surfaces) */
  --color-bg-base: #0a0a0f;          /* Deepest background */
  --color-bg-surface: #111118;        /* Card/panel surface */
  --color-bg-elevated: #1a1a24;       /* Elevated cards, modals */
  --color-bg-hover: #22222e;          /* Hover state on surfaces */
  --color-bg-active: #2a2a38;         /* Active/pressed state */

  /* Border */
  --color-border-subtle: #1e1e2a;     /* Faint dividers */
  --color-border-default: #2a2a3a;    /* Card borders */
  --color-border-strong: #3a3a4e;     /* Emphasized borders */

  /* Text */
  --color-text-primary: #f0f0f5;      /* Primary text */
  --color-text-secondary: #9595ad;    /* Secondary text */
  --color-text-tertiary: #5e5e76;     /* Muted text, placeholders */
  --color-text-inverse: #0a0a0f;      /* Text on light backgrounds */

  /* Accent — Indigo-violet gradient feel */
  --color-accent-primary: #6366f1;    /* Primary actions */
  --color-accent-primary-hover: #818cf8;
  --color-accent-primary-muted: rgba(99, 102, 241, 0.12);
  --color-accent-secondary: #8b5cf6;  /* Secondary highlights */

  /* Semantic colors */
  --color-success: #34d399;
  --color-success-muted: rgba(52, 211, 153, 0.12);
  --color-warning: #fbbf24;
  --color-warning-muted: rgba(251, 191, 36, 0.12);
  --color-danger: #f87171;
  --color-danger-muted: rgba(248, 113, 113, 0.12);
  --color-info: #60a5fa;
  --color-info-muted: rgba(96, 165, 250, 0.12);

  /* === TYPOGRAPHY === */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
  --font-display: 'Inter', var(--font-sans);

  --text-xs: 0.75rem;      /* 12px */
  --text-sm: 0.8125rem;    /* 13px */
  --text-base: 0.875rem;   /* 14px — base size for data-dense UI */
  --text-lg: 1rem;         /* 16px */
  --text-xl: 1.125rem;     /* 18px */
  --text-2xl: 1.375rem;    /* 22px — page titles */
  --text-3xl: 1.75rem;     /* 28px — hero/splash only */

  /* Line heights */
  --leading-tight: 1.25;
  --leading-normal: 1.5;
  --leading-relaxed: 1.625;

  /* Letter spacing */
  --tracking-tight: -0.01em;
  --tracking-normal: 0;
  --tracking-wide: 0.025em;

  /* === SPACING === */
  --space-0: 0;
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-10: 2.5rem;
  --space-12: 3rem;
  --space-16: 4rem;

  /* === RADII === */
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
  --radius-full: 9999px;

  /* === SHADOWS === */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.25);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.3);
  --shadow-glow: 0 0 20px rgba(99, 102, 241, 0.15);

  /* === TRANSITIONS === */
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 400ms;
  --ease-default: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);

  /* === Z-INDEX SCALE === */
  --z-base: 0;
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-modal-backdrop: 300;
  --z-modal: 400;
  --z-command-palette: 500;
  --z-toast: 600;
}
```

### 2b. Import in `index.css`

At the top of `packages/boardroom-ai/client/src/index.css`, before Tailwind directives:
```css
@import './styles/tokens.css';
```

### 2c. Extend Tailwind config

**File:** `packages/boardroom-ai/client/tailwind.config.ts` (NOT the package root — the config lives inside `client/`).

KEEP the existing `persona` and `status` color objects. ADD the new token-based
colors alongside them in the `extend.colors` block:
```typescript
theme: {
  extend: {
    colors: {
      // KEEP existing persona + status colors here (don't delete them)
      persona: { /* ...existing... */ },
      status: { /* ...existing... */ },
      bg: {
        base: 'var(--color-bg-base)',
        surface: 'var(--color-bg-surface)',
        elevated: 'var(--color-bg-elevated)',
        hover: 'var(--color-bg-hover)',
        active: 'var(--color-bg-active)',
      },
      // NOTE: Using 'line' instead of 'border' to avoid conflicting with
      // Tailwind's built-in borderColor utility. Use as: border-line, border-line-subtle, etc.
      line: {
        subtle: 'var(--color-border-subtle)',
        DEFAULT: 'var(--color-border-default)',
        strong: 'var(--color-border-strong)',
      },
      text: {
        primary: 'var(--color-text-primary)',
        secondary: 'var(--color-text-secondary)',
        tertiary: 'var(--color-text-tertiary)',
      },
      accent: {
        DEFAULT: 'var(--color-accent-primary)',
        hover: 'var(--color-accent-primary-hover)',
        muted: 'var(--color-accent-primary-muted)',
        secondary: 'var(--color-accent-secondary)',
      },
      success: { DEFAULT: 'var(--color-success)', muted: 'var(--color-success-muted)' },
      warning: { DEFAULT: 'var(--color-warning)', muted: 'var(--color-warning-muted)' },
      danger: { DEFAULT: 'var(--color-danger)', muted: 'var(--color-danger-muted)' },
      info: { DEFAULT: 'var(--color-info)', muted: 'var(--color-info-muted)' },
    },
    fontFamily: {
      sans: ['var(--font-sans)'],
      mono: ['var(--font-mono)'],
      display: ['var(--font-display)'],
    },
    borderRadius: {
      sm: 'var(--radius-sm)',
      md: 'var(--radius-md)',
      lg: 'var(--radius-lg)',
      xl: 'var(--radius-xl)',
    },
    boxShadow: {
      sm: 'var(--shadow-sm)',
      md: 'var(--shadow-md)',
      lg: 'var(--shadow-lg)',
      glow: 'var(--shadow-glow)',
    },
    transitionDuration: {
      fast: 'var(--duration-fast)',
      normal: 'var(--duration-normal)',
      slow: 'var(--duration-slow)',
    },
  },
}
```

### 2d. Add Inter font

In `packages/boardroom-ai/client/index.html` (note: lives in `client/`, not package root), add Google Fonts import:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

**Validate:** `npm run typecheck`. Verify tokens load by checking any page.

---

## TASK 3: Core UI Component Library

Create a component library in `packages/boardroom-ai/client/src/components/ui/`.
These are the atomic building blocks for every page.

### 3a. Utility: `packages/boardroom-ai/client/src/lib/cn.ts`

```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

### 3b. Button component: `components/ui/Button.tsx`

Use `cva` for variants:
```typescript
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';
import { motion } from 'motion/react';

const buttonVariants = cva(
  'inline-flex items-center justify-center font-medium transition-all duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-white hover:bg-accent-hover shadow-sm active:scale-[0.98]',
        secondary: 'bg-bg-elevated text-text-primary border border-line hover:bg-bg-hover active:scale-[0.98]',
        ghost: 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
        danger: 'bg-danger text-white hover:bg-red-400 active:scale-[0.98]',
        success: 'bg-success text-bg-base hover:bg-emerald-300 active:scale-[0.98]',
      },
      size: {
        sm: 'h-8 px-3 text-xs rounded-md gap-1.5',
        md: 'h-9 px-4 text-sm rounded-md gap-2',
        lg: 'h-11 px-6 text-base rounded-lg gap-2.5',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);
```

Wrap with `motion.button` for subtle press animation (`whileTap={{ scale: 0.98 }}`).

### 3c. Card component: `components/ui/Card.tsx`

```typescript
// Surface card with subtle border and optional hover glow
const Card = ({ children, className, hover = false, ...props }) => (
  <div
    className={cn(
      'rounded-lg border border-line bg-bg-surface p-4',
      hover && 'transition-all duration-normal hover:border-accent/30 hover:shadow-glow cursor-pointer',
      className
    )}
    {...props}
  >
    {children}
  </div>
);
```

Include `Card.Header`, `Card.Body`, `Card.Footer` sub-components.

### 3d. Input component: `components/ui/Input.tsx`

Styled input with focus ring animation, label, error message support.
```
bg-bg-base border border-line rounded-md px-3 h-9 text-sm text-text-primary
placeholder:text-text-tertiary
focus:border-accent focus:ring-1 focus:ring-accent/30
transition-all duration-fast
```

### 3e. Badge component: `components/ui/Badge.tsx`

Status badges with semantic color variants:
- `default` (gray), `success` (green), `warning` (amber), `danger` (red), `info` (blue), `accent` (indigo)
- Soft variant (muted background) and solid variant

### 3f. Skeleton component: `components/ui/Skeleton.tsx`

Animated loading placeholder:
```tsx
const Skeleton = ({ className }: { className?: string }) => (
  <div className={cn(
    'animate-pulse rounded-md bg-bg-hover',
    className
  )} />
);
```

### 3g. Toast/Notification component: `components/ui/Toast.tsx`

Create a toast system with:
- Slide-in from top-right using Motion `animate` + `exit`
- Auto-dismiss after 4 seconds
- Variants: success, error, warning, info
- Zustand store for toast state: `useToastStore`
- A `<Toaster />` component mounted at App root

### 3h. Tooltip component: `components/ui/Tooltip.tsx`

Lightweight tooltip on hover with fade animation. Position: top (default).
```
bg-bg-elevated text-text-primary text-xs px-2 py-1 rounded-md shadow-md
border border-line
```

### 3i. Avatar component: `components/ui/Avatar.tsx`

Initials-based avatar with background color derived from name hash.
Sizes: sm (24px), md (32px), lg (40px).

### 3j. Progress component: `components/ui/Progress.tsx`

Animated progress bar with Motion. `value` prop (0-100).
Indigo gradient fill with subtle glow on the leading edge.

### 3k. Tabs component: `components/ui/Tabs.tsx`

Tab switcher with animated underline indicator that slides between tabs using
Motion `layoutId`.

### 3l. Dropdown/Select component: `components/ui/Select.tsx`

Headless dropdown with Motion enter/exit. Focus management, keyboard nav.

**Validate:** `npm run typecheck`. Each component should export cleanly.

---

## TASK 4: Motion Primitives

Create `packages/boardroom-ai/client/src/lib/motion.ts`

Reusable animation presets:
```typescript
export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2 },
};

export const slideUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] },
};

export const slideIn = {
  initial: { opacity: 0, x: -12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 12 },
  transition: { duration: 0.2 },
};

export const scaleIn = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
  transition: { duration: 0.2, ease: [0.34, 1.56, 0.64, 1] },
};

export const staggerContainer = {
  animate: { transition: { staggerChildren: 0.05 } },
};

export const staggerItem = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
};

// Page transition wrapper
export const pageTransition = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.3, ease: [0, 0, 0.2, 1] },
};
```

Create a `PageWrapper` component:
```tsx
import { motion } from 'motion/react';
import { pageTransition } from '../../lib/motion';

export function PageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <motion.div {...pageTransition}>
      {children}
    </motion.div>
  );
}
```

**Validate:** `npm run typecheck`.

---

## TASK 5: Command Palette (Cmd+K)

Create `packages/boardroom-ai/client/src/components/ui/CommandPalette.tsx`

This is the power-user navigation hub. Cmd+K (or Ctrl+K) opens a search-driven
command menu that lets users jump to any page, search entities, or trigger actions.

### 5a. Build the component using `cmdk`

```tsx
import { Command } from 'cmdk';
import { motion, AnimatePresence } from 'motion/react';

// Groups:
// 1. Navigation — jump to Dashboard, Decisions, Memory, People, Settings, etc.
// 2. Actions — New Decision Session, Create Goal, Create Project, etc.
// 3. Search — Search memories, decisions, people (debounced API call)
// 4. Recent — Last 5 visited pages

// Style: frosted glass overlay, bg-bg-elevated/95 backdrop-blur-xl border border-line
// Width: max-w-xl centered, rounded-xl, shadow-lg
// Input: auto-focus, placeholder "Search or type a command..."
```

### 5b. Create keyboard shortcut hook

```typescript
// hooks/useKeyboardShortcut.ts
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      toggleCommandPalette();
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

### 5c. Wire entity search

The command palette should search across:
- Pages (static list — Dashboard, Decisions, Memory, People, etc.)
- Goals (from entities store)
- Projects (from entities store)
- People (from entities store)
- Recent decisions (from session history)

Use the existing stores for data. Debounce the search input at 200ms.

### 5d. Mount in App.tsx

Add `<CommandPalette />` at the App root level, alongside `<Toaster />`.

**Validate:** `npm run typecheck`. The palette should open on Cmd+K.

---

## TASK 6: Layout System Rebuild

Rebuild the app shell — sidebar, header, main content area.

### 6a. Redesign Sidebar: `components/shared/Sidebar.tsx`

Current sidebar is functional but flat. Rebuild with:

**Visual design:**
- Width: 240px expanded, 64px collapsed
- Background: `bg-bg-base` with right border `border-line-subtle`
- Logo/brand at top: "BoardRoom" in font-display, text-lg, font-semibold,
  with a subtle indigo gradient on the text
- Navigation items: icon + label, rounded-md, hover:bg-bg-hover
- Active item: bg-accent-muted, text-accent, with left border indicator (2px indigo)
- Collapse button at bottom with rotate animation on the chevron icon

**Sections:**
1. Brand/logo
2. Primary nav: Dashboard, Decisions, Memory, People
3. Separator
4. Secondary nav: Settings, Personas, Integrations
5. Separator
6. User avatar + name + plan badge at bottom

**Animation:**
- Collapse/expand: smooth width transition via Motion
- Items: `staggerItem` animation on mount
- Active indicator: `layoutId="nav-indicator"` for sliding highlight

### 6b. Create App Header: `components/shared/AppHeader.tsx`

Sticky header inside the main content area:
- Page title (dynamic based on route)
- Breadcrumbs (for nested routes like /decisions/:id)
- Right side: Cmd+K shortcut hint (`⌘K`), notification bell, user avatar dropdown
- Subtle bottom border, bg-bg-base/80 with backdrop-blur

### 6c. Notification dropdown

Bell icon in header. Shows count badge when unread.
Dropdown panel shows:
- Outcome review nudges
- Contradiction alerts
- Cognitive load warnings
- Pattern detections

Pull from cortex store + entities store. Motion slide-down on open.

### 6d. Update Layout.tsx

**File:** `packages/boardroom-ai/client/src/components/shared/Layout.tsx`

Import `useLocation` from react-router-dom and `AnimatePresence`, `motion` from
`motion/react`. Import `pageTransition` from `../../lib/motion`.

**CRITICAL**: `AnimatePresence` requires a keyed child to animate transitions.
A bare `<Outlet />` won't animate because React Router reuses the component.
You MUST use `location.pathname` as the key on a wrapping `motion.div`:

```tsx
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { pageTransition } from '../../lib/motion';
import { Sidebar } from './Sidebar';
import { AppHeader } from './AppHeader';

export function Layout() {
  const location = useLocation();
  return (
    <div className="flex h-screen bg-bg-base font-sans text-text-primary">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <AppHeader />
        <main className="flex-1 overflow-y-auto p-6" id="main-content">
          <AnimatePresence mode="wait">
            <motion.div key={location.pathname} {...pageTransition}>
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
```

**NOTE:** Remove the old `TrialBanner` import if it's no longer used, or keep it
inside `AppHeader` if you want to preserve trial status display.

**Validate:** `npm run typecheck`. The new layout should render with page transitions.

---

## TASK 7: Empty State Illustrations

Create `packages/boardroom-ai/client/src/components/ui/EmptyState.tsx`

Replace the current text-only empty state with illustrated empty states.

Since we can't import image files easily, create SVG-based illustrations
directly in React components. Use simple geometric/abstract art with the
accent color palette — NOT clipart, NOT cartoon. Think: minimal line art
with indigo accents.

**Variants needed:**
1. `no-decisions` — Abstract brain/lightbulb outline
2. `no-memories` — Abstract memory/database outline
3. `no-people` — Abstract people/network outline
4. `no-goals` — Abstract target/flag outline
5. `no-data` — General empty state
6. `search-empty` — Magnifying glass with nothing found

Each includes:
- SVG illustration (80x80px)
- Title text
- Description text
- Optional action button (e.g., "Create your first goal")

**Validate:** `npm run typecheck`.

---

## TASK 8: Global Styles + Polish

### 8a. Scrollbar styling

In `index.css`:
```css
/* Custom scrollbar for dark theme */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--color-border-default); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--color-border-strong); }
```

### 8b. Selection color

```css
::selection {
  background: var(--color-accent-primary-muted);
  color: var(--color-text-primary);
}
```

### 8c. Focus styles

```css
*:focus-visible {
  outline: 2px solid var(--color-accent-primary);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
```

### 8d. Base body styles

```css
body {
  background-color: var(--color-bg-base);
  color: var(--color-text-primary);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

**Validate:** `npm run typecheck`. Visual check: app should look notably different — darker, richer, more intentional.

---

## FINAL: PHASE A REPORT

```markdown
# UI Phase A Report — Design Foundation
Date: [date]

## Completed
1. [PASS/FAIL] Dependencies installed (motion, cmdk, cva, clsx, tailwind-merge)
2. [PASS/FAIL] Design tokens (colors, typography, spacing, shadows, transitions)
3. [PASS/FAIL] Component library (Button, Card, Input, Badge, Skeleton, Toast, Tooltip, Avatar, Progress, Tabs, Select)
4. [PASS/FAIL] Motion primitives (fadeIn, slideUp, scaleIn, stagger, pageTransition)
5. [PASS/FAIL] Command palette (Cmd+K with entity search)
6. [PASS/FAIL] Layout rebuild (Sidebar, AppHeader, notifications)
7. [PASS/FAIL] Empty state illustrations (6 SVG variants)
8. [PASS/FAIL] Global styles (scrollbar, selection, focus, body)

## Component Inventory
- New UI components created: [count]
- Motion presets defined: [count]
- Design tokens: [count]

## Notes
- [Any issues encountered]
```

---

## EXECUTION ORDER

1. Task 1 — Dependencies (2 min)
2. Task 2 — Design tokens (20 min)
3. Task 3 — Component library (90 min)
4. Task 4 — Motion primitives (20 min)
5. Task 5 — Command palette (45 min)
6. Task 6 — Layout rebuild (60 min)
7. Task 7 — Empty states (30 min)
8. Task 8 — Global styles (15 min)

Begin Task 1 now. Commit after each task. Go.
