# UI Foundation — tokens, motion, material, shape

**Scope:** `packages/boardroom-ai/client` · **Decision:** ADR-015 · **Guard:** `client/tests/ui-standards.test.ts`
**Research + audit:** `docs/research/APPLE-GRADE-UI-2026-10-20.md`

Everything below is additive: every token name that existed before this pass still works, old names are aliases of the new values.

## 1. Token catalogue (`client/src/styles/tokens.css`, mapped in `client/tailwind.config.ts`)

| Group | Tokens | Tailwind |
|---|---|---|
| Type faces | `--font-sans` (Inter Variable, self-hosted, `opsz` 14–32), `--font-mono` (JetBrains Mono Variable), `--font-display` = sans | `font-sans`, `font-mono`, `font-display` |
| Type scale | `--text-xs … --text-3xl` (unchanged), `--text-4xl` 2.125rem (Large Title) | `text-4xl` (tracking baked in) |
| Tracking | `--tracking-display` −0.02em (≥ 20 px), `--tracking-title` −0.011em (17–19 px) | `tracking-display`, `tracking-title` |
| Numerics | `.tnum` / `[data-numeric]` → `tabular-nums lining-nums` | `tnum` (class) |
| Easing | `--ease-out` (0.23,1,0.32,1), `--ease-in-out` (0.77,0,0.175,1), `--ease-sheet` (0.32,0.72,0,1), `--ease-default` = out | `ease-out`, `ease-in-out`, `ease-sheet` (and the default) |
| Duration | instant 0 · fast 120 · normal 180 · slow 240 · sheet 320 ms | `duration-instant/fast/normal/slow/sheet` |
| Depth | `--shadow-color` (HSL triplet, warm neutral; darker in dark), `--highlight` (1 px inset top), `--hairline` / `--hairline-strong` (fg at 9 % / 16 %, 12 % / 20 % dark), `--shadow-sm/md/lg/xl` (4–5 layers, highlight first) | `shadow-sm/md/lg/xl`, `shadow-hairline`, `shadow-highlight`, `border-hairline(-strong)`, `ring-hairline` |
| Elevation | `--surface-1/2/3` — lighter per step in dark, white in light | `bg-surface-1/2/3`; `Card elevation={0..3}` |
| Shape | `--radius-control` 0.625rem, `--radius-container` 1rem (= `--radius-xl`), `--radius-capsule` 999px; `.concentric` | `rounded-control/container/capsule` |
| Layers | `--z-dropdown 100`, `--z-sticky 200`, `--z-modal-backdrop 300`, `--z-modal 400`, `--z-command-palette 500`, `--z-toast 600` | `z-dropdown` … `z-toast` — never a literal |
| Material | `.material` (regular), `.material-clear`, `.material-sidebar`; solid fallbacks for no `backdrop-filter` and `prefers-reduced-transparency` | classes in `index.css` |

`lib/cn.ts` teaches tailwind-merge the token-named scales, so `cn('rounded-control', 'rounded-xl')` resolves to the caller's class.

## 2. Motion rules (`client/src/lib/motion.ts`)

1. **Enter / exit: `EASE_OUT`.** On-screen movement (resize, reorder): `EASE_IN_OUT`. Sheets and drawers: `EASE_SHEET`. Nothing on the UI layer eases in — it delays the moment the user is watching.
2. **Under 300 ms.** Use the `DURATION` tokens; review rule: anything longer gets shortened to 150–250 ms or deleted.
3. **Frequency.** Keyboard-driven and very frequent actions get no animation: arrow keys in cmdk, Tab indicator moved by keyboard (`instant`), notification rows (no stagger). Delight belongs on rare moments (onboarding celebration).
4. **Entrances start at ≥ 0.9.** `scaleIn` is 0.96 → 1, no overshoot. Never `scale: 0`.
5. **Springs** (`springs`): `default` {visualDuration 0.55, bounce 0} — Apple's default · `snappy` {0.28, 0.08} — menus, toasts, indicators · `sheet` {0.42, 0} · `gesture` {stiffness 400, damping 36} — drag release only, pass the gesture `velocity`.
6. **Press feedback:** `active:scale-[0.97]` on buttons (never when disabled).
7. **Transition only what changes:** `transition-[background-color,color,box-shadow,transform]`, never `transition-all`.
8. **Origin-aware popups:** `origin-[var(--transform-origin)]`, 140 ms ease-out, 0.96 → 1 (`ui/popup-motion.ts`). Tooltips: 300 ms open delay, 0 ms when moving between siblings (`TooltipProvider`).
9. **Reduced motion** is global (`index.css`): transitions and keyframes collapse; Motion components read `useReducedMotion()` for gesture-driven entrances.

