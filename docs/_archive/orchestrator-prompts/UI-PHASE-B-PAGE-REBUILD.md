# UI PHASE B — PAGE-BY-PAGE REBUILD

> **Usage**: Paste into Claude Code (Opus). Fresh session.
> **Purpose**: Rebuild every page using Phase A's design system, component library,
>   and motion primitives. Transform engineer-grade pages into premium SaaS screens.
> **Duration**: ~6-8 hours.
> **Scope**: Client code only. No server changes. No new API endpoints.
> **Prereqs**: Phase A complete (design tokens, component library, motion primitives,
>   command palette, layout rebuild, toast system all in place).

---

Read .claude/CLAUDE.md first. You are the PAGE REBUILD AGENT.

**Context**: Phase A created the design foundation — tokens in `styles/tokens.css`,
components in `components/ui/`, motion presets in `lib/motion.ts`, layout shell in
`components/shared/Sidebar.tsx` + `AppHeader.tsx`, `cn()` in `lib/cn.ts`,
toast system via `useToastStore`, and a command palette at `components/ui/CommandPalette.tsx`.

Your job: apply all of it to every page. Each page gets rebuilt with the new
design system, motion animations, proper loading/error/empty states, and
premium visual polish. Reference only real files — import from the component
library, not arbitrary Tailwind classes.

**Commit after EACH task.** Message format:
`feat(ui): description — UI-B-{N}`

---

## DESIGN PRINCIPLES (Apply to every page)

1. **Token-first**: Use design token classes (`bg-bg-surface`, `text-text-secondary`,
   `border-line`, etc.). Never hardcode hex or arbitrary gray-### values.
2. **Component-first**: Use `<Button>`, `<Card>`, `<Badge>`, `<Input>`, `<Skeleton>`,
   `<Tabs>`, `<Progress>`, `<Avatar>`, `<Tooltip>` from `components/ui/`. Don't
   recreate button styles inline.
3. **Motion-first**: Wrap every page in `<PageWrapper>`. Use `staggerContainer` +
   `staggerItem` for lists. Use `AnimatePresence` for conditional content.
   Use `fadeIn`/`slideUp` for sections that load asynchronously.
4. **State-first**: Every page must handle 4 states: loading, error, empty, data.
   Loading = skeleton shimmer. Error = `<ErrorBanner>` with retry. Empty = illustrated
   `<EmptyState>` from Phase A. Data = the actual content.
5. **Density**: 14px base. Compact spacing. Data should breathe but not waste space.
   Think Linear/Vercel, not WordPress admin.

---

## TASK 1: Login & Registration Page

**File:** `packages/boardroom-ai/client/src/pages/LoginPage.tsx`

### Current state
- Center card, plain inputs, toggle between login/register, gray background.
- No animation, no brand identity, no visual interest.

### Rebuild spec

**Layout:**
- Full-screen split: left 40% brand panel, right 60% form panel (stack on mobile)
- Left panel: `bg-bg-base` with subtle animated gradient mesh background
  (CSS `@keyframes` with 3 indigo/violet blobs moving slowly — pure CSS, no canvas).
  Define the `@keyframes gradientMesh` in `styles/tokens.css` alongside other tokens.
  Create a `.gradient-mesh` utility class there. Reference in the LoginPage component.
  - Centered: "BoardRoom" logo text in `font-display text-3xl font-bold` with
    `bg-gradient-to-r from-accent to-accent-secondary bg-clip-text text-transparent`
  - Tagline below: "Intelligent decisions. Clear direction." in `text-text-secondary text-lg`
  - 3 rotating testimonial/value props at bottom (fade transition every 5 seconds):
    "Stress-test ideas before committing resources"
    "Detect priority drift before it costs you"
    "Every decision backed by your full context"
- Right panel: `bg-bg-surface` with the form

**Form:**
- Use `<Card>` with no border (clean surface)
- Use `<Input>` components with labels
- Use `<Button variant="primary" size="lg">` for submit (full width)
- Toggle: "Don't have an account? Sign up" as `<Button variant="ghost">`
- Error: Use toast system (`useToastStore`) instead of inline error banner
- Motion: form slides in from right (`slideIn` preset), inputs stagger in

