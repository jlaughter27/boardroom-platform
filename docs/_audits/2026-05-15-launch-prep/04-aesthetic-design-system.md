# BoardRoom AI — Aesthetic & Design System Audit

**Date:** 2026-05-15
**Target bar:** Linear / Vercel / Stripe / Raycast — every detail dialed.
**Scope:** client tokens, Tailwind config, `components/ui/*` (14 primitives — listed as 15 in brief, actually 14 exported), motion utilities, all pages, and a sampling of feature components.

---

## Executive summary

**Design system maturity: 5 / 10.**

The foundation is real but the finish is not. There IS a token layer (`tokens.css` + `tailwind.config.ts`) and most UI primitives consume tokens; CVA is used for `Button` and `Badge`; Framer Motion is in place; reduced-motion is honored at the CSS layer. That puts BoardRoom ahead of "shadcn-copy-paste" land.

But this is not a Linear-grade product yet. The visual language has at least four cracks that any senior designer would clock inside a minute:

1. **Radii are inconsistent.** Tokens define `radius-sm/md/lg/xl` (matched in Tailwind), but TSX uses `rounded-lg` (86 uses) far more than the design-system "primary" `rounded-xl` (21 uses) — Button/Input/Card/CommandPalette use `xl`, while Skeleton, Modal-header chips, MemoryCard, ErrorBanner, Toast, GoalNode use `lg/md`. There is no single radius identity. Linear is `rounded-md` end to end; Vercel is `rounded-lg`; we pick a different one per file.
2. **Icons are inline hand-rolled SVGs with inconsistent stroke-widths.** 57 inline `<svg>` blocks across the codebase. Stroke widths range `1`, `1.5`, `1.8`, `2`. Sizes range from `w-4 h-4` to `w-5 h-5` to `w-[18px]`. No icon component, no library. This is the single biggest visible amateur-hour tell.
3. **The Settings page does not use the design system's primitives.** It hand-rolls a `<select>` with bespoke classes (line 167-176), and `DecisionLabPage` ships another bespoke `<select>` (line 137-144). 11 of these raw selects in the codebase. The `Select` component in `ui/` exists. Nobody uses it.
4. **Sidebar is hardcoded `text-white/40`, `bg-white/10` everywhere.** The brand decision (dark sidebar always-on) is fine, but the *implementation* skipped the dedicated `--color-sidebar-foreground*` tokens that were created for exactly this purpose. The tokens are dead code; the file uses Tailwind's `white/40` opacity utilities directly.

**What's strong**
- Solid token CSS with sane scales (spacing 0–16, radius 5-step, durations 3-step, z-index named).
- Dark mode is real (root tokens + `.dark` overrides), and the semantic color set (`success`, `warning`, `danger`, `info` with `*-muted` companions) is correctly designed.
- CVA on `Button`/`Badge` is the right pattern.
- Motion utilities in `lib/motion.ts` are coherent (5 named animations + page transition + stagger), and `prefers-reduced-motion` is short-circuited at the CSS layer.
- Sidebar active-state has a `layoutId="nav-indicator"` (Framer shared-element) — this is a Linear-grade touch.
- Skeletons exist (shimmer keyframe is on-brand with warm-gold mid-stop — clever).
- Custom scrollbars with warm-gold ring.
- Skip-to-content link present.

**What's amateur-hour**
- No icon system. Inline SVGs everywhere with mismatched strokes.
- Tabs/Select primitives exist but are bypassed by feature code that rolls its own.
- `font-bold` used 13 times — most type systems at this bar use only `medium`/`semibold` for UI weight (Linear, Vercel, Raycast: zero `font-bold` in UI chrome).
- `Button danger` variant: `hover:bg-red-400` — hardcoded color, breaks tokenization, the hover is *lighter* than the rest state in light mode (wrong direction).
- `Button success` variant: `text-background hover:bg-emerald-300` — same problem.
- `Avatar` palette has 8 hardcoded Tailwind hexes (`bg-emerald-600`, etc.). Not tokenized.
- `SubscriptionSettings`/`CalendarSettings` use `bg-green-500`, `bg-red-600/20` directly.
- `AdminPage` has the only two `dark:` overrides in the whole codebase — and it's an exception, not the rule (the rest relies on token swap).
- `bg-text-tertiary` and `border-t-line` are used in 4 files but **these classes don't exist** in the Tailwind config. They render as no-op (broken).
- `Tooltip` has no positioning library (no Floating UI / Popper) — it's always `bottom-full left-1/2 -translate-x-1/2`. Will clip at viewport edges. Not arrow-decorated.
- `Modal` is hand-rolled — not built on `Dialog` primitive, no exit animation, no scroll lock, no portal (it lives in DOM tree, can be clipped by overflow ancestors).
- No tabular numerals anywhere despite `AnimatedCount`, Progress %, score readouts, time-ago strings, currency in subscription, confidence pcts. Numbers will dance.
- The cmd-K hint button shows just `⌘K` with no surrounding label/icon — looks naked. Linear/Raycast show a search input shape.

---

## Token inventory: what exists vs what should exist

