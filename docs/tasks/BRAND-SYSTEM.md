# BoardRoom AI — Brand System Specification v1.0

> Single source of truth for all visual design decisions. Every component, token, and interaction in the product must trace back to this document.

---

## 1. Design Philosophy

**Warm. Premium. Functional.**

BoardRoom AI serves executives making high-stakes decisions. The visual language must convey:
- **Authority** — warm gold accents, not playful primaries
- **Clarity** — high contrast, clean typography, generous whitespace
- **Restraint** — motion serves function, never decoration
- **Duality** — light-first design with a polished dark mode

No neon. No bounce animations. No exclamation marks in UI copy. Gradients are limited to subtle accent treatments (text clips, border images, progress fills) — never on page or card backgrounds.

---

## 2. Color Palette

### 2.1 Core Tokens (Light Mode — `:root` defaults)

| Token | Hex | Role |
|-------|-----|------|
| `--color-background` | `#fafaf6` | Page background (warm off-white) |
| `--color-foreground` | `#1a1a16` | Primary text |
| `--color-card` | `#ffffff` | Card/surface background |
| `--color-card-foreground` | `#1a1a16` | Text on cards |
| `--color-muted` | `#f3f2ed` | Hover states, subtle backgrounds |
| `--color-muted-foreground` | `#6b6960` | Secondary/tertiary text |
| `--color-primary` | `#b5890a` | Gold accent — button backgrounds, active borders |
| `--color-primary-foreground` | `#ffffff` | Text on primary backgrounds |
| `--color-primary-text` | `#8a6914` | Darker gold for inline text/links on light backgrounds (5.5:1 on white) |
| `--color-accent` | `#f3f2ed` | Subtle accent surfaces |
| `--color-accent-foreground` | `#6b6960` | Text on accent surfaces |
| `--color-border` | `#e6e4db` | All borders |
| `--color-ring` | `rgba(181, 137, 10, 0.3)` | Focus rings |
| `--color-primary-warm` | `#a0522d` | Warm sienna — gradient companion to gold (for `from-primary to-primary-warm`) |
| `--color-destructive` | `#b91c1c` | Destructive actions |
| `--color-destructive-foreground` | `#ffffff` | Text on destructive backgrounds |

### 2.2 Core Tokens (Dark Mode — `.dark` class on `<html>`)

| Token | Hex | Role |
|-------|-----|------|
| `--color-background` | `#111110` | Page background (warm near-black) |
| `--color-foreground` | `#e8e8e2` | Primary text |
| `--color-card` | `#1a1a18` | Card/surface background |
| `--color-card-foreground` | `#e8e8e2` | Text on cards |
| `--color-muted` | `#222220` | Hover states, subtle backgrounds |
| `--color-muted-foreground` | `#9a9890` | Secondary/tertiary text |
| `--color-primary` | `#d4a31a` | Gold accent (brighter for dark surfaces) |
| `--color-primary-foreground` | `#111110` | Text on primary backgrounds |
| `--color-primary-text` | `#d4a31a` | Same as primary in dark mode (already high contrast on dark bg) |
| `--color-accent` | `#222220` | Subtle accent surfaces |
| `--color-accent-foreground` | `#9a9890` | Text on accent surfaces |
| `--color-border` | `#2e2e2a` | All borders |
| `--color-ring` | `rgba(212, 163, 26, 0.3)` | Focus rings |
| `--color-primary-warm` | `#c07040` | Warm sienna — gradient companion (brighter for dark surfaces) |
| `--color-destructive` | `#ef4444` | Destructive actions |
| `--color-destructive-foreground` | `#111110` | Text on destructive backgrounds |

### 2.3 Semantic Colors

