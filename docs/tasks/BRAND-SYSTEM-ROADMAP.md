# Brand System Implementation Roadmap

> Claude Code execution plan for migrating from the current indigo-violet dark-only theme to the warm gold + warm neutral light/dark brand system defined in `BRAND-SYSTEM.md`.

**Estimated sessions:** 8–12 focused Claude Code sessions  
**Risk level:** High — touches every visible surface. No feature work in parallel.  
**Strategy:** Bottom-up (tokens → primitives → components → pages). Each phase is independently deployable without visual regression if the previous phase is complete.

---

## Current State vs. Target

| Dimension | Current | Target |
|-----------|---------|--------|
| Accent color | Indigo `#6366f1` | Gold `#b5890a` (light) / `#d4a31a` (dark) |
| Background philosophy | Cold blue-black (`#0a0a0f`) | Warm off-white (`#fafaf6`) light, warm near-black (`#111110`) dark |
| Token naming | Custom (`--color-bg-base`, `--color-accent-primary`) | shadcn-compatible (`--color-background`, `--color-primary`, `--color-foreground`) |
| Theme support | Dark-only | Light-first + dark mode toggle (`.dark` class on `<html>`) |
| Sidebar | Themed with app | Fixed dark palette (`#1c1b1a`), independent of theme |
| Logo | Gradient text treatment | Wordmark: "Board" = blue-600, "Room AI" = foreground |
| Persona colors | 7 custom (green/red/purple/blue/yellow/orange/cyan) | 3 defined (Operator=blue-800, Strategist=emerald-800, Skeptic=red-800) + need to define remaining 4 |
| Radius default | `rounded-lg` (8px) | `rounded-xl` (12px) |
| Fonts loaded | Inter (Google Fonts) | Inter + JetBrains Mono (Google Fonts) |
| Animations | Gradient mesh blobs, Framer Motion | `pulse-live`, `fade-in`, functional transitions only |

---

## Phase 0: Pre-Flight (1 session)

**Goal:** Snapshot current state, create migration safety net.

### Tasks

- [ ] **0.1** — Create a `brand-migration` branch off `main`
- [ ] **0.2** — Screenshot every page/state in current UI (home, auth, room, session active, session idle, settings, decision lab, memory panel, persona selector, modals). Save to `docs/brand-migration/before/`
- [ ] **0.3** — Audit every file that imports from `tokens.css` or references `--color-*` variables directly
  ```
  grep -r "var(--color" packages/boardroom-ai/client/src/ --include="*.tsx" --include="*.css" -l
  ```
- [ ] **0.4** — Audit every file using Tailwind color classes that will change (`bg-bg-base`, `text-accent`, `border-line`, etc.)
  ```
  grep -rE "(bg-bg-|text-text-|border-line|text-accent|bg-accent)" packages/boardroom-ai/client/src/ --include="*.tsx" -l
  ```
- [ ] **0.5** — Document the full mapping: old token name → new token name (see Migration Map below)
- [ ] **0.6** — Verify `npm run typecheck` and `npm run test` pass on the branch before any changes

### Output
`docs/brand-migration/TOKEN-MIGRATION-MAP.md` — a table every subsequent session references.

---

## Phase 1: Design Token Overhaul (1–2 sessions)

**Goal:** Replace `tokens.css` and `tailwind.config.ts` with brand-system-aligned tokens. Nothing visual changes yet because component classes still reference old names — this phase just lays the new foundation alongside the old one.

### Tasks

- [ ] **1.1** — Rewrite `packages/boardroom-ai/client/src/styles/tokens.css`
  - Define `:root` (light mode) with all BRAND-SYSTEM.md light palette tokens
  - Define `.dark` with all dark palette tokens
  - Keep sidebar tokens as separate block (not theme-dependent)
  - Add persona color tokens (all 7 — extend the 3 defined in brand doc, preserve existing 4 or align to brand feel)
  - Add speaker color tokens (8 indices)
  - Remove gradient mesh keyframes (replaced in Phase 3)
  - Add `pulse-live` and `fade-in` keyframes
  - **Token naming convention:** `--color-background`, `--color-foreground`, `--color-primary`, `--color-card`, `--color-muted`, `--color-border`, `--color-ring`, `--color-destructive`, `--color-accent`, `--color-warm`

