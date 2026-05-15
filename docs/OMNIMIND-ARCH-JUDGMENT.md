# OmniMind Master Architecture — Three-AI Debate, Validation, and Judgment

**Author:** Claude (Opus) acting as principal architect
**Date:** 2026-04-10
**Context:** Josh requested research, debate, validation, and a final judgment across three competing AI-authored architecture blueprints for OmniMind — Gemini, OpenAI Codex, and Minimax — to define the dev path forward.

---

## 0. Framing: The Judgment Is Not Greenfield

The critical fact none of the three AI proposals were given: **OmniMind already exists in production**. Both services are deployed on Railway, Phases 0 and 1 are complete, the Prisma schema has 32 models, the custom agent runtime is shipping, and the 7-persona system is live. Any recommendation that requires burning down what's built is not a recommendation — it's a rewrite proposal, and rewrites are evaluated on an entirely different axis than greenfield designs.

This reframes the question from *"which blueprint is best in the abstract?"* to *"which blueprint best describes the system already in flight, and what should be grafted on for Phases 2–4?"*

---

## 1. The Three Proposals — Compressed Fingerprints

### 1.1 Gemini — "The Agentic Pretender"

**Core thesis.** Memory is the moat. Deterministic orchestrator + governed memory. "Add, don't subtract." Memory proposals validated by Zod before persistence.

**Stack recommendation.** Turborepo + Next.js 15 + Fastify + Postgres/pgvector/pg_trgm + Claude Sonnet + Haiku + **MCP tool execution in Docker sidecars** + Clerk/Auth0 for auth.

**Pattern chosen.** Pattern C — Monolithic Orchestrator + Governed Memory. Rejects LangChain (Pattern A) and Kafka-style event micro-agents (Pattern B).

**Best original ideas.**
- **Memory Confidence Decay.** Unverified AI-inferred memories start at confidence 0.5; decay and prune after 30 days unless conversationally re-verified. This is the most valuable single idea across all three docs.
- **Context Sufficiency Scoring** (0.0–1.0) with max-3 clarifying questions when below 0.5.
- **Source weighting** (human=1.0, AI=0.5) on every fact.
- Adversarial self-critique naming "data rot" as the hidden failure mode of proposal-based writes — UX laziness kills the whole scheme.

**Weak spots.**
- Picks **MCP** for tool execution, which directly contradicts the current code's ADR-008 (native `tool_use`).
- Recommends **Fastify** and **Next.js**, which are not what's built (Express + React SPA).
- 22-week roadmap is a greenfield fantasy; Josh has already burned most of it building what exists.
- "Omin Mind" typo throughout suggests it never grounded itself in the real product name.

### 1.2 OpenAI Codex — "The Enterprise Platform"

**Core thesis.** Separate thinking, remembering, and acting into independent layers with a deterministic policy-governed runtime that orchestrates multiple models and tools under strong observability and tenant isolation. SOC 2 first, ISO 27001 later.

**Stack recommendation.** Multi-provider model routing with hard-constraint PDP. Capability microservices (runtime-core, model-orchestrator, memory, tool-broker, policy, eval). **Central PDP + distributed PEP** pattern. mTLS + SPIFFE/SPIRE workload identities. Immutable audit journal with hash chain. SLSA build provenance, Sigstore artifact signing, SBOMs. OpenTelemetry everywhere. Terraform + K8s.

**Pattern chosen.** Pattern C (Workflow-first deterministic core + bounded agentic enclave) *implemented on* Pattern B (capability microservices).

**Best original ideas.**
- **8-layer cognitive stack** (Experience → Orchestration → Reasoning → Memory → Tools → Policy → Eval → Ops) with explicit build-vs-buy per layer.
- **Tiered autonomy levels** (L0 deterministic, L1 assisted, L2 bounded autonomous) — clean mental model for letting agentic behavior earn trust incrementally.
- **Policy-as-code separation** (PDP central, PEP distributed at gateway + orchestrator + tool broker + egress).
- **Signed ActionReceipts** for every side effect, cross-checked against assistant claims to detect hallucinated actions.
- **Eval-gated releases** as a hard CI requirement, not optional.