**Transitions:**
- Login ↔ Register: `AnimatePresence mode="wait"` with crossfade on the form title
  and any fields that differ (name field slides in/out)

**Validate:** `npm run typecheck`.

---

## TASK 2: Onboarding Flow

**File:** `packages/boardroom-ai/client/src/pages/OnboardingPage.tsx`
**Components:** `components/onboarding/WizardStep.tsx`, `AboutYouStep.tsx`,
`GoalsStep.tsx`, `ProjectsStep.tsx`, `PeopleStep.tsx`, `ContextStep.tsx`

### Current state
- 5-step wizard with WizardStep wrapper. Functional but flat. No progress
  visualization, no celebration, no personality.

### Rebuild spec

**Wrapper (OnboardingPage.tsx):**
- Full-screen centered layout, no sidebar/header (standalone flow)
- Background: `bg-bg-base` with the same gradient mesh from login (reuse)
- Centered card: `max-w-2xl` `bg-bg-surface` `rounded-xl` `shadow-lg` `border border-line`
- Progress bar at top of card: `<Progress>` component showing step/5 * 100
  with step labels underneath ("About You" → "Goals" → "Projects" → "People" → "Context")
  - Current step label: `text-accent font-medium`
  - Completed steps: `text-success` with checkmark icon
  - Future steps: `text-text-tertiary`

**Step transitions:**
- Each step wrapped in `AnimatePresence mode="wait"`
- Forward: content slides left out, new slides left in (`x: 20 → 0` / `x: 0 → -20`)
- Backward: reverse direction
- Use `motion.div` with `key={currentStep}` for automatic AnimatePresence swap

**Individual steps:**
- Replace raw `<input>` and `<textarea>` with `<Input>` and styled textareas
- Replace raw buttons with `<Button>` variants
- GoalsStep + ProjectsStep: When extraction completes, show extracted items with
  `staggerContainer`/`staggerItem` animation. Each extracted item: `<Card hover>`
  with `<Badge>` for type
- PeopleStep: Each person row uses `<Card>` with `<Avatar>` component, `<Input>`
  fields, and a remove button with `<Button variant="ghost" size="sm">`

**Completion (step 5 → redirect):**
- After `complete()` succeeds, show a 2-second celebration screen:
  - Large checkmark icon with `scaleIn` animation
  - "You're all set!" in `text-2xl font-semibold`
  - "Redirecting to your dashboard..." in `text-text-secondary`
  - Subtle confetti effect: 20-30 small colored dots (`accent`, `success`, `warning`)
    animating outward from center using Motion `animate` with random trajectories
    (no heavy library — just motion.div elements with random x/y/rotation targets)
- Then navigate to `/`

**Data persistence:** Keep existing sessionStorage logic. No changes needed.

**Validate:** `npm run typecheck`.

---

## TASK 3: Dashboard Page

**File:** `packages/boardroom-ai/client/src/pages/DashboardPage.tsx`
**Components:** All dashboard widget components in `components/dashboard/`

### Current state
- "Dashboard" heading + customize button. Grid of widgets. Error banner.
- No visual hierarchy, no greeting, no intelligence summary.

### Rebuild spec

**Header section:**
- Replace static "Dashboard" with dynamic greeting:
  - `"Good morning, {firstName}"` / afternoon / evening (based on hour)
  - Subtitle: a one-liner from the cognitive load hook or proactive questions hook.
    E.g., "You have 3 overdue tasks" or "All projects on track" — in `text-text-secondary`
- Right side: "Customize" button → `<Button variant="ghost" size="sm">` with grid icon

**Widget grid:**
- Wrap entire grid in `motion.div` with `staggerContainer`
- Each widget wrapped in `motion.div` with `staggerItem`
- Widget cards: use `<Card>` component with consistent padding
- Widget headers: `text-sm font-medium text-text-secondary uppercase tracking-wide`
  with right-aligned action button (ghost) where applicable

**Widget-specific polish:**