These are consistent across modes unless noted:

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--color-success` | `#15803d` | `#34d399` | Positive states, active, connected |
| `--color-success-muted` | `rgba(21, 128, 61, 0.1)` | `rgba(52, 211, 153, 0.12)` | Success backgrounds |
| `--color-warning` | `#c2410c` | `#fb923c` | Caution, stale, pending (orange-shifted to distinguish from gold) |
| `--color-warning-muted` | `rgba(194, 65, 12, 0.1)` | `rgba(251, 146, 60, 0.12)` | Warning backgrounds |
| `--color-danger` | `#b91c1c` | `#f87171` | Error, risk, overdue |
| `--color-danger-muted` | `rgba(185, 28, 28, 0.1)` | `rgba(248, 113, 113, 0.12)` | Danger backgrounds |
| `--color-info` | `#1d4ed8` | `#60a5fa` | Informational, neutral highlight |
| `--color-info-muted` | `rgba(29, 78, 216, 0.1)` | `rgba(96, 165, 250, 0.12)` | Info backgrounds |

### 2.4 Persona Colors

| Persona | Light Mode | Dark Mode | Semantic |
|---------|-----------|-----------|----------|
| Optimist | `#065f46` (emerald-800) | `#10b981` (emerald-500) | Growth, opportunity |
| Critic | `#991b1b` (red-800) | `#ef4444` (red-500) | Risk, caution |
| Alternate | `#6b21a8` (purple-800) | `#a855f7` (purple-500) | Unconventional thinking |
| Technician | `#1e40af` (blue-800) | `#3b82f6` (blue-500) | Precision, engineering |
| Questionnaire | `#92400e` (amber-800) | `#f59e0b` (amber-500) | Inquiry, illumination |
| Doer | `#9a3412` (orange-800) | `#f97316` (orange-500) | Action, urgency |
| CEO | `#155e75` (cyan-800) | `#06b6d4` (cyan-500) | Authority, synthesis |

Each persona color must meet 4.5:1 contrast against `--color-card` in its respective mode.

### 2.5 Speaker Colors (Transcript)

8-color palette for distinguishing speakers in transcripts:

| Index | Light | Dark |
|-------|-------|------|
| 0 | `#1e40af` | `#60a5fa` |
| 1 | `#065f46` | `#34d399` |
| 2 | `#9a3412` | `#fb923c` |
| 3 | `#6b21a8` | `#c084fc` |
| 4 | `#991b1b` | `#fca5a5` |
| 5 | `#155e75` | `#67e8f9` |
| 6 | `#854d0e` | `#fde047` |
| 7 | `#4a044e` | `#e879f9` |

### 2.6 Status Colors

| Status | Light | Dark | Usage |
|--------|-------|------|-------|
| Active | `#15803d` | `#22c55e` | Active items, live states |
| Pending | `#a16207` | `#eab308` | Awaiting action |
| Done | `#1d4ed8` | `#3b82f6` | Completed items |
| Overdue | `#b91c1c` | `#ef4444` | Past deadline |
| Draft | `#57534e` | `#6b7280` | Unpublished, in-progress |
| Archived | `#44403c` | `#4b5563` | Inactive, historical |

### 2.7 Decision Status Colors

| Status | Light | Dark | Usage |
|--------|-------|------|-------|
| Proposed | `#a16207` | `#f59e0b` | New decision proposals |
| Approved | `#1d4ed8` | `#3b82f6` | Accepted decisions |
| In Progress | `#8a6914` | `#d4a31a` | Dark gold — active execution (uses `--color-primary-text` to distinguish from warning) |
| Done | `#15803d` | `#22c55e` | Completed |
| Revisited | `#7c3aed` | `#a78bfa` | Reopened for review |

### 2.8 Memory Status Colors

| Status | Light | Dark | Usage |
|--------|-------|------|-------|
| Active | `#15803d` | `#10b981` | Current, reliable memory |
| Stale | `#a16207` | `#f59e0b` | Needs refresh |
| Disputed | `#b91c1c` | `#ef4444` | Conflicting information |
| Closed | `#57534e` | `#6b7280` | Archived memory |

---