**Weak spots.**
- **Premature enterprise hardening.** SOC 2, multi-region HA/DR, SPIFFE, SBOMs, and a central PDP service before 10 paying customers is exactly the anti-pattern it claims to avoid in its own "over-engineered" self-critique.
- **Multi-provider routing from day one** contradicts the reality that single-provider discipline is a feature, not a bug, until you have enough traffic to triangulate quality differences with real data.
- Capability microservices at this stage forces a rewrite of what's deployed and will crush delivery velocity.
- 64+ week roadmap assumes a 4–5 person platform team. Josh is functionally a solo founder with a build agent.
- Treats Omin Mind as a platform-for-platforms problem when the product is currently an app for solo founders.

### 1.3 Minimax — "The Disciplined Indie Build"

**Core thesis.** Memory truth precedes reasoning quality. The user is the authority, always. Visibility enables trust. Operational discipline before sophistication. Cost is a first-class architectural constraint. Security is not a feature.

**Stack recommendation.** Turborepo/pnpm + Next.js client + Next.js API routes + PostgreSQL with `pgvector`, `pg_trgm`, `tsvector`, `unaccent` + Redis (Upstash) for distributed rate limit + Claude Sonnet 4 + Haiku 4 + Voyage AI or OpenAI embeddings + Railway deployment.

**Pattern chosen.** Pattern B — **Coordinated Prompt Assembly** (custom ~200–500 LOC runtime), with explicit rejection of LangGraph/AutoGen/CrewAI. Modular monolith now; service extraction only when a specific operational or product requirement demands it.

**Best original ideas.**
- **7-layer architecture** (Identity/Isolation → Policy/Guardrails → Memory Storage → Memory Substrate → Persona Engine → Session/Dialogue → Executive Interface) — each layer has defined responsibilities, failure modes, security concerns, scaling concerns, and explicit build-vs-buy.
- **`FORCE ROW LEVEL SECURITY`** with tests run against the low-privilege app role, not the DB owner. Calls out the exact mistake most teams make.
- **Citation verification gate** — every synthesis claim that cites a memory is verified against the actual memory content before serving. Closes the hallucinated-citation loop.
- **Confirmation-rate feedback loop** — auto-tune the memory confidence threshold based on observed user confirmation rates (target 60% confirmation, <5% error on auto-confirmed).
- **Structural output requirements per persona** — each persona must produce specific named sections (e.g., Critic: biggest fragility → historical evidence → failure mode → "what would have to be true"). This forces differentiation structurally rather than stylistically.
- **Concrete migration triggers** on every ADR (e.g., "migrate from pgvector at 500K vectors OR p95 retrieval latency >500ms").
- **Explicit critical path identification** in the roadmap — "weeks 1–4 are critical path, week 5 is polish, everything else can slide 1–2 weeks."
- **Memory is not the moat — accumulated decision-grade understanding is.** Refined thesis after self-attack.

**Weak spots.**
- Recommends **Next.js API routes** instead of a separate Express API service, which is less robust than the two-service split Josh actually has (BoardRoom + OmniMind).
- Recommends **Voyage AI** embeddings when Josh has already committed to OpenAI `text-embedding-3-small` (ADR-011).
- Suggests a single monorepo service; Josh has correctly split data ownership into two services, which is architecturally superior for the long run.
- Like the others, doesn't know about the existing two-service boundary, the shared package pattern, or the specific tech debt list in FRAGILE-ZONES.

---

## 2. Validation Against Reality — What's Actually Built

