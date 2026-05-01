# Principles — The Non-ADR Guidance That Shapes the Roadmap

**Audience:** Claude or human about to make a judgment call that isn't covered by an ADR.
**Purpose:** ADRs lock down specific technical choices. Principles lock down the *style of thinking*. When two valid options exist and the ADRs don't decide, these do.

These are not commandments — they're the consistent biases that produced the current roadmap shape. If a phase decision violates one, that's not automatically wrong, but it deserves a `DEC-N` entry in [`STATUS/DECISIONS-LOG.md`](../../STATUS/DECISIONS-LOG.md) explaining why.

---

## 1. Pattern-first, LLM-fallback

**Statement:** When parsing structured-ish text, try regex / heuristics / SQL first. Only reach for an LLM when patterns measurably fail on real data.

**Why:** Patterns are deterministic, free, instant, and debuggable. LLMs are non-deterministic, costly, slow, and opaque. The mem0 research ([`docs/research/mem0-memory-architectures/stage5-validation/final-recommendation.md`](../../research/mem0-memory-architectures/stage5-validation/final-recommendation.md)) found that ~80% of what mem0 cloud uses an LLM for can be done with deterministic ADD/UPDATE/DELETE/NOOP rules over Postgres data. The remaining 20% is where Phase 5a (LLM augmentation) earns its $/user/month.

**How it shapes phases:** Phase 2 ships pattern extraction *before* Phase 5a touches an LLM. The flag for LLM augmentation defaults off. The extraction primitives in Phase 2 stay in production even after Phase 5a — they're the cheap baseline the LLM only enhances.

## 2. Measurable triggers, not vibes

**Statement:** Every "we'll do X later" decision names a specific number, count, or event that flips X from later to now. No vague "when scale demands it."

**Why:** Vague triggers produce two failure modes: shipping things prematurely (because someone *feels* like the time is right) and never shipping (because no concrete signal ever arrives). Both waste calendar weeks. The deferred catalogue ([`04-roadmap/DEFERRED/README.md`](../04-roadmap/DEFERRED/README.md)) is the canonical example: every entry has a row like "≥200 `Decision.outcome` populated AND `MemoryCitation` table exists."

**How it shapes phases:** Phase 7b and Phase 8 are explicitly DEFERRED with named triggers. Phase 16 (knowledge graph deep) only ships if recursive-CTE p95 exceeds 500ms AND pattern-match queries become a product feature. "Maybe later" is never an acceptable phase status.

## 3. Postgres-native > new infrastructure

**Statement:** When a feature could be solved by adding a Postgres table, function, or extension vs. introducing a new piece of infra (Redis, BullMQ, Pinecone, Neo4j), prefer Postgres until a measured ceiling forces the change.

**Why:** Each new infra component multiplies operational surface area: another credential, another deploy, another failure mode, another monitoring pane, another cost line. PostgreSQL with pgvector + pg_trgm + tsvector + recursive CTEs handles 80%+ of "we need a graph / queue / vector store / fuzzy search." ADRs 003 and 009 codify this for vector DB and Redis specifically; this principle generalizes the bias.

**How it shapes phases:** Phase 4 graph traversal uses recursive CTEs over typed link tables, not Neo4j. Phase 2 `MemoryWriteEvent` is a Postgres table, not a queue service. The eventual rate-limiter migration goes to a Postgres `RateBucket` table with row locks (per the scalability audit, section E), not Redis. Phase 16 (knowledge graph deep) is gated specifically because it might be the first principled exception.

## 4. Eval before quality claims

**Statement:** "We improved retrieval" is a measurable claim. Until the eval harness reports it, it's a feeling.

**Why:** Memory systems are full of opportunities for self-deception. A change that "feels better" on three demo queries can regress on the long tail. A change that scores well on the standard eval can break a slice that matters to a real user (e.g., multi-entity queries, recent-bias queries, long-context queries). The Phase 0.5 eval harness exists so every later phase ships with a number, not an adjective.

**How it shapes phases:** Phase 0.5 (eval harness) precedes every retrieval-affecting phase. Phases 3, 6, 7a all have phase-specific eval slices in their exit criteria. The cross-cutting quality gate "no regression on standard queries" applies to every phase, not just retrieval phases. Phase 5a's LLM augmentation specifically requires "per-100-pair precision ≥0.6" before flag-on.

## 5. Single source of truth

**Statement:** For schema, prompts, types, and decisions, there is one canonical location. Copies are derived, not authoritative.