## 3. Typography

### Fonts
- **Sans:** Inter (weights: 400, 500, 600, 700)
- **Mono:** JetBrains Mono (weight: 400) — code blocks, technical data
- **Display:** Inter (same family, differentiated by weight/tracking)

### Scale
| Name | Size | Use |
|------|------|-----|
| `xs` | 0.75rem (12px) | Micro labels, timestamps |
| `sm` | 0.8125rem (13px) | Secondary text, badges |
| `base` | 0.875rem (14px) | Body text, inputs |
| `lg` | 1rem (16px) | Section headers |
| `xl` | 1.125rem (18px) | Page subtitles |
| `2xl` | 1.375rem (22px) | Page titles |
| `3xl` | 1.75rem (28px) | Hero text |

### Micro Typography (Section Labels)
```
text-[11px] font-semibold uppercase tracking-wider text-muted-foreground
```

---

## 4. Spacing & Layout

### Radius
| Name | Value | Use |
|------|-------|-----|
| `sm` | 6px | Badges, small pills |
| `md` | 8px | Inputs, minor cards |
| `lg` | 10px | — |
| `xl` | 12px | **Default component radius** — cards, buttons, modals |
| `2xl` | 16px | Large modals, hero cards |
| `full` | 9999px | Pills, avatars |

### Shadows

| Name | Light | Dark |
|------|-------|------|
| `sm` | `0 1px 2px rgba(0,0,0,0.05)` | `0 1px 2px rgba(0,0,0,0.3)` |
| `md` | `0 4px 12px rgba(0,0,0,0.08)` | `0 4px 12px rgba(0,0,0,0.25)` |
| `lg` | `0 8px 24px rgba(0,0,0,0.12)` | `0 8px 24px rgba(0,0,0,0.3)` |

No `shadow-glow`. No colored shadows. Shadows are neutral and subtle.

### Active Persona Indicator (replaces shadow-glow)
When a persona card is "active/speaking", use:
```
border-2 border-[persona-color] shadow-md
```
This replaces the old `shadow-glow` (indigo glow) with a persona-colored border + neutral shadow.

### Card Hover (replaces shadow-glow hover)
```
hover:shadow-md hover:border-border/0 hover:-translate-y-0.5 transition-all duration-200
```
No `active:scale-[0.99]` — remove scale-on-tap effects.

---

## 5. Sidebar

The sidebar has a **fixed dark palette** independent of the active theme.

| Property | Value |
|----------|-------|
| Background | `#1c1b1a` |
| Text default | `rgba(255,255,255,0.5)` |
| Text hover | `rgba(255,255,255,0.8)` |
| Text active | `rgba(255,255,255,1.0)` |
| Active item bg | `rgba(255,255,255,0.1)` |
| Section labels | `rgba(255,255,255,0.3)` — `text-[10px] uppercase tracking-widest font-semibold` |
| Expanded width | `w-56` (224px) |
| Collapsed width | `w-14` (56px) |
| Transition | `duration-200 ease` |

### Logo
- "Board" in `text-blue-400` (on dark sidebar background)
- "Room AI" in `text-white`
- Font: `text-lg font-bold tracking-tight`

---

## 6. Component Specifications

### 6.1 Button

| Variant | Classes |
|---------|---------|
| Primary | `rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors` |
| Secondary | `rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors` |
| Ghost | `rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors` |
| Destructive | `rounded-xl text-destructive hover:bg-destructive/10 transition-colors` |
| Pill | `rounded-full bg-white/20 px-3.5 py-1.5 text-xs font-medium text-white` |

All buttons: `disabled:opacity-50 disabled:cursor-not-allowed`
Loading state: `Loader2` icon + `animate-spin`, maintain button width.

### 6.2 Card

| Pattern | Classes |
|---------|---------|
| Standard | `rounded-xl border border-border bg-card p-4` |
| Elevated/hover | `hover:shadow-md hover:border-transparent hover:-translate-y-0.5 transition-all duration-200` |
| Selected | `border-transparent shadow-md` + persona-colored border via inline style |

