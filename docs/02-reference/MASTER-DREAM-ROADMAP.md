# BoardRoom AI — Master Dream Roadmap

> **Generated:** 2026-04-17
> **Method:** Two independent dream passes (module-centric + user-journey-centric), cross-audited, synthesized.
> **Scope:** Every module, feature, micro-feature — with look, function, and data connection specs.

---

## Cross-Audit Summary

### Pass 1 (Module-Centric) — Strengths
- Strong taxonomy: 8 clean modules with clear separation of concerns
- Good coverage of decision lifecycle (make → track → review → learn)
- Identified the compound intelligence layer (cross-module data flows)

### Pass 2 (User-Journey-Centric) — What It Caught That Pass 1 Missed
- **Input diversity**: Pass 1 assumed text-in, text-out. Real users need voice input, document upload, email forwarding, screenshot capture, quick-capture mobile flows
- **Time-awareness**: Most features in Pass 1 are point-in-time. Users need the system to reason about time — "what changed since last week?", "what's coming in 3 days?", "how has my thinking evolved?"
- **Proactive intelligence**: Pass 1 was mostly reactive (user asks, system answers). The killer product PUSHES intelligence to the user — "You should think about X today" before they know they need to
- **Output diversity**: Pass 1 outputs text. Users need exportable briefs, shareable artifacts, calendar events, email drafts, Notion/docs exports
- **Onramp simplicity**: Pass 1 front-loaded complexity. Real adoption needs a 30-second-to-value entry point that deepens over time
- **Ministry-specific features**: Pass 1 was entirely business-focused. Missed sermon prep, pastoral care tracking, leadership pipeline, stewardship intelligence
- **Consultant-specific features**: Missed client engagement tracking, proposal generation, deliverable management, expertise inventory

### Pass 2 — What Pass 1 Had That Pass 2 Under-specified
- Detailed persona dispatch per module
- The Arena/simulation concept (stress testing as a distinct mode)
- Custom persona builder depth
- The Vault as a standalone knowledge management layer

### Synthesis Decisions
- Combined into **9 modules** (added Watchtower from Pass 2, kept all Pass 1 modules, merged overlapping concepts)
- Added **Input Layer** and **Output Layer** as cross-cutting systems (not modules, but infrastructure every module uses)
- Added **Proactive Intelligence Engine** as the Cortex evolution that powers push notifications across all modules
- Added domain-specific feature sets within relevant modules rather than creating separate ministry/consultant modules

---

## Architecture: How Modules Connect to Data

```
┌─────────────────────────────────────────────────────────┐
│                    INPUT LAYER                           │
│  Text Chat │ Voice │ Doc Upload │ Email Forward │ Quick  │
│            │ Input │ + Ingest   │ + Parse       │ Capture│
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│               9 MODULES (User-Facing)                    │
│                                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ War Room │ │ Command  │ │  Forge   │ │  Mirror  │   │
│  │(Decide)  │ │ Center   │ │(Plan)    │ │(Reflect) │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │  Vault   │ │  Arena   │ │  Pulse   │ │ Council  │   │
│  │(Know)    │ │(Test)    │ │(Execute) │ │(People)  │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│  ┌──────────┐                                           │
│  │Watchtower│                                           │
│  │(Monitor) │                                           │
│  └──────────┘                                           │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│           PROACTIVE INTELLIGENCE ENGINE                   │
│  Cortex Scheduler │ Pattern Detection │ Push Triggers    │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│              CORE DATA LAYER (OmniMind)                  │
│  Memory │ Retrieval │ Entities │ Validation │ Embeddings │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                   OUTPUT LAYER                            │
│  Briefs │ Exports │ Calendar Events │ Email Drafts │ PDF │
└─────────────────────────────────────────────────────────┘
```

---

## Cross-Cutting Systems

### Input Layer (Infrastructure)

These aren't a module — they're how data enters ALL modules.

#### IL-1: Quick Capture
- **Look:** Floating action button (bottom-right) present on every page. Tap → minimal modal with text field + voice button + file drop zone. No module selection required — system auto-routes.
- **Function:** User drops a thought, file, or voice note. System classifies it (decision, commitment, memory, idea, person reference) using a lightweight Haiku classifier. Routes to appropriate module for processing. If ambiguous, stores as raw memory with `WORKING` class for later triage.
- **Data:** Creates `MemoryEntry` with `sourceType: MANUAL`, `memoryClass: WORKING`. Haiku classification determines `domain` and `tags`. If entity references detected (person names, project names), creates `MemoryEntityLink` rows. If commitment language detected ("I need to", "I promised"), also creates draft `Commitment` with `status: OPEN`.
- **Prisma models touched:** `MemoryEntry`, `MemoryEntityLink`, `Commitment` (conditional)

#### IL-2: Voice Input
- **Look:** Microphone icon in Quick Capture modal + dedicated voice mode in War Room. Waveform visualization during recording. Real-time transcription preview.
- **Function:** Browser MediaRecorder API → send audio to Deepgram (already have `deepgramApiKey` on Team model) or Whisper API → transcription → same classification pipeline as text input. In War Room, voice becomes the session input instead of typing.
- **Data:** Transcription stored as `TranscriptEntry` if in-session, or as `MemoryEntry.content` if quick capture. Raw audio URL stored in `MemoryEntry.metadata.audioUrl` for playback.
- **Prisma models touched:** `TranscriptEntry` (in-session), `MemoryEntry` (quick capture)
- **New fields needed:** `MemoryEntry.metadata` already supports arbitrary JSON — store `{ audioUrl, transcriptionConfidence, duration }`

#### IL-3: Document Ingestion
- **Look:** Drop zone in Vault module + file attachment in any session. Supported: PDF, DOCX, XLSX, CSV, images (OCR), plain text. Progress bar showing extraction → analysis → memory creation pipeline.
- **Function:** Upload → extract text (pdf-parse, mammoth, xlsx) → chunk into semantic sections → generate embeddings → create memories. LLM pass (Haiku) extracts structured entities: people mentioned, decisions referenced, financial figures, dates, commitments. Links to relevant existing entities automatically.
- **Data:** Each document becomes multiple `MemoryEntry` rows (one per semantic chunk) with `sourceType: API_IMPORT`, linked via shared `sourceRef` (document ID). Extracted entities create/update `Person`, `Project`, `Goal` records. A parent `MemoryEntry` with `memoryClass: SEMANTIC` holds the document summary.
- **Prisma models touched:** `MemoryEntry` (multiple), `MemoryEntityLink`, `Person`, `Project`, `Goal`
- **New model needed:** `Document` — tracks uploaded files (filename, mimeType, size, status, extractedAt, chunkCount, userId)

#### IL-4: Email Forward
- **Look:** User gets a unique forwarding address (e.g., `josh-abc123@ingest.boardroom.ai`). Settings page shows the address with copy button. Forwarded emails appear in Vault with parsed metadata.
- **Function:** Inbound email webhook (SendGrid/Postmark) → parse sender, subject, body, attachments → classify content → create memories + entities. System recognizes email threads and maintains conversation context. Attachments go through Document Ingestion pipeline.
- **Data:** Each email becomes a `MemoryEntry` with `sourceType: API_IMPORT`, `domain` auto-classified, `metadata: { from, subject, date, threadId }`. Sender matched against `Person` records (create if new, with `role: "email_contact"`).
- **Prisma models touched:** `MemoryEntry`, `MemoryEntityLink`, `Person`
- **New model needed:** `IngestEndpoint` — per-user forwarding address config (address, userId, isActive, lastReceivedAt)

### Output Layer (Infrastructure)

#### OL-1: Brief Generator
- **Look:** "Generate Brief" button available on any entity view (Decision, Project, Goal, Person). Choose format: executive summary (1 para), full brief (1-2 pages), presentation-ready (bullet points). Preview in-app, download as PDF/DOCX/MD.
- **Function:** Aggregates all related memories, decisions, commitments, and context capsules for the entity. Sonnet generates a structured brief with sections based on entity type. For Decisions: context → options → analysis → recommendation → assumptions. For Projects: status → progress → risks → next steps → stakeholders.
- **Data:** Reads from `ContextCapsule` (if fresh), otherwise generates from raw entity data + `MemoryEntry` rows linked via `MemoryEntityLink`. Stores generated brief in new `GeneratedArtifact` model for caching/versioning.
- **New model needed:** `GeneratedArtifact` — (id, userId, entityType, entityId, artifactType, content, format, generatedAt, staleAfter)

#### OL-2: Calendar Integration
- **Look:** In Pulse and Command Center, events appear inline with commitments and deadlines. "Add to Calendar" button on any dated item. Meeting prep auto-surfaces 30min before calendar events.
- **Function:** OAuth flow (Google Calendar, already have `OAuthToken` model). Bi-directional sync: deadlines/review dates → calendar events, calendar events → context for meeting prep. Pre-meeting brief generated automatically using Council + Vault data about attendees.
- **Data:** Uses existing `OAuthToken` model. Decision `reviewAt` and Commitment `deadline` fields map to calendar events. Meeting attendees matched against `Person` records for relationship context.
- **Prisma models touched:** `OAuthToken`, `Decision` (reviewAt), `Commitment` (deadline), `Person`

#### OL-3: Export Hub
- **Look:** Global export menu (top-right dropdown). Export types: "My Decision Journal" (PDF), "Weekly Report" (DOCX), "Goal Progress" (XLSX), "Relationship Map" (SVG), "Full Memory Backup" (JSON). Scheduled exports (weekly email digest).
- **Function:** Pre-built templates for common exports. Custom export builder for power users. Markdown → PDF/DOCX conversion. Data visualization for graphs and maps. Scheduled via node-cron for recurring exports.
- **Data:** Reads across all models. Export configs stored in `UserProfile.dashboardLayout` (extend existing JSON field) or new `ExportConfig` model for scheduled exports.
- **New model needed:** `ExportConfig` — (id, userId, exportType, template, schedule, lastRunAt, recipients)

---

## Module 1: War Room (Decision Intelligence)

**Job-to-be-done:** Make better decisions faster, with receipts and accountability.

**Current state:** 7 personas analyze a prompt, CEO synthesizes. Basic streaming. Memory extraction post-session.

**Frontend location:** `DecisionSessionPage.tsx`, `DecisionLabPage.tsx`
**Backend location:** `agents/agent.ts`, `agents/orchestrator.ts`
**Data models:** `Session`, `AdvisorMessage`, `Decision`, `DecisionAssumption`, `MeetingOutput`

---

### Feature WR-1: Decision Tree Builder

**Look:** After personas analyze a decision, system generates an interactive tree visualization. Root node = the decision question. First-level branches = options identified. Each branch has child nodes for consequences (short-term, long-term), required actions, and risk factors. Nodes are color-coded: green (opportunity), red (risk), yellow (uncertainty), blue (action required). Click any node to see which persona generated it and read the full analysis. Drag to rearrange. Pinch to zoom.

