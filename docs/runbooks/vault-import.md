# Vault import — Obsidian vault → OmniMind

`scripts/vault-import.mjs` (`pnpm import:vault`) loads an Obsidian vault into OmniMind: one memory per note, synced by vault path. Re-running it is the sync: new notes are created, edited notes are updated in place, unchanged notes are skipped. It never deletes.

## What goes in, what stays out

| | Rule |
|---|---|
| **Imported** | every `*.md` under `wiki/` and `.raw/` |
| **Skipped (plumbing)** | `wiki/log.md`, `wiki/hot.md`, Obsidian Bases (`*.base.md`), generated catalogs (`index.md`, `_index.md`, `*-index.md`), `lint-report-*` / `tiling-report-*`, `dashboard.md`, `type: alias` stubs |
| **Held back (ministry)** | tag `ministry` or `tgfc`, a `ministry/` folder, or `tgfc` in the path. Ministry writes need local embeddings (Ollama) and OmniMind answers `503 MINISTRY_DEFERRED` until that path is live; the importer lists them and never relabels them. |
| **Not imported** | vault tooling outside `wiki/` and `.raw/` (`skills/`, `commands/`, `agents/`, `docs/`, `_templates/`, `.obsidian/`, …) |

Domain (OmniMind's per-domain budget: business 400, personal 200, ai-systems 300, other 250 live memories per user): `personal` (`.raw/identity/`, `personal` tag/folder) → `learning` (course modules, glossary) → `ai-systems` → `business`.

Each memory: `title` = frontmatter `title` or file name; `content` = the note body (markdown, wikilinks kept); `sourceType: API_IMPORT`; `sourceRef: vault:<path>`; tags `vault`, `vault:<type>` + the note's tags; `importance` from `status` (evergreen 0.7 … stub 0.3, archive 0.2); `metadata.vault` = `{path, sha256, type, status, created, updated, aliases, links}`.

Writes go through `POST /memories` (validation pipeline) as agent `vault-import` in **one tenant** (default `josh-business` — MCP reads are tenant-scoped, so that is where Claude Code and the other MCP clients see them). Creates send `dedup: false` (see `docs/contracts/omnimind-api.contract.md` → POST /memories) so the near-duplicate auto-supersede cannot let one note overwrite another. Writes are paced at 18/min (OmniMind's per-user write limit is 20/min) and honour `Retry-After`. Before writing, the importer checks each domain's live count + new notes against the budget and stops with nothing written if one would overflow.

Semantic search embeds the first ~8,000 characters of a note; full-text and trigram search cover the whole note.

**Links.** After every note exists, the importer turns `[[wikilinks]]` into memory→memory links (`linkType: wikilink`) with `POST /memories/links/batch` (500 per request), so the knowledge graph shows the vault's structure instead of 200 orphans. A target resolves by file name, title or alias (case-insensitive; `[[folder/Note]]` uses its last segment). Targets that were skipped, held back (ministry) or don't exist stay unresolved and are counted in the summary — no link crosses the ministry boundary or a tenant. Additive and idempotent: a re-run reports existing links; a wikilink removed from a note is not unlinked. `--no-links` skips the phase.

## Run it

```bash
# 1. Plan only — reads the vault, no network
pnpm import:vault -- --vault <path-to-vault> --plan-only

# 2. Dry run against production — reads existing rows + budgets, writes nothing
OMNIMIND_API_URL=https://omnimind-api-production.up.railway.app \
OMNIMIND_API_KEY=<OmniMind service key> \
pnpm import:vault -- --vault <path-to-vault> --user-email <your BoardRoom login e-mail> --dry-run

# 3. Import (≈ 1 min per 18 notes at the default pace) — same command without --dry-run; --report out.json keeps the result
```

Options: `--tenant <id>` (default `josh-business`), `--user-id <id>` instead of `--user-email`, `--rate <writes/min>`, `--report <file>`. When `OMNIMIND_REQUIRE_AGENT_KEY=true`, set `OMNIMIND_AGENT_KEY=<omk_ key>` of an agent in the target tenant with `memory:write`; the importer then sends `x-agent-key` instead of the unverified header triple.

Exit codes: `0` done (or dry run), `1` at least one write failed (listed with status + reason), `2` usage, config or preflight (budget) error — nothing written.

## Verify

- BoardRoom → Memory Explorer: filter tag `vault`.
- Any MCP client on a `josh-business` token: `memory_search "<a phrase from a note>"`.
- `GET /memories?tags=vault&limit=1` with the agent headers → `total` equals the number of imported notes.

**Regression guard (RD-7).** CI's `e2e` job imports the synthetic vault in `tests/fixtures/vault/` (invented notes; answer key `expected.json`) into a throwaway OmniMind + BoardRoom and asserts: every importable note lands once in `josh-business`, ministry and plumbing stay out, the wikilinks reach `GET /graph` as memory→memory edges, a keyword and a natural-language question each find their note in the top 3, and a re-run writes nothing. Locally: `node tests/e2e/live/checks/vault-import.mjs --standalone` (needs `BOARDROOM_URL`, `OMNIMIND_URL`, `OMNIMIND_API_KEY`), or as one step of `pnpm e2e:live`. Never point it at the real vault; the fixture is the contract.

## Ministry notes

When the ministry embedding path is live (local embeddings, `MINISTRY_DEFERRED` lifted), extend the importer to write the held-back list to `tgfc-ministry` with `domain: ministry`. Until then they stay in the vault only.