| Architectural axis | Gemini says | Codex says | Minimax says | What's actually built | Verdict |
|---|---|---|---|---|---|
| Agent orchestration | Custom runtime | Workflow engine + enclave | Custom ~200 LOC | Custom ~200 LOC (ADR-001) | **Minimax matches** |
| LLM provider strategy | Anthropic only | Multi-provider routing | Anthropic only (Sonnet + Haiku) | Anthropic only (ADR-002) | **Minimax + Gemini match** |
| Primary datastore | Postgres + pgvector + pg_trgm | Relational + vector + object + graph | Postgres + pgvector + pg_trgm + tsvector | Postgres 16 + pgvector + pg_trgm + tsvector (ADR-003) | **Minimax exact match** |
| Embeddings | 1536-dim | Generic | 1024-dim Voyage | OpenAI 1536-dim (ADR-011) | **Gemini closest on dimension** |
| Service topology | Monolithic orchestrator | Capability microservices | Modular monolith | Two-service split (BoardRoom UX + OmniMind data) | **Nobody got it exactly — reality is between Minimax and Codex** |
| Tool execution | **MCP sidecar** | Sandboxed workers + signed receipts | Permitted-tool list per persona | Native Anthropic `tool_use` content blocks (ADR-008) | **Minimax closest; Gemini wrong** |
| Memory writes | Proposal + Zod validation | Proposal + provenance + trust score | Proposal + validation pipeline | Validation pipeline: Zod → temporal → budget | **All three agree with reality** |
| Background jobs | Unspecified | Queue workers + event bus | Redis + Upstash + batch cron | node-cron, no Redis (ADR-009) | **Reality simpler than all three** |
| Auth model | Clerk/Auth0 | mTLS + SPIFFE + ABAC | JWT + Argon2id + `FORCE RLS` | JWT httpOnly + API key + timing-safe compare | **Minimax closest** |
| Per-persona context | Differentiated by tag | Retrieval plan | Differentiated slices + structural output | 7–10 items packaged by `context-packager.ts` | **All aligned** |
| Roadmap realism | 22 weeks, greenfield | 64+ weeks, 5-person team | 5-week critical path, phased | Phases 0–1 shipped, Phase 2–4 spec'd | **Minimax matches phase cadence** |
| Compliance posture | Light | SOC 2 first, ISO later | Deferred to v2+ | Deferred (known limitation) | **Minimax matches Josh's stage** |
| Knowledge graph | Deferred | Phase 3+ optional | Deferred until 500+ memories/user | Deferred (ADR-004) | **All three aligned** |

**Scorecard.** Minimax aligns with the current build on **9 of 13** axes. Gemini aligns on **5 of 13** (and is actively wrong on 2). Codex aligns on **3 of 13** and would force a rewrite on at least 5.

This is not a coincidence. Minimax asked the right primary question — *"what is the correct architecture for a disciplined solo indie builder shipping a thinking tool?"* — and therefore landed on the same answers Josh's codebase already embodies.

---

## 3. The Debate — Where the Three Disagree and Who Wins

### 3.1 Custom runtime vs agent framework

- **Gemini:** custom runtime, roughly 200 LOC, reject frameworks.
- **Codex:** workflow engine for deterministic core + bounded agentic enclave for complex tasks. Doesn't commit to custom vs framework explicitly, but leans framework-ish (LangGraph-style typed state machines).
- **Minimax:** custom runtime, schema-first contracts, explicit self-critique against its own recommendation and defends it — "the real risk is not framework vs. custom, it's discipline vs. mess."

**Winner: Minimax.** The attack-and-defend framing is the decisive move. Frameworks don't give you discipline; they give you opinions. The custom runtime with typed Zod contracts at every function boundary is better than LangGraph without them. Josh already took this path; the code proves it's working.

**Caveat.** Minimax is right only as long as the runtime stays ~200 lines. The moment it grows branching logic for mode routing, persona-specific error handling, and multi-step tool chains past ~600 lines, the framework attack becomes valid again. Track runtime LOC as a health metric.

### 3.2 Single vs multi-provider LLM routing

- **Gemini:** Anthropic only. Maximize prompt caching and tool use boundaries. Admit platform risk and add a "degraded mode" UI fallback.
- **Codex:** Multi-provider from start with hard-constraint routing matrix. Never lock in.
- **Minimax:** Anthropic only for v1–v2, behind an `LLMProvider` adapter interface. Concrete re-evaluation trigger: "reevaluate at 5,000+ paying users or if Anthropic quality/cost deteriorates."