**Why:** Drift between two "sources" of the same fact is the silent killer of correctness. The Prisma schema is the only definition of the database. Persona prompts live in `docs/prompts/*.system.md` (per ADR-005). Types live in `packages/shared/src/`. ADRs live in `docs/DECISIONS.md`. When something needs to be "updated everywhere," it actually needs to be updated in one place that everywhere imports.

**How it shapes phases:** Phase 1 schema work happens in `prisma/schema.prisma` first; Zod schemas in shared/ are derived from it; types in shared/ are derived from those. Phase 2 prompt changes live in `docs/prompts/`, not in the extraction TypeScript. Every ADR that gets written in Phase 9 is an addition to `docs/DECISIONS.md`, not a parallel doc.

## 6. Reversibility > optimality

**Statement:** When two designs are roughly equivalent, prefer the one that's easier to roll back.

**Why:** A solo-founder roadmap can't afford one-way doors that turn out to be wrong. Phase 14 explicitly transitions to migration history specifically because `prisma db push --accept-data-loss` is the opposite of reversible. Feature flags, behind-flag rollouts, A/B comparisons, and "ship the new path alongside the old" are all expressions of this principle.

**How it shapes phases:** Phase 3 ships RRF as an A/B against weighted fusion before declaring a winner. Phase 6 adds the entity ranker boost behind a flag. Phase 5a's LLM augmentation defaults off and can be killed via flag without code change. Phase 9 explicitly *deletes* dead code only after writing ADRs explaining why — making the deletion documented, not silent.

## 7. Solo founder reality

**Statement:** All time estimates assume ~60% sustained focus, not 100%. Multi-week phases assume calendar weeks, not engineering weeks.

**Why:** Customer support, bug fixes, sales conversations, infrastructure surprises, and life all consume time that pure engineering estimates ignore. A 14-week pure-engineering roadmap inflates to a 22-week calendar roadmap when the founder is also the support team, the salesperson, and the on-call engineer. Estimating against fantasy capacity creates false missed deadlines and erodes confidence in the plan.

**How it shapes phases:** [`04-roadmap/ROADMAP-OVERVIEW.md`](../04-roadmap/ROADMAP-OVERVIEW.md) explicitly notes "16-22 calendar weeks (solo founder, ~60% focus)" against ~14 weeks of nominal phase work. The p90 estimate of 30 weeks builds in even more slack. Phases are sized so each one ships independent value — order of completion matters more than sustained velocity.

## 8. Service boundary inviolable

**Statement:** BoardRoom never touches the database. All persistent operations route through OmniMind via HTTP.

**Why:** The single biggest architectural lever in the platform is the BoardRoom ↔ OmniMind seam. It's what lets OmniMind be replaced, scaled separately, exposed via MCP, and ultimately wrapped in an SDK. Every shortcut that bypasses the seam (a "quick" direct Prisma import, a "temporary" shared connection pool) erodes the separation and makes future phases harder.

**How it shapes phases:** Phases 10 (MCP) and 12 (SDK) are *only possible* because the seam is clean. Phase 15 (cortex isolation) extracts a piece of OmniMind into its own service — only feasible because OmniMind itself doesn't have leaked-in BoardRoom dependencies. ADR-013 codifies this; this principle reinforces that no phase, ever, weakens it.

## 9. Markdown is data

**Statement:** Prompts, decisions, plans, and roadmap state live in `.md` files in the repo, not in TypeScript constants, not in a database, not in a notion doc.

**Why:** Markdown in the repo is diff-able, grep-able, version-controlled, branch-able, and (critically) loadable by Claude Code with no tool plumbing. Every time a fact moves from a markdown file into a TypeScript constant, it loses those properties. ADR-005 makes this explicit for persona prompts; this principle generalizes to roadmap state, decisions, ADRs, and eval rubrics.

**How it shapes phases:** The entire `docs/roadmap/` directory is markdown. Eval rubrics live in `eval/rubrics/*.md`, not in code. Phase 11 (markdown export) extends this principle externally — user data becomes markdown they can grep, branch, and own. The `STATUS/` files are the runtime state of the roadmap, kept in markdown so any session can read them with `Read`.

---

**Conflict resolution:** When two principles point in different directions, prefer in this order: (1) Service boundary inviolable (architectural integrity), (2) Eval before quality claims (don't ship vibes), (3) Reversibility > optimality (don't paint into corners), (4) the rest tied. Document the call in `STATUS/DECISIONS-LOG.md`.
