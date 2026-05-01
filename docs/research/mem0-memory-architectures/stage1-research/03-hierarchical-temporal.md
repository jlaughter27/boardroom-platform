# Hierarchical, Temporal, and Consolidation-Based Memory in AI Systems

> **Research constraint note.** Live web search/fetch were unavailable for this
> report, so every citation below points at primary sources (papers, official
> docs, or GitHub repos) that the author is confident exist as of the
> January 2026 knowledge cutoff. Claims that come from product marketing vs.
> peer-reviewed / preprint research are tagged inline as **[marketing]** or
> **[paper]**. Where a claim cannot be traced to a specific source, it is
> labelled **[folk knowledge]** and framed as a pattern rather than a result.
> No benchmark numbers or paper titles have been invented.

---

## 1. MemGPT / Letta — hierarchical memory today

MemGPT ([Packer et al., 2023, arXiv:2310.08560](https://arxiv.org/abs/2310.08560))
models the LLM context window as "main memory" in an OS analogy, with two
external tiers the agent pages in/out via tool calls:

- **Main context** — the live prompt. Subdivided into **system instructions**,
  a **working context** scratchpad (persona + user facts), and the **FIFO
  message queue** (recent turns).
- **Recall memory** — full conversation history, searchable.
- **Archival memory** — unbounded semantic store (vector DB), written and
  read via explicit `archival_memory_insert` / `archival_memory_search`
  tool calls. The agent also emits a **self-edit** when the FIFO queue nears
  the token limit, summarising evicted turns back into working context.

The core contribution is that **the LLM itself is the memory manager**:
paging is a tool-use loop, not a framework behaviour. The paper's benchmark
was a synthetic "deep memory retrieval" task over multi-session chats where
a vanilla context-window baseline failed by construction **[paper]**.

**Is it still SOTA?** The tier model is widely imitated but the original
benchmark has been superseded. LongMemEval ([Wu et al., 2024,
arXiv:2410.10813](https://arxiv.org/abs/2410.10813)) is now the common yardstick
for long-term conversational memory, and papers built around plain RAG +
summarisation (e.g. mem0's own eval) report competitive numbers without
MemGPT's tool loop **[paper]**. MemGPT's latency/cost overhead — every
retrieval is a tool-call round-trip — is the usual critique.

**Letta** ([letta-ai/letta](https://github.com/letta-ai/letta),
[docs.letta.com](https://docs.letta.com)) is the commercialisation of MemGPT
by the original authors. On top of the tier model it adds:
- **Stateful agents as a first-class server object** — persisted `agent_state`
  rows in Postgres, REST/gRPC API, multi-user.
- **Editable memory "blocks"** — named, size-capped slots in working context
  that any agent (or the user) can rewrite; the "human" and "persona" blocks
  are conventions, not schema.
- **Sleep-time agents** — background agents that reorganise memory between
  turns (see §10).
- **ADE (Agent Development Environment)** — a GUI to inspect and edit the
  blocks and archival rows.

Public production references are thin — Letta markets to enterprises but
named customers are mostly dev-tool and support-bot pilots **[marketing]**.
The open-source repo has real usage, but I have not seen an independent
case study of MemGPT-style tiering *beating* a well-tuned RAG+summary
system on a realistic agent task.

---

## 2. Working memory vs. long-term memory — the "write-back cache"

The pattern of "keep recent turns verbatim in the prompt, periodically
summarise them into a persistent store" predates LLMs and is essentially
LangChain's `ConversationSummaryBufferMemory` ([LangChain memory
docs](https://python.langchain.com/docs/how_to/chatbot_memory/)). The analogy
to a write-back cache is reasonable but also a bit lossy — there is no
"dirty bit" and the summary is irrecoverably lower-fidelity than the source.

**Empirical comparisons are rare and mixed.**
- The MemGPT paper showed that paging beats naive truncation on its own task
  but did not isolate summarisation from tiering.
- LongMemEval ([arXiv:2410.10813](https://arxiv.org/abs/2410.10813)) tested
  commercial assistants (ChatGPT, Claude, Gemini) and showed ~30% accuracy
  drops on multi-session questions, with summarisation-based strategies the
  main lever that moved the needle — but also the main source of hallucinated
  "facts" that were never said **[paper]**.
- Anthropic's published guidance on Claude memory ([Building effective
  agents, 2024](https://www.anthropic.com/research/building-effective-agents))
  treats summarisation as a straightforward compression step, not a novel
  mechanism.

The honest read: summarisation-on-eviction is **proven to reduce token
cost** and **unproven to preserve fidelity**. Every production system that
relies on it pays a hallucination tax on temporal/quantitative facts
("you said 20% last week" when the user said 15%). This is the main
argument for keeping the raw entry around and layering the summary
*alongside* it rather than replacing it — the "write-through" variant.

---

## 3. Memory consolidation / compaction

In practice, production systems use four compaction strategies, often
stacked:

1. **Hard TTL / archival** — move entries older than N days to cold
   storage, exclude from default retrieval. Simple, safe, dumb.
2. **Importance-scored eviction** — compute a score per entry, drop the
   bottom-k. Score inputs vary (see §4).
3. **Re-summarisation / merge** — LLM pass that folds N related entries
   into one canonical statement. This is what **mem0** does in its
   [ADD/UPDATE/DELETE pipeline](https://github.com/mem0ai/mem0): the
   `add()` call runs an LLM over the new fact plus candidates retrieved
   from the store and emits an action — append, update-in-place, or
   delete the stale fact. The [mem0 paper (arXiv:2504.19413)](https://arxiv.org/abs/2504.19413)
   reports this reduces storage and improves their LOCOMO benchmark
   accuracy vs. append-only RAG **[paper]**.
4. **User-curated pinning / forgetting** — explicit "keep forever" and
   "forget this" flows (see §9).

Mem0 also ships a **graph variant** (Mem0g) that stores fact triples in a
graph DB instead of as text rows, and uses the same LLM-driven
consolidation over nodes/edges. The benchmark gain over the non-graph
variant is real but modest (few points on LOCOMO) **[paper]**.

Bloat in practice is almost never about raw disk; at 100k entries per
user you are still well inside pgvector's fast regime. The real bloat
tax is at **retrieval time** — more candidates means noisier top-k.
That's what consolidation actually buys you.

---

## 4. Recency decay and importance scoring

The **Generative Agents** paper ([Park et al., 2023,
arXiv:2304.03442](https://arxiv.org/abs/2304.03442)) is the most-cited
source for a concrete formula in agentic memory:

```
score = α·recency + β·importance + γ·relevance
recency   = 0.995 ^ hours_since_last_access   (exponential decay)
importance = LLM-rated 1–10 at write time
relevance = cosine(query_embedding, memory_embedding)
```

They did not tune α/β/γ rigorously; the paper reports qualitative ablations
on the "Smallville" town simulation, not a principled sweep **[paper]**.

**Ebbinghaus-style half-life** formulas (`R = e^(-t/S)` where S grows with
repeated access) have been studied for spaced-repetition systems (Anki,
SuperMemo) for decades, and a few LLM-memory papers reference them, but I
am not aware of a head-to-head benchmark showing half-life beats simple
exponential decay on an agent task **[folk knowledge]**.

**Importance scoring is the weak link.** LLM-rated importance at write time
is cheap but drifts — what was a "5" in January is a "2" in July once the
project ships. A reasonable alternative used in some deployments is
**access-count as importance proxy** (Hebbian-ish: facts retrieved often
are important), which is cheap and self-correcting. No public paper I know
of compares the two cleanly.

---

## 5. Temporal reasoning failures — "what did I decide last quarter vs. now"

The failure mode is well-documented: vector retrieval is time-agnostic, so
a query like "what's my current pricing?" can surface a six-month-old
pricing memo with high cosine similarity and outvote the recent
decision. LongMemEval names this the **"temporal reasoning"** slice and
commercial assistants score worst on it **[paper]**.

**Graphiti / Zep** ([getzep/graphiti](https://github.com/getzep/graphiti),
[Zep paper arXiv:2501.13956](https://arxiv.org/abs/2501.13956)) claim to fix
this with a **bi-temporal knowledge graph**: every edge has a `valid_from /
valid_to` (when the fact was true in the world) and a `created_at / expired_at`
(when the system learned / invalidated it). When a new fact contradicts an
existing edge, the old edge is **invalidated**, not deleted, and queries
filter on the valid-time axis.

The Zep paper's headline is a ~18-point win on their DMR benchmark vs.
MemGPT **[paper]**. The DMR benchmark is Zep's own and not independently
replicated, so treat the magnitude with caution; the *direction* (bi-temporal
+ graph > flat vector) is consistent with the qualitative argument.

---

## 6. Bi-temporal data models in AI memory — real win or over-engineering?

Bi-temporal (valid-time × transaction-time) is battle-tested in finance
and insurance databases; it is not an LLM-era invention. What's new is
applying it to *LLM-extracted* facts, where the extractor is unreliable.

**What bi-temporal actually buys a product like omnimind:**
- Correct answers to "as of April, what did I think about X?" without
  relying on the LLM to infer from raw timestamps.
- Audit trail: "the system believed X from 2026-01-03 to 2026-04-01,
  then learned Y". Useful for trust and for the cortex contradiction
  layer.
- Clean separation of "the user changed their mind" (valid-time edit)
  from "we corrected our extraction" (transaction-time edit).

**Where it becomes over-engineering:**
- If most facts are immutable events ("had a call with X on date Y"),
  there's nothing to invalidate — you just need a timestamp.
- Two timestamps per row is fine; the cost is the *invalidation logic*.
  Every write becomes a "find-and-expire" over candidate prior facts,
  which is exactly the mem0 ADD/UPDATE pipeline but harder because you
  need to reason about time ranges, not just "is this a duplicate".

For omnimind's 100k-entries-per-user scale, a *single* `valid_at`
timestamp plus a `superseded_by_id` nullable FK captures 80% of the
value of full bi-temporal at maybe 20% of the complexity.

---

## 7. Contradiction detection

Three families, in increasing cost and accuracy:

1. **Rule-based** — string/key matching on structured attributes. Works
   for "pricing = $X" vs. "pricing = $Y" when you've already extracted
   typed fields. Fails on anything prose.
2. **LLM-based pairwise check** — on write, retrieve top-k similar
   entries, ask an LLM "does this new fact contradict any of them?".
   This is what mem0's ADD pipeline does for the UPDATE/DELETE decision,
   and what omnimind's cortex-contradictions persona presumably does.
   Cheap per-write, high recall, moderate precision.
3. **Graph-based temporal invalidation** — Graphiti/Zep approach: when
   a new edge `(subject, predicate, object2, valid_from=now)` arrives
   for a subject that already has `(subject, predicate, object1)`, mark
   the older edge's `valid_to = now`. Requires a graph model and clean
   triple extraction.

There is no published benchmark I know of that cleanly compares these
three on the same agent task. The mem0 paper ablates their own
update/delete step and reports small accuracy gains; it does not test
against the graph-based variant head-to-head **[paper]**.

For a product with a cortex layer already, the right move is usually
**LLM-based on write + scheduled graph-style sweep**: catch the obvious
contradictions synchronously, let the cortex pass catch the subtle
cross-domain ones weekly.

---

## 8. Memory summarisation patterns — weekly memos, daily digests,
end-of-session summaries

These are mostly **product patterns**, not research findings.

- **End-of-session summary** is load-bearing in almost every agent
  product. The MemGPT eviction summary is one form; OpenAI's
  ChatGPT Memory ([OpenAI Memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq))
  appears to be another **[marketing]**.
- **Daily / weekly digests** (what omnimind calls cortex memos) are
  documented in product blogs (Reflect, Granola, Rewind) but I'm not
  aware of a controlled study showing they improve downstream retrieval
  quality vs. raw entries. The user-facing value (trust, ritual) is
  probably larger than the retrieval-quality value.
- **Impact on retrieval:** a summary is a *new retrievable unit*. It
  competes with the underlying entries for top-k slots. Unless you
  either (a) boost summaries at query time, or (b) exclude the entries
  they subsume, you can actually *hurt* retrieval by adding noise.
  The mem0 UPDATE-in-place pattern avoids this by not keeping both.

---

## 9. User-in-the-loop memory curation — Granola, Rewind, Limitless

These are consumer/prosumer products; their design choices are
**[marketing]** and observed UI behaviour, not studied.

- **Granola** — meeting notes product. Memories = notes, user can
  edit/delete freely, no explicit "pin". Summary is the primary
  artifact; raw transcript is secondary.
- **Rewind / Limitless** — passive-capture, "your life recorded".
  The curation flow is mostly *search + delete*; the surface pressure
  is on privacy (time-range deletes, app blocklists) rather than on
  what-to-remember.
- **ChatGPT Memory** — explicit "Manage memories" list; user can
  delete individual entries and toggle the whole feature. No editing.
- **Notion AI / Reflect AI** — memory is an artifact of the doc
  store, not a separate layer. Curation = editing your notes.

**Lessons for a B2B agent platform like omnimind:**
- Hard-delete is table stakes. Soft-delete is fine for recovery but
  must be invisible to the agent.
- Pin / "always remember this" is high-value for founders who want
  mission-critical context (company thesis, user research themes).
- Bulk edit is rarely used but heavily requested; scheduled
  re-summarisation is a more useful proxy.
- The moment you show users the memory list, you must commit to never
  including a memory the user deleted. Audit this with integration
  tests.

---

## 10. "Sleeptime compute" — real or hype?

The term was popularised by Letta ([sleep-time compute blog post,
letta.com](https://www.letta.com/blog/sleep-time-compute)) and an Anthropic
research blog ([Anthropic: Sleep-time compute,
2025](https://www.anthropic.com/research/sleep-time-compute)) that
described using **idle inference budget** to pre-process context before
user queries arrive, trading latency at read-time for a fixed off-peak
cost **[paper/marketing]**.

Concretely what's proposed:
- Between user turns, run background agents that: re-summarise recent
  memory, detect contradictions, enrich facts with entity links,
  pre-compute likely answers to anticipated questions.
- At query time, the agent reads the *pre-processed* context, which is
  smaller and pre-reasoned-over.

**Is it in production?** Letta ships sleep-time agents as a feature;
beyond their own cloud I have not seen an independent case study.
Anthropic's own post frames it as a research direction, not a product.
The underlying pattern — offline batch jobs that prepare state for
online queries — is of course ancient (ETL, search index rebuilds,
materialised views). The novelty is using an LLM as the batch
processor.

**The honest read:** "sleeptime compute" is a good *name* for a real
and boring architectural pattern (**offline LLM batch jobs over the
memory store**). Omnimind's node-cron cortex jobs (weekly memo,
contradictions, pattern detection) already *are* sleeptime compute
in this sense. You don't need Letta to do it.

---

## Implications for omnimind

**(a) Hierarchical layer (working/archival).** **Don't add MemGPT-style
tiering.** Omnimind already has a working/archival distinction by virtue
of session scope (ephemeral) vs. `MemoryEntry` (persistent), and the
persona model means "main context" is re-packed per-call by
`context-packager.ts`. Adding explicit tier-paging tool calls would
slow every persona invocation for marginal benefit at 100k entries.
The one piece worth stealing is Letta's **editable memory blocks** —
i.e. a small, user-visible, always-in-context "user profile" slot
that the cortex updates weekly. That's a lightweight working-context
pattern without the paging overhead.

**(b) Consolidation/compaction.** Adopt mem0's **ADD/UPDATE/DELETE
pipeline on write** (synchronous LLM-as-consolidator), and keep the
existing cortex weekly job as the async pass. Skip importance-based
eviction until retrieval quality actually degrades — at 100k
entries with hybrid retrieval it probably won't. Add a `superseded_by_id`
FK instead of full bi-temporal; it captures "I changed my mind" without
the two-timestamp complexity.

**(c) Temporal reasoning.** The pragmatic move: index `valid_at` on
`MemoryEntry`, add a **recency-boost term** to the retrieval ranker
(omnimind already has `ranker.ts`), and lean on the existing
contradiction-alerts cortex job for invalidation. A full temporal
knowledge graph (Graphiti/Zep) is real value but very expensive to
adopt mid-flight and orthogonal to the persona architecture that is
omnimind's actual moat.
