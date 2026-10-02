# BoardRoom AI + OmniMind — Improvement Research (1–6 month horizon)

**Date:** 2026-10-02 · **Author:** Claude research pass (one researcher agent + orchestrator synthesis) · **Status:** input to Phase 6 planning, not a commitment

Grounded in `.claude/CLAUDE.md`, `PROJECT-BRIEF.md`, `CURRENT-STATE.md`, the 2026-10-02 audit's "Strategic observations", `schema.prisma`, `retrieval/`, `jobs/`, `orchestrator.ts`, `agent.ts`, `omnimind-mcp/`, `eval/`, and `docs/roadmap/`. External claims are linked; the egress proxy blocked arxiv.org, letta.com, mem0.ai, docs.railway.com, modelcontextprotocol.io and neo4j.com, so those are snippet-level and flagged at the end. Bugs found by the audit are not repeated here.

**Shipped the same day from this research:** item 7 (knowledge-graph page) — `GET /graph` + `/graph` page, see CHANGELOG 2026-10-02.

---

## Executive summary — 8 highest-leverage moves (payoff ÷ effort)

| # | Move | Effort | Payoff | One-line rationale |
|---|---|---|---|---|
| 1 | **Prompt-cache a shared "core context" block + upgrade the Sonnet pin** | S | High | Zero `cache_control` exists anywhere in `boardroom-ai/server`; 7 parallel persona calls re-send the same profile/goals every session. Sonnet 5.5 is $2/$10 vs the pinned Sonnet 4.5 ($3/$15): a cost cut and a quality bump in one PR. |
| 2 | **Close the decision loop: numeric forecast at decision time → outcome capture → calibration chart** | S–M | High | `Decision.outcomeRating`, `reviewAt`, `OutcomeReviewNudge`, `OutcomeReviewModal.tsx` already exist; the only missing primitive is a *stated probability* to score against. This is the product thesis made measurable. |
| 3 | **Labeled retrieval eval with recall@k / MRR (roadmap Phase 0.5, pulled forward)** | S | High | `eval-retrieval.ts` scores by title-substring; nothing computes recall@k. Every memory change (decay, ranker, consolidation) is unmeasurable, and the audit found decay silently broke retrieval. |
| 4 | **Independent first round + structured rebuttal + CEO "disagreement ledger"** | M | High | One parallel round then CEO today. 2025–26 debate literature shows sycophantic collapse and "agree more while knowing less"; the fix is protocol, not prompts. |
| 5 | **Per-entity reflection ("ContextCapsule as core memory") on a sleep-time job** | M | High | `ContextCapsule` (summary / openRisks / unresolvedQuestions / staleAfter) is the right shape; it is not generated routinely or injected as an always-present block. This is the Letta/LangMem convergence without MemGPT tiers (DEF-004 stays deferred). |
| 6 | **Railway private networking + nightly pg_dump to R2 + monthly restore drill** | S | Med-High | Two config changes and one template; removes a public hop from every persona call and converts "we have backups" into "we have restored". |
| 7 | **Knowledge-graph page: local graph (depth 1–3) + backlinks panel + filters, canvas-rendered** | M | Med | Shipped 2026-10-02. Next: unlinked mentions + per-entity backlinks on entity pages. The global hairball is the trap; local graph and backlinks are what people use. |
| 8 | **MCP: tool annotations + `structuredContent` + cursor pagination + `memory_reflect`** | S–M | Med | Tools are registered plain, with no annotations, resources or pagination. Cheap conformance wins that make external agents use it correctly. |

Deliberately *not* in the top 8: cross-encoder reranker (DEF-002), MemGPT tiers (DEF-004), feature-flag tables (DEF-007), a graph database (ADR-004). The research supports keeping all four deferred.

---

## 1. Agent memory architecture