1. **GoalHierarchy** (`components/dashboard/GoalHierarchy.tsx`):
   - Tree nodes use `<Card hover>` with indentation via `pl-{level * 4}`
   - Status indicated by colored left border (success=on-track, warning=at-risk, danger=overdue)
   - `<Badge>` for status text
   - `<Progress>` bar for completion percentage
   - Expand/collapse children with `AnimatePresence` + `slideUp`

2. **WeekCalendarStrip** (`components/dashboard/WeekCalendarStrip.tsx`):
   - Day columns with `bg-bg-elevated` cards
   - Today highlighted: `border-accent` ring, `bg-accent-muted` header
   - Events as small pills with `<Badge variant="soft">`
   - Empty days: subtle dashed border placeholder

3. **WeeklyMemoCard** (`components/dashboard/WeeklyMemoCard.tsx`):
   - `<Card>` with accent gradient top border (2px `bg-gradient-to-r from-accent to-accent-secondary`)
   - Memo text in `text-text-primary leading-relaxed`
   - "Generate Memo" button: `<Button variant="secondary">` with sparkle icon
   - Loading state: `<Skeleton>` lines

4. **CortexInsightsPanel** (`components/dashboard/CortexInsightsPanel.tsx`):
   - Pattern cards with confidence bar (`<Progress>`)
   - Pattern type as `<Badge>`
   - Evidence count in `text-text-tertiary text-xs`

5. **ProactiveQuestions** (`components/dashboard/ProactiveQuestions.tsx`):
   - Each question in a `<Card hover>` with left icon matching type
   - Dismiss button (X) with `fadeIn`/`fadeOut` AnimatePresence
   - Stagger animation on mount

6. **OutcomeReviewBanner** (`components/dashboard/OutcomeReviewBanner.tsx`):
   - Accent-muted background banner with pulse dot indicator
   - "Review" button: `<Button variant="primary" size="sm">`

7. **CognitiveLoadBanner** (`components/dashboard/CognitiveLoadBanner.tsx`):
   - Warning severity: `bg-warning-muted border-l-2 border-warning`
   - Critical severity: `bg-danger-muted border-l-2 border-danger`
   - Animated attention pulse on critical

8. **RecentDecisions** (`components/dashboard/RecentDecisions.tsx`):
   - Decision rows: `<Card hover>` with question text, mode `<Badge>`, timestamp
   - Click → navigate to `/decisions/:id`
   - Stagger animation

9. **QuickTakeWidget** (`components/dashboard/QuickTakeWidget.tsx`):
   - `<Card>` with `<Input>` and `<Button variant="primary">` inline
   - Placeholder: "What decision are you facing?"
   - Enter triggers navigation to new session with pre-filled question

10. **ContradictionCard** (`components/dashboard/ContradictionCard.tsx`):
    NOTE: This is NOT a standalone widget — it renders INSIDE `CortexInsightsPanel`.
    Polish it in the context of that parent component:
    - `bg-danger-muted` card with severity `<Badge>`
    - Entity names in `font-medium`
    - Resolve/dismiss actions as `<Button variant="ghost" size="sm">`

**Empty dashboard:**
- If no widgets have data yet (fresh user, just completed onboarding):
  - Show `<EmptyState variant="no-data">` with "Your dashboard will come alive as
    you start making decisions and tracking goals"
  - Below: 3 quick-start cards (staggered in): "Create a Goal", "Start a Decision",
    "Add a Team Member" — each as `<Card hover>` with icon, title, and description

**Validate:** `npm run typecheck`.

---

## TASK 4: Decision Lab (List Page)

**File:** `packages/boardroom-ai/client/src/pages/DecisionLabPage.tsx`

### Current state
- "Decision Lab" heading + "New Decision" button. Session cards as flat divs.

### Rebuild spec

**Header:**
- "Decision Lab" in `text-2xl font-semibold`
- Subtitle: `{sessions.length} decisions analyzed` in `text-text-secondary`
- Right: `<Button variant="primary">` "New Decision" with plus icon