Remediation order when something feels off: delete the animation → shorten it → fix the easing.

## 3. Material placement

- Material belongs to the **navigation layer** that floats above content: `AppHeader` (once scrolled), `CommandPalette`, `Toast`, sheets/modals' chrome, floating toolbars, the graph's legend bar / minimap / hover card. The `backdrop-blur` guard enforces the allow-list; the three graph bars use the `.material` class, so they need no exception.
- **Never glass on glass.** A popover or menu opened from the glass header is a solid `bg-surface-2` with `ring-hairline` + `shadow-lg`.
- **Never on content:** cards, tables, list rows, chart frames stay opaque (`bg-card` / `bg-surface-*`). On the graph page the canvas, the inspector and the in-flow controls / timeline bar are content; only what floats over the canvas is material (the reference layering model).
- `.material-clear` only over media-rich backdrops with a dimming layer; prefer `.material`.
- `.material` never sets `position` (only `isolation`), so it composes with `absolute` / `sticky` / `fixed` chrome. Do not add `position: relative` back to the recipe — it silently un-floats the graph bars.
- Text on glass must stay ≥ 4.5:1 after blur — the 72 % fill is tuned for that on both themes; do not lower it. Secondary text inside a material (and in the header at all times) reads `--color-muted-foreground-on-glass` (7.7:1 on white, vs 5.5:1 for the regular muted step) via a `--color-muted-foreground` override on `.material` — see **§8** for the check that enforces it.
- Reduce Transparency (`prefers-reduced-transparency`, or the `.reduce-transparency` class on `<html>` for environments that cannot emulate it) turns every material and the modal scrim solid; the layout does not change.
- No SVG displacement / lensing in this foundation (Chromium-only garnish, deferred).

## 4. Depth

One light source, straight above: shadow offsets grow with blur, never sideways. Elevation reads mostly from the hairline ring and the 1 px top highlight; outer shadow layers are soft and hue-matched (`--shadow-color`). Dark mode: surfaces get lighter per elevation step (`--surface-2/3`) instead of heavier shadows.

## 5. Concentric radius rule

`inner radius = outer radius − padding`, clamped at 0. Containers publish the numbers, children opt in:

```tsx
<Card className="p-6">                 {/* sets --parent-radius: var(--radius-xl); --parent-pad: 1.5rem */}
  <img className="concentric" />        {/* radius = max(0, 1rem − 1.5rem) → square; with p-2 → 0.5rem */}
</Card>
```

`Card` derives `--parent-pad` from its `p-*` class; `Modal` publishes 1.5rem. Controls use `rounded-control` (0.625rem), containers `rounded-xl` (1rem), pills and standout actions `rounded-capsule`.

## 6. Primitives (`client/src/components/ui`)

