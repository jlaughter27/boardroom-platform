# Advanced Cortex

> Constraints reminder: Respect ADRs 001-013. See [`../01-foundations/CONSTRAINTS.md`](../01-foundations/CONSTRAINTS.md).

---

## Problem

Cortex today is a foundation, not a finished product. The current cortex layer (Phase 2 complete) runs three scheduled jobs:

- **Weekly memo** (Sun 6pm) — synthesizes the week's memories into a digest.
- **Pattern detection** (Mon 3am) — finds recurring themes.
- **Contradiction alerts** (Tue 9pm) — flags facts that disagree.

These are valuable, but they're **observational**. They tell the user what happened. They don't yet:

- Close the loop between a decision and its outcome ("you said the launch would land April 15; it landed April 22 — what assumption was off?")
- Detect contradictions across entities, not just within memories ("Project X's deadline assumes Person Y is available, but Person Y is on three other Q2 projects")
- Track decision quality over time ("decisions made under high time-pressure have a 40% higher reversal rate")
- Surface deadline risk before it's too late ("Task Z is overdue by 3 days; the goal it blocks slips next week if not unblocked")
- Recommend next actions ("based on your last 4 weekly memos, the recurring blocker is hiring — here are 3 candidates from your contacts")

The user wants a cortex that doesn't just describe the past — it **anticipates the next move** without acting on its own.

## Approach

Five new cortex capabilities, each a separate scheduled job. All read-only — they surface, never act. Every recommendation links back to source memories so the user can verify.

### 1. Outcome–decision feedback loop

For every `Decision` row, OmniMind already stores `assumptions` as a separate table. After the decision date passes (plus a configurable observation window — default 30 days), a cortex job asks:

- Did the decided action happen? (Check linked tasks for `completedAt`.)
- Did the assumed outcome materialize? (Search recent memories tagged with the same entities for confirmation/disconfirmation language.)
- Which assumptions held vs. failed? (LLM pass over assumptions vs. observed outcomes.)

Output: a `DecisionReview` row. Surfaced in the weekly memo and a per-decision sidebar in the UI.

### 2. Cross-entity contradictions

Today's contradictions cortex compares memory pairs. The advanced version walks the entity graph: for each `Project`, gather all `Task`, `Person`, `Goal` it links to plus all memories about those entities; ask the LLM to flag inconsistencies *across* entities.

Examples it should catch:
- "Project Q2 launch deadline = April 30" + "Person Alex (sole owner) is on PTO April 25-May 5"
- "Goal: hit 1k MRR by July" + "Decision: pause all paid acquisition for Q2"
- "Task: ship feature X" depends on "Task: vendor Y integration" but vendor Y was deprecated last month

### 3. Decision-quality trend

Aggregate-level metric. Per quarter:

- `decisions_made_count`
- `decisions_reversed_count` (decision marked superseded)
- `assumptions_failed_rate` (from §1)
- `time_pressure_index` (avg time between decision creation and synthesis)
- `confidence_calibration` (how often "high confidence" decisions hold vs. "low confidence")

A persona — call it the **Quartermaster** — synthesises these into a quarterly report. "Your Q1 decisions had a 22% reversal rate; the failed ones share the property that they were made in sessions under 10 minutes long."

### 4. Deadline + commitment alerts

Read existing `Task.dueDate` and `Commitment.dueDate`. Score risk:

- Overdue tasks blocking goals → high priority
- Tasks due in < 7 days with > 50% effort remaining → at-risk
- Commitments approaching due-date with no linked recent activity → likely-slip

Surface in a daily morning digest (cron 7am user-local) AND as a real-time push when a deadline crosses a threshold.

### 5. Recommended next actions

Read the latest weekly memo, the open tasks, the recent decisions, and the user's stated goals. Ask the LLM: "Given this context, what 3 actions should the user take this week to move their goals forward?"

Output a ranked list with rationale and source links. **Recommendations are advisory only** — never auto-execute. The user clicks "add to tasks" or "dismiss."

## Schema impact