- [ ] **1.2** — Rewrite `tailwind.config.ts`
  - Map new CSS vars to Tailwind: `background`, `foreground`, `primary`, `card`, `muted`, `border`, `ring`, `destructive`, `accent`, `warm`
  - Add `primary-foreground`, `card-foreground`, `muted-foreground`, `accent-foreground`, `destructive-foreground`
  - Update persona colors (keep 7, align hex values)
  - Update radius defaults: `xl: 12px` as the default component radius
  - Add custom animations: `pulse-live`, `fade-in`
  - Update shadow values to match brand (less blue glow, more neutral)
  - Add `darkMode: 'class'` to enable `.dark` class switching

- [ ] **1.3** — Load JetBrains Mono in `index.html`
  ```html
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
  ```

- [ ] **1.4** — Update `index.css`
  - Replace scrollbar styles with brand scrollbar spec (`scrollbar-thin` class)
  - Add `prefers-reduced-motion` handling for new animations
  - Remove skeleton shimmer if not in brand system (or keep if needed)
  - Ensure antialiased font smoothing is present

- [ ] **1.5** — **Backwards compatibility shim:** Temporarily add old token names as aliases pointing to new tokens so existing components don't break during migration
  ```css
  /* MIGRATION SHIM — remove after Phase 2 */
  --color-bg-base: var(--color-background);
  --color-bg-surface: var(--color-card);
  --color-text-primary: var(--color-foreground);
  --color-accent-primary: var(--color-primary);
  /* ... etc */
  ```

