# Track F — Design System Overhaul: Follow-Ups

**Status of Wave 3 Track F:** core foundations shipped; large-surface sweeps deferred.

This file lists every deliverable that was scope-trimmed during the May-15 launch sprint
and recommends a target sprint for the remainder.

---

## Per-deliverable status

| #  | Deliverable                                          | Status     | Notes                                                                                                                                |
|---:|------------------------------------------------------|------------|--------------------------------------------------------------------------------------------------------------------------------------|
| 1  | Adopt lucide-react (replace 57 inline SVGs)          | **partial**| Lucide added; Sidebar (8 SVGs), Toast (4 unicode glyphs), Modal close, Dialog close converted. Remaining 40+ SVGs across 18 files still inline — see "Remaining lucide migration" below. |
| 2  | Radix Dialog + Tooltip + Popover + DropdownMenu      | **partial**| Dialog + Tooltip shipped (and wired). Popover + DropdownMenu installed but **no callsites migrated yet** — `CommandPalette` (cmdk-based) and the inline NotificationCenter dropdowns still hand-rolled. |
| 3  | Tokenize radius scale (`xs/sm/md/lg/full`)           | **partial**| Tokens defined in `tokens.css` + exposed via Tailwind. `Button`, `Input`, `Toast`, `Dialog`, `Tooltip` rewritten to the right rung. **The ~150-callsite `rounded-*` audit across all of `client/src/` is NOT done.** |
| 4  | Tabular numerals utility                             | **partial**| Global `.tabular-nums` class added; `Input` (when `type="number"`) and `AnimatedCount` apply it. `Progress` %, badge counts, stat cards, time-ago strings have not been swept. |
| 5  | Form-control height (`h-9` canonical)                | **shipped**| `Button` (h-9 md) + `Input` (h-9) aligned. `Select` trigger was already h-9. Custom form controls in pages not audited. |
| 6  | Button danger/success hover DARKEN                   | **shipped**| `red-700` / `emerald-700` w/ dark-mode `red-600` / `emerald-600` variants. Tests cover regression. |
| 7  | Persona color tokens (light + dark)                  | **shipped**| `--persona-*` defined for both themes in `tokens.css`. Tailwind `colors.persona.*` rewired to var() with hex fallback. |
| 8  | Sidebar tokens wired                                 | **shipped**| `text-white/40` and friends replaced with `text-sidebar-foreground{,-muted}`. Border `white/10` -> `border-sidebar-border`. |
| 9  | Phantom Tailwind classes                             | **deferred**| Wave 2 Track B already fixed most. Track G is adding the regex CI gate. Not Track F's primary concern. |
| 10 | EmptyState dedup (kill `shared/EmptyState`)          | **shipped**| Duplicate file deleted (zero importers). `ui/EmptyState` is canonical. |
| 11 | Toast pause-on-hover + ARIA                          | **shipped**| Pause-on-hover + pause-on-focus with remaining-time resume; `role="alert"`+`aria-live="assertive"` for errors, `role="status"`+`aria-live="polite"` otherwise. Tests cover both. |
| 12 | Motion tokens + prefers-reduced-motion respect       | **partial**| `--motion-duration-*` + `--motion-ease-*` tokens added; `MOTION` JS const + `motionTransition()` helper exposed from `lib/motion.ts`; `@media (prefers-reduced-motion)` zeroes durations. **Callsite migration** of Framer transitions to consume `MOTION` is NOT done — `lib/motion.ts` keeps existing presets unchanged for backward compat. |
| 13 | `--text-base` ↔ Tailwind alignment                   | **deferred**| The token (`0.875rem`) and Tailwind default (`1rem`) still disagree. Recommend overriding Tailwind's `text-base` to `0.875rem` in a follow-up commit — needs careful audit (every page hero uses `text-base`). |
| 14 | `/dev/components` test page                          | **shipped**| `pages/DevComponentsPage.tsx` routed at `/dev/components`, gated by `import.meta.env.DEV`. Tree-shaken from prod bundle. |

---

## Remaining lucide migration (deliverable #1)

23 files still contain inline `<svg>`; ~40+ paths total. Suggested batches:

1. **High-traffic surfaces** (likely visible in screenshots / demos):
   - `components/shared/AppHeader.tsx` (2 SVGs — cmd-K glyph, hamburger)
   - `components/shared/NotificationCenter.tsx` (9 SVGs — bell, dot, action icons)
   - `components/dashboard/GoalNode.tsx` / `ProjectNode.tsx` / `TaskNode.tsx` (graph node iconography)
   - `components/dashboard/WeekCalendarStrip.tsx` (chevrons)
   - `components/decision/PersonaCard.tsx` (avatar fallback if any)
