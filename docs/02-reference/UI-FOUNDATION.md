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

- Material belongs to the **navigation layer** that floats above content: `AppHeader`, `CommandPalette`, `Toast`, sheets/modals' chrome, floating toolbars, graph controls. The `backdrop-blur` guard enforces the allow-list.
- **Never glass on glass.** A popover or menu opened from the glass header is a solid `bg-surface-2` with `ring-hairline` + `shadow-lg`.
- **Never on content:** cards, tables, list rows, chart frames stay opaque (`bg-card` / `bg-surface-*`).
- `.material-clear` only over media-rich backdrops with a dimming layer; prefer `.material`.
- Text on glass must stay ≥ 4.5:1 after blur — the 72 % fill is tuned for that on both themes; do not lower it.
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
| `Select`, `Tabs`, `Popover`, `Menu` | Base UI | all share `POPUP_MOTION` + `POPUP_SURFACE` |
| `Toast` | Motion + Zustand | `.material`, enters from the right on `springs.snappy`, pauses on hover/focus, swipe right to dismiss (80 px or 500 px/s) |

### Adding a primitive

1. Start from the Base UI part (`@base-ui/react/<part>`) when behaviour exists there; keep CVA/Tailwind for styling. Custom DOM only for pure presentation.
2. Style popups with `POPUP_MOTION` + `POPUP_SURFACE`; dialogs with the Modal recipe; never add a new easing or duration literal — use the tokens.
3. Icons: `lucide-react`, `strokeWidth={1.75}`, 18 px in navigation, 16 px inline, `aria-hidden` unless the icon is the only label.
4. Numbers that update in place get `tnum`.
5. Export it from `ui/index.ts`, add a colocated test under `client/tests/components/ui/`, and make sure `pnpm --filter @boardroom/boardroom-ai test:client` (which runs `ui-standards.test.ts`) stays green.
6. Shoot it light + dark with `tools/visual-preview` before merging.