**Function:**
1. After all 7 personas respond, a post-processing step (Sonnet) extracts structured decision data: options, consequences per option, dependencies, risks, and timeline estimates
2. Data normalized into a tree structure (JSON) with node types: `option`, `consequence`, `risk`, `action`, `dependency`
3. Frontend renders using D3.js force-directed tree or React Flow
4. User can: expand/collapse branches, add manual nodes, mark branches as "eliminated" or "chosen", annotate any node
5. Tree is versioned — each session interaction can update the tree, and user can see how their thinking evolved

**Data connections:**
- Tree structure stored in `Decision.options` (extend from `Json @default("[]")` to hold full tree): `{ nodes: [{ id, type, label, personaSource, parentId, metadata }], edges: [...] }`
- Each tree node can reference the `AdvisorMessage.id` that generated it (traceability)
- When user marks a branch as "chosen", updates `Decision.chosenPath` and `Decision.status → DECIDED`
- Node annotations create `MemoryEntry` rows with `memoryClass: DECISION`, linked via `MemoryEntityLink` to the `Decision`
- **No new models needed** — extends `Decision.options` JSON structure

**Micro-features:**
- **Probability overlay:** Assign rough probability percentages to consequence nodes. System warns when probabilities don't sum correctly or when you're weighting unlikely outcomes too heavily.
  - *Data:* Stored in tree node `metadata.probability` within `Decision.options` JSON
- **Time horizon toggle:** Switch the tree view between 30-day, 90-day, and 1-year consequence horizons. System re-queries personas for longer-term thinking.
  - *Data:* Each node has `metadata.timeHorizon` tag. Persona re-query creates new `AdvisorMessage` rows linked to same `Session`
- **"What if" branching:** Duplicate any subtree, modify an assumption, re-run personas on just that branch. Compare original vs. modified side-by-side.
  - *Data:* Creates a new `Decision` with `metadata.forkedFrom` pointing to original decision ID. Tree nodes carry version tags.

---

### Feature WR-2: Assumption Tracker (Active Monitoring)

**Look:** Right sidebar panel in any decision view showing a card stack of assumptions. Each card shows: assumption text, confidence level (colored badge: HIGH/MEDIUM/LOW/SPECULATIVE), review date, current status (ACTIVE/INVALIDATED/CONFIRMED), and linked decision. Top of sidebar: count badge showing "3 assumptions need review" in amber.

**Function:**
1. During persona analysis, Questionnaire and Critic personas explicitly extract assumptions (already partially built in extraction pipeline)
2. Each assumption logged to `DecisionAssumption` with confidence score and optional review date
3. Cortex scheduler checks assumptions on a weekly cadence: queries recent memories and session content for evidence that contradicts or confirms each active assumption
4. When contradiction detected: creates `ContradictionAlert` linking to the assumption, pushes notification to user
5. User can: confirm, invalidate, or defer each assumption. Invalidation triggers a prompt: "This assumption was critical to Decision X. Want to revisit?"

**Data connections:**
- **Primary model:** `DecisionAssumption` (already exists: text, confidence, reviewAt, status, decisionId)
- **Extend `DecisionAssumption`:** Add `invalidatedAt DateTime?`, `invalidatedReason String?`, `linkedMemoryIds String[]` (evidence that confirmed/invalidated)
- **Contradiction detection:** Creates `ContradictionAlert` with `entityA: { type: "assumption", id: assumptionId }`, `entityB: { type: "memory", id: memoryId }`
- **Review scheduling:** `OutcomeReviewNudge` with `nudgeType: "assumption_review"`, `decisionId` pointing to parent decision

**Micro-features:**
- **Assumption inheritance:** When a new decision depends on an old decision's assumption, system detects the dependency and links them. If the upstream assumption is invalidated, all downstream decisions get flagged.
  - *Data:* `DecisionAssumption` gets `inheritedFromId String?` pointing to parent assumption. Cascade alerts via `ContradictionAlert`
- **Confidence decay:** Assumptions auto-decrease in confidence over time if no confirming evidence appears. Weekly Cortex job adjusts `confidence` field based on time elapsed and evidence count.
  - *Data:* `DecisionAssumption.confidence` updated by cortex-scheduler cron job. Decay formula stored in `UserProfile.cognitivePatterns` JSON

---

### Feature WR-3: Outcome Tracking & Decision Journal

**Look:** Two views:
1. **Timeline view:** Vertical timeline (left rail) showing all decisions chronologically. Each node shows: title, date, status badge (OPEN/DECIDED/REVIEWED), outcome rating (1-5 stars if reviewed). Click to expand inline details.
2. **Journal view:** Rich-text formatted decision journal. Each entry: the original question, what the personas said (collapsed), what you decided, why, what actually happened (filled in at review time), and the lessons learned.

**Function:**
1. When a decision has `reviewAt` set, `OutcomeReviewNudge` fires at that date
2. User records: actual outcome (free text), outcome rating (1-5), whether each assumption held, and key learnings
3. System compares predicted outcomes (from persona analysis) to actual outcomes
4. Over time, builds a **Persona Accuracy Profile**: which persona was most helpful for which types of decisions. Stored per-user.
5. Decision journal is auto-generated from structured data but user can edit the narrative

**Data connections:**
- **Primary:** `Decision` — uses `outcome`, `outcomeRating`, `reviewAt`, `status` (→ REVIEWED)
- **Nudges:** `OutcomeReviewNudge` — `nudgeType: "outcome_review"`, `scheduledFor` = `Decision.reviewAt`, status transitions: pending → sent → completed
- **Persona accuracy:** New field in `UserProfile.cognitivePatterns` JSON: `{ personaAccuracy: { optimist: { correct: 12, total: 20, domains: { pricing: 0.8, hiring: 0.4 } }, ... } }`
- **Journal entries:** `MeetingOutput` already stores `decisions`, `advisorInsights`. Extend with `outcome` and `learnings` fields, or use `MemoryEntry` with `memoryClass: DECISION` for the narrative
- **Timeline query:** `Decision WHERE userId = X AND deletedAt IS NULL ORDER BY createdAt DESC` with pagination. Filter by `status`, `domain` (via linked Project domain), date range

**Micro-features:**
- **"I went with B" quick-log:** One-click button on any open decision to log the choice without a full session. Updates `Decision.chosenPath` and `status → DECIDED`. Optionally add a one-line rationale.
  - *Data:* PATCH to `Decision` — sets `chosenPath`, `rationale`, `status`
- **Prediction scoring:** Before a decision, user rates their confidence (1-10). After review, system calculates calibration score: were you overconfident, underconfident, or well-calibrated?
  - *Data:* `Decision.metadata` JSON gets `{ predictionConfidence: 8, actualOutcome: 6, calibrationDelta: +2 }`. Aggregate stored in `UserProfile.cognitivePatterns.calibrationHistory`
- **Decision replay:** "Show me every decision about pricing in the last 6 months." Filtered timeline with full context.
  - *Data:* Query: `Decision WHERE userId AND domain IN [...] AND createdAt > 6mo AND deletedAt IS NULL`. Domain derived from linked `Project.domain` via `DecisionProjectLink`

---

### Feature WR-4: Stakeholder Simulation

**Look:** In decision session, a "Simulate Reaction" button. Opens a panel where user selects a person from their People Directory (or types a new name). System generates a simulated response from that person's perspective, displayed in a chat bubble styled differently (portrait silhouette + person's name). Multiple stakeholders can be simulated sequentially.

**Function:**
1. Pull `Person` record + all linked `MemoryEntry` rows about this person (via `MemoryEntityLink`)
2. Build a dynamic system prompt: "You are simulating [Person Name]. Based on what is known about them: [aggregated memories about their values, communication style, priorities, past reactions]. Respond to this decision/proposal as they would."
3. Sonnet generates the simulated response
4. Response stored as `AdvisorMessage` with `personaId: "stakeholder-sim"`, `personaName: [Person Name]`
5. User can flag simulated responses as "accurate" or "way off" — feedback trains future simulations

**Data connections:**
- **Person data:** `Person` record + `MemoryEntry` rows linked via `MemoryEntityLink WHERE entityType = 'person' AND entityId = [personId]`
- **Simulation output:** `AdvisorMessage` with custom `personaId` format: `stakeholder-sim-{personId}`
- **Accuracy feedback:** `AdvisorMessage.rating` field (already exists) — user rates the simulation
- **Over time:** Feedback stored in `Person.metadata` (extend model) or `MemoryEntry` tagged with `stakeholder-simulation-feedback`
- **New persona prompt needed:** `docs/prompts/stakeholder-simulator.system.md`

**Micro-features:**
- **"How would [famous founder] approach this?"** Built-in templates for well-known strategic frameworks: Bezos (regret minimization), Musk (first principles), Buffett (circle of competence), etc. Not claiming to simulate the actual person — using their published framework.
  - *Data:* Static persona prompts in `docs/prompts/frameworks/`. No new models needed.
- **Multi-stakeholder panel:** Simulate 3-5 stakeholders simultaneously, see all reactions side by side, identify where they'd align vs. conflict.
  - *Data:* Multiple `AdvisorMessage` rows with different `personaId` values in same `Session`

---

### Feature WR-5: Modes (Enhanced)

**Current state:** `decide`, `stress-test`, `plan`, `brainstorm` — route to different persona subsets.

**Enhancements:**

- **Convince Me mode:** User picks a side. System argues the strongest case for the opposite. Uses Critic + Alternate + Questionnaire with an adversarial system prompt overlay. Goal: find the strongest steel-man argument against the user's preferred option.
  - *Data:* New mode in dispatch: `convince-me`. Session `metadata: { userPosition: "Option A", mode: "convince-me" }`. Uses existing persona system with modified prompt preamble.

- **Pre-Mortem mode:** "It's 6 months from now and this decision failed. Why?" System generates failure scenarios ranked by likelihood. Each failure mode gets: cause, early warning signs, and preventive actions.
  - *Data:* Session mode `pre-mortem`. Output stored in `MeetingOutput.risks` (already exists) + new `MeetingOutput.failureModes` (extend JSON).

- **Speed Round mode:** For low-stakes decisions. Only 2 personas (CEO + most relevant specialist). Max 500 tokens each. Result in <30 seconds. For the "should I reply to this email?" level decisions.
  - *Data:* Same models, smaller context window. `Session.metadata.mode = "speed-round"`.

- **Reversibility Check:** Before full analysis, system quickly classifies the decision: one-way door (irreversible) vs. two-way door (reversible). Two-way doors get lighter analysis with a nudge to "just try it." One-way doors get full treatment.
  - *Data:* `Decision.metadata.reversibility = "one-way" | "two-way"`. Classification by Haiku before persona dispatch.

---

## Module 2: Command Center (Strategic Dashboard)

**Job-to-be-done:** See the full picture of your business and life at a glance. Know what matters today.

**Current state:** `DashboardPage.tsx` exists but is basic. `cortex.store.ts` has some Cortex data.

**Frontend location:** `DashboardPage.tsx` (major rebuild)
**Data models:** Reads from ALL models — this is the aggregation layer

