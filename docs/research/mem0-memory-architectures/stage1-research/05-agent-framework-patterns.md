# Memory Patterns in Modern Agent Frameworks (2025-2026)

> **Research note**: Live web search/fetch tools were unavailable during this pass. The report below is synthesized from the author agent's training knowledge through January 2026 and cross-referenced against the omnimind repo's own ADRs. Where a claim is shaky, I flag it. Citation URLs point to primary documentation pages; the *contents* of those pages as of today have not been independently re-verified in this session.

---

## 1. OpenAI Assistants / Responses API memory model

OpenAI shipped two overlapping primitives. The **Assistants API** (beta, 2023 → deprecation-scheduled 2026) exposed `Thread` as the server-persisted message store, with `Run` as the per-turn execution and a built-in `file_search` tool backed by OpenAI-managed vector stores. Memory was implicit: append to thread → OpenAI truncates/summarizes under the hood, opaquely. Power users hated this because (a) they couldn't see what was truncated and (b) OpenAI charged for *all* tokens including the hidden scrollback.

The **Responses API** (GA 2025) [replaced Assistants](https://platform.openai.com/docs/api-reference/responses) with a cleaner model: stateless by default, with an optional `previous_response_id` chaining primitive for server-side continuity, plus a `store: true/false` toggle. OpenAI added a first-party `memory` / "ChatGPT memory" product on the consumer side — an LLM-summarized profile per user — but the API-facing equivalent is **conversation state via response chaining** plus bring-your-own vector store. As of late 2025 there is no official, server-managed, queryable long-term memory store in the API; the pattern OpenAI recommends is: you keep a DB, you inject relevant context into each `input`, OpenAI handles nothing. This is the "responses API is a stateless LLM call" school.

**Takeaway for omnimind**: OpenAI conceded that opaque server memory is the wrong primitive. They retreated to "the platform gives you a stateless inference boundary; memory is your problem." Omnimind is already there.

## 2. Anthropic Claude Agent SDK memory primitives

The Claude Agent SDK (née Claude Code SDK, renamed mid-2025) is a thin wrapper over the Messages API with tool-use, subagents, and a local filesystem abstraction. It deliberately ships **no memory primitive**. The [SDK docs](https://docs.anthropic.com/en/docs/claude-code/sdk) treat memory as bring-your-own: Anthropic provides (a) a long context window (1M tokens on Sonnet 4.6 and Opus 4.7), (b) [prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching) with 1h TTL as of 2025, and (c) a `CLAUDE.md` convention for human-authored, agent-read "instructions memory." The recent [context editing / memory tool](https://www.anthropic.com/news/context-management) (late 2025) adds an in-agent "scratchpad" tool where the model can write notes to a file-backed store it re-reads on subsequent turns, but this is closer to a tool interface than a memory service — persistence and scoping are the caller's problem.

Anthropic's published agent guidance ("Building effective agents", mid-2025) argues explicitly *against* framework-baked memory in favor of "give the agent a filesystem and let it write/read." The Claude Code team dogfooded this — CLAUDE.md is the memory.

**Takeaway**: Anthropic's stance validates omnimind's approach. There is no Anthropic-blessed memory system you're missing out on.

## 3. LangGraph memory: checkpointer vs store

LangGraph drew a sharp, useful distinction that other frameworks muddled:

- **Checkpointer** (`MemorySaver`, `SqliteSaver`, `PostgresSaver`): persists the full graph state at each node boundary. This is *thread-scoped*, short-term, and its actual job is durability + resumption + time-travel debugging, not "memory" in the human sense. Think: WAL for agent execution. [LangGraph persistence docs](https://langchain-ai.github.io/langgraph/concepts/persistence/).
- **Store** (`BaseStore`, `InMemoryStore`, `PostgresStore`): a separate key-value + optional vector-index API for *cross-thread* long-term memory. Namespaced by `(user_id, "memories")` or similar. [LangGraph memory docs](https://langchain-ai.github.io/langgraph/concepts/memory/).

The good idea worth stealing: **separating session durability from semantic memory** as distinct concerns with distinct APIs. Omnimind collapses them into `MemoryEntry` right now; the checkpointer-for-resumption concept doesn't exist. Whether that matters depends on whether runs are long enough to need mid-run durability — at current runtimes (sub-minute persona dispatches) it doesn't.

LangGraph also formalized three memory *types* aligned with cognitive science: **semantic** (facts), **episodic** (event logs / few-shot examples), **procedural** (system-prompt-as-memory, updated by reflection). This taxonomy is load-bearing for anyone building a multi-agent system and is worth borrowing as internal vocabulary even without LangGraph itself.

## 4. CrewAI memory architecture

CrewAI's [memory system](https://docs.crewai.com/concepts/memory) exposes five named stores — **Short-Term** (RAG over recent interactions, ChromaDB), **Long-Term** (SQLite of task outcomes), **Entity** (RAG of entities: people, places, concepts), **Contextual** (runtime merge of the above), and **User Memory** (per-user preferences). All agents in a Crew share these stores by default; scoping is by `crew_id` not by agent. Memory is opt-in per-crew via `memory=True`.

The interesting move: **entity memory as a first-class store**, not just unstructured text. CrewAI extracts entities during task execution and keeps a separate RAG index over them. This is conceptually adjacent to omnimind's entity graph (Person, Goal, Project, Task) but CrewAI's version is flat — no Goal→Project→Task relations, no temporal constraints. Omnimind's DAG is strictly richer.

The anti-pattern CrewAI exhibits: memory is tightly coupled to the Crew runtime; to use CrewAI memory outside a Crew you basically can't. This is the vendor-lock-in trap omnimind is avoiding by keeping memory in OmniMind-the-service behind a REST boundary.

## 5. Letta (formerly MemGPT)

[Letta](https://docs.letta.com/) is both a library (`letta` Python package) and a hosted/self-hostable service (Letta Server). It is the most memory-centric of the mainstream frameworks: every agent has a structured memory composed of **core memory blocks** (always in context, rewriteable by the agent itself via `core_memory_replace` / `core_memory_append` tools), **archival memory** (unbounded vector-indexed store, searched via tool calls), and **recall memory** (full conversational history, also tool-searched).

The [MemGPT paper](https://arxiv.org/abs/2310.08560) framed this as "virtual context management" — an OS-style paging abstraction where the LLM is the CPU and core memory is RAM. Letta productized it. **Production adoption is modest** — mostly research and long-running companion chatbots (e.g., character.ai-style use cases). I'm not aware of a flagship enterprise deployment.

The pattern worth stealing: **model-in-the-loop memory curation**. The LLM itself is given `core_memory_replace` tools and decides what's important enough to keep in the always-in-context block. Omnimind currently runs memory extraction on the *output* of a turn (Doer's extraction persona); Letta-style self-editing during the turn is an option — probably overkill for a 7-persona decision system, but interesting for the onboarding flow.

## 6. Zep

[Zep](https://www.getzep.com/) pivoted in 2024-2025 from "generic memory service" to "memory with a temporal knowledge graph" (Graphiti, their open-source engine, [released mid-2024](https://github.com/getzep/graphiti)). The pitch: extract entities + facts from conversation, build a bi-temporal graph (valid-time + transaction-time), let edges expire, query with recency/validity-aware retrieval.

**Integration**: Python/TS SDKs, REST API. You POST messages, Zep does extraction + indexing asynchronously, you GET search results or a pre-packaged "memory context" block to inject.

**Cost model (as I last saw it)**: hosted tier is usage-based per-user-per-month; self-host is free (Apache-2 for Graphiti core, source-available for the Zep Cloud enterprise features — confirm current license before relying on this). The self-host path requires Neo4j which is a non-trivial operational dependency.

For omnimind: the *temporal knowledge graph* idea is the load-bearing one. Memories that expire, facts with effective-dates, edges that become stale — this is more mature than omnimind's current `MemoryEntry` with a single `createdAt`. Worth lifting concepts without lifting Zep.

## 7. Semantic Kernel (Microsoft)

[Semantic Kernel](https://learn.microsoft.com/en-us/semantic-kernel/) is .NET-first, Python/Java secondary, and Microsoft's answer to LangChain. Memory is modeled as **`IMemoryStore`** with connectors for Azure AI Search, Qdrant, pgvector, etc., plus a **Kernel Memory** sidecar service that does ingestion + RAG. The framework-level abstraction is "semantic text memory" — essentially a typed vector store with `save_information` / `search` methods.

Nothing architecturally novel here for omnimind's purposes. The one pattern to note: Semantic Kernel treats memory-as-a-plugin (a callable skill the LLM can invoke), not memory-as-auto-injected-context. This matches native tool_use better than LangChain's "stuff it in the prompt" default.

## 8. Durable execution: Inngest, Trigger.dev, Temporal, Rivet

These are **workflow engines**, not memory systems, but they solve an adjacent problem: persisting state across long-running agent runs (hours, days, weeks). [Inngest](https://www.inngest.com/docs/features/middleware/durable-execution), [Trigger.dev](https://trigger.dev/docs), and [Temporal](https://temporal.io/) all implement event-sourced replay: every step's input/output is logged; on restart the workflow deterministically replays to the last completed step. Rivet is a visual graph editor over a similar runtime.

Relevance to memory: durable workflows collapse "checkpointer" and "job queue" into one thing. If omnimind ever needs multi-day agent runs (Cortex already approaches this with weekly cron jobs), the pattern is: use a durable execution layer for run state, keep semantic memory separate in OmniMind's DB. Do not conflate "this run's progress" with "what the user believes." LangGraph's checkpointer/store split is the same insight at a smaller scale.

Omnimind's current node-cron Cortex jobs are the naive version of this. That's fine below ~500 users; above that, durable execution becomes real.

## 9. IDE assistants: Cursor, Windsurf, Zed, Claude Code

IDE agents handle codebase memory with three converging patterns:

1. **File-as-memory conventions**: `CLAUDE.md`, `.cursor/rules`, `.windsurf/rules`, `AGENTS.md`. Human-editable, version-controlled, loaded at session start. This is "procedural memory" in LangGraph's taxonomy.
2. **Project indexing**: automatic chunking + embedding of the codebase, retrieved via tool call (`codebase_search` in Cursor, workspace symbol search in Zed). Ephemeral — rebuilt from source of truth (git).
3. **User-scoped preferences**: Cursor's "memories" feature (launched 2025) lets the user or agent save `(project_id, preference)` tuples; shown to the user, editable, injected into the system prompt.

The convergent insight: **memory that matters is either (a) in version control or (b) explicitly surfaced to the user for edit**. No IDE has shipped a successful "opaque AI learning from you" feature — users rejected it every time. This is directly relevant to omnimind's user-facing memory UI.

## 10. MCP memory servers

The [Model Context Protocol](https://modelcontextprotocol.io/) spec includes no mandated memory primitive, but the reference servers include [`@modelcontextprotocol/server-memory`](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) — a tiny knowledge-graph server (entities, relations, observations) persisted as JSON. Adoption: hobbyist. It's not a production system; it's a conformance example.

More interesting: Anthropic's [memory tool](https://www.anthropic.com/news/context-management) shipped late 2025 *is* essentially a memory-MCP-server-shaped thing, exposed as a built-in tool. But it's a server-managed scratchpad, not a curated long-term store.

Omnimind's stance (reject MCP for tool-use, ADR-008) doesn't preclude *exposing* OmniMind's memory API as an MCP server for third-party consumers (Claude Desktop users, other agents) later. This is a low-cost optional surface area, not a coupling decision.

## 11. Multi-agent shared memory: scoping patterns

The literature divides cleanly:

- **Message-passing** (CrewAI, AutoGen, Microsoft Magentic-One): agents speak to each other; "memory" is the transcript. Simple, but every agent re-reads everything → context explosion at scale. Works for ≤3 agents, breaks at 7+.
- **Shared blackboard** (classical AI, resurrected in some 2025 systems): one structured store, all agents read/write. Requires schema discipline or it becomes unreadable soup.
- **Shared entity graph + per-agent views** (what omnimind does): one canonical store, each agent gets a filtered/ranked projection. Scales with entity count, not agent count.

The [AutoGen team's 2024 paper on conversable agents](https://arxiv.org/abs/2308.08155) and its follow-ups converged on the view that message-passing doesn't scale past small teams without a summarizer-in-the-loop; at which point you've reinvented a shared store with lossy compression. Omnimind's shared-entity-graph is the right pattern for 7 personas. CrewAI-style pure message-passing would be a regression.

## 12. Context window management: does 1M context kill memory?

Claude 4.7's 1M context (Opus/Sonnet) genuinely shifts the problem. The old question was "how do I fit enough context?" The new questions:

1. **Cost**: 1M tokens at Opus rates is ~$15/call input. Memory-as-retrieval is still cheaper than memory-as-stuff-everything.
2. **Signal-to-noise**: long-context recall degrades non-uniformly. Anthropic's own [needle-in-a-haystack results](https://www.anthropic.com/news/claude-3-family) show >99% at 200k; beyond that, [independent benchmarks](https://github.com/hsiehjackson/RULER) show degradation on multi-hop reasoning past ~500k even when surface recall is high. "It's all in context" ≠ "it's all used."
3. **Latency**: prefill time scales with context. A 1M-token call has seconds of TTFT; bad for conversational UX.
4. **Provenance**: at 1M tokens you lose the ability to tell the user *why* the model said X. Retrieval-based memory surfaces sources; stuffed context doesn't.

The retrieval problem *does* shift — from "what's the top-k most relevant?" to "what's the *minimum sufficient set* to avoid contradiction?" Quality > quantity. This is exactly what omnimind's 7-10 items per persona cap is optimizing for, and it remains the right design even with 1M context.

---

## Implications for omnimind

**(a) Patterns worth borrowing from rejected frameworks.** Three: (1) LangGraph's **checkpointer/store split** — conceptually separate "this run's durable state" from "semantic long-term memory," even if both live in Postgres. Relevant when Cortex jobs grow to multi-hour. (2) LangGraph's **semantic/episodic/procedural memory taxonomy** as internal vocabulary; maps cleanly onto existing models (MemoryEntry, Decision/TranscriptEntry, ContextCapsule). (3) Zep/Graphiti's **bi-temporal edges** — add `validFrom`/`validTo` to entity links so stale facts expire gracefully. Skip Letta's self-editing memory tools (overkill for 7-persona decision UX) and CrewAI's coupled memory runtime (the entire anti-pattern you're avoiding).

**(b) 1M context changes the calculus.** It doesn't eliminate memory — it makes memory an **optimization** (cost, latency, provenance) rather than a **correctness** requirement. Keep the 7-10 item cap per persona; drop it only if a specific persona benchmark proves more helps. Do not "just pass everything" — you lose citations and pay 20x.

**(c) Shared entity graph vs message-passing.** Shared-entity-graph is correct for 7 personas. Message-passing breaks at this scale, as AutoGen's team effectively conceded. The one hybrid worth exploring: **one-shot persona-to-persona notes** (Critic flags "Optimist missed risk X" as a typed MemoryEntry, not a message) — preserves the store-based architecture while enabling the cross-persona signal that pure graph-sharing lacks.
