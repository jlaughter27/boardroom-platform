# Apple-grade UI on the web — what it is made of, and how BoardRoom gets there

**Date:** 2026-10-20 · **Scope:** `packages/boardroom-ai/client` · **Status:** research + implementation plan (no code changed by this doc)

> TL;DR — "Apple-level" is not a look, it is six disciplines applied without exception: **material layering** (glass only on the navigation layer), **physics motion** (ease-out, under 300 ms, critically-damped springs, interruptible), **optical typography** (optical sizes, tight display tracking, tabular figures), **concentric shape**, **layered color-matched depth**, and **frequency-aware restraint** (the more often an action happens, the less it animates). Our client has a solid token system and Motion already installed, so this is a foundation upgrade (tokens + 6 primitives), not a rewrite. Four phases; Phase A ships in a day with zero visual regressions.

---

## 1. What the research says (primary sources where reachable)

### 1.1 Material and depth — Apple's own layering model

Apple's WWDC25 sessions ("Meet Liquid Glass", "Get to know the new design system") state the rules more precisely than any blog:

| Rule | Source wording |
|---|---|
| Glass lives on the **navigation layer** that floats above content, never on content itself | "best reserved for the navigation layer that floats above the content of your app" |
| **Never stack glass on glass** | top elements "use fills, transparency, and vibrancy … a thin overlay that is part of the material" |
| Two variants, **Regular** (adaptive, default) and **Clear** (media-rich, needs a dimming layer); **never mix them** | Clear "requires a dimming layer … if that compromises the content, use Regular" |
| Shapes are **fixed**, **capsule** (radius = height/2) or **concentric** (radius = parent radius − padding) | capsules for phone / standout actions; concentric for windows and nested containers |
| Tint is **semantic** (primary action), not decorative | — |
| Respect **Reduce Transparency** / **Reduce Motion** | material falls back to frosted/opaque |

**Web reality.** Browsers cannot read the pixels behind an element, so the web has two tiers:

- **Tier 1 (all browsers):** `backdrop-filter: blur() saturate()` + translucent fill + hairline border + 1 px inset top highlight. This is the frosted "Regular" look and is what every polished web app (Raycast, Linear, Arc's web surfaces) actually ships.
- **Tier 2 (Chromium only):** SVG `feDisplacementMap` referenced from `backdrop-filter: url(#lens)` for refraction. Safari and Firefox silently drop it, so it must be a progressive enhancement behind `@supports` and never carry meaning. Contrast of text on glass must be measured **after** the blur.

### 1.2 Motion — numbers that are actually documented

**Apple's default animation** is a spring with `response: 0.55`, `dampingFraction: 1.0` (critically damped: settles in ~0.55 s with no overshoot). That is the baseline "feel" people call Apple-like: fast start, no bounce, interruptible.

**Emil Kowalski's standards** (animations.dev, `emilkowalski/skills` STANDARDS.md), which are the de-facto web distillation:

| Rule | Value |
|---|---|
| Enter / exit easing | **ease-out**, `cubic-bezier(0.23, 1, 0.32, 1)` |
| On-screen movement (reorder, resize) | ease-in-out, `cubic-bezier(0.77, 0, 0.175, 1)` |
| Drawers / sheets (iOS feel) | `cubic-bezier(0.32, 0.72, 0, 1)`, ~500 ms for full-height sheets |
| Hover / color | plain `ease` |
| Never | **ease-in on UI** ("delays the exact moment the user is watching") |
| Duration ceiling | **< 300 ms** for UI; review rule "> 300 ms → reduce to 150–250 ms" |
| Press feedback | `scale(0.97)` on `:active` ("the interface should feel as if it's listening") |
| Entrances | never from `scale(0)`; start at ≥ 0.9–0.95 |
| Origin | transform-origin at the trigger (origin-aware menus/tooltips) |
| Springs | for gestures and interruptible motion; `bounce` 0.1–0.3, mostly 0 |
| Frequency | **keyboard-driven and very frequent actions get no animation**; occasional surfaces (modal, drawer, toast) get standard animation |
| Remediation order | delete the animation → shorten it → fix the easing |
| Performance | animate only `transform` and `opacity`; `will-change: transform` for jitter |

Rauno Freiberg's "Novelty" essay adds the governing principle: **the more often an action is performed, the less satisfying any novel treatment becomes** (semantic satiation). Delight belongs on rare moments; frequent paths should feel instant.

**Motion (the library we already ship, v11.18.2)** exposes exactly the Apple parameters: `type: 'spring', visualDuration, bounce` (visualDuration overrides duration; bounce 0 = critically damped, default 0.25). Apple's default maps to `{ visualDuration: 0.55, bounce: 0 }`. Caveat from a current issue on Emil's repo: duration/bounce springs start at velocity 0 (fine for enter/exit; for drag-release pass `velocity`).

### 1.3 Typography — optical sizing is the thing people miss

- SF Pro switches **Text → Display at 20 pt**; tracking tightens continuously between 17 and 28 pt. iOS defaults (Large setting): Large Title 34/41, Title 1 28/34, Title 2 22/28, Title 3 20/25, Headline 17/22 semibold, Body 17/22, Callout 16, Subheadline 15, Footnote 13/18, Caption 12 / 11. macOS body is 13 pt.
- **Inter 4** folded "Inter Display" into the variable font as an **`opsz` axis (14–32)**; `opsz 32` equals the old Display cut. Turn on `font-optical-sizing: auto` and the browser picks it from the rendered size, exactly like SF.
- **Google Fonts serves the pre-4 Inter without `opsz`.** We load Inter from Google Fonts today (`index.html:41`, four static weights), so we have no optical sizing and no variable weight. Self-host `@fontsource-variable/inter` instead.
- Numbers in tiles, tables and timers need `font-variant-numeric: tabular-nums` or they jitter on update. Headlines need `text-wrap: balance`; body copy `text-wrap: pretty`.

### 1.4 Shape — concentric radii

Nested rounded corners look wrong unless `inner = outer − (padding + border)`, clamped at 0. Hardcoded radius scales guarantee drift; the fix is a CSS variable inherited from the parent.

### 1.5 Depth — layered, color-matched shadows

Josh Comeau's "Designing Beautiful Shadows": one light source (same offset ratio everywhere), **5–6 stacked layers** instead of one, and the shadow **color matched to the surface hue** with saturation and lightness lowered, declared once as `--shadow-color` and reused per layer. Raycast adds the second half of the recipe: elevation comes mostly from **hairline borders and a 1 px inset top highlight** (`inset 0 1px 0 rgba(255,255,255,.1)`), not from big outer shadows.

### 1.6 Platform capabilities we can lean on (as of 2026-10)

| Feature | Status | Use |
|---|---|---|
| `<dialog>` + `popover` + `@starting-style` + `transition-behavior: allow-discrete` | Baseline | entry/exit transitions for modal, menus, tooltips with no JS mount dance |
| CSS anchor positioning | Baseline since Firefox 147 (Jan 2026); `@position-try` needs Safari ≥ 18.4 | tooltips/popovers anchored without floating-ui |
| View Transitions (same-document) + `:active-view-transition-type()` | Baseline (pseudo-classes newly available Apr 2026) | route transitions |
| React `<ViewTransition>` / `addTransitionType` | **stable in React 19.3** (Sept 2026). We run **19.2.4** | direction-aware page transitions after a minor upgrade |
| `field-sizing`, `:open`, `contrast-color()`, `sibling-count()` | Baseline 2026 | auto-growing inputs, open-state styling, text-on-tint |
| Tailwind **v4** (`@theme`, OKLCH palette, P3) | GA; we run **3.4.19** | optional; our CSS-variable tokens already give v4's main benefit |

### 1.7 Headless primitives — the 2026 picture

Base UI (ex-Radix + Floating UI + MUI engineers) hit 1.0 in Dec 2025 and **shadcn/ui made it the default primitive layer in July 2026**; Radix's cadence has slowed; React Aria remains the deepest (date, color, table, tree) and the strictest on a11y/i18n. We have **no** headless layer today: `Modal.tsx` hand-rolls the focus trap and Escape handling, has no animation, no scroll lock and no `inert` on the page behind it.

---

## 2. Audit — where BoardRoom's client stands against that bar

Measured on the current branch (`packages/boardroom-ai/client`):

| Area | Finding | Evidence |
|---|---|---|
| Fonts | Google-Fonts Inter, static 400/500/600/700, **no `opsz`, no `tnum`**, no `text-wrap` | `index.html:41`, `tokens.css:79`, 0 uses of `tabular-nums` |
| Easing | Material curve `cubic-bezier(0.4,0,0.2,1)` as default; `scaleIn` uses a back-ease overshoot `(0.34,1.56,0.64,1)` (bouncy, not Apple) | `tokens.css` `--ease-default`, `lib/motion.ts` |
| Durations | 150/250/400 ms; page transition 300 ms; toast 4 s auto-dismiss | `tokens.css`, `motion.ts`, `Toast.tsx` |
| `transition-all` | **21** usages → animates layout props and colors together, causes repaint jank | `grep transition-all` |
| Press feedback | none; `Button` has hover colour only, no `:active` scale | `ui/Button.tsx` |
| Cards | `hover:-translate-y-0.5` lift on every card (a frequent surface; Rauno/Emil would delete it) | `ui/Card.tsx` |
| Entrances | Onboarding animates from `scale: 0.5` | `OnboardingPage.tsx:53,68` |
| Shadows | single-layer neutral black, no inset highlight, no hue match | `tokens.css` `--shadow-*` |
| Radii | fixed scale; 12 px card radius with 16 px padding wraps 12 px children → not concentric | `Card.tsx`, `Button.tsx` |
| Material | 7 ad-hoc `backdrop-blur` usages, no shared material token, no `prefers-reduced-transparency` fallback | grep |
| Modal | no enter/exit animation, flat `bg-black/50` overlay, hand-rolled focus trap, `z-50` literal instead of `--z-modal` | `shared/Modal.tsx` |
| Reduced motion | handled in one hook (`useReducedMotion`) and used by the graph; **no global CSS rule**, so Tailwind transitions and keyframes still run | 1 CSS match |
| Icons | hand-inlined SVG paths per nav item; stroke widths vary (1.8 in sidebar, others 2) | `Sidebar.tsx` |
| Dark surfaces | `#111110` page, `#1a1a18` card — a single elevation step; no lighter-on-elevation ladder | `tokens.css` dark block |
| Route transitions | opacity + 6 px translate via Motion; no shared-element continuity | `motion.ts pageTransition` |
| Strengths | CSS-variable tokens wired into Tailwind, light/dark in one file, entity + persona palettes validated for ΔE, Motion + CVA + cmdk already present, a11y labels on dialogs, `focus-visible` ring, PWA meta | — |

Net: **the bones are right** (tokens, Tailwind mapping, Motion, cmdk). What is missing is the physics layer and the material layer, and consistency of application.

---

## 3. Implementation plan for our stack

Principles for the whole plan: additive (no primitive deleted, old names kept as aliases), tokens first so every page improves without touching it, visual regression via the `tools/visual-preview` harness that the viz lane just landed.

### Phase A — Foundation tokens (≈1 day, zero visual regression, ships alone)

**A1. Typography.** Add `@fontsource-variable/inter` (+ `@fontsource-variable/jetbrains-mono`), drop the Google Fonts `<link>`.

```css
/* index.css */
@import '@fontsource-variable/inter';
@import '@fontsource-variable/inter/opsz.css';   /* the opsz-enabled face */

:root {
  --font-sans: 'Inter Variable', ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-display: var(--font-sans);
  /* Apple-like scale on a 14 px web base; display sizes get tighter tracking */
  --text-xs: 0.6875rem;  --text-sm: 0.8125rem; --text-base: 0.875rem;
  --text-lg: 1rem;       --text-xl: 1.125rem;  --text-2xl: 1.375rem;
  --text-3xl: 1.75rem;   --text-4xl: 2.125rem;  /* 34 px = Large Title */
  --tracking-display: -0.02em;  /* ≥ 20 px */
  --tracking-title: -0.011em;   /* 17–19 px */
}
body { font-optical-sizing: auto; text-wrap: pretty; font-feature-settings: 'calt', 'case'; }
h1, h2, .display { letter-spacing: var(--tracking-display); text-wrap: balance; }
.tnum, [data-numeric] { font-variant-numeric: tabular-nums lining-nums; }
```

Tailwind: add `fontSize['4xl']`, `letterSpacing.display/title`, and a `tnum` utility via `@layer utilities`.

**A2. Motion tokens** (`tokens.css`) and presets (`lib/motion.ts`), replacing the Material curve as default:

```css
:root {
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);        /* enter / exit */
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);    /* on-screen movement */
  --ease-sheet: cubic-bezier(0.32, 0.72, 0, 1);      /* drawers, sheets */
  --ease-default: var(--ease-out);                   /* keep the old name */
  --duration-instant: 0ms; --duration-fast: 120ms; --duration-normal: 180ms;
  --duration-slow: 240ms;  --duration-sheet: 320ms;
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important; scroll-behavior: auto !important;
  }
}
```

```ts
// lib/motion.ts — Apple parameters expressed in Motion's own terms
export const springs = {
  /** Apple's default: response 0.55, dampingFraction 1.0 */
  default: { type: 'spring', visualDuration: 0.55, bounce: 0 },
  /** menus, popovers, toasts */
  snappy:  { type: 'spring', visualDuration: 0.28, bounce: 0.08 },
  /** sheets and drawers (pairs with --ease-sheet for CSS-only paths) */
  sheet:   { type: 'spring', visualDuration: 0.42, bounce: 0 },
  /** drag release only — pass velocity from the gesture */
  gesture: { type: 'spring', stiffness: 400, damping: 36, mass: 1 },
} as const satisfies Record<string, Transition>;

export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
export const scaleIn = {               // was a 1.56 back-ease overshoot
  initial: { opacity: 0, scale: 0.96 }, animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.98 },  transition: { duration: 0.18, ease: EASE_OUT },
};
```

Rule for the codebase (enforced by an ESLint `no-restricted-syntax` rule in Phase D): no `transition-all`, no `ease-in`, no `scale(0)` entrances, no animation on keyboard-driven list navigation.

**A3. Depth tokens** — layered, hue-matched, plus the inset highlight and a hairline:

```css
:root {
  --shadow-color: 48 10% 20%;   /* warm neutral matched to #fafaf6; dark theme: 48 8% 2% */
  --highlight: inset 0 1px 0 0 hsl(0 0% 100% / 0.6);
  --hairline: color-mix(in oklab, var(--color-foreground) 9%, transparent);
  --shadow-sm: var(--highlight), 0 1px 1px hsl(var(--shadow-color) / .06), 0 1px 2px hsl(var(--shadow-color) / .08);
  --shadow-md: var(--highlight), 0 1px 1px hsl(var(--shadow-color) / .05), 0 2px 4px hsl(var(--shadow-color) / .05),
               0 6px 12px hsl(var(--shadow-color) / .06), 0 12px 24px hsl(var(--shadow-color) / .06);
  --shadow-lg: var(--highlight), 0 1px 2px hsl(var(--shadow-color) / .06), 0 4px 8px hsl(var(--shadow-color) / .06),
               0 12px 24px hsl(var(--shadow-color) / .08), 0 24px 48px hsl(var(--shadow-color) / .1);
}
.dark { --highlight: inset 0 1px 0 0 hsl(0 0% 100% / 0.06); --shadow-color: 48 8% 2%;
  /* elevation ladder: higher surfaces are lighter, like macOS dark */
  --color-background: #0f0f0e; --color-card: #171716; --surface-2: #1d1d1b; --surface-3: #242422; }
```

**A4. Shape tokens** — concentric by construction:

```css
:root { --radius-capsule: 999px; --radius-container: 1rem; --radius-control: 0.625rem; }
.concentric { --r: var(--parent-radius, var(--radius-container)); --p: var(--parent-pad, 0px);
  border-radius: max(0px, calc(var(--r) - var(--p))); }
/* Card sets --parent-radius / --parent-pad on itself; children opt in with .concentric */
```

**A5. Material tokens** — one `.material` recipe, variants `regular` / `clear` / `sidebar`, with the Apple fallbacks baked in:

```css
.material { position: relative; isolation: isolate;
  background: color-mix(in oklab, var(--color-card) 72%, transparent);
  box-shadow: var(--highlight), 0 0 0 1px var(--hairline), var(--shadow-md);
  -webkit-backdrop-filter: blur(20px) saturate(1.8); backdrop-filter: blur(20px) saturate(1.8); }
.material-clear { background: color-mix(in oklab, var(--color-card) 40%, transparent); }
@supports not (backdrop-filter: blur(1px)) { .material { background: var(--color-card); } }
@media (prefers-reduced-transparency: reduce) { .material, .material-clear { background: var(--color-card); backdrop-filter: none; } }
/* Chromium-only lensing, decorative, opt-in: */
@supports (backdrop-filter: url(#lens)) { .material-lens { backdrop-filter: url(#lens) blur(14px) saturate(1.8); } }
```

Where it is allowed: **AppHeader**, floating **graph toolbars / spotlight bar / minimap**, **CommandPalette**, **Toast**, **Sheet**. Where it is banned: cards, tables, list rows, chart frames (content layer). Never a material inside a material.

### Phase B — Six primitives (≈2 days)

Adopt **Base UI** (`@base-ui-components/react`) for Dialog, Popover, Menu, Tooltip, Select, Tabs behaviour; keep our CVA styling. It replaces the hand-rolled focus trap, adds scroll-lock, `inert`, typeahead, and proper ARIA, and is where shadcn moved. (React Aria only if we later need date pickers or data grids.)

1. **Button** — remove `transition-all`; `transition: background-color, color, box-shadow, transform` on `--ease-out` 120 ms; `active:scale-[0.97]`; add `variant="glass"` and `shape="capsule"`; loading state swaps label with a spinner without width change (`grid-area` stacking).
2. **Card** — delete the hover lift; hover = shadow step `sm → md` plus hairline darkening; declares `--parent-radius/--parent-pad`; `elevation` prop (0–3) maps to the dark ladder.
3. **Sheet/Dialog** — `<Dialog>` from Base UI, backdrop `blur(8px)` + 40 % scrim, panel springs with `springs.sheet` (Motion) or `--ease-sheet` 320 ms via `@starting-style`; bottom-sheet on < 640 px with drag-to-dismiss (`springs.gesture`, velocity passed from the drag).
4. **Popover/Tooltip/Menu** — anchor-positioned (Base UI's positioner), origin-aware `transform-origin` from the side it opened on, 96 → 100 % scale, 140 ms, hover intent delay 300 ms open / 0 ms move between siblings.
5. **Tabs / Segmented control** — shared `layoutId` indicator with `springs.snappy`; capsule shape; keyboard arrows move without animation (frequency rule).
6. **Toast** — stack with `layout` + `springs.snappy`, slide from the origin edge, pause on hover, swipe to dismiss; `material` surface.

Plus an **icon pass**: one set at one stroke weight (`lucide-react`, 1.75 px, 18/20 px boxes) replacing inlined paths; icons optically centred (`translate-y-[0.5px]` where glyph bounds demand it).

### Phase C — Apply to the shell and the three showcase pages (≈2 days)

- **Shell:** glass AppHeader that reads the page behind it when scrolled, sidebar keeps its intentional dark surface but gains the inset highlight + hairline; route changes via `ViewTransition` after bumping React to **19.3** (`pnpm up react react-dom@^19.3`), with `addTransitionType('nav-forward'|'nav-back')` so detail pages slide and back-navigation reverses.
- **Dashboard:** StatTiles get `tnum`, deltas animate with `AnimatedCount` on `springs.default`; no entrance animations on load (frequent surface); only *changed* tiles pulse once.
- **Graph page:** the controls, spotlight, timeline and minimap are the navigation layer → `material`; the canvas is content → no glass. Hover card is a Popover (origin-aware). This is the one page where the Chromium lens enhancement is worth enabling on the floating toolbar.
- **Decision session:** persona stream cards stay flat; the mode selector becomes a capsule segmented control; the CEO synthesis sheet uses `springs.sheet`.

### Phase D — Guardrails (½ day)

- ESLint: ban `transition-all`, `ease-in`, `scale: 0`, and literal `z-50`; require tokens.
- Visual regression: add `shell`, `dialog`, `menu`, `toast` pages to `tools/visual-preview` and shoot light/dark per PR; store PNGs under `scratchpad/visual/<round>` (not in git).
- Contrast test on glass: a Playwright check that samples text over the busiest fixture background with blur applied and asserts ≥ 4.5:1.
- Reduced-motion and reduced-transparency smoke shots.
- Perf budget: 60 fps scroll with the glass header over the graph on a 2019 MacBook Air profile (Chromium `--cpu-throttling-rate 4`).

### Sequencing against work in flight

The graph and dashboard visualization lanes are editing `tokens.css` and `components/viz/*` right now. Land their PR first, then open **Phase A + B as one PR** (tokens + primitives, with the viz primitives re-pointed at the new shadow/material tokens), then **Phase C** per page. Phase A changes are value-only token swaps and old names stay aliased, so nothing in the viz work breaks.

### Explicitly not doing

- No WebGL / displacement "liquid" on content surfaces; lensing stays a Chromium-only garnish on one floating toolbar.
- No Tailwind v4 migration in this pass; our CSS-variable tokens already deliver the runtime-theming benefit, and v4's upgrade tool does not handle our plugin/animation config.
- No bounce above 0.1 anywhere except drag release.
- No entrance animation on dashboard load or on keyboard navigation inside cmdk.

---

## 4. Decision requests for Josh

1. **Base UI** as the headless layer (recommended) vs. keep hand-rolled primitives. Base UI costs one dependency and removes ~300 lines of fragile focus/scroll code.
2. **React 19.3** bump for `ViewTransition` now, or stay on Motion-only route transitions until the next dependency sweep.
3. **Lucide** as the single icon set (recommended) vs. keep bespoke SVG paths.

---

## Sources

Apple: [Meet Liquid Glass (WWDC25)](https://developer.apple.com/videos/play/wwdc2025/219/) · [Get to know the new design system (WWDC25)](https://developer.apple.com/videos/play/wwdc2025/356/) · [SwiftUI `Animation.default` reference](https://developer.apple.com/documentation/swiftui/animation/default.md) · [HIG Typography](https://developers.apple.com/design/human-interface-guidelines/foundations/typography/) · [The details of UI typography (WWDC20)](https://developer.apple.com/videos/play/wwdc2020/10175/)
Motion: [Motion React transitions](https://motion.dev/docs/react-transitions) · [Motion spring docs](https://motion.dev/docs/spring) · [emilkowalski/skills STANDARDS.md](https://github.com/emilkowalski/skills/blob/main/skills/review-animations/STANDARDS.md) · [7 Practical Animation Tips](https://emilkowal.ski/ui/7-practical-animation-tips) · [Great animations](https://emilkowal.ski/ui/great-animations) · [Good vs Great Animations](https://emilkowal.ski/ui/good-vs-great-animations) · [emilkowalski/skills issue #32 (spring velocity caveat)](https://github.com/emilkowalski/skills/issues/32) · [Rauno Freiberg — Invisible Details of Interaction Design](https://rauno.me/craft/interaction-design) · [Rauno Freiberg — Novelty](https://rauno.me/craft/novelty)
Glass on the web: [LogRocket — Liquid Glass with CSS and SVG](https://blog.logrocket.com/how-create-liquid-glass-effects-css-and-svg/) · [kube.io — Refraction with CSS and SVG](https://kube.io/blog/liquid-glass-css-svg/) · [Emit Solution — physics, code and pitfalls](https://emit-solution.com/en/blog/recreate-apple-liquid-glass-css) · [html-in-canvas.dev — CSS vs WebGL](https://html-in-canvas.dev/liquid-glass-effect/) · [liquid-glass-react README (Safari/Firefox caveat)](https://cdn.jsdelivr.net/npm/liquid-glass-react@1.1.1/README.md)
Typography: [Inter v4 beta notes (opsz folds in Display)](https://github.com/rsms/inter/discussions/493) · [Inter Display in the variable font (discussion #757)](https://github.com/rsms/inter/discussions/757) · [Inter optical sizing presets — Nan Xiao](https://nanx.me/blog/post/inter-optical-sizing/) · [Inter 4.0 not on Google Fonts](https://www.usetools.design/tools/inter-4-0)
Depth and shape: [Josh Comeau — Designing Beautiful Shadows](https://www.joshwcomeau.com/css/designing-shadows) · [Shadow Palette Generator](https://www.joshwcomeau.com/shadow-palette) · [Concentric border radius — jakub.kr](https://jakub.kr/work/concentric-border-radius) · [The concentric border-radius rule](https://dev.to/sgbp/the-concentric-border-radius-rule-why-nested-rounded-corners-look-slightly-wrong-3hog) · [Raycast design language notes](https://ai2.design/inspiration/raycast)
Platform: [React 19.3 release post](https://react.dev/blog/2026/09/09/react-19-3) · [React Labs: View Transitions, Activity](https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more) · [New to the web platform, Sept 2026 — web.dev](https://web.dev/blog/web-platform-09-2026) · [Baseline 2026 CSS features](https://blog.codercops.com/blog/baseline-2026-css-features-production-guide) · [modern-css.com Baseline tracker](https://modern-css.com/whats-new/baseline/) · [Tailwind v4 migration guide (DEV)](https://dev.to/akaranjkar08/tailwind-css-v4-everything-that-changed-and-how-to-migrate-2026-guide-3h49)
Primitives: [Base UI vs React Aria (Untitled UI)](https://www.untitledui.com/blog/base-ui-vs-react-aria) · [Radix vs Base UI 2026](https://www.shadcndeck.com/blog/radix-vs-base-ui) · [React Aria vs Radix 2026 (PkgPulse)](https://www.pkgpulse.com/guides/react-aria-vs-radix-primitives-2026)