---

### Feature CC-1: Active Decisions Board

**Look:** Kanban-style board with columns: OPEN → DECIDED → UNDER REVIEW → CLOSED. Cards show decision title, age (days since created), urgency badge (calculated from `reviewAt` proximity and assumption count), and linked project name. Cards are draggable between columns. Filter bar: by domain, by project, by date range. Card click → slides open a detail panel (not full page nav).

**Function:**
1. Query all `Decision WHERE userId AND deletedAt IS NULL` grouped by `status`
2. Urgency score calculated client-side: `urgency = (daysOpen / 14) * 0.3 + (assumptionCount / 5) * 0.3 + (reviewDateProximity) * 0.4`
3. Drag to "DECIDED" column triggers inline `chosenPath` input
4. Weekly Cortex job flags decisions that have been OPEN > 14 days without activity

**Data connections:**
- **Read:** `Decision` (all fields), `DecisionAssumption` (count per decision), `DecisionProjectLink` → `Project` (for domain/title)
- **Write:** `Decision.status` on drag, `Decision.chosenPath` on decide
- **Urgency calculation:** Client-side from `Decision.createdAt`, `Decision.reviewAt`, count of `DecisionAssumption WHERE decisionId`
- **Staleness alert:** Cortex scheduler creates `OutcomeReviewNudge` with `nudgeType: "stale_decision"` for decisions OPEN > 14 days

**Micro-features:**
- **Decision age heatmap:** Cards gradually shift from cool blue (new) to warm red (stale) based on days open. Visual urgency without reading numbers.
  - *Data:* Pure frontend calculation from `Decision.createdAt`
- **"Decide by" countdown:** If `reviewAt` is set, shows a countdown timer on the card. Pulsing animation when < 48 hours.
  - *Data:* `Decision.reviewAt` — frontend countdown

---

### Feature CC-2: Commitment Radar

**Look:** Circular radar visualization (think: a sonar display). Rings represent time horizons: inner ring = due this week, middle = this month, outer = this quarter. Dots represent commitments — positioned by due date (ring) and domain (angle). Dot size = importance. Dot color: green (on track), yellow (at risk — approaching deadline with no progress), red (overdue). Hovering a dot shows commitment details + linked stakeholder. Center shows total count and "commitment load" score.

**Function:**
1. Query all `Commitment WHERE userId AND status = OPEN AND deletedAt IS NULL`
2. Position on radar: deadline determines ring, `Project.domain` (via `linkedProjectId`) determines angular sector
3. Risk assessment: commitment with deadline < 3 days and no linked completed tasks = yellow. Past deadline = red.
4. "Commitment load" score: weighted sum of open commitments factoring deadline proximity and stakeholder importance
5. Click any dot → detail panel with: full commitment text, stakeholder info, linked project, related decisions, and "Complete / Defer / Drop" actions

**Data connections:**
- **Read:** `Commitment` (all open), `Person` (via `stakeholderId`), `Project` (via `linkedProjectId`), `Task` (via `ProjectTaskLink` to see if related tasks are progressing)
- **Write:** `Commitment.status` on complete/defer/drop, `Commitment.completedAt` on complete
- **Risk calculation:** Compare `Commitment.deadline` to current date. Check `Task WHERE projectId = commitment.linkedProjectId AND status != 'completed'` for progress signal
- **Load score:** `SUM(1/daysUntilDeadline * stakeholder.importance)` across open commitments. Stored transiently (not persisted — recalculated on dashboard load)

**Micro-features:**
- **"What am I forgetting?" button:** System scans all commitments, open decisions, recent session outputs, and entity `updatedAt` timestamps. Surfaces items that haven't been touched in > 2 weeks but aren't marked complete.
  - *Data:* Cross-query: `Commitment WHERE status = OPEN AND updatedAt < 14d` UNION `Decision WHERE status = OPEN AND updatedAt < 14d` UNION `Task WHERE status = pending AND updatedAt < 14d`
- **Overcommitment warning:** When total open commitments exceed a user-configured threshold (default: 15), or when > 5 commitments have deadlines in the same week, system surfaces a warning: "You have 7 commitments due next week. Consider renegotiating or delegating."
  - *Data:* Count query on `Commitment WHERE deadline BETWEEN [weekStart, weekEnd] AND status = OPEN`. Threshold stored in `UserProfile.metadata` JSON

---

### Feature CC-3: Momentum Score

**Look:** Large circular gauge (0-100) front and center on dashboard. Needle position + numeric score. Below the gauge: 3 contributing factors shown as horizontal bars: "Decision Velocity" (decisions made vs. deferred), "Commitment Integrity" (kept vs. broken), "Goal Progress" (advancing vs. stalled). Trend arrow showing week-over-week change. Click gauge → full breakdown page.

**Function:**
1. **Decision Velocity** (0-100): `(decisions moved to DECIDED in last 14 days) / (total decisions opened in last 14 days) * 100`. Penalized for decisions OPEN > 14 days.
2. **Commitment Integrity** (0-100): `(commitments COMPLETED on time in last 30 days) / (total commitments due in last 30 days) * 100`. MISSED and DEFERRED reduce score.
3. **Goal Progress** (0-100): For each active `Goal`, check linked `Project` and `Task` completion rates. Average across goals.
4. **Momentum Score** = weighted average: Decision Velocity (30%) + Commitment Integrity (40%) + Goal Progress (30%)
5. Calculated by Cortex scheduler weekly, stored for trend analysis

**Data connections:**
- **Decision Velocity:** `Decision WHERE userId AND createdAt > 14d` — count by status
- **Commitment Integrity:** `Commitment WHERE userId AND deadline BETWEEN [30d ago, now]` — ratio of COMPLETED to total
- **Goal Progress:** `Goal WHERE userId AND status = active` → `GoalProjectLink` → `Project` → `ProjectTaskLink` → `Task` — completion percentage
- **Storage:** `WeeklyMemo` model — extend `thinkingQualityScore` to also store momentum breakdown: `{ momentumScore, decisionVelocity, commitmentIntegrity, goalProgress }`
- **Trend:** Compare current `WeeklyMemo.thinkingQualityScore` to previous week's. `WeeklyMemo.scoreChange` already exists for this.

---

### Feature CC-4: Weekly Intelligence Briefing

**Look:** Full-width card at top of dashboard on Mondays (or user-configured day). Sections:
1. **This Week's Priority Stack** — top 3 things that matter most, with reasoning
2. **What Changed** — decisions made, commitments completed/missed, new information that shifted context
3. **Pressure Points** — upcoming deadlines, unresolved contradictions, stale assumptions
4. **Pattern Alert** — any new thinking pattern detected (from Mirror/Cortex)
5. **Recommended Focus** — what the CEO persona would advise you to focus on

Collapsible sections. "Read aloud" button (TTS). Export as PDF/email.

