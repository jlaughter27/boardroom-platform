# Per-Tenant Cost Controls

> Constraints reminder: Respect ADRs 001-013. See [`../01-foundations/CONSTRAINTS.md`](../01-foundations/CONSTRAINTS.md). ADR-002 keeps the model surface narrow (Sonnet 4.6 + Haiku 4.5 + `text-embedding-3-small`), which makes accounting tractable.

---

## Problem

OmniMind today has no per-tenant LLM spend tracking, no caps, and no circuit breaker. A single user — or worse, a runaway loop in a marketplace persona — can rack up hundreds of dollars in Anthropic charges in an afternoon and we'd find out from the invoice. As we add the SDK (Phase 12), MCP server (Phase 10), and persona marketplace (Phase 17), the attack surface for accidental or malicious overspend grows fast.

Three failure modes we will hit without controls:

1. **Runaway agent loops** — a marketplace persona invokes itself recursively via tool use; per-call cost is small, total cost is enormous.
2. **Plan abuse** — a free-tier user finds a way to invoke premium personas; their usage is uncapped.
3. **Genuine power-user surprise** — a paying user has a busy week and exceeds their plan's expected usage; we want to soft-throttle, not hard-fail, and we want them to know before the surprise.

## Approach

Three layers, each independently useful, deployed in this order:

### Layer 1 — per-request accounting

(Foundational; ships in Phase 13 as part of [observability-suite.md](observability-suite.md).)

Every Anthropic and OpenAI call writes an `LlmUsage` row inside the same transaction as the consuming feature's write (where applicable). Captures `userId`, `model`, `inputTokens`, `outputTokens`, `costCents`, `source`, `requestId`. Anthropic responses include `usage.input_tokens` and `usage.output_tokens`; cost is computed against a versioned price table.

Prompt-cache discount accounted for — cached tokens cost ~10% of uncached and Anthropic returns separate counts.

### Layer 2 — per-plan daily and monthly caps

A per-plan configuration table:

| Plan | Daily LLM $ cap | Monthly LLM $ cap | Cortex jobs per week | Premium personas |
|---|---|---|---|---|
| Free | $0.50 | $5 | 1 | none |
| Pro | $5 | $50 | 7 | all 7 cores |
| Team (Phase 18+) | per-seat $5 | per-seat $50 + team pool | unlimited | all + custom |

Enforcement check before every Anthropic / OpenAI call:

```ts
const todaySpend = await prisma.llmUsage.aggregate({
  where: { userId, createdAt: { gte: startOfDay() } },
  _sum: { costCents: true },
})

if (todaySpend._sum.costCents >= plan.dailyCapCents) {
  throw new BudgetExceededError({
    userId,
    period: 'day',
    cap: plan.dailyCapCents,
    spent: todaySpend._sum.costCents,
  })
}
```

The check is < 5ms (indexed on `(userId, createdAt)`). Cached on the request scope to avoid double-counting within a single multi-LLM-call request.

### Layer 3 — spend velocity circuit breaker

Borrowed pattern from the existing `omnimind-client.ts` resilience layer, applied to spend rather than network failure. A user's hourly average spend is computed continuously. If burn rate exceeds **5x the hourly average for 5 consecutive minutes**, the circuit opens:

- New requests fall back to a **degraded mode**: cortex paused, premium personas swapped for Haiku-only equivalents, MCP `invoke_persona` rejected with `circuit_open` error
- An alert fires (paged to ops at high severity)
- The user gets an in-app notification: "We've throttled your account temporarily — possible runaway. Check the activity log."
- Circuit transitions OPEN → HALF_OPEN after a 15-minute cooldown, allowing a probe request through; CLOSED after a successful probe

The circuit catches both runaway loops (the most common cause) and abuse (rare, but the same defense works).

### User-visible UX

- **Settings → Usage** page: today's spend, this month's spend, daily cap progress bar, monthly cap progress bar, top consuming features (BoardRoom session, MCP, cortex)
- **Approaching-limit notification** at 80% daily and 80% monthly — in-app banner + optional email
- **Hard-cap notification** when reached — banner explaining what's blocked + when it resets + "upgrade plan" CTA
- **Circuit-breaker notification** — separate from the cap; user knows we throttled them automatically and can review activity

