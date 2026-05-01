# Agent Dispatch Patterns — When and How to Spawn Subagents

**Audience:** Claude (parent session) deciding whether to delegate work.
**Purpose:** Reusable templates for spawning subagents efficiently. Prevents the two failure modes: (a) spawning agents for work the parent could do directly, burning tokens and wall-clock; (b) doing single-threaded work that should have been parallel.

The original 18-agent pipeline that produced this roadmap is documented in [`MEMORY-AGENTS-PIPELINE.md`](MEMORY-AGENTS-PIPELINE.md). This file gives you the smaller, reusable patterns.

---

## Pattern 1 — Single audit (1 agent, fire-and-wait)

**When to use:** You need a focused investigation of one part of the codebase or one specific question, and the answer doesn't fit in your remaining context budget.

**Examples:**
- "Audit the cortex job scheduler for soft-delete leakage"
- "Find every call site of `getPrismaClient` and report which ones are wired through middleware"
- "Inventory every `as any` in `packages/omnimind-api/src/services/`"

**Agent count:** 1 general-purpose agent (use Explore if read-only and you'll write the report yourself; use general-purpose if the agent must produce a file).

**Expected wall-clock:** 3-8 minutes.

**Expected token cost:** 30-80k tokens.

**Prompt scaffold:** See [`PROMPT-TEMPLATES.md`](PROMPT-TEMPLATES.md) "Run a focused audit".

**When NOT to use:** If the answer fits in <5 file reads, do it yourself. The subagent overhead isn't worth it.

---

## Pattern 2 — Parallel research wave (3-5 agents)

**When to use:** A question has multiple distinct angles and you need depth on each before synthesizing. Common shape: "Should we adopt X?" where X has security, performance, cost, and DX dimensions.

**Examples:**
- "Evaluate moving the embedding queue from in-memory to BullMQ — security, cost, ops complexity, migration risk"
- "Research mem0 alternatives — Letta, MemGPT, Zep, Cognee — compare on retrieval quality, schema fit, license"
- "What does our cortex job scheduler look like vs. industry patterns — node-cron, BullMQ, Inngest, Temporal"

**Agent count:** 3-5 general-purpose agents, dispatched in parallel (single message, multiple Task tool calls, all `run_in_background: true` or all in one batched send).

**Expected wall-clock:** 8-15 minutes (parallel; longest agent dictates).

**Expected token cost:** 200-500k tokens total.

**Storage convention:** Each agent writes to a distinct path so they don't race. Use `docs/research/{topic-slug}/stage1-research/{angle-slug}.md`.

**Prompt scaffold:** See [`PROMPT-TEMPLATES.md`](PROMPT-TEMPLATES.md) "Multi-agent research wave".

**Critical pitfall:** Each agent's prompt must be **self-contained** — they cannot see your conversation history. Include the working directory, the exact files to read, the exact output path, and the constraints (ADRs, file size limits, Anthropic-only rule).

---

## Pattern 3 — Adversarial debate (aggressive + conservative + synthesizer)

**When to use:** You're proposing a non-trivial architectural change and want stress-testing before committing. Especially valuable for ADR proposals, schema changes, or anything that touches the data layer.

**Structure:**
1. **Aggressive agent** — Argue strongly for the change. Maximize the upside case. Steelman the proposal.
2. **Conservative agent** — Argue strongly against. Maximize the downside, focus on what could break, what's load-bearing today, what migration risk looks like.
3. **Synthesizer** — Reads both, produces a single recommendation with evidence and a "if we do this, here are the 3 things that must be true first" gate list.

**Examples:**
- "Should we pull Phase 14 (migration history) forward to immediately after Phase 0?"
- "Should the embedding queue move to BullMQ now or wait for the multi-instance trigger?"
- "Is it time to introduce a knowledge graph or does recursive CTE still cover us?"

**Agent count:** 3 (2 parallel + 1 sequential after).

**Expected wall-clock:** 12-20 minutes.

**Expected token cost:** 150-350k tokens.

**Critical pitfall:** Tell the aggressive and conservative agents explicitly to **commit to their position** even if the evidence is mixed. Otherwise both produce the same hedged "it depends" answer and you've wasted the contrast.

---

## Pattern 4 — Multi-stage validation (research → audit → debate → review → validate)

**When to use:** You're producing a high-stakes artifact (a roadmap, a phase spec, a major feature design) where being wrong is expensive. This is the 18-agent pipeline pattern, scaled down.

**Stages:**
1. **Research** (3-5 parallel agents) — gather depth on each angle
2. **Audit** (1-3 parallel agents) — assess current state from different lenses (security, scalability, code quality)
3. **Builders** (1-N parallel agents) — each produces one section of the artifact
4. **Reviewers** (2-3 parallel agents) — completeness, consistency, executor-feasibility
5. **Validator** (1 agent) — stitches inconsistencies, produces final master output

**Examples:**
- The full omnimind roadmap pipeline (18 agents, ~$8 of tokens, ~45 min wall-clock)
- A make-it-10 feature that touches 5+ files and 2+ services
- A Phase N rebuild after the original spec was invalidated

**Agent count:** 8-18 depending on scope.

**Expected wall-clock:** 30-60 minutes total.

**Expected token cost:** 1.5-3M tokens (~$5-12 at 2026 Sonnet pricing).

**See:** [`MEMORY-AGENTS-PIPELINE.md`](MEMORY-AGENTS-PIPELINE.md) for the full structure with file-path conventions.

**Critical pitfall:** Synthesizers and validators must run **after** the work they synthesize is complete. Either run them sequentially with a wait, or have them poll for prerequisite files with a timeout. Racing the synthesizer against incomplete research produces garbage.

---

## Tool-type pitfalls (reinforcing [`MEMORY-AGENTS-PIPELINE.md`](MEMORY-AGENTS-PIPELINE.md))

These are easy to forget under time pressure. Re-read before dispatching.

- **Explore agents cannot Write.** If your agent must produce an artifact file, use `general-purpose`. Save Explore for read-only audits where the parent does the writing.
- **Plan agents cannot Write either.** Same workaround.
- **Parallel agents racing on the same file.** Each agent owns a distinct path; use `stage{N}-{name}/` namespacing.
- **WebSearch/WebFetch can be permission-blocked.** Always include a fallback: "if WebSearch is denied, fall back to training-cutoff knowledge but flag every claim as unverified."
- **Subagents don't see your conversation.** Every subagent prompt must be self-contained: working directory, file paths, output path, constraints.

---

## When NOT to spawn agents

Spawning a subagent is appropriate when the work is large, parallelizable, or needs depth you can't fit in your context. It is **not** appropriate when:

- **The task fits in one Claude call.** A single-file edit, a typecheck-then-fix loop, or a question answered by reading 1-2 docs — do it yourself.
- **You're "validating" decisions already in `01-foundations/CONSTRAINTS.md`.** The ADRs are settled. A subagent re-litigating them is pure cost.
- **You're re-reading docs that are already summarized.** The load-order map exists for this reason.
- **The user asked for a quick fix.** A 5-minute edit becomes a 25-minute event if you spawn agents. Match the response to the request.
- **You're using agents to avoid making a decision.** "Let me get a second opinion" is sometimes signal you should just commit to the read of the situation you already have. If you genuinely need adversarial input, use Pattern 3 — but don't spawn agents to defer your own judgment.
- **You're inside a context-tight session.** Subagent dispatch returns a summary that lands in your context. If you're already at 60%+ of budget, the summary alone may push you to compaction.

---

## Picking the right pattern (decision table)

| Situation | Pattern | Cost |
|---|---|---|
| Need one focused investigation | 1 (Single audit) | $0.10-0.30 |
| Need depth on multiple angles | 2 (Parallel research) | $0.50-1.50 |
| Proposing a non-trivial architectural change | 3 (Adversarial debate) | $0.40-1.00 |
| Producing a high-stakes artifact (roadmap, phase spec) | 4 (Multi-stage validation) | $5-12 |
| Quick fix, single file, <50 LOC change | None — do it yourself | $0.01-0.05 |
| Question already answered in `02-current-state/` | None — read the doc | $0.01 |

---

## After agents return

Whatever pattern you used, you (the parent) own three things post-dispatch:

1. **Read every agent's output.** Don't rubber-stamp. Agents produce confident-sounding garbage at non-zero rate.
2. **Cross-check claims against the codebase.** Especially for audit agents — file paths and line numbers can drift; always grep to verify.
3. **Update `STATUS/CHANGELOG.md`** with what was researched and where the artifacts landed. Future sessions need to find the work without re-running it.

Agent output is input to your judgment, not a substitute for it.