| Primitive | Built on | Notes |
|---|---|---|
| `Button` | CVA | `variant` primary/secondary/ghost/danger/success/**glass**, `shape="capsule"`, `loading` (spinner in the same grid cell → no width change, `aria-busy`) |
| `Card` | — | `hover` = shadow step + hairline darken (no lift), `elevation` 0–3, publishes concentric vars |
| `Modal` (`shared/`) | Base UI Dialog | focus trap, scroll lock, `inert`; 0.96 → 1 + 8 px on `--ease-sheet` 320 ms; bottom sheet < 640 px |
| `Tooltip` + `TooltipProvider` | Base UI Tooltip | mount the provider once (App.tsx) |
| `Select`, `Tabs`, `Popover`, `Menu` | Base UI | all share `POPUP_MOTION` + `POPUP_SURFACE`; `Select` has `size="sm"` (28 px) for dense rows and toolbars, plus `id` / `title` so labels and disabled-reason tooltips survive a migration from a native select |
| `Tabs variant="segmented"` | Base UI Tabs + Motion | capsule segmented control; the raised pill (`bg-card`, hairline ring, one shadow step) slides on `springs.snappy`, instantly from the keyboard; optional 16 px icon per segment; panels optional (`ModeSelector`) |
| `Switch` | Base UI Switch | `role="switch"`, capsule track, 120 ms ease-out thumb, `sm` (28 × 16) for dense rows |
| `Slider` | Base UI Slider | gold track fill, value bubble only while dragging, arrow / Page / Home / End steps, `onCommit` on release, keep the numeric readout next to it in `tnum` |
| `PageHeader` | — | the one page title block: `text-3xl` + `tracking-display` + `text-balance`, muted subtitle, actions on the title row (drop under it on phones), 24 px rhythm; `accent` for the dashboard greeting, `align="center"` for single-purpose pages |
| `Modal variant="sheet"` | Base UI Dialog + Motion | inset side sheet from the trailing edge on ≥ 640 px, bottom sheet below; the bottom sheet drags down from its grabber / title row and dismisses past 120 px or a 600 px/s flick, settling on `springs.gesture` with the release velocity; reduced motion → no drag, close button only |
| `Button size="icon"` | CVA | 32 px square hit area; always pass `aria-label` |
| `Toast` | Motion + Zustand | `.material`, enters from the right on `springs.snappy`, pauses on hover/focus, swipe right to dismiss (80 px or 500 px/s) |

### Adding a primitive

1. Start from the Base UI part (`@base-ui/react/<part>`) when behaviour exists there; keep CVA/Tailwind for styling. Custom DOM only for pure presentation.
2. Style popups with `POPUP_MOTION` + `POPUP_SURFACE`; dialogs with the Modal recipe; never add a new easing or duration literal — use the tokens.
3. Icons: `lucide-react`, `strokeWidth={1.75}`, 18 px in navigation, 16 px inline, `aria-hidden` unless the icon is the only label.
4. Numbers that update in place get `tnum`.
5. Export it from `ui/index.ts`, add a colocated test under `client/tests/components/ui/`, and make sure `pnpm --filter @boardroom/boardroom-ai test:client` (which runs `ui-standards.test.ts`) stays green. The guard also refuses a native `<select` outside `ui/Select.tsx` and any `scroll` event listener; when one has to stay, put `ui-standards: allow select — <reason>` (line above) or `ui-standards: allow scroll-listener — <reason>` (same line) next to it.
6. Shoot it light + dark with `tools/visual-preview` before merging (§8).

## 7. Route transitions (React `<ViewTransition>`, React ≥ 19.3)

- `shared/Layout.tsx` wraps the routed page root in `<ViewTransition key={pathname} name="page" update="none">`. A route change is one View Transition on `page`: the old page fades out and the new one fades in, both sliding 10 px — in from the right going forward, reversed going back — in 180 ms on `--ease-out`. In-place content updates never animate; the shell (`root`) does not cross-fade. Browsers without `document.startViewTransition` swap instantly.
- Direction is a **transition type**: `hooks/useRouteTransition.ts` tags router link clicks `nav-forward` (bubble-phase click listener, after the router handled it), popstate `nav-back` / `nav-forward` from `history.state.idx`, and `useTransitionNavigate()` tags programmatic navigation (⌘K palette, keyboard shortcuts, buttons; `direction: NAV_BACK` for "close"-style moves). `index.css` reads the tag with `html:active-view-transition-type(nav-back)::view-transition-new(page)` and friends. Reduced motion: opacity only.
- React flushes the first transition it sees inside a `popstate` event synchronously (no View Transition). `RouteTransitionArmer`, rendered in `App.tsx` before `<BrowserRouter>`, registers a popstate listener ahead of the router's and spends that eager slot on a no-op update, so the router's own update stays asynchronous and animates. If a browser ever orders listeners differently, back is an instant swap — never an error.
- `PageWrapper` adds no motion of its own any more (it doubled the route entrance); `pageTransition` in `lib/motion.ts` is kept for callers outside the shell.
- Keyboard-driven route changes (palette, shortcuts) use the same transition; keyboard list navigation inside a page stays un-animated (motion rule 3).

## 8. Visual verification and the contrast-on-glass gate

```bash
pnpm --filter @boardroom/boardroom-ai build                      # the harness serves client/dist
node tools/visual-preview/shoot-pages.mjs --round <name>        # shell + showcase pages, light + dark, desktop + mobile, variants
node tools/visual-preview/shoot-pages.mjs --round r --only dashboard-scrolled,graph-global --theme dark
node tools/visual-preview/shoot-pages.mjs --round r --dist <older client/dist> --legacy   # a "before" round from an older build
node tools/visual-preview/shoot-pages.mjs --round r --skip-variants --no-gate            # report contrast, never fail on it
```

Shots land under `<scratchpad>/visual/<round>/` (never in git) with a `manifest.json`. Every page may list `contrast` targets; after the shot, `tools/visual-preview/contrast.mjs` reads the target's computed text colour, screenshots a 3 px frame around its glyph box and compares the colour against the **worst 5 %** of those composited background pixels (what the blur, saturation and tint actually produced). Targets today: the header title, search label and ⌘K hint over scrolled content; the graph legend label / count and the hover card title / meta over the canvas; sheet titles; the segmented control's active and idle labels. Any ratio under 4.5:1 fails the shoot. Variants: `--reduced-motion` (Playwright `reducedMotion: 'reduce'`; asserts the dialog transition collapsed and the bottom sheet has no grabber) and `--reduced-transparency` (the `.reduce-transparency` class, since Playwright cannot emulate the media query; asserts the header and legend have `backdrop-filter: none`). `route-transition` / `route-transition-back` slow the View Transition to 6 s and capture a frame mid-flight, and assert that forward and back were tagged `nav-forward` / `nav-back`.

`shoot.mjs` steps available to any page spec: `wait`, `waitGone`, `click` (`optional: true` for controls an older build lacks), `type`, `press`, `sleep`, `settle`, `evaluate`, `scroll: { selector, top }`, `style: 'css'`, `assert: 'js'`, `hoverCanvas: { selector, until }`.

## 9. Brand gold and token contrast (M1-D1)

The old light-mode gold (`#b5890a`) carried white labels at 3.21:1. Gold now has separate tokens per job, and the founder picks one of two variants (M1-F5):

| Token | Job | Light (default) | Light (`dark-label`) | Dark |
|---|---|---|---|---|
| `--color-primary` (`bg-primary`, `border-primary`) | solid fill: buttons, chips, switches, progress, logo, icons | `#8f6d07` | `#b5890a` | `#d4a31a` |
| `--color-primary-foreground` (`text-primary-foreground`) | the label on a solid fill | `#ffffff` (4.82:1) | `#1a1a16` (5.44:1) | `#111110` (8.15:1) |
| `--color-primary-hover` (`hover:bg-primary-hover`) | hover step for a solid fill | `#7d5f06`, darker | `#c4970f`, lighter | `#ddb033`, lighter |
| `--color-primary-text` (`text-primary-text`) | gold **text**, including on `bg-primary/10–15` tints | `#7d5f10` | `#7d5f10` | `#d4a31a` |
| `--color-sidebar-primary` (`text-/bg-sidebar-primary`) | gold on the always-dark sidebar | `#d4a31a` | `#d4a31a` | `#d4a31a` |

**How to flip the variant:** the default variant is (a), a darker fill with white labels. To switch to (b), the original gold with dark labels, add one attribute to `<html>` in `packages/boardroom-ai/client/index.html`:

```html
<html lang="en" data-gold="dark-label">
```

The block `:root[data-gold="dark-label"]:not(.dark)` in `tokens.css` then overrides the three fill tokens in light mode only. Dark mode already uses dark labels. To make (b) permanent instead, copy that block's three values into `:root` and delete the block. The token test covers both states either way. To preview without editing: `node tools/visual-preview/shoot-pages.mjs --gold dark-label` (shots are suffixed `--gold-dark-label`) and `node tools/visual-preview/contrast.mjs --gold dark-label`.

**Rules** (enforced by the `brand gold and token contrast (Lane D · M1-D1)` block in `client/tests/ui-standards.test.ts`):

1. **Token pairs.** The test parses `tokens.css` and resolves light/dark × default/`dark-label`. Text pairs must be ≥ 4.5:1: labels on fill and on hover, gold text on page/card/muted/popover/tints, body and muted text, semantic text, destructive and success labels, and sidebar text. Non-text pairs must be ≥ 3:1: the fill on page/card, and the sidebar gold. It fails on the pre-M1-D1 tokens (white on `#b5890a` = 3.21:1).
2. **`text-primary` is a fill colour, not a text colour.** Use `text-primary-text` for gold text. The test holds an explicit allow-list for non-text uses (logo marks, icons, decorative glyphs). Each entry names its file and a line fragment, and stale entries fail.
3. **A solid `bg-primary` carries `text-primary-foreground`.** Never `text-foreground`, `text-white` or `text-muted-foreground` on the fill (white on dark-mode gold is 1.89:1).
4. **Hover on a solid fill uses `hover:bg-primary-hover`.** A `/80` or `/90` tint lightens the light-mode fill under its white label below AA.

**Page sweep.** `node tools/visual-preview/contrast.mjs` (after `pnpm --filter @boardroom/boardroom-ai build`) serves the build against the mock API and measures **every** visible text element on Login and Settings. It covers light/dark × both variants × 1440 px and 390 px. For each viewport position it reads the colours, hides all text, takes one screenshot and compares each colour with the backdrop pixels inside its own glyph boxes (worst 5 %). Text needs 4.5:1, large text and single glyphs need 3:1, and disabled or `aria-hidden` content is skipped. Any failing pair exits 1. Flags: `--only login|settings`, `--theme`, `--gold default|dark-label|both`, `--dist <older build>`, `--shots <dir>`, `--json <file>`, `--verbose`.