**Function:**
1. Cortex scheduler runs on configured day (default: Monday 6am user's timezone)
2. `cortex-memo.system.md` persona generates the briefing from aggregated data:
   - All decisions/commitments/tasks with activity in last 7 days
   - Any new `ThinkingPattern` or `ContradictionAlert` from last 7 days
   - Upcoming deadlines in next 7 days
   - Goal progress changes
3. Sonnet generates narrative briefing text
4. Stored as `WeeklyMemo` record
5. Pushed to user via email (if configured) and displayed on dashboard

**Data connections:**
- **Generation reads:** `Decision` (last 7d activity), `Commitment` (last 7d + next 7d deadlines), `ThinkingPattern` (last 7d), `ContradictionAlert` (active), `Goal`/`Project`/`Task` (status changes), `MemoryEntry` (last 7d, high importance)
- **Storage:** `WeeklyMemo` — all fields used: `weekStart`, `weekEnd`, `decisionsMade`, `decisionsByCategory`, `patternsNoticed`, `activeContradictions`, `upcomingPressurePoints`, `thinkingQualityScore`, `recommendedFocus`, `fullMemoText`
- **Delivery:** Email via OL-2 integration. Dashboard display reads latest `WeeklyMemo WHERE userId ORDER BY generatedAt DESC LIMIT 1`

**Micro-features:**
- **Contradiction Dashboard (inline):** Shows active `ContradictionAlert` rows with severity badges. User can: resolve (with explanation), accept tension (acknowledge the contradiction as intentional), or dismiss.
  - *Data:* `ContradictionAlert` — read all `WHERE userId AND status = ACTIVE`. Write: `status`, `resolvedAt`, `resolution`
- **90-day decision domain heatmap:** Grid showing domains on Y-axis, weeks on X-axis, cell color = number of decisions. Reveals where you're spending cognitive energy.
  - *Data:* `Decision WHERE createdAt > 90d GROUP BY domain, WEEK(createdAt)`. Domain from `DecisionProjectLink` → `Project.domain`

---

## Module 3: Forge (Strategy & Planning Workshop)

**Job-to-be-done:** Go from vague ambition to executable plan with accountability.

**Frontend location:** New page: `ForgePage.tsx`
**Data models:** `Goal`, `Project`, `Task`, `GoalProjectLink`, `ProjectTaskLink`, `TaskDependency`

---

### Feature FG-1: Goal Decomposition Engine

**Look:** Starts with a single text input: "What do you want to achieve?" After input, system generates a hierarchical view:
- **Level 0:** The stated goal (large card at top)
- **Level 1:** Sub-goals (3-5 cards below, connected by lines)
- **Level 2:** Projects per sub-goal (smaller cards)
- **Level 3:** Tasks per project (checklist items)

Each card shows: title, success metric, deadline (if set), status badge, owner. Interactive — drag to rearrange, click to edit, collapse/expand levels. Progress bar on each card showing completion percentage of children.

**Function:**
1. User states a goal in natural language
2. Sonnet (using Doer + Technician persona perspectives) decomposes:
   - Identifies 3-5 sub-goals (milestones)
   - For each sub-goal, identifies 2-4 projects (workstreams)
   - For each project, identifies 3-7 tasks with dependencies
   - Estimates effort and suggests deadlines
3. User reviews and edits the decomposition before confirming
4. On confirm: batch-creates all entities and link records
5. System checks decomposition against existing goals/projects for overlap and suggests merges

**Data connections:**
- **Create:** Multiple `Goal` records (parent-child via `parentGoalId`), `Project` records, `Task` records
- **Link:** `GoalProjectLink` (goal → project), `ProjectTaskLink` (project → task), `TaskDependency` (task → task)
- **Success metrics:** `Goal.successMetrics` array and `Project.successMetrics` array
- **Deadlines cascade:** If top goal has deadline, system distributes sub-deadlines proportionally to `Goal.deadline`, `Project.deadline`, `Task.deadline`
- **Overlap detection:** Query existing `Goal WHERE userId AND status = active`, compare titles/metrics via embedding similarity. If cosine similarity > 0.85, suggest merge.

**Micro-features:**
- **Constraint identifier:** System checks your goal decomposition against your known resources (from UserProfile + open commitments). "You've planned 40 hours/week of work but you have 25 hours of existing commitments. Here's the realistic version."
  - *Data:* Sum `Task.estimatedEffort` across all active tasks. Compare to user's stated capacity (stored in `UserProfile.metadata.weeklyCapacityHours`)
- **Anti-goal setting:** "What should I explicitly NOT pursue this quarter?" Creates `Goal` with `status: "anti-goal"`. System flags any new decision or project that drifts toward an anti-goal.
  - *Data:* `Goal.status = "anti-goal"`. Cortex scheduler checks new `Decision` and `Project` records against anti-goal embeddings via semantic similarity.

---

### Feature FG-2: Strategy Canvas

**Look:** Full-screen interactive canvas (React Flow or custom SVG). Pre-built sections arranged spatially:
- **Center:** Value Proposition (what you offer)
- **Left:** Customer Segments (who you serve)
- **Right:** Revenue Model (how you make money)
- **Top:** Channels (how you reach customers)
- **Bottom:** Competitive Position (how you're different)

Each section is a card group — click to expand, edit inline, add sub-cards. Personas appear as floating comment bubbles attached to sections they've analyzed. Canvas is versioned — scrub a timeline slider to see how your strategy evolved.

**Function:**
1. Initial canvas populated from onboarding data + existing memories about the user's business
2. User edits any section → triggers targeted persona analysis (Technician for feasibility, Critic for risks, Optimist for opportunities)
3. Canvas auto-saves on every edit
4. Version history: each save creates a snapshot (JSON diff, not full copy)
5. "Run Full Strategy Review" button dispatches all 7 personas against the complete canvas

**Data connections:**
- **Storage:** New model `StrategyCanvas` — (id, userId, canvasType, content JSON, version, parentVersionId, createdAt, updatedAt)
- **Content JSON structure:** `{ sections: [{ id, type, title, items: [{ id, text, personaComments: [] }] }] }`
- **Persona comments:** Stored inline in canvas JSON AND as `AdvisorMessage` rows (for searchability/retrieval)
- **Version history:** Each save creates new `StrategyCanvas` row with `parentVersionId` pointing to previous version. `content` stores only the diff (JSON Patch format) after first full version.
- **Memory integration:** Canvas sections auto-generate `MemoryEntry` rows tagged with `domain: "strategy"` so other modules can reference strategic context

**New model needed:** `StrategyCanvas`

---

### Feature FG-3: Scenario Planner

**Look:** Split-screen interface. Left side: scenario description ("What if my biggest client churns?"). Right side: cascading impact analysis organized by domain — Financial, Operational, Strategic, People, Timeline. Each domain shows: immediate impact, 30-day impact, 90-day impact. Below the impact analysis: a recommended response plan (auto-generated by Doer persona). Color severity coding throughout.

**Function:**
1. User describes a scenario in natural language
2. System pulls all relevant context: the mentioned client's `Person` record, related `Project` records, `Commitment` records, financial memories
3. All 7 personas analyze the scenario with full context
4. Post-processing (Sonnet) structures the output into the domain×timeline matrix
5. Doer generates a response plan with prioritized actions
6. User can save scenario + response plan for future reference

**Data connections:**
- **Context retrieval:** Hybrid search (semantic + structured) on `MemoryEntry` with the scenario text as query. Entity extraction from scenario text → `Person`, `Project`, `Goal` lookups via `MemoryEntityLink`
- **Storage:** New model `Scenario` — (id, userId, description, impactAnalysis JSON, responsePlan JSON, status, createdAt)
- **Impact JSON:** `{ financial: { immediate, thirty_day, ninety_day }, operational: {...}, strategic: {...}, people: {...}, timeline: {...} }`
- **Related entities:** `ScenarioEntityLink` join table — links scenario to affected `Person`, `Project`, `Goal`, `Decision` records
- **Triggering real planning:** "Activate this response plan" converts response plan items into `Task` records linked to relevant `Project`

**New models needed:** `Scenario`, `ScenarioEntityLink`

---

### Feature FG-4: OKR/North Star Builder

**Look:** Guided wizard flow (3 steps):
1. **Set North Star** — single input: "What's the one metric that matters most this quarter?" System suggests options based on your stated goals.
2. **Define Objectives** — 3-5 objectives. For each, system pre-fills suggestions from your Goal hierarchy. User edits/confirms.
3. **Set Key Results** — For each objective, 2-4 measurable key results. System enforces: must be measurable, must have a number, must have a deadline.

After setup: OKR dashboard view showing objective cards with key result progress bars. Weekly check-in prompt to update key result progress.

**Function:**
1. Wizard pulls existing `Goal` records and `Project.successMetrics` to suggest objectives
2. Validation: rejects vague key results ("improve customer satisfaction" → "increase NPS from 40 to 55 by Q3")
3. On confirm: creates `Goal` (objective level) + child `Goal` records (key result level) with `successMetrics` populated
4. Weekly check-in (Cortex scheduler) prompts user to update progress on each key result
5. Quarterly review: auto-generates a retrospective comparing planned vs. actual, feeds into Mirror module

**Data connections:**
- **Storage:** Uses existing `Goal` model hierarchy. North Star = top-level `Goal` with `level: 0` and `metadata.type = "north-star"`. Objectives = `Goal` with `level: 1`, `parentGoalId` → North Star. Key Results = `Goal` with `level: 2`, `parentGoalId` → Objective.
- **Progress tracking:** `Goal.successMetrics` stores the target. Progress updates stored as `MemoryEntry` with `memoryClass: SEMANTIC`, `domain: "okr-progress"`, linked via `MemoryEntityLink` to the Goal
- **Check-in prompts:** `OutcomeReviewNudge` with `nudgeType: "okr_checkin"`, weekly schedule

---

## Module 4: Mirror (Personal Intelligence & Growth)

**Job-to-be-done:** See yourself clearly. Know your patterns. Grow deliberately.

**Frontend location:** New page: `MirrorPage.tsx`
**Backend:** Cortex scheduler + pattern detection personas
**Data models:** `ThinkingPattern`, `UserProfile.cognitivePatterns`, `ContradictionAlert`

---

### Feature MR-1: Thinking Pattern Dashboard

**Look:** Three-column layout:
1. **Strengths** (green) — patterns that serve you well: "Strong first-principles reasoning on product decisions," "Consistently considers stakeholder impact"
2. **Biases** (amber) — cognitive biases detected: "Sunk cost tendency in project continuation decisions," "Optimism bias on timeline estimates (average 40% underestimate)"
3. **Cycles** (blue) — recurring behavioral patterns: "Decision fatigue spikes on Thursdays," "Motivation dip in week 3 of any project"

Each pattern card shows: description, evidence count, confidence score, first/last detected dates, trend indicator (↑ getting stronger, ↓ fading, → stable). Click to see the specific decisions/sessions that evidenced this pattern.

**Function:**
1. Cortex scheduler runs `cortex-patterns.system.md` persona weekly
2. Scans last 30 days of: `Decision` records (choices made, time-to-decide, outcome ratings), `AdvisorMessage` history (which persona advice was followed/ignored), `Commitment` records (kept/missed patterns), session transcripts
3. Pattern detection via Sonnet: identifies cognitive biases, strengths, and behavioral cycles
4. New patterns → create `ThinkingPattern` record. Existing patterns → increment `evidenceCount`, update `lastDetected`, adjust `confidence`
5. Patterns below confidence threshold (< 0.3) after 90 days without new evidence → archived

**Data connections:**
- **Primary model:** `ThinkingPattern` — `pattern`, `patternType` (BIAS/STRENGTH/BEHAVIORAL_CYCLE/DECISION_STYLE), `evidenceCount`, `confidence`, `firstDetected`, `lastDetected`, `trend`
- **Evidence links:** `ThinkingPattern` needs new field: `evidenceIds String[]` — array of `Decision.id` and `Session.id` values that evidenced this pattern
- **Detection input:** Reads `Decision` (last 30d), `AdvisorMessage` (last 30d), `Commitment` (last 30d), `Session` (last 30d)
- **Trend calculation:** Compare current `confidence` and `evidenceCount` to values from 30 days ago (stored in `ThinkingPattern.metadata` JSON as `{ history: [{ date, confidence, evidenceCount }] }`)

**Micro-features:**
- **Decision fatigue detector:** Tracks time of day and day of week for each decision. Identifies low-quality decision periods (decisions made during these times have lower outcome ratings).
  - *Data:* `Decision.createdAt` hour + day of week, correlated with `Decision.outcomeRating`. Pattern stored as `ThinkingPattern` with `patternType: BEHAVIORAL_CYCLE`
- **"Tell me something I don't want to hear" button:** System surfaces the highest-confidence, most uncomfortable pattern. Prioritizes patterns the user hasn't acknowledged.
  - *Data:* `ThinkingPattern WHERE userId AND confidence > 0.7 AND patternType = BIAS ORDER BY confidence DESC LIMIT 1`, filtered for patterns not yet marked as "acknowledged" in metadata

---

### Feature MR-2: Values Alignment Monitor

**Look:** Horizontal bar chart showing user's stated values (from onboarding/profile) on the Y-axis. Bar length = percentage of recent decisions aligned with that value. Color gradient: green (> 70% aligned) → yellow (40-70%) → red (< 40%). Below the chart: a narrative summary: "Your top stated value is 'Family' but only 2 of your last 15 decisions protected family time. Meanwhile, 'Revenue Growth' — your #4 value — drove 11 of 15 decisions."

**Function:**
1. User sets `valueHierarchy` during onboarding (stored in `UserProfile.valueHierarchy`)
2. For each decision (last 90 days), system classifies which values it served (via `Decision.metadata.valuesServed` — populated by CEO persona during synthesis)
3. Calculates alignment score per value: `(decisions serving value / total decisions) * 100`
4. Compares rank order of values-by-action to stated hierarchy
5. Generates narrative highlighting gaps between stated and revealed preferences

**Data connections:**
- **Values source:** `UserProfile.valueHierarchy` (String array, ordered by priority)
- **Decision classification:** `Decision.metadata` JSON — extend to include `{ valuesServed: ["family", "growth", "faith"] }`. Populated by CEO persona post-synthesis.
- **Alignment calculation:** Query `Decision WHERE userId AND createdAt > 90d`, aggregate `valuesServed` counts, compare to `valueHierarchy` ordering
- **Display:** Pure frontend calculation, no new models needed

---

### Feature MR-3: Confidence Calibration Tracker

**Look:** Scatter plot where X-axis = "How confident you were" (1-10) and Y-axis = "How it actually turned out" (1-10 outcome rating). Perfect calibration = dots along the diagonal. Overconfidence = dots in lower-right quadrant. Underconfidence = upper-left. Running calibration score shown as a percentage. Historical trend line.

**Function:**
1. For each `Decision` that has both `metadata.predictionConfidence` and `outcomeRating`, plot a point
2. Calculate calibration metrics: Brier score, average overconfidence delta, domain-specific calibration
3. Detect if calibration varies by domain (e.g., well-calibrated on product decisions, overconfident on hiring)
4. Surface as `ThinkingPattern` when a clear calibration bias is detected

**Data connections:**
- **Read:** `Decision WHERE outcomeRating IS NOT NULL AND metadata->predictionConfidence IS NOT NULL`
- **Calibration storage:** `UserProfile.cognitivePatterns` JSON — add `{ calibration: { overall: 0.72, byDomain: { product: 0.85, hiring: 0.45 }, history: [...] } }`
- **Pattern creation:** When domain-specific miscalibration detected (> 0.3 delta), create `ThinkingPattern` with `patternType: BIAS`

---

### Feature MR-4: Growth Journal

**Look:** Vertical timeline with weekly entries. Each entry auto-populated with:
- Key decisions made that week
- Commitments kept/missed
- New patterns detected
- A reflection prompt (system-generated, personalized based on patterns)

User adds their own reflection below each auto-generated section. Reflections are private — never used as persona context unless user explicitly shares.

**Function:**
1. Weekly auto-generation (Cortex scheduler, same cadence as Weekly Memo)
2. Pulls `WeeklyMemo` data + prompts user with a personalized reflection question
3. Reflection questions generated by Sonnet based on recent patterns: "You deferred 3 decisions about team structure this week. What's making that domain hard for you right now?"
4. User's reflection text stored as `MemoryEntry` with `memoryClass: EPISODIC`, `domain: "reflection"`
5. Monthly synthesis: Cortex generates a "Month in Review" that identifies growth trends across weekly reflections

**Data connections:**
- **Auto-content:** `WeeklyMemo` (latest), `Decision` (last 7d), `Commitment` (last 7d), `ThinkingPattern` (last 7d changes)
- **Reflection storage:** `MemoryEntry` with `memoryClass: EPISODIC`, `sourceType: MANUAL`, `domain: "reflection"`, `metadata: { weekOf: "2026-04-14", promptUsed: "..." }`
- **Monthly synthesis:** `MemoryEntry WHERE domain = "reflection" AND createdAt > 30d` → Sonnet generates synthesis → stored as `MemoryEntry` with `domain: "reflection-synthesis"`

---

## Module 5: Vault (Knowledge & Context Management)

**Job-to-be-done:** Never lose context. Never re-explain yourself. Build institutional knowledge about yourself and your ventures.

**Frontend location:** `MemoryExplorerPage.tsx` (major rebuild)
**Data models:** `MemoryEntry`, `ContextCapsule`, `MemoryEntityLink`

---

### Feature VT-1: Context Capsules (Smart Bundles)

**Look:** Card grid showing context bundles. Each card: title ("My SaaS Business," "Church Plant," "Investment Portfolio"), icon, last updated date, memory count, and "Load" button. Creating a capsule: wizard that asks "What is this about?" → system pulls related memories → user reviews/edits → saves bundle. In any session, a "Load Context" dropdown lets you inject one or more capsules into the conversation.

**Function:**
1. User creates a capsule by naming it and describing the domain
2. System queries `MemoryEntry` by domain/tags/semantic similarity, proposes a bundle of 20-50 relevant memories
3. User curates: add/remove specific memories
4. `ContextCapsule` stores a summary + references to key entities
5. When loaded into a session, capsule summary + top memories are injected into persona system prompts as context
6. Auto-refresh: Cortex scheduler regenerates capsule summary when underlying memories change significantly

**Data connections:**
- **Primary model:** `ContextCapsule` — uses all fields: `entityType` = "capsule", `entityId` = capsule-specific ID, `summary`, `openRisks`, `unresolvedQuestions`, `activeStakeholders`, `recentChanges`, `staleAfter`
- **Memory association:** New join table `CapsuleMemoryLink` — (id, capsuleId, memoryId) to track which memories belong to each capsule
- **Loading into session:** Capsule summary text prepended to persona system prompts. Key memories added to context-packager retrieval results (up to 7-10 item limit)
- **Staleness:** `staleAfter` compared to latest `MemoryEntry.updatedAt` for linked memories. If any linked memory updated after `staleAfter`, capsule marked for regeneration

**New model needed:** `CapsuleMemoryLink`

---

### Feature VT-2: Document Library

**Look:** File manager-style interface. Columns: document title, type (PDF/DOCX/etc), upload date, extracted memory count, status (processing/ready/failed). Click document → detail view showing: original document preview (embedded PDF viewer or text extract), extracted memories in a sidebar, linked entities. Drag-and-drop upload. Bulk upload support.

**Function:** (Uses IL-3 Document Ingestion pipeline)
1. Upload → file stored in object storage (S3/R2) → background processing
2. Text extraction → semantic chunking → embedding generation → memory creation
3. Entity extraction (people, projects, dates, financial figures) → entity linking
4. Document-level summary generated (Haiku) → stored as parent memory
5. User can: re-process (if extraction was poor), delete document + all derived memories, manually link memories to entities

**Data connections:**
- **New model:** `Document` — (id, userId, filename, mimeType, fileSize, storageUrl, status: PROCESSING|READY|FAILED, extractedAt, chunkCount, summaryMemoryId, metadata JSON, createdAt, deletedAt)
- **Derived memories:** `MemoryEntry` rows with `sourceType: API_IMPORT`, `sourceRef: document.id`
- **Entity links:** `MemoryEntityLink` connecting document-derived memories to `Person`, `Project`, `Goal`
- **Summary link:** `Document.summaryMemoryId` → `MemoryEntry.id` (the document-level summary)

---

### Feature VT-3: Relationship Graph (Visual)

**Look:** Force-directed graph visualization (D3.js). Nodes = entities (Person: circle, Project: square, Goal: diamond, Decision: hexagon). Edges = relationships (commitment, collaboration, decision-link, memory-link). Node size = importance/activity. Edge thickness = strength of relationship (number of shared memories/links). Color coding by domain. Click any node → detail sidebar. Zoom, pan, filter controls.

**Function:**
1. Build graph from all entity relationships:
   - `Person` ↔ `Project` via `ProjectPersonLink`
   - `Project` ↔ `Goal` via `GoalProjectLink`
   - `Decision` ↔ `Project` via `DecisionProjectLink`
   - `Person` ↔ `Commitment` via `Commitment.stakeholderId`
   - `MemoryEntry` ↔ any entity via `MemoryEntityLink`
2. Edge weight = count of links between two entities
3. Layout algorithm clusters related entities
4. Time slider: filter to only show entities/relationships active within a date range
5. "Path finder": select two entities, system highlights the connection path between them

**Data connections:**
- **Read (all join tables):** `ProjectPersonLink`, `GoalProjectLink`, `DecisionProjectLink`, `ProjectTaskLink`, `MemoryEntityLink`, `Commitment` (stakeholder/project links)
- **Node data:** `Person`, `Project`, `Goal`, `Decision`, `Task` — all with `deletedAt IS NULL`
- **Graph rendered client-side** — API returns nodes + edges as JSON. No new models needed.
- **Edge calculation:** Count of `MemoryEntityLink` rows connecting two entities (via shared memories). E.g., Person A and Project B are strongly connected if many memories reference both.

**Micro-features:**
- **"Who should I talk to about X?"** — User types a question, system finds the `Person` with most memory connections to that topic via semantic search on `MemoryEntry` linked to `Person` entities.
  - *Data:* Semantic search on `MemoryEntry`, filter results by those linked to `Person` via `MemoryEntityLink WHERE entityType = 'person'`
- **Relationship decay alerts:** When `Person.lastContactAt` is > 30 days old and they have active `Commitment` or `ProjectPersonLink` records, surface a "reconnect" nudge.
  - *Data:* Cortex scheduler queries `Person WHERE lastContactAt < 30d ago AND (has active commitments OR has active project links)`

---

### Feature VT-4: Timeline View

**Look:** Horizontal scrollable timeline. Events plotted chronologically: decisions (blue markers), commitments created (green), commitments due (red outline), memories added (gray dots), sessions held (purple). Above the timeline: filter bar for entity type, domain, person. Below: detail panel for selected event. Zoom levels: day, week, month, quarter.

**Function:**
1. Aggregates timestamped events from all entities: `Decision.createdAt`, `Commitment.createdAt` + `deadline`, `MemoryEntry.createdAt`, `Session.createdAt`, `Goal.deadline`, `Task.deadline`
2. Events rendered on horizontal axis, colored by type
3. Click event → detail panel with full context
4. "What happened around this time?" — select a date range, system summarizes all activity in that window (Haiku generates narrative)

**Data connections:**
- **Read:** All timestamped entities: `Decision`, `Commitment`, `MemoryEntry`, `Session`, `Goal`, `Task` — each with their respective date fields
- **Filter:** By `entityType`, by domain (via entity's domain field or linked `Project.domain`), by person (via `MemoryEntityLink` or `Commitment.stakeholderId`)
- **No new models** — pure aggregation view

---

## Module 6: Arena (Stress Testing & Simulation)

**Job-to-be-done:** Pressure-test ideas before they cost money or reputation.

**Frontend location:** New page: `ArenaPage.tsx`
**Backend:** Extended persona dispatch + simulation engine
**Data models:** `Session`, `AdvisorMessage`, `Scenario` (new)

---

### Feature AR-1: Pitch Simulator

**Look:** Chat-style interface with a twist: the "audience" responds. Left side: user's pitch (typed or pasted). Right side: simulated audience reactions from different archetypes:
- Skeptical Investor (red avatar)
- Enthusiastic Early Adopter (green avatar)
- Risk-Averse Enterprise Buyer (blue avatar)
- Domain Expert Competitor (orange avatar)

Each archetype responds with questions, objections, and reactions. Below the conversation: a Pitch Scorecard — Clarity (1-10), Persuasiveness (1-10), Gap Coverage (1-10), Overall (1-10). Specific feedback on what was strong, weak, and missing.

**Function:**
1. User selects scenario: "Investor Pitch," "Customer Demo," "Partnership Proposal," "Board Presentation"
2. User inputs their pitch (full text, slide-by-slide, or conversational)
3. System generates archetype responses using custom system prompts per archetype
4. Multi-turn: user can respond to questions, audience continues the conversation
5. After conversation ends (user clicks "Score"), CEO persona synthesizes feedback into the scorecard
6. Scorecard + conversation saved for future reference and improvement tracking

**Data connections:**
- **Session:** Standard `Session` with `metadata: { mode: "pitch-simulator", scenarioType: "investor", archetypes: [...] }`
- **Archetype responses:** `AdvisorMessage` with custom `personaId` values: `archetype-skeptical-investor`, `archetype-early-adopter`, etc.
- **Scorecard:** `MeetingOutput` — extend to include `{ pitchScore: { clarity, persuasiveness, gapCoverage, overall, strengths: [], weaknesses: [], gaps: [] } }`
- **Improvement tracking:** Compare `pitchScore.overall` across sessions with same `scenarioType` to show improvement over time
- **New prompts needed:** `docs/prompts/archetypes/skeptical-investor.system.md`, etc.

---

### Feature AR-2: Negotiation Prep

**Look:** Three-panel layout:
1. **Situation Brief** (left): User describes the negotiation — who, what's at stake, their goals, known constraints
2. **Strategy Analysis** (center): System generates: your BATNA, their likely BATNA, ZOPA analysis, recommended tactics, anchoring strategy, concession plan
3. **Rehearsal** (right): Chat interface where system plays the counterparty. User practices responses, system escalates difficulty.

**Function:**
1. User inputs negotiation context + selects counterparty from People Directory (or describes them)
2. If `Person` record exists: pull all memories about them for behavioral modeling
3. Technician + Critic + Doer personas generate the strategy analysis
4. Rehearsal mode: Sonnet simulates the counterparty with escalating challenge levels (cooperative → competitive → aggressive)
5. Post-rehearsal: CEO generates a "negotiation playbook" — 1-page summary of strategy, key phrases, red lines, and walk-away triggers

**Data connections:**
- **Context:** `Person` (counterparty) + linked `MemoryEntry` rows. `Commitment` records involving this person. Past `Decision` records related to this relationship.
- **Strategy output:** `MeetingOutput` with `metadata: { type: "negotiation-prep", counterpartyId: "...", batna: "...", zopa: {...} }`
- **Rehearsal:** Standard `Session` + `AdvisorMessage` flow with `personaId: "negotiation-counterparty"`
- **Playbook:** `GeneratedArtifact` (from OL-1) with `artifactType: "negotiation-playbook"`

---

### Feature AR-3: Crisis Simulator

**Look:** War-room aesthetic. Red-tinted header: "CRISIS SCENARIO." Timer showing simulated elapsed time (T+0:00). Left panel: the crisis event description and evolving situation. Right panel: recommended actions organized by time horizon — "Right Now (0-4 hours)," "Today," "This Week," "Recovery (30 days)." Each action has an "Execute" button that logs it and updates the simulation. Situation evolves based on actions taken.

**Function:**
1. User describes a crisis scenario or selects from templates ("Key client churns," "Cofounder leaves," "Cash crunch," "PR disaster," "Technical failure")
2. System pulls all relevant context (affected projects, people, commitments, financial data from memories)
3. All 7 personas generate immediate analysis
4. Doer + CEO structure the response plan by time horizon
5. Interactive: user "executes" actions, system evolves the scenario (second-order effects) and regenerates the response plan
6. Post-simulation: generates a "Crisis Playbook" — a reusable response plan stored for if this actually happens

**Data connections:**
- **Scenario storage:** `Scenario` model with `description`, `impactAnalysis`, `responsePlan`
- **Context retrieval:** Full hybrid search using scenario text. Entity extraction links to `Person`, `Project`, `Commitment`
- **Action log:** `Session` + `AdvisorMessage` (each simulated turn). `TranscriptEntry` for user's action decisions.
- **Playbook:** `GeneratedArtifact` with `artifactType: "crisis-playbook"`, linked to `Scenario`
- **Reuse:** If a real crisis matches a simulated scenario (detected by semantic similarity on new session input vs. stored `Scenario.description`), system surfaces the playbook: "You simulated this scenario 3 months ago. Here's the playbook you created."

---

### Feature AR-4: Red Team Mode

**Look:** Single button available in any module: "Red Team This." Opens an overlay panel where the system attacks the current plan/decision/strategy from every angle. Output formatted as an adversarial brief:
- **Critical Vulnerabilities** (ranked by severity)
- **Blind Spots** (things not considered)
- **Failure Modes** (how this could go wrong)
- **Competitive Response** (how competitors or adversaries would counter)
- **Recommended Hardening** (what to fix before proceeding)

**Function:**
1. Takes the current context (whatever the user is looking at — a decision, a strategy canvas, a goal decomposition)
2. Dispatches Critic + Questionnaire + Alternate with adversarial system prompt overlays
3. Each persona independently identifies weaknesses
4. CEO synthesizes into the structured adversarial brief
5. User can mark each vulnerability as "addressed," "accepted risk," or "will fix"

**Data connections:**
- **Input:** Whatever entity is currently in view — `Decision`, `StrategyCanvas`, `Goal`, `Scenario`
- **Output:** `AdvisorMessage` rows with `personaId` suffixed: `critic-redteam`, `questionnaire-redteam`, `alternate-redteam`, `ceo-redteam`
- **Status tracking:** `MeetingOutput.metadata.redTeamFindings: [{ id, text, severity, status: "open"|"addressed"|"accepted" }]`

---

## Module 7: Pulse (Execution & Accountability)

**Job-to-be-done:** Close the gap between deciding and doing. Build the habit of follow-through.

**Frontend location:** New page: `PulsePage.tsx`
**Data models:** `Commitment`, `Task`, `Project`, `OutcomeReviewNudge`

---

### Feature PL-1: Commitment Engine (Enhanced)

**Look:** Two views:
1. **Active Commitments** — table with columns: description, stakeholder, deadline, project, status, days remaining. Sortable by any column. Row click → detail panel with full context (source session, related decisions, linked tasks).
2. **Commitment Feed** — chronological feed showing commitment lifecycle events: created, approaching deadline, completed, missed, deferred. Like a Twitter feed but for your promises.

**Function:**
1. Commitments auto-extracted from sessions (existing `commitment-extraction.system.md`)
2. Enhanced extraction: also parses email forwards and Quick Capture inputs for commitment language
3. Smart deadline suggestions: if user says "I'll get back to them next week," system calculates a specific date and sets it
4. Nudge engine: 3 days before deadline → reminder, 1 day before → urgent reminder, day after → "This commitment is overdue. Complete, defer, or renegotiate?"
5. Stakeholder notification drafts: when completing a commitment involving a person, system drafts a follow-up message

**Data connections:**
- **Primary:** `Commitment` — all fields. `status` transitions: OPEN → COMPLETED | MISSED | DEFERRED
- **Extraction source:** `Session` (via `sourceSessionId`), `MemoryEntry` (email/quick capture → commitment detection)
- **Nudges:** `OutcomeReviewNudge` with `nudgeType: "commitment_reminder"`, `scheduledFor` = `Commitment.deadline` - 3 days, -1 day, +1 day
- **Stakeholder context:** `Person` via `Commitment.stakeholderId` — pull contact info, communication style preferences from person's memory entries
- **Project context:** `Project` via `Commitment.linkedProjectId` — shows where this commitment fits in the bigger picture

**Micro-features:**
- **Renegotiation wizard:** When a commitment can't be met, system guides you through renegotiating: drafts a message to the stakeholder explaining the delay, proposes a new timeline, and updates the commitment record.
  - *Data:* `Commitment.status → DEFERRED`, `Commitment.deadline` updated, `MemoryEntry` created logging the renegotiation reason
- **Commitment patterns:** Weekly analysis of commitment data: average time-to-complete, on-time percentage, which stakeholders you're most reliable with, which domains you struggle in.
  - *Data:* Aggregated from `Commitment WHERE userId AND completedAt IS NOT NULL` — compare `completedAt` to `deadline`. Patterns stored as `ThinkingPattern` with `patternType: BEHAVIORAL_CYCLE`

---

### Feature PL-2: Weekly Review Protocol

**Look:** Guided review flow (not a dashboard — a step-by-step process that takes 15 minutes):
1. **Commitment Review** — list of all commitments that were due this week. User marks each: completed ✓, missed ✗, deferred →. For missed: "Why?" prompt.
2. **Decision Review** — any decisions from this week. Quick reflection: "Still feel good about this?"
3. **Goal Check-in** — each active goal: rate progress 1-5, one sentence on what moved/blocked
4. **Next Week Preview** — upcoming deadlines, scheduled meetings, open decisions. System suggests top 3 priorities.
5. **Reflection** — "What's one thing you learned this week?" (feeds into Mirror module)

**Function:**
1. Triggered weekly (configurable day/time) via notification or dashboard prompt
2. Each step pre-populated with relevant data
3. User responses update entity records in real-time
4. On completion: generates a "Week X Summary" stored as `WeeklyMemo`
5. Streak tracking: shows consecutive weeks of completed reviews. Gamification element.

**Data connections:**
- **Step 1:** `Commitment WHERE deadline BETWEEN [weekStart, weekEnd] AND userId` — user updates `status`
- **Step 2:** `Decision WHERE createdAt BETWEEN [weekStart, weekEnd] AND userId` — user adds `metadata.weeklyReflection`
- **Step 3:** `Goal WHERE status = active AND userId` — progress stored as `MemoryEntry` with `domain: "okr-progress"`
- **Step 4:** `Commitment WHERE deadline BETWEEN [nextWeekStart, nextWeekEnd]` + `Decision WHERE reviewAt BETWEEN [nextWeekStart, nextWeekEnd]` + calendar events (if integrated)
- **Step 5:** Reflection → `MemoryEntry` with `memoryClass: EPISODIC` (feeds Mirror/MR-4)
- **Summary:** `WeeklyMemo` created with all aggregated data
- **Streak:** `UserProfile.metadata.reviewStreak: { current: 8, longest: 12, lastCompleted: "2026-04-14" }`

---

### Feature PL-3: Sprint Planner

**Look:** Left panel: draggable task cards from your active projects. Right panel: a 2-week calendar grid. Drag tasks onto specific days. System shows: total estimated hours per day (bar chart at bottom of each day column), capacity warnings when a day is overloaded. AI suggestion button: "Plan my sprint" auto-arranges tasks based on priority, dependencies, estimated effort, and your energy patterns (from Mirror).

**Function:**
1. Pulls all `Task WHERE userId AND status IN ['pending', 'in_progress']` with effort estimates
2. "Plan my sprint" algorithm:
   - Respects `TaskDependency` ordering
   - Factors in `Task.priority`
   - Distributes effort across days to not exceed capacity (from `UserProfile.metadata.weeklyCapacityHours / 5`)
   - If Mirror data available, schedules high-effort tasks during peak energy times
3. Manual override: drag to rearrange. System warns if dependencies are violated.
4. Daily standup prompt (optional): "What did you finish yesterday? What's blocked?"

**Data connections:**
- **Read:** `Task` (all active, with `estimatedEffort`, `priority`, `deadline`), `TaskDependency`, `ProjectTaskLink` → `Project`
- **Capacity:** `UserProfile.metadata.weeklyCapacityHours`
- **Energy patterns:** `ThinkingPattern WHERE patternType = BEHAVIORAL_CYCLE AND pattern LIKE '%energy%'`
- **Sprint storage:** New model `Sprint` — (id, userId, startDate, endDate, taskAssignments JSON: `[{ taskId, scheduledDate, order }]`, status, createdAt)
- **Daily standup:** `MemoryEntry` with `domain: "standup"`, `sourceType: MANUAL`

**New model needed:** `Sprint`

---

### Feature PL-4: Delegation Briefer

**Look:** Select a task or project → "Create Delegation Brief" button → system generates a comprehensive handoff document:
- **Context** — why this work matters, how it fits into the bigger picture
- **Scope** — exactly what needs to be done, acceptance criteria
- **Constraints** — budget, timeline, technical requirements, stakeholder preferences
- **Decision Authority** — what the delegate can decide on their own vs. what needs approval
- **Communication Protocol** — how often to check in, what format, escalation triggers
- **Resources** — links, documents, people to talk to

Output as downloadable PDF/DOCX or copy-to-clipboard for pasting into a project management tool.

**Function:**
1. User selects entity (Task, Project, or Commitment)
2. System pulls all context: the entity itself, parent project/goal, related decisions, linked people, relevant memories
3. Sonnet generates the delegation brief using the Doer + Technician persona perspectives
4. User reviews and edits
5. On confirm: generates artifact + creates a `Commitment` for the delegate (if delegate is a known `Person`)

**Data connections:**
- **Input:** `Task` or `Project` (the work being delegated) + all linked entities via join tables
- **Context aggregation:** `Goal` (via `GoalProjectLink`), `Decision` (via `DecisionProjectLink`), `Person` (via `ProjectPersonLink`), `MemoryEntry` (via `MemoryEntityLink`)
- **Output:** `GeneratedArtifact` with `artifactType: "delegation-brief"`, `entityType: "task"|"project"`, `entityId`
- **Delegation tracking:** `Commitment` created with `description: "Delegated: [task title]"`, `stakeholderId: delegate's Person.id`

---

## Module 8: Council (People & Relationship Intelligence)

**Job-to-be-done:** Manage the humans in your orbit more effectively. Never drop a relationship ball.

**Frontend location:** `PeopleDirectoryPage.tsx` (major upgrade)
**Data models:** `Person`, `Commitment`, `ProjectPersonLink`, `MemoryEntityLink`, `CustomPersona`

---

### Feature CN-1: Stakeholder Profiles (Deep)

**Look:** Person detail page with tabs:
1. **Overview** — name, role, relationship type, importance score, last contact, domains of overlap, relationship health indicator (green/yellow/red based on engagement recency + commitment status)
2. **History** — chronological timeline of all interactions: sessions where they were mentioned, decisions involving them, commitments made to/about them, memories referencing them
3. **Intelligence** — system-generated insights: "They care most about [X]," "Past friction points: [Y]," "Communication preference: [Z]," "Best approach when asking for [W]"
4. **Open Items** — active commitments involving them, decisions that affect them, upcoming meetings with them

**Function:**
1. Profile auto-builds from accumulation of memories mentioning this person
2. Intelligence tab: Sonnet generates behavioral profile from aggregated memories (refreshed monthly or on-demand)
3. Relationship health: calculated from `lastContactAt`, open commitment status, and memory sentiment
4. "Prepare for meeting" button: generates a 1-page brief (context, open items, talking points, things to avoid)

**Data connections:**
- **Primary:** `Person` (all fields)
- **History:** `MemoryEntry` linked via `MemoryEntityLink WHERE entityType = 'person' AND entityId = [id]`. `Commitment WHERE stakeholderId = [id]`. `Decision` linked via `DecisionProjectLink` → `ProjectPersonLink`.
- **Intelligence:** Sonnet generates from memory aggregation → stored in `Person.notes` (extend to structured JSON) or `ContextCapsule` with `entityType: "person"`, `entityId: person.id`
- **Health calculation:** `lastContactAt` recency (< 2 weeks = green, 2-6 weeks = yellow, > 6 weeks = red) adjusted by commitment status (overdue commitment with person = always red)

**Micro-features:**
- **Communication style adapter:** "Draft a message to [Person] about [Topic]." System adjusts tone and format based on what it knows about the person's preferences.
  - *Data:* `Person.notes` or linked `MemoryEntry` tagged with `communication-style`. Generates email draft → output via OL-3 or clipboard.
- **Follow-up generator:** After a meeting/session involving a person, system drafts follow-up actions and messages.
  - *Data:* Most recent `Session` mentioning this person → `MeetingOutput.actionItems` filtered for items involving this person

---

### Feature CN-2: Custom Persona Builder (Enhanced)

**Look:** Multi-step wizard:
1. **Name & Description** — who is this persona? What lens do they analyze through?
2. **Knowledge Base** — upload documents, paste text, or select existing memories that define this persona's worldview. "Make a persona that thinks like my mentor Dave" → system pulls all memories about Dave + user provides Dave's writings/advice.
3. **Behavioral Parameters** — risk tolerance slider, communication style (direct ↔ diplomatic), time horizon (short ↔ long term), values emphasis checkboxes
4. **Test Drive** — run a sample decision through the new persona to calibrate
5. **Activate** — persona joins the user's board for relevant sessions

**Function:**
1. Wizard collects inputs, generates a system prompt using a meta-prompt (Sonnet generates the persona system prompt from the user's specifications)
2. System prompt stored in `CustomPersona.systemPrompt`
3. Knowledge base memories linked to persona for context injection during sessions
4. Test drive: runs a quick session with just this persona
5. User can iterate on the system prompt or behavioral parameters
6. Active custom personas appear alongside the 7 core personas in mode selection

**Data connections:**
- **Primary:** `CustomPersona` — all fields. `personaId` = user-chosen slug. `systemPrompt` = generated text.
- **Knowledge base:** `MemoryEntry` rows tagged with `customPersona: [personaId]` via `MemoryEntityLink WHERE entityType = 'custom_persona' AND entityId = persona.id`
- **Behavioral parameters:** Stored in `CustomPersona.metadata` JSON (extend model to add `metadata Json @default("{}")`)
- **Dispatch integration:** Orchestrator checks `CustomPersona WHERE userId AND isActive = true` and includes matching personas in dispatch based on domain overlap
- **Test drive:** Standard `Session` with `metadata: { testDrive: true, personaId: customPersona.personaId }`

---

### Feature CN-3: Meeting Prep (Proactive)

**Look:** Triggered automatically 30 minutes before a calendar event (requires calendar integration, OL-2). Notification surfaces a prep card:
- **Attendees** — matched against People Directory with relationship health indicators
- **Context** — recent interactions, open commitments, relevant decisions
- **Suggested Agenda** — based on open items between you and attendees
- **Talking Points** — key things to raise, organized by priority
- **Watch Outs** — sensitive topics, unresolved tensions, overdue commitments

Also available on-demand: "Prep me for my call with [Person]" in any session.

**Function:**
1. Calendar sync (OL-2) pulls upcoming events
2. 30 min before: parse attendee list, match against `Person` records
3. For each attendee: pull recent `MemoryEntry`, open `Commitment`, relevant `Decision`
4. Sonnet generates the prep brief using CEO + Doer perspectives
5. Brief displayed as dismissable card on dashboard + optional push notification

**Data connections:**
- **Calendar:** `OAuthToken` for Google Calendar OAuth. Calendar event attendees matched by email to `Person.email` (currently `Person` doesn't have email — need to add, or match via `MemoryEntry` content about the person)
- **Person context:** Same aggregation as CN-1 History tab
- **Open items:** `Commitment WHERE stakeholderId = person.id AND status = OPEN`
- **Brief storage:** `GeneratedArtifact` with `artifactType: "meeting-prep"`, `entityType: "calendar_event"`, `entityId: calendarEventId`
- **New field needed on Person:** `email String?` (for calendar attendee matching)

---

### Feature CN-4: Network Map

**Look:** Concentric circle visualization. User at center. Inner ring: high-importance relationships (importance > 0.8). Middle ring: regular contacts (0.4-0.8). Outer ring: peripheral connections (< 0.4). Lines between people show shared projects or mutual relationships (if known). Color: by domain. Size: by interaction frequency. Clicking a person highlights all their connections. "Cold" relationships (no contact > 60 days) shown with dashed outlines.

**Function:**
1. Build from `Person` records + `ProjectPersonLink` (shared projects = connections between people)
2. Importance = `Person.importance`, adjusted by recency of interaction
3. Interaction frequency from `Person.interactionFrequency`
4. "Cold" detection: `Person.lastContactAt` > 60 days
5. Suggested actions: "Reconnect with [Person] — you have 2 open commitments and haven't spoken in 45 days"

**Data connections:**
- **Nodes:** `Person WHERE userId AND deletedAt IS NULL`
- **Edges:** People connected via shared `Project` (both linked via `ProjectPersonLink`). Also connected if mentioned in same `MemoryEntry`.
- **Layout:** Client-side force-directed graph. Node position = importance × recency. Edge weight = shared context count.
- **Suggestions:** Cortex scheduler identifies cold but important relationships: `Person WHERE importance > 0.5 AND lastContactAt < 60d ago AND (has OPEN commitments OR has active project links)`

---

## Module 9: Watchtower (Market & External Intelligence)

**Job-to-be-done:** Know what's happening outside your bubble that affects your decisions.

**Frontend location:** New page: `WatchtowerPage.tsx`
**Backend:** Web search tool (already exists) + scheduled intelligence gathering
**Data models:** `MemoryEntry` (external intelligence stored as memories)

**This module came entirely from Pass 2 — Pass 1 was fully inward-focused.**

---

### Feature WT-1: Industry Radar

**Look:** Three-section dashboard:
1. **Tracked Topics** — user-configured list of topics/keywords to monitor (e.g., "AI regulation," "SaaS pricing trends," "church tech"). Each shows latest findings with freshness indicator.
2. **Competitive Landscape** — tracked competitors (manual list). Latest news, product changes, funding. Sourced from web search.
3. **Signal Feed** — auto-curated feed of external developments relevant to user's active goals and projects.

**Function:**
1. User configures tracked topics and competitors in settings
2. Cortex scheduler runs weekly web searches for each topic + competitor
3. Results filtered for relevance (Haiku scoring) and stored as `MemoryEntry` with `domain: "external-intelligence"`, `sourceType: API_IMPORT`
4. Signal Feed: cross-references external findings against user's active `Goal` and `Project` records — surfaces only what's relevant
5. User can "react" to signals: "This affects my plans" → creates a linked `Decision` or updates relevant `ContextCapsule`

**Data connections:**
- **Configuration:** New model `WatchlistItem` — (id, userId, type: "topic"|"competitor"|"keyword", name, searchQueries String[], lastSearchedAt, isActive, createdAt)
- **Results:** `MemoryEntry` with `sourceType: API_IMPORT`, `domain: "external-intelligence"`, `tags` include watchlist item name, `metadata: { source: "web_search", url, searchQuery, relevanceScore }`
- **Relevance matching:** Embedding similarity between new external `MemoryEntry` and user's active `Goal.title` / `Project.title` embeddings
- **Signal → Action:** User clicking "This affects my plans" creates `MemoryEntityLink` between the signal memory and affected `Project`/`Goal`, optionally spawns a new `Decision`

**New model needed:** `WatchlistItem`

---

### Feature WT-2: Assumption Invalidation Radar

**Look:** Subset of Watchtower that specifically monitors external conditions tied to active `DecisionAssumption` records. Display: assumption text + external signal that might affect it + confidence impact indicator (↑↓→).

**Function:**
1. For each active `DecisionAssumption`, Cortex generates search queries that would find invalidating evidence
2. Weekly web search + comparison
3. If relevant finding detected: creates `ContradictionAlert` linking the assumption to the external signal
4. User decides: update assumption, revisit decision, or dismiss

**Data connections:**
- **Read:** `DecisionAssumption WHERE status = ACTIVE` → generate search queries
- **Search:** Web search tool (existing `web-search.tool.ts`)
- **Storage:** Results as `MemoryEntry`. If relevant: `ContradictionAlert` with `entityA: { type: "assumption", id }`, `entityB: { type: "external_signal", memoryId }`
- **Action:** User can update `DecisionAssumption.status` or trigger a new `Decision` session

---

## Domain-Specific Feature Sets

### Ministry Features (integrated into relevant modules)

These aren't a separate module — they're domain-specific capabilities within existing modules.

#### MN-1: Sermon Prep Workshop (in Forge)
- **Look:** Guided flow: Scripture text → key themes → application points → illustration suggestions → outline → full draft. Each stage gets persona analysis: Technician (exegetical accuracy), Critic (theological pitfalls), Optimist (application opportunities), Doer (practical takeaways).
- **Data:** `Session` with `metadata: { mode: "sermon-prep", scripture: "..." }`. Sermon drafts stored as `MemoryEntry` with `domain: "ministry"`, `tags: ["sermon"]`.
- **Context memory:** System remembers every sermon prepped — tracks scripture coverage, recurring themes, illustration reuse. Prevents accidental repetition.

#### MN-2: Pastoral Care Tracker (in Council)
- **Look:** Extended Person profiles for congregation members. Tracks: last pastoral contact, care needs, life events (illness, job loss, celebration), follow-up commitments. Privacy-sensitive — all data encrypted at rest.
- **Data:** `Person` records with `domains: ["pastoral-care"]`. `Commitment` records for follow-up visits/calls. `MemoryEntry` with `domain: "pastoral-care"` for care notes.
- **HIPAA consideration:** While not legally required for churches, system should treat pastoral care data with healthcare-level sensitivity. Flag in `Person.metadata: { sensitiveContext: true }` — excluded from general retrieval, only surfaced in pastoral-care domain queries.

#### MN-3: Stewardship Intelligence (in Command Center)
- **Look:** Dashboard widget showing giving trends, budget health, and generosity patterns (anonymized/aggregated). Integrates with church management systems (Planning Center, etc.).
- **Data:** `MemoryEntry` with `domain: "stewardship"`, `tags: ["giving", "budget"]`. Aggregated — never individual donor data.
- **Integration:** Future Phase 3 — Planning Center API connector.

### Consultant Features (integrated into relevant modules)

#### CS-1: Client Engagement Tracker (in Council)
- **Look:** Person profiles extended for clients. Shows: engagement status (active/paused/completed), total sessions, deliverables produced, open action items, satisfaction signals.
- **Data:** `Person` with `domains: ["client"]`, `metadata: { engagementStatus, contractEnd, retainerValue }`. `Project` records per client engagement. `Commitment` records for deliverables.

#### CS-2: Proposal Generator (in Forge)
- **Look:** "Create Proposal" flow: select client → describe engagement → system generates a structured proposal pulling from your expertise inventory (past deliverables, relevant case studies from memory).
- **Data:** `MemoryEntry` tagged `domain: "expertise"` for past work. `GeneratedArtifact` with `artifactType: "proposal"`. Template stored in `ContextCapsule` with `entityType: "template"`.

#### CS-3: Expertise Inventory (in Vault)
- **Look:** Auto-generated catalog of your knowledge areas based on memory analysis. Shows: topics you've advised on, frequency, depth, related case studies. Useful for positioning and marketing.
- **Data:** Cortex analysis of `MemoryEntry` tagged by domain → generates expertise map stored as `ContextCapsule` with `entityType: "expertise-profile"`.

---

## Proactive Intelligence Engine (Cortex Evolution)

This isn't a user-facing module — it's the background system that powers proactive features across all modules.

### Current state: `cortex-scheduler` + 4 cortex personas (memo, patterns, contradictions, simulation)

### Enhanced Cortex Jobs:

| Job | Frequency | Inputs | Output | Destination Module |
|-----|-----------|--------|--------|--------------------|
| Weekly Memo | Weekly | All entity changes in 7d | `WeeklyMemo` | Command Center |
| Pattern Detection | Weekly | Decisions, commitments, sessions (30d) | `ThinkingPattern` | Mirror |
| Contradiction Scan | Daily | Active assumptions, new memories | `ContradictionAlert` | Command Center, War Room |
| Assumption Monitoring | Weekly | Active `DecisionAssumption` + web search | `ContradictionAlert` | Watchtower |
| Commitment Nudges | Daily | Commitments approaching deadline | `OutcomeReviewNudge` | Pulse |
| Decision Staleness | Daily | Decisions OPEN > 14 days | `OutcomeReviewNudge` | Command Center |
| Relationship Health | Weekly | Person records + contact recency | Notifications | Council |
| Context Capsule Refresh | Weekly | Capsules past `staleAfter` | Updated `ContextCapsule` | Vault |
| Values Alignment | Monthly | Decisions (90d) + `UserProfile.valueHierarchy` | `ThinkingPattern` | Mirror |
| Goal Progress | Weekly | Goal/Project/Task completion rates | `WeeklyMemo` supplement | Forge |
| External Intelligence | Weekly | `WatchlistItem` search queries | `MemoryEntry` (external) | Watchtower |
| Meeting Prep | 30min before event | Calendar events + Person data | `GeneratedArtifact` | Council |
| Sermon Coverage | Monthly | Sermon memories | `ContextCapsule` | Ministry (Forge) |

---

## New Prisma Models Summary

Models needed beyond current schema:

| Model | Purpose | Key Fields |
|-------|---------|------------|
| `Document` | Uploaded file tracking | userId, filename, mimeType, storageUrl, status, chunkCount, summaryMemoryId |
| `IngestEndpoint` | Email forwarding addresses | userId, address, isActive, lastReceivedAt |
| `GeneratedArtifact` | Cached generated outputs | userId, entityType, entityId, artifactType, content, format, staleAfter |
| `ExportConfig` | Scheduled export configurations | userId, exportType, template, schedule, lastRunAt |
| `StrategyCanvas` | Versioned strategy documents | userId, canvasType, content JSON, version, parentVersionId |
| `Scenario` | Crisis/simulation scenarios | userId, description, impactAnalysis JSON, responsePlan JSON, status |
| `ScenarioEntityLink` | Scenario ↔ entity relationships | scenarioId, entityType, entityId |
| `CapsuleMemoryLink` | Context capsule ↔ memory membership | capsuleId, memoryId |
| `WatchlistItem` | External monitoring configuration | userId, type, name, searchQueries, isActive |
| `Sprint` | Sprint planning assignments | userId, startDate, endDate, taskAssignments JSON |

### Extended Existing Models:

| Model | New Fields |
|-------|-----------|
| `Decision` | `metadata Json @default("{}")` (for reversibility, valuesServed, predictionConfidence, forkedFrom) |
| `Person` | `email String?`, `metadata Json @default("{}")` |
| `DecisionAssumption` | `invalidatedAt DateTime?`, `invalidatedReason String?`, `linkedMemoryIds String[]` |
| `CustomPersona` | `metadata Json @default("{}")` |
| `ThinkingPattern` | `evidenceIds String[]` |
| `Session` | `metadata Json @default("{}")` (for mode, testDrive flags, scenarioType) |
| `MeetingOutput` | `metadata Json @default("{}")` (for pitchScore, redTeamFindings, failureModes) |

---

## Implementation Priority (Recommended Sequence)

### Tier 1 — Retention Core (Build first — makes existing product sticky)
1. **CC-1: Active Decisions Board** — visualizes existing data, no new models
2. **CC-2: Commitment Radar** — visualizes existing data, no new models
3. **CC-3: Momentum Score** — leverages existing `WeeklyMemo`
4. **PL-1: Commitment Engine (Enhanced)** — extends existing extraction
5. **PL-2: Weekly Review Protocol** — guided flow over existing data
6. **IL-1: Quick Capture** — lowest friction input, routes to existing systems

### Tier 2 — Intelligence Layer (Makes the product irreplaceable)
7. **CC-4: Weekly Intelligence Briefing** — Cortex memo elevated to first-class UX
8. **MR-1: Thinking Pattern Dashboard** — Cortex patterns with a face
9. **WR-2: Assumption Tracker** — existing model, new monitoring
10. **WR-3: Outcome Tracking & Decision Journal** — existing fields, new UX
11. **VT-1: Context Capsules** — solves re-explanation problem, one new join table

### Tier 3 — Power Features (Differentiation + revenue expansion)
12. **FG-1: Goal Decomposition Engine** — uses existing entity models
13. **CN-1: Stakeholder Profiles (Deep)** — extends existing People Directory
14. **CN-3: Meeting Prep** — requires calendar integration (Phase 3)
15. **AR-4: Red Team Mode** — leverages existing persona system
16. **WR-1: Decision Tree Builder** — extends Decision.options JSON
17. **VT-2: Document Library** — new Document model + ingestion pipeline

### Tier 4 — Premium / Differentiation
18. **AR-1: Pitch Simulator** — new archetype personas
19. **AR-2: Negotiation Prep** — advanced simulation
20. **AR-3: Crisis Simulator** — interactive scenario engine
21. **FG-2: Strategy Canvas** — new model, rich UI
22. **FG-3: Scenario Planner** — new models
23. **WT-1: Industry Radar** — external data, new model
24. **WR-4: Stakeholder Simulation** — dynamic persona generation
25. **PL-3: Sprint Planner** — new Sprint model
26. **PL-4: Delegation Briefer** — artifact generation
27. **CN-2: Custom Persona Builder (Enhanced)** — wizard UX
28. **CN-4: Network Map** — complex visualization
29. **VT-3: Relationship Graph** — D3 force graph
30. **VT-4: Timeline View** — aggregation visualization

### Domain Features (Layer in based on user segment):
- Ministry: MN-1, MN-2, MN-3 (after Tier 2)
- Consultant: CS-1, CS-2, CS-3 (after Tier 2)

---

## Revenue Implications

| Tier | Features | Pricing Signal |
|------|----------|---------------|
| Free | War Room (3 sessions/mo), basic dashboard | Lead gen |
| Pro ($29/mo) | Unlimited War Room, Command Center, Pulse, Vault basics | Core value |
| Executive ($79/mo) | + Mirror, Forge, Council, Arena, all modes | Power users |
| Enterprise ($199/mo) | + Watchtower, Custom Personas (unlimited), API access, team features | Consultants, multi-venture founders |
| Ministry (custom) | + Ministry features, pastoral care, stewardship | Church licensing |

---

*This is a living document. Update as features move through implementation.*