2. **Onboarding** — `components/onboarding/steps/BootstrapStep.tsx` (6 SVGs); affects first-impressions.
3. **Modal-internal** — `components/shared/ShortcutsModal.tsx`, `components/memory/PersonCard.tsx`.
4. **Page-level (single SVG each)**: `MemoryExplorerPage`, `LoginPage`, `DecisionLabPage`, `DashboardPage`.
5. **AINudge.tsx** (2 SVGs — sparkle, dismiss).

Suggested approach: one commit per directory under `client/src/components/<dir>/`, plus a final commit for `pages/`.

---

## Remaining radius sweep (deliverable #3)

`grep -nE 'rounded-(xl|2xl|lg|md|sm|full)' client/src/**/*.tsx` reports ~150 hits.
Recommended pass:

- **Replace `rounded-xl` → `rounded-lg`** on cards, modals (already done in primitives; sweep feature components).
- **Replace `rounded-xl` → `rounded-md`** on buttons and inputs in feature code that doesn't use our primitives.
- **Keep `rounded-full`** for chips, avatars, pills, status dots.
- **Replace `rounded-md` → `rounded-lg`** on card-shaped containers in `dashboard/*` (currently mixed).
- **Skeletons**: pick the radius of the eventual content (i.e. `rounded-lg` for card-shaped skeletons, `rounded-md` for control-shaped, `rounded-full` for avatars).

This is mechanical and best done with a structured codemod or paired pair-review pass.

---

## Remaining tabular-nums sweep (deliverable #4)

Targets per audit:
- `Progress` % label rendering (currently no label slot — add one in a follow-up).
- `Badge` when used as a count badge (`<Badge>12</Badge>`).
- All `Date`-formatted strings in cards (DecisionLab "X hours ago", Dashboard activity feed).
- `SubscriptionSettings` / `AdminPage` currency + token usage cells.
- `MemoryCard` confidence percentage.

Suggested: scan `grep -rE "\.toFixed|\.toLocaleString|hours? ago|minutes? ago" client/src/` and wrap each `<span>` with `className="tabular-nums"`.

---

## `--text-base` decision (deliverable #13)

The current state:
- `tokens.css` defines `--text-base: 0.875rem` (14px).
- `<body>` CSS uses `font-size: var(--text-base)`.
- Tailwind's `text-base` is unaffected (1rem / 16px).
- Any element with the `text-base` class renders 2px larger than expected.

**Recommendation:** add `fontSize: { base: '0.875rem' }` (with corresponding line-height) under `tailwind.config.ts` -> `theme.extend`, then audit every `text-base` usage. ~30 callsites.

---

## Popover + DropdownMenu migration

Now that Radix is installed:
- **`NotificationCenter.tsx`** dropdown should move to `RadixDropdownMenu`.
- **`CommandPalette.tsx`** is cmdk-based; keep as-is for now (it has its own keyboard/positioning that's already good).
- The decision-mode picker chevrons in `DecisionLabPage` are good Popover candidates.

---

## Linear-grade nice-to-haves (P2 from audit)

- Card hover lift drop from `-translate-y-0.5` (2px) to 1px + shadow tint shift.
- Crossfade page transitions (drop `AnimatePresence mode="wait"`).
- Cmd-K header button → faux search input with magnifier + placeholder + chip.
- `<Kbd>` primitive — currently three different keyboard-shortcut renderings in CommandPalette / ShortcutsModal / AppHeader.
- Skeleton compositions (`CardSkeleton`, `RowSkeleton`, `AvatarSkeleton`).
- `useDelayedLoading(200ms)` hook to avoid skeleton-flash on fast responses.

---

## Bundle-size impact (this track)

Measured from clean `pnpm vite build`:

- Before Track F: `index-*.js` chunk 635 KB minified (≈ 188 KB gzipped) — estimate from pre-merge baseline.
- After Track F: `index-*.js` chunk 659.49 KB minified (194.80 KB gzipped).
- **Delta: ≈ +24 KB minified / +6.8 KB gzipped.**

Sources:
- `@radix-ui/react-dialog` + `@radix-ui/react-tooltip`: ~18 KB minified / 5.5 KB gzipped.
- `lucide-react` (tree-shaken to ~9 icons currently in use): ~1.5 KB minified / 0.6 KB gzipped.
- Net new code in primitives (Dialog, Toast, Tooltip rewrites): ~4 KB minified / 0.7 KB gzipped.

`@radix-ui/react-popover` + `@radix-ui/react-dropdown-menu` are installed but currently dead code; they will tree-shake away until the migration commits land.

---

## Sign-off

Track F's primitive layer and tokens are launch-ready. The remaining work is
*sweep* work (callsite audits) that's mechanically tedious but low-risk and
high-reward. Schedule a focused 1-day pass post-launch to land all four
sweeps (lucide, radius, tabular, text-base) together.