```prisma
model DecisionReview {
  id                  String   @id @default(cuid())
  decisionId          String   @unique
  observationWindow   Int      // days
  outcomeMaterialized Boolean?
  assumptionsHeld     String[] // array of assumption IDs
  assumptionsFailed   String[]
  reviewedAt          DateTime @default(now())
  notes               String?
  decision            Decision @relation(fields: [decisionId], references: [id])
}

model CortexRecommendation {
  id           String   @id @default(cuid())
  userId       String
  type         String   // "next_action" | "deadline_risk" | "cross_entity_contradiction"
  priority     Int      // 1-100
  title        String
  rationale    String
  sourceLinks  Json     // [{ kind: "memory" | "decision" | "task", id: "..." }]
  status       String   @default("open") // open | acknowledged | dismissed | acted_on
  createdAt    DateTime @default(now())
  resolvedAt   DateTime?
  user         User     @relation(fields: [userId], references: [id])

  @@index([userId, status, priority])
}

model DecisionQualityMetric {
  id                  String   @id @default(cuid())
  userId              String
  periodStart         DateTime
  periodEnd           DateTime
  decisionsCount      Int
  reversalsCount      Int
  failedAssumptionsRate Float
  timePressureIndexMs Int
  confidenceCalibrationScore Float
  createdAt           DateTime @default(now())

  @@unique([userId, periodStart, periodEnd])
}
```

## API surface

- `GET /v1/cortex/recommendations?status=open` — paginated, ordered by priority
- `POST /v1/cortex/recommendations/:id/acknowledge` | `/dismiss` | `/act-on`
- `GET /v1/cortex/decision-reviews/:decisionId`
- `GET /v1/cortex/decision-quality?period=quarter`
- `POST /v1/cortex/run/:jobName` — manual trigger (admin/debug only)

## Phases

- [`../04-roadmap/PHASE-16-cortex-isolation/`](../04-roadmap/PHASE-16-cortex-isolation/) — Phase 16 first isolates cortex into its own service (per ops research §6) — canonical numbering (was tagged "Phase 15" by Builder 4); the advanced jobs ship inside that isolated service post-Phase 16
- Each new job rolls out independently (feature-flag per job)

Estimated effort: ~6-8 weeks for all five jobs (each is ~1-2 weeks including prompt iteration + eval scenarios).

## Non-goals

- **No auto-acting.** Cortex never creates a task, sends an email, or modifies an entity without an explicit user click. Every output is advisory.
- **No model routing.** Cortex stays on Claude Sonnet 4.6 (long-context synthesis) and Haiku 4.5 (cheap classification). Per ADR-002.
- **No real-time inference at the persona-call critical path.** All advanced cortex runs on schedules or on outbox events. The user-facing read path stays sub-second.
- **No prediction markets.** "Decision quality trend" is a description of past decisions, not a prediction of future ones.

## Risks

- **Hallucinated recommendations.** Cortex inventing tasks the user didn't agree to. Mitigation: every recommendation must cite ≥ 1 source memory or decision; UI displays sources; eval scenarios test for fabrication.
- **Notification fatigue.** Daily deadline alerts become noise. Mitigation: per-user notification settings; bundle multiple alerts into one digest.
- **LLM cost.** Five cortex jobs × LLM calls × N users = real money. Mitigation: migrate cortex to Anthropic Message Batches API (50% discount, 24h latency tolerated — fits cortex perfectly).
- **Cross-entity contradictions are noisy.** The graph of entities × memories has high false-positive rates. Mitigation: confidence threshold ≥ 0.7; "dismiss as not-a-contradiction" feedback retrains the prompt.
- **Decision quality metrics demoralise users.** A "your decisions are bad" dashboard is a UX failure. Mitigation: framing matters — "what worked vs. what didn't, and why" beats "you reversed 22% of decisions."

## Success metrics

- ≥ 60% of recommendations are acted on or acknowledged within 7 days of creation
- < 10% of recommendations dismissed as "not relevant" or "wrong" (proxy for false-positive rate)
- Decision review job runs on 100% of decisions whose observation window has elapsed
- Per-user cortex LLM cost < $0.50/user/week (post-Batches API migration)
- ≥ 30% of weekly memos cite an outcome from a prior decision review (proxy for feedback-loop value)

## Dependencies on other features

- **Observability suite** (Phase 13) — `omnimind.cortex.job.duration` metric required to monitor new jobs
- **Per-tenant cost controls** (Phase 14) — cortex spend rolls into per-user caps
- **Cortex isolation** (Phase 15) — advanced jobs run in the isolated cortex service to keep the API event loop clean
- **Webhooks event bus** (Phase 13) — `cortex.recommendation.created` event for downstream notification routing
