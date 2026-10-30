# Phase 8 — Real-data roadmap (from the 2026-10-23 end-to-end run)

**What this is:** the next steps after loading a real Obsidian vault into the full stack (BoardRoom production build + OmniMind + MCP gateway) and driving it through the UI and MCP. It sits on top of [`PHASE-8-ROADMAP.md`](PHASE-8-ROADMAP.md): Phase 8 items keep their IDs; new work found by the run is `RD-*`. Per-item state lives in [`../STATUS/PHASE-PROGRESS-TRACKER.md`](../STATUS/PHASE-PROGRESS-TRACKER.md) § "Phase 8 — real-data follow-ups".

**Where things stand (2026-10-23):**

| | State |
|---|---|
| Merged | PR #25 (wave 1, 11 items), PR #26 (wave 2, 4 items), PR #27 (vault importer) |
| Open | PR #28 — the four fixes from the real-data run (POST reads on the read budget, FTS any-word fill, batch memory links + importer link phase, plain-language provider errors). CI green. Waiting on the founder's "merge". |
| Production | **Nothing verified since PR #22.** The sandbox cannot reach `*.up.railway.app`; post-deploy verify is wired but skips until its host variables exist. |
| Real-data run | 16/16 steps, zero console errors. Not exercised: semantic search and real persona answers (no LLM / embedding keys in the sandbox). |

---

## What the run found

| # | Finding | Status |
|---|---|---|
| 1 | POST reads (`/memories/search`, `/context/for-persona`, …) counted against the 20/min **write** budget — one decision dispatch or a busy MCP client locked the user out of every POST | **Fixed in #28** |
| 2 | Full-text search was all-words-or-nothing; natural-language questions found nothing without embeddings | **Fixed in #28** (CI IR eval: for-persona recall@10 0.520 → 0.718, `/memories/search` 0.535 → 0.826) |
| 3 | An imported vault showed an **empty knowledge graph** (wikilinks were not links; orphans hidden) | **Fixed in #28** (batch links + importer link phase) |
| 4 | Persona cards showed raw provider JSON on failure | **Fixed in #28** |
| 5 | Memory detail renders **raw markdown** (headings, bold, tables as pipes, `[[wikilinks]]` as text) | RD-1 |
| 6 | Single-keyword hybrid scores are nearly flat (~0.42 across the top 10); identical runs ordered differently; once an exact title match fell out of the top 20 | RD-2 |
| 7 | Semantic search embeds only the first ~8,000 characters; long notes (common in a vault) are mostly invisible to it | RD-3 |
| 8 | Domain budgets are documented as *soft* but enforced as a **hard 422** — as a vault grows, every write in that domain (MCP included) starts failing | RD-4 |
| 9 | The vault and OmniMind drift after import: deleted notes and removed wikilinks are never reflected; re-import is manual | RD-5 |
| 10 | The graph caps memories at 200 by importance — a vault larger than that silently loses nodes | RD-6 |
| 11 | The whole import → links → graph → search flow has **no CI coverage** (the real-data harness holds private data and stays out of the repo) | RD-7 |
| 12 | Ministry notes are held back (no local-embedding path in production) | RD-10 (founder decision) |

---

## Stage 0 — Unblock (founder, ~1 hour, today)

Nothing below Stage 2 can be proven in production until these are done. Order matters.

| Order | ID | Step | Why first |
|---|---|---|---|
| 1 | — | Say **"merge"** on PR #28 | The production import needs the batch-link endpoint and the read-budget fix |
| 2 | M0-F2 | Rotate the five leaked secrets (repo is public; early history holds deploy values) | The vault import authenticates with the OmniMind service key that leaked |
| 3 | M0-F1 | Production `pg_dump` + restore drill | Safety net before any bulk write or migration; go-live refuses to run without it |
| 4 | M0-F4 | Add repo variables `BOARDROOM_HOST`, `OMNIMIND_API_HOST`, `OMNIMIND_MCP_HOST` (+ optional secret `OMNIMIND_API_KEY`) | Turns on automatic post-deploy verification — every merge after that is proven in production, not assumed |
| 5 | M0-F3 | Branch protection on `main`: require `verify`, `docker`, `E2E`, `Retrieval IR eval` | Railway deploys `main` regardless of CI today |
| 6 | M1-F7 | Pick the default entity tenant (ADR-017) | Unblocks M1-B4 → B1 → B3 and M1-C4 → D2 / D4 |
| 7 | M1-F5 | Pick the gold variant (recommendation: dark-label) | One-attribute flip |