**Winner: Minimax.** Multi-provider routing from day one is a solution to a problem Josh does not yet have. It adds an entire abstraction layer, fragments prompt caching, and creates behavioral inconsistency between personas depending on which provider served them. The correct posture is: single provider, clean adapter interface, bail to a fallback only if primary degrades. This matches ADR-002.

**Codex's attack has a valid kernel.** Vendor concentration risk is real. Mitigation: keep `anthropic.ts` client behind a narrow interface, never leak provider-specific types into personas/orchestrator. Gemini's "degraded read-only mode" UI is a cheap addition worth adopting.

### 3.3 Memory writes — proposal-based or direct?

All three agree: LLMs never write directly; they propose. User or policy confirms.

**Unanimous. Already implemented.**

The remaining debate is *UX friction vs data integrity*. Gemini names "data rot" as the fatal flaw — users won't review proposals, so the queue grows unreviewed, and the system either ignores unreviewed memories (wasting work) or ingests them (poisoning). Minimax proposes auto-confirm high-confidence extractions with a visible "Memory Inbox" and threshold auto-tuning. Codex proposes provenance + trust scoring + retention class.

**Synthesis move.** Adopt all three:

1. **Every memory carries provenance + confidence** (Minimax + Codex).
2. **High-confidence extractions auto-confirm with an undo grace window** (Minimax).
3. **Confidence decay for unused memories** (Gemini) — unverified AI-inferred memories decay unless conversationally re-verified.
4. **Conversational verification** — the CEO persona occasionally surfaces quiet verification prompts like "you mentioned Q3 — still the target?" (Gemini).
5. **Confirmation-rate feedback loop** — if confirmation rate drops below 50%, auto-tune the auto-confirm threshold (Minimax).

This is the single most important synthesis across the three docs. None of the three alone solves it.

### 3.4 Microservices vs modular monolith vs two-service split

- **Gemini:** monolithic orchestrator + separate async memory curator service.
- **Codex:** capability microservices, 7+ services eventually.
- **Minimax:** modular monolith in one deployment, split by load/risk profile later.
- **Reality:** two-service split (BoardRoom = UX + orchestration; OmniMind = data + validation + retrieval + cortex jobs).