| Token category | Exists | Used everywhere? | Notes |
|---|---|---|---|
| Color core (background/foreground/card/muted/border) | Yes | ~Yes | Used through Tailwind. |
| Color primary (+ warm + text variants) | Yes | Mostly | `primary-text` and `primary-warm` exist; only used in 2-3 spots. |
| Semantic (success/warning/danger/info + muted) | Yes | Yes in primitives; bypassed in some feature code | `SubscriptionSettings` reaches for `bg-green-500` instead of `bg-success`. |
| Persona colors | Yes (hardcoded hex in Tailwind config) | Yes | Tailwind config comments admit "Phase 5 will add CSS var indirection." Currently not dark-mode-aware. |
| Status colors (active/pending/done/...) | Yes (hardcoded hex) | Inconsistently | `StatusBadge` maps to Badge variants instead of using these. The status colors are dead. |
| Sidebar tokens | Yes (intentionally non-flipping) | **No** — Sidebar.tsx ignores them and uses `white/10`, `white/40`, etc. | Tokens are dead weight. |
| Shadows (sm/md/lg) | Yes | Yes, plus 1 stray `shadow-xl` (LoginPage). | Only 18 usages total — shadow restraint is good. |
| Radius (sm/md/lg/xl/full) | Yes | **No** — `rounded-lg` (86) and `rounded-md` (46) dominate over the system "primary" `rounded-xl` (21). No identity. |
| Type scale (xs/sm/base/lg/xl/2xl/3xl) | Yes in CSS | Tailwind reads its own (since `extend` doesn't override `fontSize`). | **Mismatch: tokens.css defines `--text-base: 0.875rem` but Tailwind's `text-base` is still `1rem`.** Worth verifying — tokens are decorative if Tailwind never reads them. |
| Line-height tokens | Yes (3 values) | No — `leading-relaxed`, `leading-tight` used directly from Tailwind defaults. Tokens are decorative. |
| Letter-spacing tokens | Yes (3 values) | No — `tracking-tight`, `tracking-wide` used directly. Tokens decorative. |
| Duration (fast/normal/slow) | Yes; mapped in Tailwind `transitionDuration` | Half-used. Components mix `duration-fast` with `duration-300` (Progress), Framer hardcodes 0.15/0.2/0.25/0.3/0.4/0.5/0.6. | |
| Easing | `--ease-default`, `--ease-out` defined but **never used** | No | Framer has 4 different bezier arrays hardcoded across files. Easing is not a system; it's an aesthetic accident per file. |
| Z-index scale | Yes (named) | Yes, mostly via `z-[var(--z-toast)]` syntax | Good. One exception: `Modal.tsx` uses `z-50` literal. |
| Spacing | Yes (0/1/2/3/4/5/6/8/10/12/16) | Yes (Tailwind defaults are aligned to 4px). | Good. |
| Font family (sans/mono/display) | Yes | Yes | `display` font is same as `sans` — token exists but is not visually distinct. Either differentiate or drop. |

**Missing tokens that should exist (P1):**
- Focus ring offset/width.
- Border opacity scale (`border-subtle`, `border-strong`).
- Hover background overlay (`--color-hover-overlay`).
- Card hover-lift transform distance.
- Inset rings (used ad-hoc in Dashboard for `ring-1 ring-inset ring-primary/20`).

---

## Component-by-component primitive review

### 1. Button (`Button.tsx`) — B
- Good: CVA, forwardRef, ButtonHTMLAttributes spread, focus ring via `focus-visible:ring-2 focus-visible:ring-ring`.
- Bad:
  - `danger: 'bg-destructive text-white hover:bg-red-400'` — `red-400` is a raw Tailwind color, lighter than the rest in light mode (hover should darken, not lighten — Linear/Vercel rule).
  - `success: 'bg-success text-background hover:bg-emerald-300'` — same bug; also `text-background` makes a green button with cream text which inverts the readable hierarchy.
  - `size` map locks all three to `rounded-xl` — that's actually consistent within Button, but mismatched with Card (`rounded-xl`) and Modal (`rounded-xl`) vs. Toast (`rounded-lg`) vs. Skeleton (`rounded-md`).
  - No `loading` state. No `leftIcon`/`rightIcon` slots. No `asChild` polymorphism (you can't render a Link with Button styles without re-wrapping).
  - No `iconOnly` size — many sites do `<Button>{svg}</Button>` and end up with too much horizontal padding.

### 2. Card (`Card.tsx`) — B-
- Good: Dot-syntax composition (Card.Header / Card.Body / Card.Footer); hover prop with `-translate-y-0.5` lift.
- Bad:
  - Hover removes the border AND shifts (`hover:border-transparent hover:-translate-y-0.5`) — when border goes transparent the shadow compensates, but on a hover-card grid the border-flickering is visible.
  - `Card.Body` is empty `cn('')` — pointless wrapper. Use `Fragment` or drop the slot.
  - Default `p-4` (16px) — but `SettingsPage` overrides with `p-6` (24px) on every card. No `padding` prop. Magic-string overrides everywhere.
  - No `variant` slot (subtle, outlined, elevated). Today every card is one shape.

### 3. Input (`Input.tsx`) — B
- Good: Label, error, forwardRef, label auto-derives id.
- Bad:
  - `h-10` (40px) on Input, `h-9` (36px) on Select trigger, `h-9` on Button md. Form rows visually misalign. Linear/Vercel pin everything to one height.
  - `focus:ring-2 focus:ring-ring focus:border-primary/40` — both ring AND border-tint stack; result is a 2px halo overlapping a thicker-feeling edge. Pick one.
  - No `<TextArea>` primitive. 8 files reach for raw `<textarea>` with different classes.
  - No `leftIcon` slot, no `prefix`/`suffix` decoration, no `description`, no `optional` flag.
  - Required state has no visual cue (no asterisk, no "required" badge).

### 4. Select (`Select.tsx`) — C+
- Good: Keyboard nav (Arrow keys, Enter, Escape), click-outside, motion on open.
- Bad:
  - **Not used anywhere in pages or forms.** 11 raw `<select>` elements in the codebase ignore this primitive.
  - No portal — opens inside ancestor scroll containers. Will clip.
  - `focusIndex` is set on Arrow but never visually reset; after closing-without-selecting the highlight persists.
  - No multi-select, no search/typeahead, no `disabled` per-option.
  - The chevron is hand-rolled inline SVG — should be the same icon as elsewhere.

### 5. Tabs (`Tabs.tsx`) — C
- Good: `motion.div layoutId="tab-indicator"` is the right shared-element pattern.
- Bad:
  - `<Tabs>` takes `tabs={[{id,label,content}]}` — meaning content is computed eagerly for every tab on every render. No lazy rendering, no `onSelect`-without-content split. Linear separates `<TabList>` and `<TabPanel>` to allow this.
  - No `disabled` per-tab.
  - No `vertical` variant.
  - Active-tab indicator is a 0.5px line — fine, but `transition={{ duration: 0.2, ease: 'easeOut' }}` uses string easing while other files use bezier arrays — inconsistent motion vocabulary.
  - On mobile the tabs row will horizontal-scroll-clip silently — no overflow indicators.

### 6. Badge (`Badge.tsx`) — A-
- Good: CVA with semantic variants, `solid` compound variants, color tokens used correctly.
- Bad:
  - Solid `success: 'bg-success text-background'` — in dark mode `--color-background` is `#111110` and `--color-success` is mint `#34d399`. Mint background + near-black text is OK contrast. In light mode `--color-success` is `#15803d` (forest green) and `text-background` is `#fafaf6` cream — OK. But `text-warning solid` is `bg-warning text-background`: orange-on-cream, low-contrast (~3.4:1 in light mode). Fails AA for non-large text.
  - No `icon` slot (a green check next to "Synthesized" badge would read instantly).
  - No `dismissible` variant for filter chips.

### 7. Avatar (`Avatar.tsx`) — C+
- Good: Hash-based stable color, initials fallback, title attribute.
- Bad:
  - Hardcoded Tailwind palette (`bg-emerald-600`, etc.) — not tokenized, won't shift in dark mode (the saturated greens/cyans/roses look fine on light, washy on dark cream).
  - No image support (`src?: string`) — every avatar is always initials. Linear/Stripe support both.
  - No status indicator dot composition (online/offline/away).
  - No size > `lg`. Settings/profile pages will want `xl` (64px).
  - Title attribute is the only accessible name — should be `aria-label`.

### 8. Toast (`Toast.tsx`) — B
- Good: Zustand store pattern, motion enter/exit, popLayout mode, `aria-live="polite"`, dismiss button.
- Bad:
  - 4000ms auto-dismiss is **un-pausable** — no hover-to-pause, no `onMouseEnter` clearing the timeout. Power users will lose toasts they're reading.
  - No focus management — can't keyboard-dismiss without tab-hunting.
  - No "Action" slot (toast with "Undo" button is core to optimistic UI patterns).
  - Icon glyphs are unicode characters (`✓`, `✗`, `⚠`, `ℹ`) — rendered in the system font, not a consistent icon set. Inconsistent baseline.
  - Width pinned `w-80` — overflows on narrow mobile? It's `right-4` so probably fine, but no md: breakpoint adjustment.
  - No swipe-to-dismiss on mobile.

### 9. Tooltip (`Tooltip.tsx`) — D
- Good: 300ms hover delay (matches OS convention).
- Bad:
  - **No positioning logic.** Always renders `bottom-full left-1/2`. Will clip off-screen, get hidden under sticky headers, and overlap modals.
  - No `side` / `align` props.
  - No arrow.
  - No portal — re-parented under whatever the parent is.
  - No `delayOpen` / `delayClose` separation (entering one tooltip then another should not 300ms-restart).
  - Wrapping element is a `<div className="relative inline-flex">` — wraps children in a div. Inline elements (a/span) will break flow.
  - This needs to be replaced with `@radix-ui/react-tooltip` or `floating-ui` outright.

### 10. Skeleton (`Skeleton.tsx`) — B+
- Good: 1-liner, on-brand shimmer (warm-gold mid-stop is a nice touch), aria-hidden.
- Bad:
  - `rounded-md` baked in — Skeletons for `rounded-xl` content (Button/Input) have mismatched corners during loading → snap visible on hydrate.
  - No `circle` variant for Avatar skeleton.
  - Shimmer animation is `1.5s linear` infinite — high motion. Should respect `prefers-reduced-motion` more explicitly (the global CSS does cut it to 0.01ms which actually breaks the visual — better to swap to a static muted bg).

### 11. Progress (`Progress.tsx`) — C
- Good: Value clamped, smooth transition.
- Bad:
  - `transition-all duration-300` — hardcoded 300ms, ignores duration tokens.
  - No `aria-valuenow`/`aria-valuemax` (not announced to screen readers).
  - No `indeterminate` variant.
  - No `variant` for danger/success states (used in `PersonaCard` for confidence — would benefit from being colored by value).
  - No `label`/`description` slot.

### 12. AnimatedCount (`AnimatedCount.tsx`) — B
- Good: Uses Framer motion values (60fps), abort on unmount.
- Bad:
  - No `tabular-nums` — digits will reflow horizontally as values cross 1→10→100 boundaries.
  - No format function — can't show `1.2k`, currency, percentages without wrapping.
  - Starts from 0 every mount. If a user navigates back and forth between pages, every dashboard stat re-counts from 0. Annoying.

### 13. CommandPalette (`CommandPalette.tsx`) — B
- Good: cmdk library, backdrop blur, scale+y motion, keyboard handler, group headers, recent-entity surfacing.
- Bad:
  - **All "Goals/Projects/People" items navigate to a generic route, not the entity detail** (`navigate('/')` for goals).
  - Icons are unicode glyphs — `⌂`, `⚖`, `☁`, `☆`, `⚙`, `☺`, `⚡`. Mismatched style/baseline.
  - No recent-actions section, no "Get help", no shortcut hints next to each command.
  - No fuzzy match scoring shown.
  - No "↓ ↑ to navigate, ↵ to select" footer beyond just "esc to close."
  - Backdrop is `bg-black/60 backdrop-blur-sm` — fine in dark, slightly heavy in light mode where Linear uses `bg-black/30`.

### 14. EmptyState (`EmptyState.tsx`) — A-
- Good: 6 hand-drawn SVG illustrations using token colors, optional CTA. Tasteful.
- Bad:
  - The illustrations break visually if `--color-primary` is overridden by branding — but that's not a real risk yet.
  - Title sizing is `text-base` — surprisingly small. Linear/Vercel empty-states use `text-lg` or `text-xl` titles.
  - No "secondary action" slot ("Learn more" link alongside CTA).

### 15. PageWrapper (`PageWrapper.tsx`) — C
- Good: Single source for page-enter motion.
- Bad:
  - It's a 1-line motion wrapper. Doesn't standardize page padding, max-width, h1 placement. Every page redefines `p-6 max-w-Xxl mx-auto` differently (see consistency section).
  - PageWrapper should own the layout shell: header slot, breadcrumb slot, action slot, content slot.

### (15b. Toaster) — separate from Toast — re-counts above.

---

## Cross-page consistency findings

### Page chrome — different across every page

| Page | Outer wrapper | Padding | Max-width |
|---|---|---|---|
| Dashboard | `motion.div` | `p-6` | `max-w-5xl` |
| Decision Lab | `<div>` | `p-6` | `max-w-4xl` |
| Decision Session | `<div>` | `p-6` | `max-w-4xl` |
| Memory Explorer | `<div>` | `p-6` (no max-w!) | full-bleed |
| People Directory | `<div>` | `p-6` | `max-w-5xl` |
| Settings | `<div>` | `py-8 px-4` | `max-w-4xl` (with flex sidenav) |
| Custom Personas | `<div>` | `py-8 px-4` | `max-w-3xl` |
| Integrations | `<div>` | `py-8 px-4` | `max-w-3xl` |
| Admin | (not read but indexed) | — | — |
| Onboarding | flex center | varies | `max-w-2xl` |

**Five different padding strategies** (`p-6`, `py-8 px-4`, `p-4 md:p-6` (Layout main), full-bleed). **Four different max-widths** (`3xl`, `4xl`, `5xl`, none).

### Page headers — also different

- Dashboard: h1 with primary-gradient accent bar + subtitle + customize button.
- Decision Lab: h1 with subtitle (`{count} decisions analyzed`) + new button.
- Memory Explorer: h1 only, no subtitle, no action button (action is in sub-component).
- Settings: h1 only, no subtitle, side-nav for sections.
- People Directory: h1 + button, no subtitle.
- Login: bespoke 2-column layout.

There is no `<PageHeader>` primitive. Every page reinvents.

### Form patterns — different

- Settings uses `<Card><Input /><Input /><Button>Save</Button></Card>` with mixed Inputs and raw `<select>`s and raw `<input type="range">`s.
- People Directory has its own add-person form inline (not in a Modal). Uses Input components + textarea raw.
- Custom Personas has a `PersonaEditor` with a raw textarea.

No `<Form>` primitive, no `<FormRow>`, no `<FormSection>`, no `<TextArea>` primitive.

### Skeleton patterns — different

- Dashboard: `<Skeleton className="h-48 rounded-lg" />` per widget.
- Settings: `<Skeleton className="h-48 rounded-lg" />` (matches by accident).
- Decision Lab: `h-20 rounded-lg`.
- Admin: `h-10 rounded-md` (different radius!).
- RecentDecisions: `h-14 rounded-md`.

No skeleton component compositions for common shapes (CardSkeleton, RowSkeleton, AvatarSkeleton).

### Filter/sort UI — appears 3+ times, each time different

- DecisionLab: pill buttons + raw `<select>` for sort.
- MemoryExplorer: `MemorySearch` with 3 raw selects.
- PeopleDirectory: search input + Tabs component for directory/map.

No `<FilterBar>` primitive. No `<SortControl>`. Each filter row has different vertical alignment and different focus styling.

---

## Motion language audit

### Coherent
- 5 named entrance animations (`fadeIn`, `slideUp`, `slideIn`, `scaleIn`, `pageTransition`).
- Stagger pattern (`staggerContainer` + `staggerItem`) used consistently in lists.
- `prefers-reduced-motion` neutralizes via global CSS rule (`animation-duration: 0.01ms`).

### Incoherent
- **Easing is a free-for-all.** Across the codebase:
  - `[0.4, 0, 0.2, 1]` (cubic-bezier "smooth out" — Material's standard) — 3 places.
  - `[0.34, 1.56, 0.64, 1]` (spring-back) — 2 places.
  - `[0, 0, 0.2, 1]` (ease-out-quint) — 1 place (pageTransition).
  - `'easeOut'` (string) — Tabs, OnboardingPage.
  - `'linear'` — WizardStep spinner.
  - Default (Framer's `easeInOut`) — everywhere else.
  - **`--ease-default` and `--ease-out` exist in tokens.css and are never used.**

- **Durations are a free-for-all.** Across:
  - `150ms` (= `duration-fast`) — used in CSS via tokens.
  - `0.15s / 150ms` — used in 6 Framer files.
  - `0.2s / 200ms` (= `duration-normal` is 250ms, so 200 doesn't even match a token) — used in 8 places.
  - `0.25s / 250ms` — 2 places.
  - `0.3s` — Progress, pageTransition.
  - `0.4s / 0.5s / 0.6s` — Login + Onboarding hero.
  - `1.2s` (Persona dots), `1.5s` (skeleton shimmer), `1s linear` (spinner).
  
  None of the Framer transitions consume the duration tokens (they can't easily — Framer expects seconds-as-number, tokens are in ms-string). Solution: re-export `MOTION_DURATION = { fast: 0.15, normal: 0.25, slow: 0.4 }` as a JS constant in `motion.ts` and reference from every transition.

- **PersonaCard "thinking" animation** uses `[0.3, 1, 0.3]` over 1.2s with 0.2s delay — but it dots-color is `bg-text-tertiary` (which is broken — that class doesn't exist in Tailwind config). Quite literally invisible animation.

- Sidebar drawer (mobile) uses `ease: [0.4, 0, 0.2, 1]` for 0.2s. Sidebar collapse (desktop) uses the same easing for 0.2s. Good.

- **Card hover lift** uses `-translate-y-0.5` (2px). Linear/Vercel uses 1px. 2px reads heavy in dense grids; consider dropping to 1px and adding a 0.5px shadow-tint shift.

- **No page-exit animation timing** — `pageTransition` exits `y: -6, opacity: 0` in 0.3s, but `AnimatePresence mode="wait"` makes pages stagger awkwardly (old page fades out fully before new page enters). Linear uses a crossfade with the old page sliding 4px out as the new slides 4px in simultaneously — try `mode="popLayout"` or remove the `mode` prop.

- **No focus-state animations.** Hover transitions are everywhere (`hover:bg-muted transition-colors`), but focus-visible never animates the ring in — it pops. Apple/Linear soften this with a 100ms ring fade.

---

## Top 10 visible polish gaps (the 30-second-designer-call-out list)

1. **No icon system.** 57 inline SVGs, three stroke widths, four sizes. Replace with `lucide-react` (free, tree-shakable, matches the line-weight aesthetic of Linear/Vercel) or `@phosphor-icons/react`. Single biggest visual upgrade.
2. **`text-bold` / `font-bold` (13 places) where `font-semibold` would suffice.** Look at LoginPage: `text-4xl font-bold` hero. Linear's hero is `font-semibold`. Bold reads "marketing site," semibold reads "product."
3. **Form heights misalign.** Input `h-10`, Select trigger `h-9`, Button `h-9`. Side-by-side they're 4px off. Pick one (preferably `h-9` for compact density) and ship a `--control-height` token.
4. **Tooltip clips off-screen** and has no arrow. Replace with `@radix-ui/react-tooltip`.
5. **Modal has no animation, no portal, no scroll lock.** A modal popping in instantly with no scale/fade is the biggest "this is a prototype" tell. Replace with `@radix-ui/react-dialog`.
6. **Raw `<select>` everywhere.** 11 native selects with bespoke per-file styling. They render OS-style on each browser — completely break the design language. Use `Select` primitive (and add portal support to it).
7. **Numbers aren't tabular.** AnimatedCount, Progress %, score readouts, currency, "12 decisions analyzed" — all proportional digits, all reflow. Add `font-variant-numeric: tabular-nums` to all numeric containers (or make `tabular-nums` a body-class on numeric cells).
8. **Sidebar uses `text-white/40` instead of the dedicated sidebar tokens.** The tokens (`--color-sidebar-foreground`, `--color-sidebar-foreground-muted`) exist for this exact use case. Rewrite Sidebar to use them. Currently the tokens are unused dead weight.
9. **Persona cards have a 3px top border in the persona color, but the rest of the card is identical to every other card.** That's a thin reed. Either lean in (give the persona color real surface presence — a tint background, a small color-dot badge near the title, a colored expand-chevron) or drop it. Right now it reads as a printer error.
10. **The `cmd+K` button in the header is unstyled.** It's a tiny `kbd` glyph in a 1px border. Linear/Vercel/Raycast render a faux-search-input shape with magnifier icon + "Search..." placeholder + `⌘K` chip on the right. Currently ours is just `⌘K` floating in a border-pill. Looks like an unfinished prototype.

---

## Other findings (numbered, P0 / P1 / P2)

### P0 — Broken / wrong

11. **`bg-text-tertiary` and `border-t-line` classes are referenced but not defined in Tailwind config.** Files: `components/decision/PersonaCard.tsx:74, 63`, `components/dashboard/StatusBadge.tsx:41`, `components/settings/SubscriptionSettings.tsx:161`. These render as no-op. Fix: add tokens or replace with existing (`bg-muted-foreground/40`, `border-t-border`).
12. **`Button danger` hover lightens in light mode** (`hover:bg-red-400` against `bg-destructive` = `#b91c1c`). Hover should darken in light mode. Fix: `hover:brightness-90` or token-based hover state.
13. **`Button success` same issue** (`hover:bg-emerald-300`). And the rest-state uses `text-background` (cream) on success-green which has only 4.1:1 contrast in light mode — borderline AA for large text only.
14. **Tooltip never portals and never repositions** — will clip in any overflow-hidden container (which is most of the app — the `main` scroller and most cards).
15. **Toast auto-dismiss is not pause-on-hover.** Loses content if user hovers to read. Fix: pause timer on `onMouseEnter`.
16. **Modal lacks scroll-lock + portal + exit animation + ESC focus restoration to trigger.** Hand-rolled, not based on Radix.
17. **Progress has no aria attributes.** Fails A11y.
18. **AdminPage is the only file with `dark:` overrides** (`text-green-600 dark:text-green-400`, `bg-yellow-100 ... dark:bg-yellow-900/30 ...`). Either commit to `dark:` everywhere (mainstream Tailwind approach) or strip these and use semantic tokens (current convention). Right now it's mixed.
19. **`SubscriptionSettings`/`CalendarSettings` use `bg-green-500`, `bg-red-600/20`, hand-rolled buttons with non-Button classes.** These pages will look subtly off-brand the moment the brand color shifts.
20. **`text-base` (Tailwind default 16px) vs `--text-base` token (0.875rem / 14px) — Tailwind doesn't read the CSS var for font-size**. Tokens define `--text-base: 0.875rem` but `<body>` uses `font-size: var(--text-base)` (14px) — yet any element with `text-base` Tailwind class gets 16px. There's a hidden inconsistency where the body inherits 14px and child elements with `text-base` jump to 16px. Verify in browser.
21. **`font-display` is identical to `font-sans`.** The token exists as if it's a separate family. Either ship Inter Display / Söhne / another display face, or remove the token.

### P1 — Inconsistent

22. **Radius identity:** 86 × `rounded-lg`, 46 × `rounded-md`, 21 × `rounded-xl`, 45 × `rounded-full`, 4 × `rounded-2xl`, 1 × `rounded-sm`. Pick one for surfaces (likely `lg`), one for chips (`md` or `full`), one for buttons/inputs (`lg`, not the current `xl` — `xl` reads pillowy on small controls).
23. **No `<PageHeader>` primitive.** Each page reinvents. Build:
    ```tsx
    <PageHeader title="" subtitle="" breadcrumbs={[]} actions={...} />
    ```
24. **No `<PageShell>` / `<Section>` primitive** — every page has different padding/max-w. Build one with `density`/`maxWidth` props.
25. **No `<TextArea>` primitive.** 8 raw textareas across feature components.
26. **No `<FormRow>` / `<FieldGroup>`.** Settings hand-builds them.
27. **`StatusBadge`/`LevelBadge`/`DomainBadge` exist as 3 tiny components in `dashboard/` but should live in `ui/` and be discoverable.**
28. **Avatar palette is hardcoded** (`bg-emerald-600`, etc.). Should be a token set (`--avatar-1...8`) so dark mode can re-tune saturation.
29. **Persona colors not dark-mode aware.** Currently `optimist: '#22c55e'` (light-green) reads sour on dark cream `#111110`. Tailwind config comment admits "Phase 5 will add CSS var indirection" — that work is now overdue if dark mode is shipping.
30. **`Tabs` component is used in some pages but `DecisionLabPage` rolls its own pill-tabs** (the FILTER_TABS row) because `Tabs` only supports tab+content pairs. Need a `Tabs.List`-only variant for filter chips.
31. **`focus-visible:` is used in Button + global CSS** but **never in feature code** (zero `focus-visible:` outside Button.tsx). Most clickable divs/buttons in pages will rely on global `*:focus-visible` from `index.css` — fine, but not customizable per-control.
32. **Sidebar nav items have `min-h-[44px]`** (good — 44pt touch target), **but Header buttons, mobile hamburger, and CommandPalette items don't** (the `p-2` mobile hamburger is 36×36 — sub-AA touch).
33. **`Logo` import is from `shared/Logo` (file exists, 97 lines) but the brand mark is also rendered inline in LoginPage with a separate drop-shadow**. Hard-coded glow. Move to Logo as a `glow` prop.
34. **`ThemeToggle`** displays `Light`/`Dark`/`System` text but the icons are arbitrary unicode glyphs `☾`, `☀`, `◐` — would look more intentional with `sun` / `moon` / `monitor` SVGs. Also: lives in the sidebar (dark surface) and uses `text-white/40` directly — should use `text-sidebar-foreground-muted`.
35. **No reduced-motion respect in Framer-driven motion specifically.** Global CSS cuts transitions to 0.01ms — that catches CSS-driven animations and Framer's underlying transforms, but **Framer transition `duration: 0.25` is not affected by CSS** — Framer animates via JS rAF. There's a `useReducedMotion` hook defined in `lib/motion.ts` that's **never used in any component**. Audit your Framer transitions and short-circuit them with `useReducedMotion()`.

### P2 — Could be better

36. **No skeletons for the persona cards during streaming.** PersonaCard's "thinking" state is 3 dots — fine — but no skeleton shimmer to match the eventual card shape. Layout jumps when the response arrives.
37. **No optimistic UI patterns** documented anywhere — no `useOptimisticMutation` hook, no skeleton-to-content fade utilities.
38. **No success confirmation animations.** Save buttons toggle `'Saving...'` → toast. A subtle check-mark micro-animation on the button would feel premium.
39. **No selection styling for text outside `::selection`.** Multi-select lists (memory cards) don't have a "selected" visual beyond border. Add a soft `bg-primary/5` fill for selected rows.
40. **Scrollbar on `<main>` is always visible (always-on track) on macOS/Linux** because of the global webkit-scrollbar override. Default overlay scrollbars on Mac look better; consider gating on `(hover: hover)` or `!important` only inside `.scrollbar-thin`.
41. **`<select>` raw form on Settings page** uses `focus:ring-1 focus:ring-ring/30` but `Input` uses `focus:ring-2 focus:ring-ring`. Two ring widths.
42. **No `<Kbd>` primitive** despite kbd elements appearing in CommandPalette, AppHeader, ShortcutsModal. Each one styled differently.
43. **No empty-state for the right pane of MemoryExplorer** — there's an inline SVG note ("Select a memory to view details"). Should use `<EmptyState variant="select-prompt">`.
44. **MemoryCard tags use `text-[10px]`** — arbitrary, off-scale. Type scale stops at `xs` (12px). 10px should be a defined `text-micro` token or be raised to 11px.
45. **Confidence colors in MemoryCard** map `MEDIUM` and `LOW` both to `text-warning` — that collapses two states to one color. Add a third tier.
46. **Dashboard header has a primary→primary-warm gradient bar** on the greeting (line 98). This is the *only* place that gradient appears. If it's an anchor, replicate in PageHeader. If not, drop it.
47. **`leading-relaxed` is used for paragraph text but bumped to `leading-normal` in cards** — typography mood shifts between contexts without a reason articulated in tokens. Define `--leading-body` vs `--leading-ui`.
48. **`tracking-wide` is used on micro-uppercase labels** (`text-xs uppercase tracking-wide`) — good pattern, but the actual value is `0.025em` (subtle). Linear/Vercel use `0.05em` for uppercase. Bumping helps readability and adds editorial polish.
49. **NotificationCenter (218 lines) not reviewed in depth** — likely the same patterns as other shared components.
50. **No `<Surface>` / elevation primitive.** Cards, modals, popovers, dropdowns all reach for `bg-card border border-border` (or `bg-card/95 backdrop-blur-xl` for popovers). Codify elevations: `surface-flat`, `surface-raised`, `surface-floating`.
51. **`*:focus-visible` global outline is `2px solid var(--color-ring)` with `outline-offset: 2px`.** `--color-ring` is `rgba(181, 137, 10, 0.3)` — 30% opacity gold. Against `--color-card` cream it's barely visible (low contrast). Bump to 50% or use a solid `var(--color-primary)` ring at thinner stroke (1.5px).
52. **The cmd palette icons line up by width** (`w-5 text-center`) but the unicode glyphs are different visual weights (`⚖` is heavy, `☆` is wispy). Replaces with lucide icons.

---

## Priority recommendations

### P0 — Fix before launch (broken / wrong / a11y)
- [P0] Remove `bg-text-tertiary` / `border-t-line` references (5 files) — they're no-ops.
- [P0] Fix Button danger/success hover directions and token-leakage.
- [P0] Replace Tooltip with `@radix-ui/react-tooltip` (or floating-ui).
- [P0] Replace Modal with `@radix-ui/react-dialog` (gets you portal, scroll-lock, focus-trap, animations).
- [P0] Add `aria-valuenow/min/max` to Progress.
- [P0] Verify token `--text-base: 0.875rem` vs Tailwind default `text-base: 1rem` — pick one and apply uniformly.
- [P0] Persona color CSS var indirection so dark mode renders correctly.
- [P0] Pause-on-hover for Toast.
- [P0] AdminPage's `dark:` overrides — remove and re-do with semantic tokens.

### P1 — Inconsistency / system gaps (next sprint)
- [P1] Adopt `lucide-react` (or phosphor). Replace all 57 inline SVGs.
- [P1] Replace all raw `<select>` with `Select` primitive (add portal + viewport-flip).
- [P1] Build `<PageHeader>`, `<PageShell>`, `<TextArea>`, `<FormRow>`, `<Kbd>`, `<Surface>` primitives.
- [P1] Replace `text-white/*` colors in Sidebar/ThemeToggle with `--color-sidebar-foreground*` tokens.
- [P1] Settle on one radius identity. Strong recommendation: `rounded-lg` (0.5rem) for surfaces, `rounded-md` for compact controls, `rounded-full` for chips/avatars. Stop using `rounded-xl` for buttons — too round for the typeface weight.
- [P1] Replace `<Avatar>` palette with tokenized scale (or color algorithm based on `--color-primary` hue rotation).
- [P1] Tokenize easing — re-export `MOTION` consts from `motion.ts` and forbid hardcoded bezier arrays / durations in Framer transitions.
- [P1] Audit and remove `font-bold` usages (down to `font-semibold` everywhere). Reserve `font-bold` for narrative headings only.
- [P1] Add `tabular-nums` to all numeric containers (badges with counts, AnimatedCount, Progress %, times, currency).
- [P1] Wire `useReducedMotion()` into Framer transitions.
- [P1] Promote `StatusBadge`/`LevelBadge`/`DomainBadge`/`PriorityDot` to `components/ui/`.

### P2 — Polish (post-launch but visible)
- [P2] Custom focus-ring animation (fade-in 100ms).
- [P2] Page transition: ditch `mode="wait"` for true crossfade.
- [P2] Card hover lift: 1px instead of 2px; add shadow-tint shift.
- [P2] Skeleton shapes for common compositions (`CardSkeleton`, `RowSkeleton`, `AvatarSkeleton`).
- [P2] Empty-state titles bigger (`text-lg` instead of `text-base`).
- [P2] Build `<FilterBar>` for the filter/sort row pattern.
- [P2] Add `<Kbd>` primitive.
- [P2] Cmd-K header button → faux-search-input shape with magnifier + placeholder + chip.
- [P2] Tracking-wide uppercase labels → `tracking-[0.05em]`.
- [P2] Selection state for memory list rows.
- [P2] Success state on save buttons (micro check).
- [P2] Toast: Action slot, swipe-to-dismiss on mobile.

---

## Reference inspiration

| Pattern | What Linear/Vercel/Stripe/Raycast does | What we should do |
|---|---|---|
| Tabs | Linear uses `border-b-2` active indicator that slides via shared `layoutId` — same as ours. But content is rendered lazily and tabs are `data-state` driven (Radix). | Lift our Tabs to Radix Tabs; keep the motion overlay. |
| Tooltip | Linear/Vercel use Radix Tooltip with `side="top"`, 4px arrow, 200ms delay, 4px padding, `text-xs`, `bg-foreground text-background`. | Use Radix Tooltip with same defaults. Our colors match, only positioning is wrong. |
| Cmd-K trigger in header | Linear/Vercel render a faux-input: `<button class="w-64 flex items-center gap-2 px-3 h-9 rounded-md border bg-card text-muted-foreground"><Search/> Search... <kbd class="ml-auto">⌘K</kbd></button>` | Replace our 1-glyph button with this shape. |
| Icon set | All four use stroke-based monoline icons (Linear: custom lucide-fork, Vercel: Geist Icons, Stripe: bespoke set, Raycast: lucide). | Adopt `lucide-react` (1.5px stroke matches our SVG inline strokes). |
| Form heights | All use a single control height (32px Linear / 36px Vercel / 40px Stripe). | Pin to 36px (`h-9`) for compact density. |
| Empty states | Linear uses small monoline icon + 16px title + 13px description + ghost-button CTA. Vercel similar. | Ours is close. Bump title to `text-lg`. |
| Modal | Radix Dialog with portal, scroll-lock, animation, ESC-restore-focus. | Replace ours with Radix Dialog. |
| Color hover | Linear: `hover:bg-foreground/[0.04]`. Vercel: same. Stripe: subtle tints. | We use full `hover:bg-muted` which is `#f3f2ed` — a real surface change, not a hint. Tone down for compact controls. |
| Tabular numerals | All four use `font-variant-numeric: tabular-nums` on numeric cells. | Add to body or to a `.num` utility class and apply to AnimatedCount, badges, etc. |
| Page transitions | Linear: no transition (instant). Vercel: 100ms opacity fade. Stripe: similar. Raycast: instant. | **Consider removing page transition entirely.** A 300ms y-translate page transition on every nav reads slow on a productivity tool. Power users will turn it off mentally. |
| Loading states | Linear: 200ms delay before showing skeleton (no flash). | Our skeletons appear immediately. Wrap fetch hooks with `useDelayedLoading(200ms)` to avoid skeleton-flash on fast responses. |
| Sidebar | Linear's is dark on light themes (matches our intentional choice). Active state: 2px left bar + bg-foreground/5 + foreground text. Inactive: foreground/60. | Ours matches closely — but use the dedicated sidebar tokens, not `white/X` opacity. |

---

## Closing assessment

The bones are sound. There's a real token layer, dark mode is wired, motion is coherent on a per-file basis, and the team clearly cares (the warm-gold shimmer mid-stop, the `layoutId` nav indicator, the on-brand selection color — all signs of taste).

The product is being held back by three things:
1. **No icon system.** This is the single largest visual upgrade available.
2. **Primitives exist but aren't enforced.** Select, Tabs, TextArea (missing), Modal (too primitive), Tooltip (broken) — feature code keeps rolling its own, so the design system fragments with each new page.
3. **Token discipline is partial.** Tokens defined, half-used, with 4 references to classes that *don't exist*. Tokens for easing are unused. Sidebar tokens are bypassed.

Fix the 9 P0 items + adopt lucide + replace the raw selects, and the perceived quality moves from 5/10 to 7.5/10 in about 2 days of work. The remaining P1/P2 list is what closes the gap to 9/10 (Linear-grade).

The product isn't "amateur" — it's "intermediate with high ceiling." The ceiling is reachable.