## Schema impact

`LlmUsage` is shared with the observability suite (see [observability-suite.md](observability-suite.md) for the schema).

Additional tables for cost controls:

```prisma
model PlanLimits {
  id                  String   @id @default(cuid())
  planId              String   @unique // "free" | "pro" | "team_starter" | "team_pro"
  dailyLlmCapCents    Int
  monthlyLlmCapCents  Int
  cortexJobsPerWeek   Int
  premiumPersonas     String[] // ["optimist","critic",...] or ["*"]
  webhooksPerHour     Int
  effectiveFrom       DateTime
}

model UsageAlert {
  id          String   @id @default(cuid())
  userId      String
  alertType   String   // "approaching_daily" | "exceeded_daily" | "exceeded_monthly" | "circuit_open"
  threshold   Int      // percent or absolute
  spentCents  Int
  notifiedAt  DateTime @default(now())
  resolvedAt  DateTime?

  @@index([userId, alertType, notifiedAt])
}
```

## API surface

- `GET /v1/account/usage?period=day|month` — current spend + cap
- `GET /v1/account/usage/breakdown?period=day` — by `source` (boardroom / mcp / cortex / embedding)
- `GET /v1/account/usage/alerts?status=active` — outstanding alerts
- `POST /v1/account/usage/alerts/:id/acknowledge` — dismiss

## Phases

- [`../04-roadmap/PHASE-0.25-critical-fixes/`](../04-roadmap/PHASE-0.25-critical-fixes/) — Layer 1 (initial per-user token meter cap) ships in Phase 0.25
- [`../04-roadmap/PHASE-18-resilience-multitenant-fairness/`](../04-roadmap/PHASE-18-resilience-multitenant-fairness/) — full multi-layer enforcement (cap + circuit breaker + reconciliation + UI) ships in Phase 18 (canonical numbering; was tagged "Phase 14" by Builder 4)

Estimated effort: ~1.5-2 weeks (cap enforcement middleware + circuit breaker + UI + price table + alerts).

## Risks

- **False-positive circuit breakers.** A legitimate burst (user uploads a 100-page document for embedding) trips the breaker. Mitigation: the breaker tracks LLM spend, not embedding spend (which is bursty by nature and 100x cheaper); breaker thresholds are tuned in the first weeks against real traffic.
- **Race conditions in the cap check.** Two parallel requests both pass the check before either writes the `LlmUsage` row. Mitigation: idempotency at the cost is acceptable (one extra request slips through is not a security issue); if hard correctness needed, use `SELECT ... FOR UPDATE` on a per-user counter.
- **Anthropic prompt cache accounting drift.** Cache hit rates change unpredictably. Mitigation: log both raw token counts AND cost; reconcile against Anthropic invoices monthly; surface drift > 5% as an operational alert.
- **Plan downgrades stranding users mid-month.** If a Pro user downgrades, they may already be over the new monthly cap. Mitigation: downgrade takes effect at the start of the next billing cycle; current cycle stays at the higher plan.
- **Subscription middleware fails open** (per ADR-010). Cap enforcement does NOT fail open — it fails closed (reject the call). This is a deliberate divergence; communicate clearly in the error response.

## Success metrics

- Zero invoice surprises (monthly Anthropic + OpenAI bills match `LlmUsage` aggregate within ±2%)
- Circuit breaker fires < 1% of months under normal traffic
- ≥ 95% of users approaching their cap acknowledge the warning before hitting it (proxy for UX clarity)
- Median hard-cap recovery time < 24h (i.e., users who hit caps either upgrade or wait it out without escalating to support)
- Zero security incidents involving runaway-loop spend in the first 12 months

## Dependencies on other features

- **Observability suite** (Phase 13) — `LlmUsage` table is shared; usage dashboards are built there
- **Memory MCP server** (Phase 10) — MCP `invoke_persona` calls roll into the same caps
- **Persona marketplace** (Phase 17) — marketplace personas use the same per-tenant budget; tool restrictions in the manifest help bound expected spend
- **Multi-tenant teams** (Phase 18+) — team-level budgets layer on top of per-seat limits
