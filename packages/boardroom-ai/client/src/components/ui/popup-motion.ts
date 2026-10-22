/**
 * The one motion recipe for anchored popups (tooltip, popover, menu, select):
 * 140 ms ease-out, 0.96 → 1 from the side it opened on. Base UI exposes
 * `--transform-origin` on the positioner and `data-starting-style` /
 * `data-ending-style` on the popup; `data-instant` is set when the popup
 * re-opens while moving between siblings, which gets no animation at all.
 */
export const POPUP_MOTION = [
  'origin-[var(--transform-origin)] scale-100',
  'transition-[opacity,transform] duration-[140ms] ease-out',
  'data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.96]',
  'data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.98]',
  'data-[instant]:transition-none',
].join(' ');

/** Floating surface: one step up the elevation ladder, hairline edge, soft shadow. */
export const POPUP_SURFACE = 'rounded-control bg-surface-2 text-foreground shadow-lg ring-1 ring-hairline outline-none';