**Session list:**
- Wrap in `staggerContainer`, each card as `staggerItem`
- Each session: `<Card hover>` with:
  - Question text: `text-text-primary font-medium` (truncate at 2 lines)
  - Mode: `<Badge>` with mode-specific color:
    - decide → accent, stress-test → warning, plan → info, clarify → success,
      review → secondary, quick-take → ghost
  - Persona count: `<Avatar>` stack (overlapping circles, max 3 shown + "+N")
  - Synthesis status: `<Badge variant="success">` "Synthesized" or `<Badge variant="default">` "In Progress"
  - Timestamp: `text-text-tertiary text-xs` relative time ("2 hours ago")
- Click → navigate to `/decisions/:id`

**Filter/sort bar (NEW):**
- Between header and list
- Filter by mode: horizontal `<Tabs>` — All | Decide | Stress Test | Plan | Clarify | Review
- Sort: dropdown — "Most Recent" (default) | "Oldest"
- This is CLIENT-SIDE filtering only (filter the fetched sessions array)

**Empty state:**
- `<EmptyState variant="no-decisions">`
- Title: "No decisions yet"
- Description: "Start your first decision analysis to see it here"
- Action: `<Button variant="primary">` "Start Your First Decision"

**Loading state:**
- 4 `<Skeleton>` cards matching the session card layout

**Validate:** `npm run typecheck`.

---

## TASK 5: Decision Session Page (The Crown Jewel)

**File:** `packages/boardroom-ai/client/src/pages/DecisionSessionPage.tsx`
**Components:** `ModeSelector.tsx`, `PersonaCard.tsx`, `SynthesisPanel.tsx`,
`SufficiencyBanner.tsx`, `SimulationButton.tsx`, `SimulationPanel.tsx`

### Current state
- 3-phase flow: input → persona grid → synthesis. Functional streaming.
- Flat gray cards, no persona personality, no visual drama.

### Rebuild spec

This is the most important page. It's where users spend the majority of their
meaningful time. It needs to feel ALIVE — intelligent, responsive, dramatic.

**Phase 1 — Input:**
- Clean centered layout: `max-w-2xl mx-auto`
- Question input: large `<textarea>` styled with token classes, auto-growing,
  `text-lg` placeholder "What decision are you wrestling with?"
- `ModeSelector.tsx` rebuild:
  - Horizontal row of mode cards (not just buttons)
  - Each mode: icon + name + one-line description
  - Selected mode: `border-accent bg-accent-muted` with `scaleIn` checkmark
  - Use `motion.div` with `layoutId="mode-selector"` for selection indicator
- Buttons below: "Analyze" `<Button variant="primary" size="lg">` +
  "Check Clarity" `<Button variant="ghost">`
- `SufficiencyBanner.tsx`: animated slide-down with `slideUp`, uses `<Card>`
  with `bg-info-muted border-info` styling

**Phase 2 — Persona Analysis:**
- Transition: Phase 1 content fades out (`AnimatePresence`), persona grid fades in
- Grid: responsive — 1 col mobile, 2 col md, 3 col lg
- `PersonaCard.tsx` rebuild:
  - Each card: `<Card>` with colored top border (3px) matching persona color
    (use existing persona color config from tailwind — optimist=green, critic=red, etc.)
  - Card header: persona icon (emoji or avatar) + name + `<Badge>` role
  - **Waiting state**: Subtle pulse animation on the card border, "Thinking..." with
    animated dots (3 dots cycling with stagger)
  - **Streaming state**: Text appears with a typing effect. Use the existing streaming
    text from `personaStreaming[id]`. Add a pulsing cursor (blinking `|` at end).
    Card has a subtle `shadow-glow` while streaming.
  - **Complete state**: Full response with collapsible sections.
    NOTE: The existing PersonaCard.tsx has these sections — keep the same order,
    just upgrade visuals. Change visibility defaults as follows:
    - Situation Reading (collapsible, default open — matches existing)
    - Key Assumptions (collapsible, default closed — show as `<Badge>` pills when expanded)
    - Analysis (always visible — matches existing)
    - Recommendation (highlighted in `bg-accent-muted rounded-md p-3`)
    - Uncertainties (collapsible, default closed — matches existing)
    - Confidence: `<Progress>` bar with percentage
    - Dissent flag: if true, show `<Badge variant="warning">` "DISSENTS"
  - **Section collapse**: Use `AnimatePresence` + `motion.div` with height animation
  - Custom personas: show `<Badge variant="accent">` "Custom" tag