## Stage 1 — Production go-live with real data (founder + Claude, ~half a day)

| ID | Step | Owner | Done when |
|---|---|---|---|
| M1-F1 | MCP go-live (phone workflow; `backup_ok` ticked only after M0-F1) | founder | Workflow summary green; bogus-token probe 401 |
| RD-F1 | Production vault import: `--dry-run`, then real; links phase included | founder runs it, or Claude runs it once the production host is allowed in the environment's network settings and the rotated key is an environment secret | Report: every non-ministry note once in `josh-business`, links written, 0 failed |
| RD-F2 | First real decision session on a real question (real LLM) + first real MCP search from Claude Code | founder | Persona answers cite vault context; post-deploy verify green on that SHA |
| M1-F4 | Benchmark production write and `status_get` p95 | founder | Numbers recorded |

## Stage 2 — Agent wave 3 (Claude, no founder dependency — can start now)

| ID | Work | Effort | Fixes | Acceptance |
|---|---|---|---|---|
| **RD-1** | Render memory content as markdown in Memory Detail (and expanded cards): headings, lists, tables, code; `[[wikilinks]]` become links to the target memory (resolved by the importer's link rows, else by title); a **backlinks** panel ("linked from") using the existing `/memories/:id/links` + graph data. Sanitized renderer, no raw HTML. One new dependency, justified in the PR. | M | #5 | Visual shots (light/dark, desktop/mobile) of a table-heavy note; `ui-standards` + contrast gates pass; a wikilink click opens the target |
| **RD-2** | Ranking stability: (a) weight titles above body in FTS (`setweight` A/D) so an exact title match dominates; (b) find why identical queries reorder (recall reinforcement / recency in `rankAndDeduplicate`) and make `/memories/search` deterministic for identical state; (c) a keyword slice + a natural-language slice in the labeled eval, built from a **synthetic vault-shaped corpus** (no private data) | M | #6, #2 | Same query twice → same order (test); exact-title query ranks its note #1 across the eval's keyword slice; IR eval does not regress |
| **RD-4** | Budgets: make the documented behaviour true — over-budget writes succeed and raise a curator eviction proposal + a visible warning (or raise the caps), instead of a hard 422; show budget usage per domain in Settings / Admin | S–M | #8 | Test: write #401 in `business` succeeds and creates a proposal; MCP `memory_write` never fails on budget |
| **RD-6** | Graph scale: make the 200-memory cap explicit ("N more hidden — show"), allow paging / raising it, keep the communities layout responsive at ~500 nodes | S–M | #10 | Graph with 400 synthetic memories renders, settles < 5 s, shows the hidden count |
| **RD-7** | CI regression guard for the whole flow: a synthetic vault fixture in the repo + a `tests/e2e/live/checks/vault-import.mjs` journey check (import → links → graph has edges → keyword + question search find the right note → re-run writes 0) | M | #11 | Check runs in `pnpm e2e:live`; fails if the graph is empty or a re-run writes |
| **RD-5** | Vault sync: (a) importer `--prune` archives memories whose note was deleted and removes wikilink rows that no longer exist; (b) a GitHub Action in the **private** vault repo runs the importer on push (secrets live there, never in this repo) | M | #9 | Delete a note → re-run archives it; remove a wikilink → link gone; Action dry-run green |
| **RD-8** | Ratchet the retrieval-eval thresholds after three green `main` runs (per `docs/runbooks/retrieval-eval.md`) — the gate is still 0.5 while main now scores ~0.72 | S | locks in #2 | `thresholds.json` raised; CI green |
| **RD-9** | Lane follow-up backlog (each S): rebuttals restored on reload; mobile persona-card height; snippet `<pre>` stacks under its Copy button at 390 px; retry banner centred on the main pane; decorative tokens still on the old gold; WebKit sign-in cookie for `--browser webkit` | S each | lane reports | Each with a test or visual shot |

**Suggested order:** RD-1 and RD-2 first (they decide whether the imported vault is *pleasant to read* and *reliably findable* — the two things the founder will notice on day 1), then RD-7 (so they can't regress), then RD-4 and RD-6 (scale), then RD-5 (sync), RD-8, RD-9.

## Stage 2b — Founder-leverage features (2026-10-24, debated and validated)

**Why these:** the founder's recorded #1 risk is overextension, time is the binding constraint, and his stated pains are leader communication and follow-through. Each feature reuses data OmniMind already holds, adds no LLM call, and serves solo founders generally (product surface), not only this founder. Specs came from a design debate (architect → red team → judge, one per feature); the specs are in each PR description.

| ID | Feature | What ships | Schema | Gate | Deferred (by the debate) |
|---|---|---|---|---|---|
| **RD-11** | Load check — the overextension governor | Deterministic, SQL-only open-load count (active projects per domain, open/overdue commitments and tasks, decisions past review) scored against a fixed, versioned capacity; rendered as `## Current load` inside the core-context block every persona and the CEO already receive. Every non-review decision must answer **"What does this displace?"** — the CEO returns `displacement` (answer + ≤3 items to stop/pause/delegate/renegotiate/defer), shown as "What this displaces" in the synthesis. Weekly memo gets a current-load section. Level reads **UNKNOWN, never OK**, until MCP tasks/commitments are entity rows (M1-B1/B3), so the CEO cannot claim spare capacity on undercounted data. | none | merge with PR A | `GET /context/load` + session/dashboard load strip (after M3-C1 so there is one load number), `status_get` load block (after M1-B4/B1), memo trend column (after M0-F1) |
| **RD-12** | Delegation briefs + follow-through | One click from a decision's next actions or a task: pick a Person, edit a brief built only from fields the founder typed or ticked (what / by when / done when / optional why), share or copy it; only then a Commitment with `owedBy = STAKEHOLDER` is recorded. Open delegations return in "Waiting on others" (dashboard nudges: copy check-in, new date, received, drop), in MCP `status_get` (`delegations` block), and in Doer/core context, digest, memo and capsules — always "waiting on Sam", never inflating the founder's own load. No brief text stored; no outbound email. | `enum CommitmentOwedBy { USER STAKEHOLDER }` + `Commitment.owedBy` (default USER) | **PR B — merge only after the production pg_dump + restore drill (M0-F1)** | Gmail sending, LLM "polish", MCP-created delegations, People-page waiting list |
| **RD-13** | Meeting prep briefs | Dashboard card for meetings in the next 24 h: per known attendee a one-line headline ("You owe Sarah 1 overdue · Sarah owes you 2 · last touch 12d ago"), expandable to open commitments both ways, tasks they owe, related decisions, explicitly linked memories and their capsule summary. Attendees matched by normalized name and title tokens ("Lunch w/ Sarah"). Deterministic, no LLM, nothing cached but the Google event list; partial data degrades per section. | none | merge with PR A | MCP person brief (inside M1-B1 after M1-B4), status_get upcoming meetings (needs an ADR for calendar data in OmniMind), `Person.emails` matching (trigger: coverage < 50% in dogfood week 1), contradiction "tensions" |

**RD-12 cross-item requirements (binding on later items):** M1-B1's `commitment_list`, snapshot `pendingCommitments` and commitment counts read `GET /commitments?owedBy=USER`, so delegations never appear as the founder's own commitments; M3-C1's Today section consumes the same own/waiting partition as the nudges widget; M3-B2's capture typing offers "someone owes me" as a delegation (owedBy STAKEHOLDER), never as an own commitment. RD-11's load query already filters `owedBy: USER`.

**Next tier — only if the dogfood scorecard shows daily use (decide at M4):**

| ID | Feature | Size | Why it waits |
|---|---|---|---|
| RD-14 | Decision staleness + assumption re-check at outcome review (DecisionAssumption exists) | S–M | Strengthens calibration once reviews actually happen (≥ 1/week per the scorecard) |
| RD-15 | Venture pulse — weekly KPI snapshot per venture written by the founder's GHL MCP clients (`memory_write`), read by the weekly memo | S (MCP-side) | Needs MCP live in production; never build native GHL connectors |
| RD-16 | Calling-alignment check — monthly: where decisions and load went by domain vs. the stated calling order | S | Needs RD-11's load data over several weeks |

**Not building (recorded so it is not re-litigated):** sermon prep workshop (the founder already runs a separate sermon-prep system; ministry gated by RD-10); church stewardship / Planning Center dashboard (a separate church dashboard already exists; ministry-gated); pastoral care tracker (most sensitive data; RD-10 first, maybe never); native mobile or voice capture (the Claude apps reach memory through MCP once OAuth is live, M2-F1); simulators, OKR builder, strategy canvas, industry radar, network map (breadth without evidence); multi-user rooms (no second user).

## Stage 3 — After founder decisions (Phase 8 M1 remainder + scale)

| ID | Work | Depends on |
|---|---|---|
| M1-B4 → M1-B1 → M1-B3 | Entity tenancy migration, tenant-scoped MCP entity tools, backfill | M1-F7, M0-F1 |
| M1-C4 → M1-D2, M1-D4 | Real dashboard actions; reduced motion; keyboard-reachable cards | M1-B4 |
| **RD-3** | Long-note embeddings: chunk notes > 8k chars into sections, embed each, score a memory by its best chunk (new chunk table + migration; backfill for existing rows) | M0-F1 (migration), production embeddings live |
| **RD-10** | Ministry path: decide where local embeddings run (a private Railway service for the embedding model vs. a machine the founder controls), lift `MINISTRY_DEFERRED`, import the held-back ministry notes into `tgfc-ministry` | **Founder decision** on hosting; never falls back to OpenAI |

## Stage 4 — Phase 8 M2 (unchanged, now with real data)

OAuth issuer (M1-F6 → M2-F1), `status_get` moat (M2-B1), connected sign-ins (M2-B2), one entity cache (M2-C1), first-run connect (M2-C2), WebKit/iOS (M2-D1/D2), dogfood scorecard (M2-A1) → **dogfood day 1 on 2026-11-12** — with the imported vault as the day-1 corpus instead of an empty account.

---

## Decisions the founder owns

1. **Merge PR #28** (search behaviour changes for every client).
2. **Default entity tenant** (M1-F7).
3. **Source of truth for notes:** recommended — the vault stays the source of truth for notes (OmniMind mirrors it via RD-5); OmniMind is the source of truth for decisions, tasks and commitments. Two-way sync is out of scope.
4. **Budgets:** soft limits with curator proposals (recommended) or higher hard caps.
5. **Ministry hosting** for local embeddings (RD-10).

## Blind spots

- **Zero production evidence.** Three merged PRs and the vault importer have never been observed running in production. Stage 0 step 4 fixes this permanently.
- **The leaked secrets** gate the vault import itself — importing a second brain behind a public key is the worst-case order of operations.
- **Search quality depends on embeddings in production.** The sandbox run had none; RD-2/RD-7 make the no-embedding fallback good, but an OpenAI outage still degrades search.
- **Founder throughput is the bottleneck:** seven Stage-0 items gate everything after Stage 2. Stage 2 is sized so agent work continues while they land.