### 6.3 Input

```
h-10 rounded-xl border border-border bg-card px-4 text-sm text-foreground
placeholder:text-muted-foreground
focus:ring-2 focus:ring-ring focus:border-primary/40 focus:outline-none
```

Label: `mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground`

### 6.4 Badge

| Variant | Classes |
|---------|---------|
| Default | `rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground` |
| Primary | `rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary` |
| Success | `rounded-md bg-success-muted px-2 py-0.5 text-xs font-medium text-success` |
| Warning | `rounded-md bg-warning-muted px-2 py-0.5 text-xs font-medium text-warning` |
| Danger | `rounded-md bg-danger-muted px-2 py-0.5 text-xs font-medium text-danger` |
| Info | `rounded-md bg-info-muted px-2 py-0.5 text-xs font-medium text-info` |

### 6.5 Modal

| Element | Classes |
|---------|---------|
| Overlay | `fixed inset-0 z-50 bg-black/50 backdrop-blur-sm` |
| Container | `rounded-2xl bg-card border border-border shadow-2xl max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto` |
| Header | `px-6 pt-6 pb-4` |
| Body | `px-6 pb-6` |
| Footer | `px-6 pb-6 pt-2 flex justify-end gap-3` |

### 6.6 Select

```
h-10 rounded-xl border border-border bg-card px-4 text-sm text-foreground
focus:ring-2 focus:ring-ring
```

Dropdown: `rounded-xl border border-border bg-card shadow-lg`

### 6.7 Tabs

| Element | Classes |
|---------|---------|
| Tab list | `border-b border-border` |
| Tab trigger | `px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors` |
| Active tab | `text-foreground border-b-2 border-primary` |

### 6.8 Tooltip

```
rounded-lg bg-foreground px-3 py-1.5 text-xs text-background shadow-md
```

### 6.9 Toast

| Type | Classes |
|------|---------|
| Default | `rounded-xl border border-border bg-card p-4 shadow-lg` |
| Success | `border-success/30 bg-success-muted` |
| Error | `border-danger/30 bg-danger-muted` |
| Warning | `border-warning/30 bg-warning-muted` |

### 6.10 Progress

```
h-2 rounded-full bg-muted overflow-hidden
```
Fill: `bg-primary rounded-full transition-all duration-300`

---

## 7. Recording Controls (Top Bar)

### LIVE Badge
```
rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white
```
Red dot: `w-2 h-2 rounded-full bg-red-500 animate-pulse-live`

### Pill Buttons
```
rounded-full bg-white/20 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-white/30 transition-colors
```

### Connection Status
```
text-[10px] text-emerald-300
```
Green dot: `w-1.5 h-1.5 rounded-full bg-emerald-400`

---

## 8. Animation & Motion

### Philosophy
Motion is **functional only**. It communicates state changes, not personality.

### Allowed Animations

| Name | Definition | Use |
|------|-----------|-----|
| `pulse-live` | `@keyframes pulse-live { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }` — 1.5s ease-in-out infinite | Recording indicator dot |
| `fade-in` | `@keyframes fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }` — 300ms ease-out | Transcript entries appearing |
| `spin` | Standard rotation — for loading spinners only | Loading states |

### Allowed Transitions
- `transition-colors` — all hover/focus state changes
- `transition-all duration-200` — card hover lift (`-translate-y-0.5` + `shadow-md`)
- `duration-200 ease` — sidebar collapse/expand

### Easing
- `ease` or `ease-out` only. No `spring`, no `bounce`.

### Forbidden
- Gradient mesh blob animations
- Scale-on-tap for buttons
- Decorative entrance animations (except `fade-in` for transcript)
- Any `ease-spring` or bounce easing
- Parallax effects

### motion/react Library Usage