- "Synthesize" button: appears after all personas complete, centered below grid,
  `<Button variant="primary" size="lg">` with sparkle icon, `scaleIn` animation

**Phase 3 — Synthesis:**
- Transition: persona grid slides up and compresses (or scrolls up), synthesis
  panel slides in from bottom
- `SynthesisPanel.tsx` rebuild:
  - Full-width `<Card>` with accent gradient top border (like memo card)
  - Header: "CEO Synthesis" with crown/briefcase icon, `<Badge variant="accent">`
  - Sections with clear visual hierarchy:
    - **Disagreement Map**: Table or structured view showing where personas diverged.
      Each row: persona name (colored) + their stance. Use `<Card>` nested cards.
    - **Decisive Tradeoff**: Highlighted callout box, `bg-accent-muted rounded-lg p-4`
    - **Recommendation**: Large text, `text-lg font-medium`, clear and prominent
    - **Next Actions**: Numbered list with checkboxes (visual only, not interactive)
    - **Top Risks**: `<Badge variant="danger">` tags with descriptions
    - **Assumptions to Monitor**: `<Badge variant="warning">` tags
  - Streaming: Same typing effect as persona cards, sections reveal progressively

- `SimulationButton.tsx` + `SimulationPanel.tsx`:
  - Button: `<Button variant="secondary">` "Run Simulation" with flask icon
  - Input: `<Input>` for chosen path, inline with button
  - Results panel: `<Card>` with structured outcome display
  - Loading: `<Skeleton>` blocks during simulation

**Action bar (bottom of page):**
- Sticky footer bar when in Phase 3:
  - "Export" `<Button variant="ghost">`, "New Decision" `<Button variant="secondary">`,
    "Run Simulation" `<Button variant="primary">`
  - `bg-bg-surface/80 backdrop-blur border-t border-line` for frosted glass effect

**Validate:** `npm run typecheck`.

---

## TASK 6: Memory Explorer Page

**File:** `packages/boardroom-ai/client/src/pages/MemoryExplorerPage.tsx`
**Components:** `MemorySearch.tsx`, `MemoryList.tsx`, `MemoryCard.tsx`,
`MemoryDetail.tsx`, `EntityLinker.tsx`

### Current state
- 2-column layout. Search + filter. Memory list with infinite scroll.
  Detail panel on right. Functional but visually flat.

### Rebuild spec

**Layout:**
- 2-column: left 55%, right 45% (adjust from current 2/3 + 1/3 for better balance)
- Left: search/filter bar + scrollable memory list
- Right: detail panel (sticky, fills viewport height minus header)
- Divider: subtle `border-line-subtle` vertical line

**Search bar (`MemorySearch.tsx`):**
- `<Input>` with search icon prefix, `placeholder="Search your memories..."`
- Filter row below: horizontal scroll of `<Badge>` filter chips for domain, class, status
  - Active filter: `<Badge variant="accent">` — clickable to remove
  - "Add filter" button: `<Button variant="ghost" size="sm">` with plus icon
  - Dropdown for each filter type with `AnimatePresence` slide-down

**Memory list (`MemoryList.tsx` + `MemoryCard.tsx`):**
- Wrap list in `staggerContainer`, each card as `staggerItem`
- `MemoryCard.tsx`:
  - `<Card hover>` with compact layout
  - Left: colored dot for domain (color-coded: business=accent, personal=success, etc.)
  - Title: `font-medium text-text-primary` (1 line, truncated)
  - Content preview: `text-text-secondary text-sm` (2 lines max)
  - Bottom row: `<Badge>` for class + `<Badge>` for status + relative timestamp
  - Selected card: `border-accent bg-accent-muted` ring
- Infinite scroll: `<Skeleton>` cards at bottom when loading more
- Empty: `<EmptyState variant="no-memories">`

