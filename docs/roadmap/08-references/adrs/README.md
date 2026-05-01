# ADR Copies — Reference Folder

**Canonical source of truth:** `docs/DECISIONS.md` in the repo root.
**This folder:** Holds individual ADR-NNN-{slug}.md files for offline reference and per-ADR linking. As of writing, copies have not yet been extracted from the canonical file — the consolidated source is the authoritative location. If you need the full text, open `docs/DECISIONS.md`.

> **Wave 4 validator note (2026-04-18):** The 13 active ADRs live in `docs/DECISIONS.md` (~74 lines). Extracting one file per ADR into this folder is a low-priority follow-up — flagged here as a known TODO. A future session can fan them out via `awk '/^## ADR-/{...}'`-style splitting. Until then, link to `docs/DECISIONS.md#adr-NNN` (or to the index entry below) for stable references.

> **Known inconsistency to resolve:** `01-foundations/ADR-INDEX.md` and several roadmap docs treat **ADR-010 = "Subscription middleware fails open"**, but `docs/DECISIONS.md` records **ADR-010 = "Google Calendar via OAuth 2.0 + googleapis SDK"**. Either the index is mis-numbered (likely — there is no separate ADR for the subscription middleware in `DECISIONS.md`) or `DECISIONS.md` is missing an ADR entry. Recommended next step: open a `STATUS/DECISIONS-LOG.md` entry asking the user which is canonical, then either (a) renumber ADR-INDEX or (b) add the missing ADR to `DECISIONS.md`. **Do not silently rewrite either source mid-pass.**

## How this folder relates to other roadmap docs

- `01-foundations/ADR-INDEX.md` — quick-lookup index of all ADRs (active + pending), with status and "don't revisit unless" gates.
- `docs/DECISIONS.md` (repo root) — full text of every accepted ADR.
- This folder — destination for one-file-per-ADR copies when the team wants per-ADR linking, e.g. for embedding into other roadmap docs, sharing externally, or giving each ADR a stable URL.

## Active ADRs (consult `docs/DECISIONS.md` for full text)

The 13 currently active ADRs are catalogued in `01-foundations/ADR-INDEX.md`. Headlines (per `docs/DECISIONS.md`):

- **ADR-001** — Custom agent runtime, no frameworks.
- **ADR-002** — Anthropic Claude only.
- **ADR-003** — PostgreSQL + pgvector, no separate vector DB.
- **ADR-004** — No knowledge graph in v1 (UNDER REVIEW in this roadmap; addressed by Phase 4 graph traversal + DEFERRED knowledge-graph-deep).
- **ADR-005** — Keep Room model, add DecisionSession alongside.
- **ADR-006** — Monorepo with Turborepo.
- **ADR-007** — Two-agent build workflow (RETIRED — Claude Code is now sole build agent).
- **ADR-008** — Tool execution via Anthropic SDK native tool_use (NOT MCP for internal calls).
- **ADR-009** — Background jobs via node-cron, no Redis.
- **ADR-010** — Google Calendar via OAuth 2.0 + googleapis SDK *(per `docs/DECISIONS.md`; some roadmap docs reference ADR-010 as "subscription middleware fails open" — see inconsistency note above)*.
- **ADR-011** — OpenAI text-embedding-3-small for embeddings.
- **ADR-012** — Custom persona storage + dispatch.
- **ADR-013** — Widget system — JSON config, not code.

> Note: the headlines as documented in some roadmap docs (e.g. `01-foundations/ADR-INDEX.md`) describe a different ADR-005 ("Persona prompts in `docs/prompts/*.system.md`"), ADR-006 ("Soft-delete on entity tables"), and ADR-012 ("Zod validation at all boundaries"). These are real architectural commitments in the codebase — they may have been treated as ADRs in the index without being formally appended to `docs/DECISIONS.md`. The Wave 4 validator left both intact rather than silently rewriting one. The quickest reconciliation is to add the missing entries to `docs/DECISIONS.md` and renumber, OR mark the ADR-INDEX entries as "implicit ADRs from CLAUDE.md rules, formal text pending."

## Pending ADRs (this roadmap will write these)

Per `01-foundations/ADR-INDEX.md`:

- **ADR-014** — Mem0 integration strategy (end of memory-stack Phase 9).
- **ADR-015** — Retrieval eval harness as non-regression gate (end of memory-stack Phase 0.5).
- **ADR-016** — Bi-temporal link tables and supersession semantics (end of memory-stack Phase 1).
- **ADR-017** — Memory MCP server as external interface (end of Phase 10) — does NOT contradict ADR-008, which is about *internal* tool calls.
- **ADR-018** — Markdown export via git as data portability layer (end of Phase 11).
- **ADR-019** — Migration history baseline + switch to `prisma migrate deploy` (end of Phase 15).
- **ADR-020** — Cortex isolation as separate Railway service (end of Phase 16).
- **ADR-021** — Webhooks + event bus as the platform-grade external surface (end of Phase 12).
- **ADR-022** — Resilience + multitenant fairness (end of Phase 18).
- **ADR-023** — Horizontal API scale enablers (end of Phase 19).

## How to add an ADR copy here

1. Number sequentially. Don't reuse retired numbers.
2. Append the new ADR to `docs/DECISIONS.md` first (canonical).
3. Create `08-references/adrs/ADR-NNN-{slug}.md` containing:
   - Title + status (ACTIVE / RETIRED / SUPERSEDED-BY-NNN / UNDER REVIEW)
   - Date
   - Context, decision, rationale, consequences
   - Alternatives rejected and why
   - Link back to the canonical entry in `docs/DECISIONS.md`
4. Update `01-foundations/ADR-INDEX.md` and the table above.

The point of one-file-per-ADR is **stable per-ADR URLs** for inbound links from other roadmap docs and external collaborators. Until the copies are extracted, link to `docs/DECISIONS.md#adr-NNN` directly.