**Decision criteria** (apply to all 36+ files that import `motion/react`):
- **KEEP** `AnimatePresence` wrapping conditional renders (show/hide toggling). This is functional — it enables exit animations for components being unmounted.
- **KEEP** sidebar collapse, mobile drawer slide, page transitions in Layout.tsx.
- **KEEP** `AnimatedCount.tsx` (number transitions are functional feedback).
- **KEEP** Toast enter/exit, Modal enter/exit, CommandPalette enter/exit, Select dropdown, notification appear/dismiss.
- **REMOVE** `motion.div` with `initial`/`animate` used for decorative staggered entrances (e.g., list items animating in one-by-one on page load).
- **REMOVE** `whileTap: { scale }` on buttons — use `transition-colors` only.
- **REMOVE** LoginPage parallax blobs and mouse-tracking effects.
- **REMOVE** Decorative `motion.div` entrance animations on EmptyState, card grids, and similar static content.
- **CONVERT** to CSS where possible: if a component uses `motion` only for a simple opacity/translate entrance, replace with the `animate-fade-in` CSS class.

**Rule of thumb:** If removing the animation would cause content to appear/disappear without transition (jarring), keep it. If the animation just makes content "slide in fancy" on first render, remove it.

### Reduced Motion
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 9. Scrollbar

```css
.scrollbar-thin {
  scrollbar-width: thin;
  scrollbar-color: var(--color-border) transparent;
}
.scrollbar-thin::-webkit-scrollbar { width: 6px; height: 6px; }
.scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
.scrollbar-thin::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 3px;
}
.scrollbar-thin::-webkit-scrollbar-thumb:hover {
  background: var(--color-muted-foreground);
}
```

---

## 10. Responsive Breakpoints

| Breakpoint | Width | Layout |
|------------|-------|--------|
| Desktop | >1024px | Sidebar expanded + split panels |
| Tablet | 768–1024px | Sidebar collapsed by default, panels stack or tab |
| Mobile | <768px | Sidebar hidden (hamburger menu), tab switcher |

### Mobile Tab Switcher
```
Transcript | Advisor | Memory
```
- Selected: `bg-primary/10 text-primary rounded-lg px-3 py-1.5 text-sm font-medium`
- Unselected: `text-muted-foreground px-3 py-1.5 text-sm`

---

## 11. Theme Toggle

### Behavior
- Reads `localStorage.getItem('theme')` on mount
- Falls back to `prefers-color-scheme` media query
- Three states: `light`, `dark`, `system`
- Applies `.dark` class to `document.documentElement`
- Icon: Moon (for switching to dark), Sun (for switching to light)

### FOUC Prevention
Inline script in `<head>` before any stylesheets or React:
```html
<script>
(function(){
  var t = localStorage.getItem('theme');
  if (t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme:dark)').matches))
    document.documentElement.classList.add('dark');
})();
</script>
```

---

## 12. Logo

### Wordmark
- "Board" in `text-blue-600` (light mode) / `text-blue-400` (dark mode / sidebar)
- "Room AI" in `text-foreground` (light mode) / `text-white` (sidebar)
- Font: `text-lg font-bold tracking-tight`

### Sidebar Logo (always dark background)
- "Board" in `text-blue-400`
- "Room AI" in `text-white`

---

## 13. Accessibility