**Detail panel (`MemoryDetail.tsx`):**
- When no memory selected: centered illustration + "Select a memory to view details"
- When selected: `slideIn` animation from right
  - Title: `text-xl font-semibold`
  - Domain + class + status as `<Badge>` row
  - Importance: star rating or `<Progress>` bar
  - Content: full text in `text-text-primary leading-relaxed`
  - Timestamps: created, updated in `text-text-tertiary text-xs`
  - **Entity links** (`EntityLinker.tsx`): section showing linked people/projects/goals
    as `<Card hover>` pills with `<Avatar>` for people. "Link entity" button to add more.
  - **Actions**: Edit, Archive buttons at bottom
    - Archive: confirm via toast ("Memory archived" with undo action)

**Validate:** `npm run typecheck`.

---

## TASK 7: People Directory Page

**File:** `packages/boardroom-ai/client/src/pages/PeopleDirectoryPage.tsx`
**Components:** `PersonCard.tsx`, `RelationshipGraph.tsx`

### Current state
- Two tabs: Directory (card grid) and Relationship Map. Inline add form.
  Functional but bland.

### Rebuild spec

**Tabs:**
- Use `<Tabs>` component from Phase A (animated underline indicator)
- Tabs: "Directory" | "Relationship Map"

**Directory tab:**
- Search: `<Input>` with search icon, filters by name/role/domain
- "Add Person" button: `<Button variant="primary" size="sm">` — opens a modal
  (not inline form) using `<Card>` in a modal overlay with `scaleIn` animation
  - Modal form: `<Input>` for name, role, relationship, domains, notes
  - Save: `<Button variant="primary">`, Cancel: `<Button variant="ghost">`
- Person grid: responsive grid (1 col sm, 2 col md, 3 col lg)
  - `PersonCard.tsx` rebuild:
    - `<Card hover>` with:
    - `<Avatar size="lg">` at top (initials, color from name hash)
    - Name: `font-semibold text-text-primary`
    - Role: `text-text-secondary text-sm`
    - Relationship: `<Badge>` (advisor=info, team=success, stakeholder=warning, etc.)
    - Domains: row of `<Badge variant="default" size="sm">` pills
    - Notes: truncated preview, `text-text-tertiary text-xs` (2 lines)
    - Actions: edit (pencil icon) + delete (trash icon) as `<Button variant="ghost" size="sm">`
    - Delete: confirm via toast with undo
- Stagger animation on the grid
- Empty: `<EmptyState variant="no-people">`

**Relationship Map tab:**
- Keep existing D3 graph logic in `RelationshipGraph.tsx`
- Visual upgrade:
  - Node circles: use accent/persona colors, `<Avatar>` rendered as SVG foreignObject
  - Edge lines: `stroke: var(--color-border-default)`, dashed for weak relationships
  - Hover node: enlarge + show tooltip with name + role
  - Background: subtle dot grid pattern
- Minimum 3 people required — below that, show `<EmptyState>` with
  "Add at least 3 people to see the relationship map"

**Validate:** `npm run typecheck`.

---

## TASK 8: Settings Page

**File:** `packages/boardroom-ai/client/src/pages/SettingsPage.tsx`
**Components:** `CalendarSettings.tsx`, `SubscriptionSettings.tsx`

### Current state
- Multiple sections stacked: Profile, Risk Profile, Values, Subscription,
  Calendar, Account. Raw inputs, no visual grouping.

### Rebuild spec

**Layout:**
- Left sidebar nav (within the page, not the app sidebar): vertical list of
  section links — Profile, Preferences, Integrations, Subscription, Account
  - Active section: `text-accent font-medium` with left border indicator
  - Click scrolls to section (smooth scroll)
- Right content area: sections with clear spacing

**Sections (each wrapped in `<Card>` with title):**

1. **Profile**:
   - `<Input>` fields for name, email (read-only), role, industry, decision frequency
   - Save: `<Button variant="primary">` — success toast on save

2. **Preferences (Risk Profile + Values)**:
   - Risk sliders: styled range inputs with labels and accent color track
     - Each slider: label + current value badge + range input
     - Categories: Financial, Technical, People, Strategic
   - Values: tag-style input — show current values as `<Badge>` pills with X to remove,
     `<Input>` to add new. Not raw comma-separated text.