**Where the field converged (2025–26):** (a) an always-in-context *core/profile* tier plus retrievable archival memory ([Letta memory blocks](https://www.letta.com/blog/memory-blocks/), [LangMem](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)); (b) write-time consolidation deciding ADD/UPDATE/DELETE/NOOP against near-neighbours ([Mem0](https://github.com/Snseam/awesome-agent-memory/blob/main/papers/mem0-paper.md)); (c) **invalidate, don't delete**, with bi-temporal edges `(valid_at, invalid_at)` plus ingestion time ([Zep/Graphiti](https://arxiv.org/pdf/2501.13956), [overview](https://help.getzep.com/graphiti/getting-started/overview)); (d) background "sleep-time" reflection that turns episodes into learned context, with Letta reporting ~5× less test-time compute for equal accuracy ([paper](https://arxiv.org/pdf/2504.13171), [blog](https://www.letta.com/blog/sleep-time-compute/)); (e) note-level linking and evolution ([A-MEM, NeurIPS 2025](https://arxiv.org/abs/2502.12110)); (f) evaluation on labeled sets with recall@k / NDCG / MRR ([LongMemEval, ICLR 2025](https://arxiv.org/pdf/2410.10813), [MemoryAgentBench](https://github.com/HUST-AI-HYZ/MemoryAgentBench)). Anthropic's API answer is a file-based memory tool plus context editing, reported at +39% on agentic evals combined ([announcement](https://www.anthropic.com/news/context-management)); relevant as a pattern, not a replacement for OmniMind.

**Where OmniMind stands:** `MemoryEntry` has `validAt/invalidAt/supersededBy/version`, `memoryClass {WORKING, EPISODIC, SEMANTIC, DECISION}`, `importance/baseImportance` decay, `recallCount`, cosine dedup at 0.92, a 10-minute session summarizer, and `ContextCapsule`. Roadmap Phases 1–2 add bi-temporal-lite to link tables and the deterministic write loop. The gaps are wiring and use, not schema.

**Recommendations**

- **Core-memory tier as a compiled, cached block [S] [high].** `getCoreContext(userId)` in OmniMind renders UserProfile + top-N active Goals (with linked Projects) + open Commitments due ≤14 days + standing constraints into a deterministic ~1.5–3k-token markdown block (sorted keys, no timestamps). BoardRoom prepends it to every persona's `system` as a `cache_control` block (see §4 for cache minimums). Letta's persona/human block without tiers or self-edit loops; DEF-004 stays deferred. User-visible: personas stop asking for context the user already gave.
- **Temporal validity windows vs decay: keep both, use them for different questions [S] [med-high].** Decay answers "how salient"; `validAt/invalidAt` answers "was this true at time T". Retrieval only applies the forgetting curve today. Add `asOf` to the context request so the CEO/Critic can ask "what did we believe when we made decision D"; default-filter `invalidAt IS NULL OR invalidAt > now()` in all four layers; have the Phase 2 UPDATE path set `invalidAt` + `supersededBy` instead of mutating. **Do not** add a second transaction-time column set: `createdAt/updatedAt` already is the ingestion timeline.
- **Episodic summaries → per-entity reflection job [M] [high].** Extend `ContextCapsule` generation into a nightly Haiku job (Message Batches are 50% off) that, for each Goal/Project/Person touched in the last 7 days, rewrites `summary/openRisks/unresolvedQuestions/recentChanges`, cites `sourceMemoryIds`, sets `staleAfter`. Inject the capsule for entities linked to the current question. Trigger rule from generative-agents reflection: re-reflect only when the summed importance of new memories for that entity crosses a threshold, so cost scales with activity.
- **Consolidation [S, planned]:** keep the Phase 2 deterministic loop + Haiku on boundary cases. Add a provenance row (`consolidatedFrom[]`) on UPDATE so the UI can show "this fact replaced 3 earlier notes".
- **Entity resolution for People [S] [med].** `pg_trgm` similarity ≥0.6 on `Person.name` + email exact match at write time; surface "possible duplicate" in the People page rather than auto-merge. Auto-merge is the trap (irreversible; ministry data makes mistakes sensitive).
- **Retrieval evaluation [S] [high].** Pull roadmap Phase 0.5 forward *before* the 30-day dogfood: 35–50 hand-labeled queries per tenant archetype, gold = memory IDs, metrics recall@5/@10 and MRR, plus LongMemEval slices that matter here (temporal reasoning, knowledge updates, abstention). Run in CI against a seeded Postgres; gate ranker/decay PRs on no regression.
- **Do not:** adopt a graph DB (ADR-004 holds); add a cross-encoder (DEF-002); build MemGPT paging (DEF-004); trust vendor benchmark numbers (Mem0's LoCoMo / LongMemEval scores are self-reported).

---

## 2. Knowledge-graph UX

**What helps thinking vs eye candy.** Obsidian users split sharply: the *global* graph is widely called screenshot bait because layout is non-deterministic and dense ([critique](https://knodegraph.com/blog/obsidian-graph-view-alternative/), [forum](https://forum.obsidian.md/t/whats-the-point-of-the-graph-view-how-are-you-using-it/71316)), while the *local* graph with a depth slider, hover highlight, and backlinks / unlinked-mentions panels are what people use ([Obsidian help](https://obsidian.md/help/plugins/graph)). Tana / Heptabase / Notion win through typed structure and spatial sense-making, not force layouts. Linear's Insights is a faceted aggregate view: filters and counts beat hairballs.

**Ranked feature list**

1. Entity page with backlinks panel [S] [high] — SQL over link tables + `MemoryEntityLink`. *(Inspector in the graph page ships a first version.)*
2. Unlinked mentions (memories whose text contains a Person/Project name but no link, one-click "link") [S] [high] — `pg_trgm`/ILIKE; doubles as entity-resolution UX.
3. Local graph, depth 1–3, rooted at the selected entity [M] [high] — *shipped.*
4. Type/tenant/status filters + color-by-type with legend as filter [S] [med] — *shipped.*
5. Search-to-focus [S] [med] — *shipped.*
6. Time scrubber on `validAt/invalidAt` + `createdAt` [M] [med] — unique to a bi-temporal store; defer until 1–3 are used.
7. Orphans / stale view [S] [med] — *orphans toggle shipped; stale (capsule `staleAfter`) pending.*
8. Global graph [M] [low] — ship last, capped; *shipped capped at 500 memories.*

**Interaction rules that make Obsidian feel right:** hover highlights the 1-hop neighbourhood and fades the rest to ~12–15%; radius ∝ √degree, clamped; click pins and opens backlinks; depth slider 1–3 with faded rings by distance; search focuses and zooms; freeze the simulation after ~200–300 ticks; labels only above a zoom threshold or for hovered/pinned nodes; respect `prefers-reduced-motion`. *(All implemented in `components/graph/KnowledgeGraphView.tsx`.)*

**Implementation choice:** `react-force-graph-2d` (canvas, d3-force underneath, MIT) — *adopted.* Sigma.js/graphology is the step up past ~10k nodes; cytoscape brings an algorithm suite this product does not need. Gzipped sizes were not verifiable through the proxy.

---

## 3. Decision-intelligence product moves

Each loop is one primitive short of closing.

| Ritual | Already have | Minimum addition | Effort / payoff |
|---|---|---|---|
| **Decision journal with outcome review** ([Duke / Farnam Street](https://readcrucible.com/articles/decision-journals-the-practice-the-science-the-templates)) | `Decision{chosenPath, rationale, reviewAt, outcome, outcomeRating}`, `DecisionAssumption{confidence}`, `OutcomeReviewNudge`, `OutcomeReviewModal` | Add `expectedOutcome` (text) + `probabilitySuccess` (0–1) captured at commit time, mandatory in the CEO brief flow; the review modal shows the original prediction before asking for the rating. Separates decision quality from "resulting". | S / high |
| **Calibration tracking** ([Brier / reliability](https://www.convexly.app/answers/how-to-measure-forecasting-calibration)) | Persona `confidence: number`; assumption confidence categorical | Store numeric forecasts (user and each persona). After ≥20 reviewed decisions show a reliability diagram + Brier score per persona and for the user; feed "Critic is over-confident on hiring" into the weekly memo. Unblocks DEF-001. | S–M / high |
| **Pre-mortem** ([Klein](https://en.wikipedia.org/wiki/Pre-mortem)) | Critic persona, `cortex-simulation` | A `premortem` mode: Critic + Technician + Questionnaire prompted in past tense ("it is six months later and this failed"), output Zod-validated into `DecisionAssumption` rows with `reviewAt`. No new models. | S / high |
| **"What changed since last time"** | `ContextCapsule.recentChanges`, bi-temporal columns, `version` | A diff endpoint: for a re-opened question/entity, return memories/decisions/commitments created or invalidated since the last session on that entity; first card in the session. | M / med-high |
| **Commitment follow-through nudges** | `Commitment{deadline,status}`, weekly digest | Daily SQL-only job: commitments due ≤3 days or overdue → digest/email and Doer context ("you promised X to Y"). Highest-trust feature for a pastor. | S / high |
| **Weekly review ritual** | `WeeklyMemo`, patterns, contradictions | Make the memo interactive: accept / dismiss / snooze per item, written back as a memory with provenance, plus the one calibration question of the week and "decisions awaiting review". | S / med |

**Do not:** build a generic "decision quality score" before calibration data exists; build Monte-Carlo simulation UIs before pre-mortem and outcome capture are habitual.

---

## 4. Persona quality

**Evidence:** sycophancy collapses debates into premature consensus and can underperform single agents ([Peacemaker or Troublemaker](https://arxiv.org/abs/2509.23055v1)); multi-agent discussion erased up to 72% of issue-critical facts while stances homogenized ([Deliberative Illusion](https://arxiv.org/abs/2606.03032)); identity cues bias who gets deferred to ([anonymization](https://arxiv.org/pdf/2510.07517)); distinct personas alone do not yield divergent reasoning unless paired with distinct reasoning strategies ([survey](https://arxiv.org/html/2607.26212v1)). Intervention details are from abstracts (arxiv blocked).

- **Protocol over prompts [M] [high].** Round 1 stays independent and parallel (your anti-sycophancy asset). Add an optional Round 2 *only for personas whose `dissentFlag` is set or whose recommendation conflicts with the majority*: they receive the other outputs **anonymized** ("Advisor A/B") and must defend or concede with a reason. The CEO receives a machine-built **disagreement ledger** (claim, who holds it, which facts each side cited) and must address each row. Add a fact-survival check: facts cited in Round 1 `sourceMemoryIds` that vanish from the CEO brief are listed as "dropped considerations".
- **Persona-specific retrieval [S] [med].** Per-persona query rewriting before hybrid search (Critic: "risks, failures, past mistakes about X"; Doer: "tasks, deadlines, commitments about X"); give the Critic `includeArchived` plus `memoryClass=DECISION` memories with poor `outcomeRating`. Different evidence is the cheapest way to keep stances different.
- **Distinctiveness evals [S] [med].** Extend `eval-personas.ts` with pairwise embedding cosine between persona outputs (alert if median > ~0.85, calibrate), a sycophancy probe (inject a confident wrong consensus into Round 2, measure flip rate), and rubric scoring. Track per model upgrade.
- **Cost control [S] [high].** No `cache_control` exists; add a stable prefix `[persona system prompt] + [core context block]` with `cache_control: {type: "ephemeral"}`. Minimum cacheable prefix is 4,096 tokens on Haiku 4.5 and 1,024 on Sonnet 4.6 / 512 on Sonnet 5.5 ([docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)); verify with `usage.cache_read_input_tokens`. Put the shared core block first and identical across personas so all 7 calls share one cache entry. Upgrade the Sonnet pin (code pins `claude-sonnet-4-5-20250929`): no assistant prefill, no forced `tool_choice`, adaptive thinking instead of `budget_tokens`; grep before flipping. Use Message Batches for all cortex jobs and reflection.
- **Do not:** run a full 7-persona Round 2 every session; let personas see each other's named outputs; add "be contrarian" instructions as the fix.

---

## 5. Operational maturity for one person

- **Observability [S–M] [med-high].** OTel Node auto-instrumentation (http, express, prisma) + pino → OTLP to **one** backend. Free tiers as of 2026: Grafana Cloud 50 GB logs/traces, 14-day retention; Honeycomb 20M events/mo, 60-day; Axiom personal 500 GB/mo, 30-day ([comparison](https://pydantic.dev/articles/best-opentelemetry-backends), [Axiom](https://axiom.co/pricing)). Propagate `traceparent` across the seam (you already carry `x-request-id`). Five alerts, no more: health down ×2, persona p95 > 20s, cortex job failed, embedding outbox depth, daily LLM spend > budget.
- **LLM cost dashboard [S] [med].** Anthropic Admin API exposes usage and cost reports plus spend limits ([usage/cost](https://platform.claude.com/docs/en/manage-claude/usage-cost-api), [limits](https://platform.claude.com/docs/en/manage-claude/spend-limits-api)). Weekly cron pulls both + OpenAI usage into the digest; log `usage.*` per persona call to an `LlmUsage` table.
- **Railway private networking [S] [med].** `OMNIMIND_API_URL=http://omnimind-api.railway.internal:3333` (http, not https); bind OmniMind to `::` for IPv6 ([docs](https://docs.railway.com/private-networking), snippet-verified only).
- **Backups you have restored [S] [high].** Nightly `pg_dump -Fc` to Cloudflare R2 via a cron service ([template](https://github.com/Kjudeh/railway-postgres-backups)); monthly `pg_restore` into a throwaway Postgres with a row-count check and a `/context` smoke query, dated in `docs/03-operations`. Include `ENCRYPTION_KEY` in the drill.
- **Feature flags [S] [low-med].** Keep env-var flags (DEF-007). If runtime toggles are needed, a `Setting(key,value)` row behind a 30s cache and a `getFlag()` helper, so OpenFeature can slot in later.
- **Do not:** self-host Grafana/Loki/Tempo; run Sentry *and* an OTel backend; build a custom admin dashboard before saved queries prove insufficient; enable Redis for rate limiting on a single instance.

---

## 6. MCP layer

**What better memory servers do** ([comparison](https://getunblocked.com/blog/memory-mcp-servers-compared/), [mcp-memory-service](https://github.com/doobidoo/mcp-memory-service)): scope by user/agent/session, temporal validity on facts, Markdown as source of truth with an extracted graph, "dream" consolidation as tools, and spec conformance: tool annotations, `structuredContent`/`outputSchema`, cursor pagination, resources and prompts ([spec 2025-11-25 tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)).

1. **Annotations + structured output [S] [med-high].** `annotations: {readOnlyHint, destructiveHint, idempotentHint, openWorldHint}` on all 15 tools; `outputSchema` + `structuredContent` from the Zod schemas already in `@boardroom/shared`.
2. **Idempotency keys on writes [S] [high for agents].** `memory_write`, `task_upsert`, `decision_log`, `commitment_log` accept an optional `idempotencyKey`; OmniMind stores `(agentId, key) → resultId` for 24h. Agents retry; 0.92-cosine dedup is not a guarantee.
3. **Pagination [S].** `task_list`, `commitment_list`, `memory_search` return `nextCursor`; cap page size at 20.
4. **Route `memory_search` through hybrid retrieval [S] [high].** The tool queries `GET /memories` (substring + tags); external agents never get semantic/FTS/trigram or the forgetting curve. Switch it to `/context`-style hybrid search, or add a `mode` parameter.
5. **`memory_reflect` / `memory_consolidate` tools [M] [med].** Scope-gated, rate-limited, audited; long-running work goes through the job queue and returns a job id.
6. **Resources, narrowly [S–M] [med].** `omnimind://{tenant}/status`, `/goal/{id}` (capsule), `/person/{id}`, `/graph/{entityId}?hops=2`. Keep a `graph_neighborhood` tool as the universal path since resource support varies by client.
7. **Prompts [S] [low-med].** `session_start`, `decision_review`, `session_end` encode the dogfooding rules from CLAUDE.md for every client.
8. **Do not:** expose the whole graph as one resource; add `memory_delete` (keep invalidate/supersede); mirror all 15 tools as resources; run Sonnet synchronously inside a tool call.

---

## Flags / unverified

- Gzipped bundle sizes for react-force-graph-2d / sigma / cytoscape not verified (bundlephobia blocked); unpacked npm sizes only.
- *Deliberative Illusion* and *Peacemaker or Troublemaker* findings are from abstracts.
- Railway private-networking IPv6/dual-stack dates and MCP 2025-11-25 field names are from search snippets.
- Mem0/Zep benchmark numbers are vendor-reported.
- Free-tier limits for Grafana / Honeycomb / Axiom change often; re-check before choosing.