### Contrast Requirements (WCAG AA)
- Body text on background: minimum 4.5:1
- Large text (18px+ or 14px+ bold) on background: minimum 3:1
- UI components and graphical objects: minimum 3:1
- Gold primary (`#b5890a`) as button background with white text: **3.68:1** — passes AA for large text (14px bold qualifies). Primary buttons use `font-bold` (700 weight) to meet this threshold.
- Gold primary on `--color-card` (#ffffff): **3.68:1** — passes 3:1 for UI components (borders, icons). NOT sufficient for body text.
- Gold text on light backgrounds: use `--color-primary-text` (`#8a6914`) which achieves **5.5:1** on white. Never use `--color-primary` as inline text color in light mode.
- **Rule:** `text-primary` class maps to `--color-primary-text` (not `--color-primary`). This ensures links and inline text always pass AA.

### Focus States
All interactive elements:
```
focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none
```

### Tab Order
1. Sidebar navigation
2. Top bar controls
3. Content panels (left to right, top to bottom)

### ARIA
- `aria-label` on all icon-only buttons (close, delete, collapse, toggle theme)
- `aria-live="polite"` on transcript region
- `role="dialog"` + `aria-modal="true"` on modals
- Focus trap in modals (Tab cycles within modal while open)

### Keyboard Shortcuts
- `R` — Toggle recording
- `1–7` — Select persona
- `Escape` — Close modal/command palette
- `Cmd+K` / `Ctrl+K` — Command palette

---

## 14. Brand Voice (UI Copy)

- Direct and concise. No exclamation marks.
- Sentence case for headings (not Title Case)
- Action verbs for buttons: "Start session", "Export transcript", "Save changes"
- Empty states: helpful, not cute. "No decisions yet. Start a session to create one."
- Error states: clear cause + clear action. "Could not save. Check your connection and try again."

---

## 15. Token Migration Map

### CSS Custom Properties

| Old Token | New Token |
|-----------|-----------|
| `--color-bg-base` | `--color-background` |
| `--color-bg-surface` | `--color-card` |
| `--color-bg-elevated` | `--color-card` |
| `--color-bg-hover` | `--color-muted` |
| `--color-bg-active` | `--color-accent` |
| `--color-text-primary` | `--color-foreground` |
| `--color-text-secondary` | `--color-muted-foreground` |
| `--color-text-tertiary` | `--color-muted-foreground` |
| `--color-text-inverse` | `--color-primary-foreground` |
| `--color-border-subtle` | `--color-border` |
| `--color-border-default` | `--color-border` |
| `--color-border-strong` | `--color-border` |
| `--color-accent-primary` | `--color-primary` |
| `--color-accent-primary-hover` | `--color-primary` at 90% opacity |
| `--color-accent-primary-muted` | `--color-ring` |
| `--color-accent-secondary` | `--color-primary-warm` (for gradients) or `--color-primary` (for flat usage) |
| `--color-danger` | `--color-destructive` |

### Tailwind Classes

| Old Class | New Class |
|-----------|-----------|
| `bg-bg-base` | `bg-background` |
| `bg-bg-surface` | `bg-card` |
| `bg-bg-elevated` | `bg-card` |
| `bg-bg-hover` | `bg-muted` |
| `bg-bg-active` | `bg-accent` |
| `text-text-primary` | `text-foreground` |
| `text-text-secondary` | `text-muted-foreground` |
| `text-text-tertiary` | `text-muted-foreground` |
| `border-line-subtle` | `border-border` |
| `border-line` | `border-border` |
| `border-line-strong` | `border-border` |
| `text-accent` | `text-primary` (maps to `--color-primary-text` for AA-safe text color) |
| `bg-accent` | `bg-primary` (buttons) or `bg-accent` (surfaces) |
| `bg-accent-muted` | `bg-primary/10` or `bg-accent` |
| `hover:bg-accent-hover` | `hover:bg-primary/90` |
| `text-danger` | `text-destructive` |
| `bg-danger` | `bg-destructive` |
| `bg-danger-muted` | `bg-destructive/10` |
| `shadow-glow` | `shadow-md` (or remove entirely) |
| `shadow-accent/20` | `shadow-lg` (neutral shadow, no colored shadows) |
| `from-accent to-accent-secondary` | `from-primary to-primary-warm` |
| `active:scale-[0.99]` | (removed — no scale-on-tap) |

### Gradient Migration

All current `from-accent to-accent-secondary` (indigo→violet) gradients become `from-primary to-primary-warm` (gold→sienna). Specific replacements:

| File | Current | Replacement |
|------|---------|-------------|
| `Sidebar.tsx` logo text | `from-accent to-accent-secondary bg-clip-text` | Plain text: "Board" `text-blue-400`, "Room AI" `text-white` |
| `LoginPage.tsx` brand mark | `from-accent to-accent-secondary` gradient | `from-primary to-primary-warm` gradient |
| `Progress.tsx` fill | `from-accent to-accent-secondary` | Solid `bg-primary` (no gradient on small elements) |
| `SynthesisPanel.tsx` border | `borderImage` with accent gradient | `border-2 border-primary` (solid) |
| `WeeklyMemoCard.tsx` border | `borderImage` with accent gradient | `border-2 border-primary` (solid) |
| `SimulationButton.tsx` | `bg-accent-secondary/10`, `border-accent-secondary/30` | `bg-primary-warm/10`, `border-primary-warm/30` |
| `SimulationPanel.tsx` | `text-accent-secondary` | `text-primary` |
| `DayColumn.tsx` | `text-accent-secondary` | `text-primary` |
| `CommandPalette.tsx` | `text-accent-secondary` | `text-primary` |
| `OnboardingPage.tsx` | gradient text + bg ref | `from-primary to-primary-warm` or plain `text-primary` |
| LoginPage inline hex blobs | `#6366f1`, `#8b5cf6` gradients | `var(--color-primary)`, `var(--color-primary-warm)` |
| Progress.tsx inline shadow | `rgba(99, 102, 241, 0.4)` | Remove (no colored shadows) |

### Non-Color Token Migration

Typography, spacing, z-index, transition, and easing tokens are **carried forward unchanged** with the following exceptions:
- `--ease-spring` → **removed** (spring easing forbidden per Section 8)
- `--shadow-glow` → **removed** (no colored shadows per Section 4)
- All other non-color tokens (spacing, radius, z-index, durations, line-heights, letter-spacing) retain their current names and values.

### CSS Classes to Remove

These CSS constructs in `tokens.css` should be removed entirely:
- `.gradient-mesh` class and associated pseudo-element styles
- `@keyframes gradientMesh1`, `gradientMesh2`, `gradientMesh3`

---

## 16. LoginPage Post-Migration Layout

The current LoginPage has a dark split-panel layout with parallax gradient blobs. Post-migration:

### Light Mode
- **Left panel (brand):** Warm background (`bg-muted`), no animated blobs. Static gold-to-sienna gradient treatment as a subtle background element. Feature list with gold checkmark icons. Testimonial carousel (keep, but with `transition-colors` only, no spring animations).
- **Right panel (form):** `bg-card` with standard card shadow. Gold primary CTA button. Clean form layout per Input spec.
- **Mobile:** Left panel hidden, form centered on `bg-background`.

### Dark Mode
- Same layout with `.dark` token overrides. Left panel uses `bg-card` dark. Right panel uses `bg-background` dark.

Remove: parallax mouse tracking, animated gradient blobs, radial glow behind form.
Keep: split layout structure, testimonial carousel (with CSS transitions), feature list.

---

## 17. Implementation Checklist

For every component, verify:

- [ ] Uses only token-based Tailwind classes (no hardcoded hex in className)
- [ ] No inline `style` with hardcoded colors (use CSS vars if dynamic)
- [ ] Works in light mode (`:root`)
- [ ] Works in dark mode (`.dark`)
- [ ] Text meets WCAG AA contrast against its background
- [ ] Interactive elements have `focus-visible` ring
- [ ] Hover states use `transition-colors`
- [ ] Default radius is `rounded-xl` (12px) for cards, buttons, inputs
- [ ] No decorative animations (only functional: `fade-in`, `pulse-live`, `spin`)
- [ ] No `shadow-glow` or colored shadows

---

*Version: 1.0*
*Created: 2026-04-08*
*Maintained by: Claude Code (Opus)*