3. **Integrations** (moved from separate page — or keep link to IntegrationsPage):
   - Summary cards for connected integrations with status `<Badge>`
   - "Manage Integrations" link to IntegrationsPage

4. **Subscription**:
   - `SubscriptionSettings.tsx` wrapped in `<Card>`
   - Current plan shown with `<Badge variant="accent">`
   - Upgrade CTA: `<Button variant="primary">`

5. **Account**:
   - Logout: `<Button variant="secondary">`
   - Delete Account: `<Button variant="danger">` with confirmation modal
   - Confirmation modal: `scaleIn` animation, "Are you sure?" with red warning

**Validate:** `npm run typecheck`.

---

## TASK 9: Custom Personas Page

**File:** `packages/boardroom-ai/client/src/pages/CustomPersonasPage.tsx`
**Components:** `PersonaEditor.tsx`

### Current state
- List of custom personas with create/edit/delete. PersonaEditor form.
  Functional but basic.

### Rebuild spec

**Header:**
- "Custom Personas" title + subtitle: `{personas.length}/3 personas created`
- "Create Persona" button: `<Button variant="primary">` (disabled at max 3)

**Persona list:**
- Grid: 1 col sm, 2 col md, 3 col lg (max 3 cards so it always fits)
- Each persona: `<Card>` with:
  - Icon (emoji) large at top: `text-3xl`
  - Name: `font-semibold text-lg`
  - Description: `text-text-secondary text-sm` (3 lines max)
  - Model tier: `<Badge>` (Haiku=default, Sonnet=accent)
  - Active toggle: styled switch (green when active, gray when inactive)
    with `motion` spring animation on the knob
  - Actions: Edit + Delete as icon buttons
- Empty: `<EmptyState>` "Create custom personas to add unique perspectives
  to your decision analysis"

**PersonaEditor modal:**
- Open as modal overlay (not inline), `scaleIn` animation
- Form fields: all using `<Input>` and `<Select>` components
  - Name, Description (textarea), Icon (emoji picker or text input),
    Model Tier (select: Haiku / Sonnet), System Prompt (large textarea with monospace font)
- System prompt textarea: `font-mono text-sm bg-bg-base` with line numbers feel
- Preview section: live preview of how the persona card will look
- Save + Cancel buttons

**Validate:** `npm run typecheck`.

---

## TASK 10: Integrations Page

**File:** `packages/boardroom-ai/client/src/pages/IntegrationsPage.tsx`
**Components:** `IntegrationCard.tsx`, `EmailScanner.tsx`

### Current state
- Grid of 4 integration cards (Gmail, Calendar, Slack, Notion).
  Status display and connect/disconnect buttons.

### Rebuild spec

**Layout:**
- Header: "Integrations" + subtitle "Connect your tools to enrich your decision context"
- Grid: 2 col (responsive, 1 col mobile)

**IntegrationCard.tsx rebuild:**
- `<Card>` with:
  - Integration icon (use branded SVG for Gmail/Calendar, generic for Slack/Notion)
    — for simplicity, use colored emoji or Unicode symbols as placeholder icons
  - Name: `font-semibold`
  - Description: one-line `text-text-secondary text-sm`
  - Status `<Badge>`:
    - connected: `<Badge variant="success">` "Connected"
    - disconnected: `<Badge variant="default">` "Not Connected"
    - error: `<Badge variant="danger">` "Error"
    - coming_soon: `<Badge variant="default">` "Coming Soon" (dimmed card, `opacity-60`)
  - Last sync: `text-text-tertiary text-xs` (if connected)
  - Action: `<Button variant="primary" size="sm">` "Connect" or
    `<Button variant="danger" size="sm">` "Disconnect"
  - Coming soon cards: no button, badge only

**EmailScanner.tsx polish:**
- When Gmail connected, show below Gmail card (or in expanded section)
- Email list with extraction buttons using design system components
- Extraction results: `<Card>` with extracted memory previews, confirm/reject buttons

**Validate:** `npm run typecheck`.

---

## TASK 11: Loading & Error States (Global Pass)