**Winner: reality.** Josh already landed on the correct answer for this stage — a **two-service split organized around data ownership**, not capability boundaries. BoardRoom owns nothing durable; OmniMind owns everything durable. This is cleaner than Gemini's monolith (easier to harden the data plane independently) and radically cheaper than Codex's 7 services (no inter-service contract overhead on 6 boundaries that don't need to exist yet).

**Keep doing this.** The inviolable rule — *BoardRoom never touches the DB directly* — is the correct long-run constraint.

### 3.5 Tool execution — MCP vs native `tool_use` vs sandboxed workers

- **Gemini:** MCP with Docker sidecars.
- **Codex:** sandboxed worker pods + signed ActionReceipts.
- **Minimax:** plain TypeScript tools registered per-persona with permission matrix.
- **Reality:** native Anthropic `tool_use` blocks, tools = plain TS functions (ADR-008).

**Winner: reality / Minimax.** MCP is a cross-process protocol designed for decoupling tool providers from model hosts. Josh is the tool provider AND the model host, so MCP's value proposition collapses. Native `tool_use` is one function call boundary and one Zod schema. MCP would triple the surface area and invite the cross-process serialization bugs that FRAGILE-ZONES.md already warns about.

**Steal from Codex:** the concept of **signed ActionReceipts** is worth grafting on when Phase 3 integrations land (Calendar, Gmail, Stripe) — every side-effecting tool call returns a receipt that includes payload hash, actor, timestamp, and outcome. This is how you detect hallucinated actions without paying MCP's price.

### 3.6 RLS and tenant isolation

- **Gemini:** Postgres RLS eventually.
- **Codex:** tenant-scoped encryption keys, ABAC + RBAC, partition keys, cross-tenant canaries.
- **Minimax:** `FORCE ROW LEVEL SECURITY` on day one, tested with low-privilege app role (not owner), automated cross-user IDOR tests.

**Winner: Minimax, by a wide margin.** This is the single most common security failure mode in multi-user Postgres apps. The current Prisma schema uses `userId` foreign keys and application-level filtering, which is adequate for a single-user-per-session product but will break the moment Phase 4 multi-user lands. **Adopt Minimax's RLS stance now, before Phase 2 ships any new memory tables, so the security invariant is baked in before the collaborative layer is even designed.**

### 3.7 Compliance posture

- **Gemini:** silent.
- **Codex:** SOC 2 first, ISO 27001 later, SLSA + Sigstore + SBOM from day one.
- **Minimax:** defer compliance to v2+.

**Winner: Minimax.** Josh has zero enterprise customers. SOC 2 costs $30K–$80K and 6+ months. It is not what creates the product. Defer until a single paying enterprise customer asks for it, then run the audit in parallel with their pilot. Codex's advice is correct for a funded Series A platform and catastrophically wrong for this stage.

**Caveat.** Audit logging is not compliance — it's engineering hygiene. Adopt **immutable append-only audit log with hash chain** (Codex/Minimax both want this) as part of Phase 2, not as compliance theater but because it's how you debug production incidents without a monitoring tool.

---

## 4. What Each Proposal Gets Uniquely Right (The Steal List)

### 4.1 Steal from Gemini

1. **Memory Confidence Decay** — unverified AI-inferred memories decay and prune after 30 days unless re-verified conversationally. *High-value, low-effort.*
2. **Context Sufficiency Scoring with max-3 clarifying questions** when score < 0.5. (Josh already has `sufficiency-check` as a specialized persona — productize this into the main dispatch path.)
3. **Degraded read-only mode** when OmniMind or Anthropic is unreachable, with explicit user-facing messaging.
4. **Source weighting** on facts (human=1.0, agent=0.5) as a first-class field.
5. **Conversational verification prompts** woven into CEO synthesis ("you mentioned X earlier — still true?") instead of a sterile review dashboard.

### 4.2 Steal from Codex

1. **Signed ActionReceipts** for every side-effecting tool call (Phase 3, Calendar + Gmail + Stripe).
2. **Immutable append-only audit log with hash chain** for policy decisions, memory writes, and persona outputs. Ship in Phase 2.
3. **Tiered autonomy model (L0/L1/L2)** as a mental model for how tool autonomy earns trust over time.
4. **Eval-gated releases** as a CI requirement — retrieval MRR must not drop >5%, persona distinctiveness must not degrade, token cost per session variance must stay within 15%.
5. **Cost governance as architecture** — per-tenant cost caps with hard stops, near-real-time metering, weekly reconciliation against actual API billing.
6. **OpenTelemetry trace envelope** across BoardRoom → OmniMind so you can reconstruct a full session after the fact.

### 4.3 Steal from Minimax

1. **`FORCE ROW LEVEL SECURITY`** tested with a low-privilege app role. Bake into Phase 2 before adding new memory tables.
2. **Citation verification gate** — every synthesis claim that cites a memory is verified against the actual memory content before serving. Defeats hallucinated citations.
3. **Confirmation-rate feedback loop** — auto-tune auto-confirm thresholds based on real confirmation data.
4. **Structural output requirements per persona** — force each persona to produce named sections (Critic must produce "biggest fragility" → "historical evidence" → "failure mode" → "what would have to be true"). This is stronger than relying on system prompts to enforce differentiation.
5. **Concrete migration triggers on every ADR** — not "we'll revisit later" but "migrate at 500K vectors OR p95 >500ms." Update DECISIONS.md to match.
6. **Memory growth rate + memory health score** surfaced in the dashboard as an explicit KPI.
7. **Explicit critical-path identification** on every phase — "weeks 1–4 are critical path, everything else can slide."

---

## 5. Blind Spots None of the Three Caught

These are the structural gaps no single AI found, surfaced by comparing all three against reality.

1. **Two-service split ownership.** None of the three correctly intuited that the right boundary is *data ownership*, not capability or microservice. Keep defending the BoardRoom ↔ OmniMind wall.
2. **The `@boardroom/shared` package as the single source of truth.** Turborepo monorepo + shared Zod schemas is the exact mechanism that makes custom runtime sustainable past 1K LOC. Without this, Minimax's custom runtime defense falls apart. Codex hinted at it, Gemini missed it.
3. **Prompt files as first-class artifacts in `docs/prompts/*.system.md`.** All three treated prompts as strings inside code. Extracting them into markdown files loaded at runtime is a bigger win than any of them noticed — it lets non-engineers tune personas without a deploy.
4. **Soft deletes as a persona truth preservation mechanism.** `deletedAt DateTime?` is already in the schema, but none of the proposals surfaced *why* it matters: it preserves the audit trail of what the system "once believed" even after a user corrects or deletes, which is exactly what prevents memory corruption from being irrecoverable.
5. **The CEO-runs-last pattern.** The specific architectural move of having one persona see all other outputs before synthesizing is not in any of the three blueprints. This is actually the product's differentiator and deserves its own ADR documenting *why*.
6. **In-memory rate limiting is a time bomb.** FRAGILE-ZONES.md already flags this but none of the proposals addressed it specifically. The first multi-instance deploy will quietly break per-user cost caps. Adopt Minimax's Upstash Redis suggestion when Phase 4 multi-instance lands — not before, but don't forget.
7. **Subscription middleware fails open.** Currently a known limitation. Codex would call this a critical security drift; it's worth a targeted fix in Phase 3 alongside Stripe billing integration.

---

## 6. The Final Judgment — Recommended Dev Path Forward

### 6.1 Architectural decision

**Adopt Minimax as the canonical architecture doc for OmniMind going forward.** It describes the system Josh actually built more accurately than the other two, and its failure modes and self-critique are the most intellectually honest. Upgrade the existing MASTER-FRAMEWORK.md by grafting in the 7-layer model (Identity → Policy → Memory Storage → Memory Substrate → Persona Engine → Session → Interface).

**Reject Codex's enterprise path wholesale for v1–v3.** It is correct advice for a different company and a different stage. Keep the document as a reference for v4+ enterprise hardening.

**Treat Gemini as a source of discrete ideas, not a blueprint.** Its single best contribution — memory confidence decay + conversational re-verification — is more valuable than Codex's entire document, but its stack recommendations are wrong for the existing code.

### 6.2 The "Build This Next" sequence for Phase 2 (Cortex Intelligence)

In priority order, highest leverage first:

1. **Lock in `FORCE ROW LEVEL SECURITY`** on all tenant-scoped tables and write an automated test that queries as a low-privilege app role. *Half day. Phase 2 entry gate.*
2. **Memory confidence + source weighting** — add `confidence` and `sourceWeight` columns to `MemoryEntry`, propagate through the validation pipeline and retrieval ranker. *2 days.*
3. **Confidence decay job** — new node-cron task in OmniMind: sweep unverified AI-inferred memories older than 30 days with zero retrieval hits and mark them `supersededAt`. *1 day.*
4. **Citation verification gate** — in the CEO synthesis path, before streaming the final response, verify every `memoryId` citation resolves and contains substrings from the claim. If verification fails, regenerate once; if it fails twice, strip the citation and flag. *2–3 days.*
5. **Structural output requirements in persona prompts** — update each of the 7 system prompts in `docs/prompts/*.system.md` to enforce named sections (Critic: fragility → evidence → failure mode → "what would have to be true"). Add a Zod schema per persona output type. Measure persona overlap score as a release gate. *3–5 days.*
6. **Confirmation-rate feedback loop** — log `memoryProposal.autoConfirmed` events, measure confirmation rate weekly, auto-tune the auto-confirm confidence threshold. *2 days.*
7. **Conversational verification prompts** — have the CEO persona weave quiet verification of stale/decaying facts into its synthesis ("I notice you mentioned X earlier — is that still accurate?"). *3 days of prompt engineering + eval.*
8. **Append-only audit log with hash chain** for all policy decisions, memory writes, and persona outputs. *2 days.*
9. **OpenTelemetry tracing across the BoardRoom ↔ OmniMind boundary** with correlation IDs that survive the SSE stream. *3 days.*
10. **Degraded read-only mode** when OmniMind is unreachable — serve last-synthesis from cache, banner the UI, queue memory writes for replay. *2 days.*

That sequence makes Phase 2 defensible, debuggable, and trustworthy — without touching the existing service boundaries or picking a fight with any of the 13 ADRs.

### 6.3 Phase 3 additions (Integrations + custom personas)

- **Signed ActionReceipts** on every Calendar / Gmail / Stripe side effect.
- **Tool permission matrix per persona** (Technician can call calculator, Doer can call calendar, Critic cannot call anything that writes). Ship before the first integration.
- **Tiered autonomy ladder** — L0 (read-only, current state) → L1 (propose action, user confirms) → L2 (execute low-risk action autonomously with receipt). Most Phase 3 tools stay at L1.
- **Per-tenant cost caps with hard stops** — required before Stripe billing, not after.

### 6.4 Phase 4+ re-evaluation triggers

Do **not** do any of the following until an explicit trigger fires:

| Decision | Trigger |
|---|---|
| Migrate off pgvector | 500K+ vectors OR p95 retrieval >500ms sustained |
| Add a second LLM provider | Anthropic reliability <99.5% sustained OR 5,000+ paying users |
| Split OmniMind into capability microservices | 5+ engineers on the team OR single-service deploy latency >2s p95 |
| SOC 2 audit | First enterprise prospect with >$5K/mo contract requires it |
| Upstash Redis for rate limiting | Second service instance ships (multi-instance) |
| Add a knowledge graph | 500+ memories/user average OR retrieval precision plateaus below 80% |
| Adopt MCP | v2 platform migration OR third-party tool marketplace requirement |

### 6.5 The one ADR that needs writing now

**ADR-014: The CEO-Runs-Last Pattern.** None of the three AIs independently surfaced this as the product differentiator. It deserves formal documentation so future refactors don't accidentally parallelize the CEO persona alongside the others and destroy the synthesis quality.

---

## 7. What Josh Should Not Do

1. **Don't rewrite to capability microservices.** Codex's vision is correct for 2028-Josh, not 2026-Josh.
2. **Don't adopt MCP.** ADR-008 was right. MCP solves a decoupling problem you don't have.
3. **Don't add a second LLM provider.** Wait for the trigger in 6.4.
4. **Don't chase SOC 2 preemptively.** Wait for a paying enterprise customer to ask.
5. **Don't replace the custom runtime with LangGraph or CrewAI.** Watch the LOC counter instead — the moment it crosses 600 lines, refactor the internals, don't adopt a framework.
6. **Don't remove `@boardroom/shared` or split it across services.** It's the reason the custom runtime stays disciplined.
7. **Don't merge BoardRoom and OmniMind to simplify ops.** Data ownership boundary is load-bearing.

---

## 8. Executive One-Liner

> **Minimax wrote the doc you should use as your master framework. Gemini gave you the one idea (memory confidence decay + conversational verification) that closes the biggest hidden failure mode. Codex described the platform you'll want to be in three years but should ignore for now. The architecture you have is correct; the work is in hardening the memory trust layer, not rebuilding the foundations.**

---

## Appendix A — Scoring Matrix

| Criterion (weight) | Gemini | Codex | Minimax |
|---|:---:|:---:|:---:|
| Fit to current code (×3) | 5/10 | 3/10 | 9/10 |
| Stage appropriateness (×3) | 7/10 | 2/10 | 10/10 |
| Original insight (×2) | 8/10 | 7/10 | 7/10 |
| Security rigor (×2) | 5/10 | 9/10 | 8/10 |
| Failure mode analysis (×2) | 8/10 | 7/10 | 9/10 |
| Cost realism (×1) | 7/10 | 4/10 | 9/10 |
| Roadmap realism (×2) | 4/10 | 2/10 | 9/10 |
| **Weighted total** | **6.2** | **4.6** | **8.8** |

Minimax wins on every criterion except "original insight" (where it ties Codex) and "security rigor" (where Codex's enterprise stance scores highest).

---

*This judgment is opinionated on purpose. If any of the above conflicts with a direct instruction from Josh, the instruction wins and this document is wrong.*