- [ ] **1.6** — Verify: `npm run typecheck` passes, dev server renders (may look different — that's expected with color changes flowing through shims)

### Decision Required
**Persona colors:** Brand doc only defines 3 personas (Operator, Strategist, Skeptic) but the product has 7. Options:
1. Define all 7 in the brand spec before coding (recommended)
2. Keep existing 7 persona colors, just update the 3 that have brand definitions
3. Derive remaining 4 from brand color philosophy (warm, premium, not neon)

**Recommendation:** Option 3. Proposed full set:

| Persona | Light Mode | Dark Mode | Rationale |
|---------|-----------|-----------|-----------|
| Optimist | `#065f46` (emerald-800) | `#10b981` (emerald-500) | Growth, opportunity |
| Critic | `#991b1b` (red-800) | `#ef4444` (red-500) | Risk, caution |
| Alternate | `#6b21a8` (purple-800) | `#a855f7` (purple-500) | Unconventional thinking |
| Technician | `#1e40af` (blue-800) | `#3b82f6` (blue-500) | Precision, engineering |
| Questionnaire | `#92400e` (amber-800) | `#f59e0b` (amber-500) | Inquiry, illumination |
| Doer | `#9a3412` (orange-800) | `#f97316` (orange-500) | Action, urgency |
| CEO | `#155e75` (cyan-800) | `#06b6d4` (cyan-500) | Authority, synthesis |

---

## Phase 2: Component Primitives (2–3 sessions)

**Goal:** Update all UI primitives in `components/ui/` to use new tokens and match brand component specs. Remove backwards-compat shim.

### Session 2A: Core Primitives

- [ ] **2.1** — `Button.tsx` — Rewrite CVA variants to match brand button specs
  - Primary: `rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90`
  - Secondary: `rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium`
  - Ghost: `rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted`
  - Destructive: `text-destructive hover:bg-red-50 dark:hover:bg-red-950/30`
  - Pill: `rounded-full bg-white/20 px-3.5 py-1.5 text-xs font-medium text-white`
  - All: `transition-colors`, `disabled:opacity-50 disabled:cursor-not-allowed`
  - Loading state: `Loader2 + animate-spin`, maintain button width

- [ ] **2.2** — `Card.tsx` — Update to brand card specs
  - Standard: `rounded-xl border border-border bg-card p-4`
  - Elevated/hover: `hover:shadow-md hover:border-transparent hover:-translate-y-0.5 transition-all duration-200`
  - Selected: `border-transparent shadow-md` with persona-colored border via inline style

- [ ] **2.3** — `Input.tsx` — Update to brand input spec
  - `h-10 rounded-xl border border-border bg-card px-4 text-sm`
  - Focus: `focus:ring-2 focus:ring-primary/20 focus:border-primary/40`
  - Label: `mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground`

- [ ] **2.4** — `Badge.tsx` — Update variants to use brand semantic colors + status pill patterns

- [ ] **2.5** — `Select.tsx`, `Tabs.tsx`, `Tooltip.tsx`, `Progress.tsx` — Align to brand tokens

- [ ] **2.6** — `Toast.tsx` — Update to brand semantic color scheme

### Session 2B: Layout & Navigation Primitives

- [ ] **2.7** — `Sidebar.tsx` — Critical rewrite
  - Fixed dark palette (`#1c1b1a` background) regardless of theme
  - Text opacity hierarchy: default=50%, hover=80%, active=100% white
  - Active item: `bg-white/10`
  - Section labels: `text-white/30 uppercase text-[10px] tracking-widest font-semibold`
  - Logo: "Board" in `blue-400` (dark bg), "Room AI" in white
  - Expanded: `w-56`, collapsed: `w-14`, transition: `duration-200`

- [ ] **2.8** — Create `ThemeToggle.tsx` component
  - Moon/Sun icon toggle
  - Reads/writes `localStorage` key `theme`
  - Applies `.dark` class to `<html>`
  - Detects `prefers-color-scheme: dark` as default
  - Place in top bar

- [ ] **2.9** — Create `Modal.tsx` shared component (if not already abstracted)
  - Overlay: `fixed inset-0 z-50 bg-black/50 backdrop-blur-sm`
  - Container: `rounded-2xl bg-card border shadow-2xl max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto`
  - Header/Body/Footer with brand spacing

- [ ] **2.10** — Remove backwards-compat shim from `tokens.css`

- [ ] **2.11** — Global find-and-replace: old Tailwind class names → new ones across all `.tsx` files
  - `bg-bg-base` → `bg-background`
  - `bg-bg-surface` → `bg-card`
  - `bg-bg-elevated` → `bg-card` or `bg-muted`
  - `text-text-primary` → `text-foreground`
  - `text-text-secondary` → `text-muted-foreground`
  - `border-line` → `border-border`
  - `text-accent` → `text-primary`
  - `bg-accent` → `bg-primary` (context-dependent — some may be `bg-accent`)
  - (Full list from Phase 0 migration map)

- [ ] **2.12** — Verify: dev server renders correctly in both light and dark modes. Every page.

---

## Phase 3: Page-Level Components (2–3 sessions)

**Goal:** Update all page-level and feature components to brand spec.

### Session 3A: Auth & Home

- [ ] **3.1** — `LoginPage.tsx` / `AuthScreen`
  - Remove gradient mesh blobs / parallax effects
  - Clean, warm background (`bg-background`)
  - Logo: `text-2xl font-bold tracking-tight`
  - Gold primary button for sign-in
  - Match brand voice: no exclamation marks, direct copy

- [ ] **3.2** — `HomePage.tsx` / Dashboard
  - Warm background
  - Room cards with `rounded-xl`, hover lift
  - Section labels with micro typography spec

### Session 3B: Session & Transcript

- [ ] **3.3** — `TranscriptPanel.tsx`
  - Speaker colors: implement 8-color palette from brand spec
  - Transcript entry fade-in animation (`animate-fade-in`)
  - Decision/Commitment/Risk inline highlights with colored left borders
  - Search and filter with ghost button styling

- [ ] **3.4** — `RecordingControls` (top bar)
  - LIVE badge: `rounded-full bg-white/15 px-3 py-1` with pulsing red dot (`animate-pulse-live`)
  - Pill buttons: `rounded-full bg-white/20`
  - Connection status: green dot + `text-[10px] text-emerald-300`

- [ ] **3.5** — `AdvisorPanel.tsx`
  - Persona response borders using persona colors at low opacity
  - Streaming text (no container animation — SSE streaming IS the motion)
  - Pin, rate, follow-up actions with ghost button styling

### Session 3C: Personas, Memory, Decisions

- [ ] **3.6** — `PersonaSelector.tsx` / `PersonaCard.tsx`
  - Elevated card pattern with persona-colored top border
  - Selected state: `border-transparent shadow-md` + persona color border
  - Avatar circles at full persona color strength

- [ ] **3.7** — `MemoryBankPanel.tsx`
  - Status pills: active=emerald, stale=amber, disputed=red, closed=muted
  - Light/dark mode color pairs per brand spec

- [ ] **3.8** — `DecisionLab.tsx`
  - Decision status colors: proposed=amber, approved=blue, in-progress=gold, done=emerald, revisited=purple
  - Gold-bordered decision highlights

- [ ] **3.9** — `CommitmentDashboard.tsx` — align to brand status colors

### Session 3D: Settings, Modals, Onboarding

- [ ] **3.10** — `SettingsPage.tsx`, `ApiKeySetup.tsx` — brand inputs, cards, section labels
- [ ] **3.11** — All modals (`MeetingOutputModal`, `CustomPersonaModal`, etc.) — use shared Modal pattern
- [ ] **3.12** — `Onboarding` flow — brand voice, warm tone, gold CTAs
- [ ] **3.13** — `ErrorBoundary` — destructive color scheme, retry button

---

## Phase 4: Animation & Motion Polish (1 session)

**Goal:** Replace decorative motion with functional motion per brand philosophy.

### Tasks

- [ ] **4.1** — Audit all Framer Motion usage. Remove:
  - Decorative scale-on-tap for buttons (brand says `transition-colors` only)
  - Gradient mesh background animations
  - Any spring/bounce easing (brand: `ease` or `ease-out` only)

- [ ] **4.2** — Ensure all hover states have `transition-colors` or `transition-all duration-200`

- [ ] **4.3** — Implement transcript entry `animate-fade-in` (6px translateY + opacity, 300ms ease-out)

- [ ] **4.4** — Implement LIVE badge `animate-pulse-live` (1.5s ease-in-out infinite)

- [ ] **4.5** — Card hover lift: `-translate-y-0.5` + `shadow-md` appearing, 200ms

- [ ] **4.6** — `prefers-reduced-motion`: disable all `animation`, shorten transitions to 0ms

- [ ] **4.7** — Remove Framer Motion from components where CSS transitions are sufficient (reduces bundle)

---

## Phase 5: Accessibility Pass (1 session)

**Goal:** Meet WCAG AA across both themes.

### Tasks

- [ ] **5.1** — Contrast audit: verify gold-on-white (4.5:1+), muted-foreground-on-white (4.5:1+), dark mode text ratios
- [ ] **5.2** — Focus states: all interactive elements get `focus-visible:ring-2 focus-visible:ring-primary/30`
- [ ] **5.3** — Tab order: sidebar → top bar → content panels (verify with keyboard-only navigation)
- [ ] **5.4** — `aria-label` on all icon-only buttons (close, delete, collapse sidebar)
- [ ] **5.5** — Modal focus trap verification
- [ ] **5.6** — Keyboard shortcuts: verify `R` (record), `1/2/3` (persona select) work
- [ ] **5.7** — Add `aria-live="polite"` to transcript region (brand spec marks as "future" but should do now)

---

## Phase 6: Responsive & Mobile (1 session)

**Goal:** Implement responsive breakpoints from brand spec.

### Tasks

- [ ] **6.1** — Desktop (>1024px): sidebar + split panels — verify existing layout
- [ ] **6.2** — Tablet (768–1024px): sidebar collapses by default, panels stack or tab
- [ ] **6.3** — Mobile (<768px): sidebar hidden (hamburger), tab switcher (Transcript / Advisor / Memory)
  - Selected tab: `bg-primary/10 text-primary`
  - Unselected: `text-muted-foreground`
- [ ] **6.4** — Test all modals at 375px width
- [ ] **6.5** — Ensure no horizontal scroll at any breakpoint

---

## Phase 7: QA & Cleanup (1 session)

**Goal:** Final verification, dead code removal, documentation.

### Tasks

- [ ] **7.1** — Side-by-side comparison: screenshot every page/state in new UI, compare with Phase 0 screenshots
- [ ] **7.2** — Remove all migration shims, commented-out old styles, unused CSS vars
- [ ] **7.3** — Remove old gradient mesh CSS classes if unused
- [ ] **7.4** — Grep for any remaining old token references (`--color-bg-base`, `--color-accent-primary`, etc.)
- [ ] **7.5** — Grep for any hardcoded hex values that should be tokens (especially `#6366f1`, `#0a0a0f`)
- [ ] **7.6** — Run full test suite: `npm run typecheck && npm run test`
- [ ] **7.7** — Run Implementation Checklist from BRAND-SYSTEM.md §16 against every component
- [ ] **7.8** — Update `docs/CURRENT-STATE.md` to reflect brand system completion
- [ ] **7.9** — Merge `brand-migration` → `main`, deploy

---

## Migration Map (Token Rename Reference)

### Colors

| Old Token | New Token (`:root` / light) | `.dark` Override |
|-----------|-----------------------------|------------------|
| `--color-bg-base` | `--color-background: #fafaf6` | `#111110` |
| `--color-bg-surface` | `--color-card: #ffffff` | `#1a1a18` |
| `--color-bg-elevated` | `--color-card: #ffffff` | `#1a1a18` |
| `--color-bg-hover` | `--color-muted: #f3f2ed` | `#222220` |
| `--color-bg-active` | `--color-accent: #f3f2ed` | (derive) |
| `--color-text-primary` | `--color-foreground: #1a1a16` | `#e8e8e2` |
| `--color-text-secondary` | `--color-muted-foreground: #6b6960` | `#9a9890` |
| `--color-text-tertiary` | (remove — use muted-foreground) | — |
| `--color-border-default` | `--color-border: #e6e4db` | `#2e2e2a` |
| `--color-border-subtle` | `--color-border: #e6e4db` | `#2e2e2a` |
| `--color-border-strong` | (remove — single border token) | — |
| `--color-accent-primary` | `--color-primary: #b5890a` | `#d4a31a` |
| `--color-accent-primary-hover` | `--color-primary` at 90% opacity | — |
| `--color-accent-secondary` | (remove — single accent system) | — |
| `--color-danger` | `--color-destructive: #b91c1c` | `#ef4444` |
| `--color-success` | (keep as semantic, not in core token set) | — |

### Tailwind Classes

| Old Class | New Class |
|-----------|-----------|
| `bg-bg-base` | `bg-background` |
| `bg-bg-surface` | `bg-card` |
| `bg-bg-elevated` | `bg-card` |
| `bg-bg-hover` | `bg-muted` |
| `text-text-primary` | `text-foreground` |
| `text-text-secondary` | `text-muted-foreground` |
| `text-text-tertiary` | `text-muted-foreground` |
| `border-line` | `border-border` |
| `border-line-subtle` | `border-border` |
| `text-accent` | `text-primary` |
| `bg-accent` | `bg-primary` (buttons) or `bg-accent` (surfaces) |
| `text-danger` | `text-destructive` |
| `shadow-glow` | (remove — no glow in brand) |

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Gold on white fails contrast in edge cases | Medium | Pre-test all gold text/bg combos. Gold buttons always have white text, not gold text on white bg |
| Framer Motion removal breaks layout | Medium | Remove animation props one component at a time, test each |
| Sidebar fixed dark palette conflicts with light mode borders | Low | Sidebar is self-contained; use `white/` opacity classes, not theme tokens |
| Old token references missed in grep | High | Phase 7 cleanup grep catches stragglers. CI lint rule (future) |
| Persona color changes break existing session data display | Low | Persona colors are UI-only, not stored in DB |
| Mobile tab switcher is new component, not just responsive | Medium | Plan dedicated time in Phase 6, don't squeeze into Phase 3 |

---

## Session Prompting Guide

Use these prompts to start each Claude Code session:

```
Phase 0:
"Read docs/tasks/BRAND-SYSTEM-ROADMAP.md Phase 0. Create the brand-migration branch,
audit all token/class usage, and produce the TOKEN-MIGRATION-MAP.md."

Phase 1:
"Read docs/tasks/BRAND-SYSTEM-ROADMAP.md Phase 1 and BRAND-SYSTEM.md.
Rewrite tokens.css and tailwind.config.ts to the new brand token system.
Include backwards-compat shim. Load JetBrains Mono."

Phase 2A:
"Read docs/tasks/BRAND-SYSTEM-ROADMAP.md Phase 2 Session 2A and BRAND-SYSTEM.md §6.
Update all UI primitives in components/ui/ to brand component specs."

Phase 2B:
"Read docs/tasks/BRAND-SYSTEM-ROADMAP.md Phase 2 Session 2B and BRAND-SYSTEM.md §3+§5.
Rewrite Sidebar to fixed dark palette, build ThemeToggle,
do global class rename, remove shim."

Phase 3A–3D:
"Read docs/tasks/BRAND-SYSTEM-ROADMAP.md Phase 3 Session 3[X] and BRAND-SYSTEM.md.
Update [specific page components] to brand spec."

Phase 4:
"Read docs/tasks/BRAND-SYSTEM-ROADMAP.md Phase 4 and BRAND-SYSTEM.md §8.
Audit all motion, replace decorative with functional, add brand animations."

Phase 5:
"Read docs/tasks/BRAND-SYSTEM-ROADMAP.md Phase 5 and BRAND-SYSTEM.md §13.
Run accessibility pass: contrast, focus, keyboard, ARIA."

Phase 6:
"Read docs/tasks/BRAND-SYSTEM-ROADMAP.md Phase 6 and BRAND-SYSTEM.md §5.
Implement responsive breakpoints and mobile tab switcher."

Phase 7:
"Read docs/tasks/BRAND-SYSTEM-ROADMAP.md Phase 7.
Final QA: screenshot comparison, dead code removal, grep for old tokens, deploy."
```

---

*Created: 2026-04-08*  
*Source: BRAND-SYSTEM.md v1.0*  
*Depends on: All Phase 1 work in docs/tasks/_TASK-INDEX.md being complete*