Go through EVERY page and ensure consistent handling:

### Loading states
Each page that fetches data on mount must show `<Skeleton>` components
that match the shape of the actual content:

- **DashboardPage**: Skeleton widget cards in grid layout
- **DecisionLabPage**: Skeleton session cards (4 of them)
- **DecisionSessionPage**: Skeleton persona cards during dispatch
- **MemoryExplorerPage**: Skeleton memory cards in list
- **PeopleDirectoryPage**: Skeleton person cards in grid
- **SettingsPage**: Skeleton form fields
- **CustomPersonasPage**: Skeleton persona cards
- **IntegrationsPage**: Skeleton integration cards

### Error states
Every page with a store `error` field must show `<ErrorBanner>` with:
- Error message
- "Retry" button that re-fetches data
- Toast notification for transient errors (create, update, delete failures)

### Transitions
Verify that every page:
- Is wrapped in `<PageWrapper>` (from Phase A motion primitives)
- Uses `AnimatePresence` for conditional content (modals, expandable sections)
- Uses `staggerContainer`/`staggerItem` for lists

**Validate:** `npm run typecheck`.

---

## TASK 12: Typography & Spacing Audit

Final visual consistency pass across all pages:

### Typography
- Page titles: `text-2xl font-semibold text-text-primary`
- Section headers: `text-lg font-medium text-text-primary`
- Widget/card headers: `text-sm font-medium text-text-secondary uppercase tracking-wide`
- Body text: `text-sm text-text-primary leading-relaxed` (or `text-base` for long-form)
- Secondary text: `text-sm text-text-secondary`
- Metadata/timestamps: `text-xs text-text-tertiary`
- Monospace (code/prompts): `font-mono text-sm`

### Spacing
- Page padding: `p-6` (matches Layout from Phase A)
- Section gaps: `space-y-6` between major sections
- Card internal padding: `p-4` (compact) or `p-6` (roomy)
- Between card elements: `space-y-3`
- Between inline items: `gap-2` or `gap-3`

### Verify
- No raw `text-white`, `text-gray-*`, `bg-gray-*` classes remain
  (all replaced with token-based classes)
- No hardcoded hex values in className strings
- Consistent border radius usage (from tokens)

**Validate:** `npm run typecheck`. Visual scan of every page.

---

## FINAL: PHASE B REPORT

```markdown
# UI Phase B Report — Page-by-Page Rebuild
Date: [date]

## Completed
1.  [PASS/FAIL] Login & Registration page rebuild
2.  [PASS/FAIL] Onboarding flow rebuild (5 steps + celebration)
3.  [PASS/FAIL] Dashboard page rebuild (all widgets polished)
4.  [PASS/FAIL] Decision Lab list page rebuild
5.  [PASS/FAIL] Decision Session page rebuild (3 phases, streaming)
6.  [PASS/FAIL] Memory Explorer page rebuild
7.  [PASS/FAIL] People Directory page rebuild (directory + graph)
8.  [PASS/FAIL] Settings page rebuild
9.  [PASS/FAIL] Custom Personas page rebuild
10. [PASS/FAIL] Integrations page rebuild
11. [PASS/FAIL] Loading & error states global pass
12. [PASS/FAIL] Typography & spacing audit

## Pages Rebuilt: [count]/10
## Components Upgraded: [count]
## Token Violations Remaining: [count] (should be 0)

## Notes
- [Any issues encountered]
```

---

## EXECUTION ORDER

1. Task 1 — Login (45 min)
2. Task 2 — Onboarding (60 min)
3. Task 3 — Dashboard + widgets (90 min)
4. Task 4 — Decision Lab list (30 min)
5. Task 5 — Decision Session (90 min) ← most complex
6. Task 6 — Memory Explorer (45 min)
7. Task 7 — People Directory (45 min)
8. Task 8 — Settings (30 min)
9. Task 9 — Custom Personas (30 min)
10. Task 10 — Integrations (30 min)
11. Task 11 — Loading/error global pass (30 min)
12. Task 12 — Typography/spacing audit (20 min)

Begin Task 1 now. Commit after each task. Go.
