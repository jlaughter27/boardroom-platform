# Vault import — Obsidian vault → OmniMind

`scripts/vault-import.mjs` (`pnpm import:vault`) loads an Obsidian vault into OmniMind: one memory per note, synced by vault path. Re-running it is the sync: new notes are created, edited notes are updated in place, unchanged notes are skipped. By default it never removes anything; `--prune` also mirrors deletions (see [Prune](#prune-mirror-deletions)). It never hard-deletes.

## What goes in, what stays out

| | Rule |
|---|---|
| **Imported** | every `*.md` under `wiki/` and `.raw/` |
| **Skipped (plumbing)** | `wiki/log.md`, `wiki/hot.md`, Obsidian Bases (`*.base.md`), generated catalogs (`index.md`, `_index.md`, `*-index.md`), `lint-report-*` / `tiling-report-*`, `dashboard.md`, `type: alias` stubs |
| **Held back (ministry)** | tag `ministry` or `tgfc`, a `ministry/` folder, or `tgfc` in the path. Ministry writes need local embeddings (Ollama) and OmniMind answers `503 MINISTRY_DEFERRED` until that path is live; the importer lists them and never relabels them. |
| **Not imported** | vault tooling outside `wiki/` and `.raw/` (`skills/`, `commands/`, `agents/`, `docs/`, `_templates/`, `.obsidian/`, …) |

Domain (OmniMind's per-domain budget: business 400, personal 200, ai-systems 300, other 250 live memories per user — soft since RD-4: OmniMind accepts writes past it and answers with a `budget` warning; usage is in Settings → Memory budget / `GET /memories/budget`): `personal` (`.raw/identity/`, `personal` tag/folder) → `learning` (course modules, glossary) → `ai-systems` → `business`.

Each memory: `title` = frontmatter `title` or file name; `content` = the note body (markdown, wikilinks kept); `sourceType: API_IMPORT`; `sourceRef: vault:<path>`; tags `vault`, `vault:<type>` + the note's tags; `importance` from `status` (evergreen 0.7 … stub 0.3, archive 0.2); `metadata.vault` = `{path, sha256, type, status, created, updated, aliases, links}`.

Writes go through `POST /memories` (validation pipeline) as agent `vault-import` in **one tenant** (default `josh-business` — MCP reads are tenant-scoped, so that is where Claude Code and the other MCP clients see them). Creates send `dedup: false` (see `docs/contracts/omnimind-api.contract.md` → POST /memories) so the near-duplicate auto-supersede cannot let one note overwrite another. Writes are paced at 18/min (OmniMind's per-user write limit is 20/min) and honour `Retry-After`. Before writing, the importer checks each domain's live count + new notes against the budget and stops with nothing written if one would overflow. Since RD-4 that preflight is a courtesy of the importer, not a server limit: OmniMind no longer refuses over-budget writes (MCP `memory_write` included), so an import that passes the preflight cannot start failing halfway because another client wrote in the meantime.

Semantic search embeds the first ~8,000 characters of a note; full-text and trigram search cover the whole note.

**Links.** After every note exists, the importer turns `[[wikilinks]]` into memory→memory links (`linkType: wikilink`) with `POST /memories/links/batch` (500 per request), so the knowledge graph shows the vault's structure instead of 200 orphans. A target resolves by file name, title or alias (case-insensitive; `[[folder/Note]]` uses its last segment). Targets that were skipped, held back (ministry) or don't exist stay unresolved and are counted in the summary — no link crosses the ministry boundary or a tenant. Additive and idempotent: a re-run reports existing links. A wikilink removed from a note is unlinked only with `--prune`. `--no-links` skips the phase.

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

Options: `--tenant <id>` (default `josh-business`), `--user-id <id>` instead of `--user-email`, `--rate <writes/min>`, `--report <file>`, `--no-links`, `--prune` (+ `--allow-mass-prune`, see below). When `OMNIMIND_REQUIRE_AGENT_KEY=true`, set `OMNIMIND_AGENT_KEY=<omk_ key>` of an agent in the target tenant with `memory:write`; the importer then sends `x-agent-key` instead of the unverified header triple.

Exit codes: `0` done (or dry run), `1` at least one write failed (listed with status + reason), `2` usage, config or preflight (budget, mass-prune guard) error — nothing written.

## Prune (mirror deletions)

`--prune` makes the run mirror removals as well as additions. The vault is the source of truth for notes; OmniMind mirrors it, one way.

| In the vault | With `--prune` |
|---|---|
| A note is deleted, renamed, becomes plumbing (e.g. `*.base.md`) or becomes ministry | Its memory is **archived**: `DELETE /memories/:id`, which is OmniMind's soft delete (`status: ARCHIVED` + `deletedAt`; the row stays in the database). `PATCH /memories/:id` cannot set `status`, so this is the archive path. A renamed note comes back as a new memory under its new path. |
| A `[[wikilink]]` is removed from a note, or its target note is gone | The importer's `wikilink` row is removed with `DELETE /memories/:id/links/:linkId`. Only `linkType: wikilink` rows between vault memories are touched. Links you made by hand, and the links of archived memories, stay. |

- `--prune --dry-run` lists what it would archive and unlink (`would archive …`, `would unlink … → …`) and writes nothing. The `--report` JSON carries `prune: { archive, archived, unlink, unlinked, failed }`.
- **Guard:** it refuses (exit 2, nothing written) to archive more than half of the vault rows in one run when that is more than 5 rows. A vault that lost most of its notes at once is more likely mis-mounted (wrong `--vault`, a failed checkout) than emptied. Pass `--allow-mass-prune` when it really is intended.
- Cost: the link check reads `GET /memories/:id/links` once per note, paced at 90/min to leave room in the 120/min read budget for the BoardRoom UI. That is about 6 minutes for 500 notes, on top of any writes.
- Without `--prune` the run stays additive: nothing is archived or unlinked.

## Automatic sync (GitHub Actions in the private vault repo)

Run the importer from the **private vault repository** on every push. The secrets live there. This public repo only provides the script, so nothing here holds a key or a note. The script is one file that needs only Node 20 built-ins, so the workflow checks out just that file at a pinned commit.

1. In the vault repo → Settings → Secrets and variables → Actions, add:
   - `OMNIMIND_API_URL`: `https://omnimind-api-production.up.railway.app` (a GitHub runner cannot use Railway private networking)
   - `OMNIMIND_API_KEY`: the OmniMind service key (the rotated one, M0-F2)
   - `VAULT_IMPORT_USER_EMAIL`: your BoardRoom login e-mail
   - optional `OMNIMIND_AGENT_KEY`: the `omk_` key of an agent in `josh-business` with `memory:write`. You need it once `OMNIMIND_REQUIRE_AGENT_KEY=true`.
2. Replace `PINNED_SHA` below with the full 40-character SHA of a `main` commit of `jlaughter27/boardroom-platform` that has `--prune`. Pin a SHA, not a branch, so a change in this repo never runs against your vault until you bump it.
3. Save the file as `.github/workflows/omnimind-sync.yml` in the vault repo:

```yaml
name: Sync vault to OmniMind

on:
  push:
    branches: [main]
    paths: ["wiki/**", ".raw/**"]
  workflow_dispatch:
    inputs:
      dry_run:
        description: "List what would change (notes, archives, unlinks); write nothing"
        type: boolean
        default: true

# One sync at a time; a push during a run queues the next one (each run syncs the whole vault).
concurrency:
  group: omnimind-vault-sync
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  sync:
    runs-on: ubuntu-latest
    # A large first import waits out OmniMind's limits (20 writes/min per user,
    # 200 writes/hour per agent). Pushes after that touch a handful of notes.
    timeout-minutes: 330
    steps:
      - name: Check out the vault
        uses: actions/checkout@v4
        with:
          path: vault
          persist-credentials: false

      - name: Check out the importer (pinned)
        uses: actions/checkout@v4
        with:
          repository: jlaughter27/boardroom-platform
          ref: PINNED_SHA
          path: boardroom
          sparse-checkout: scripts/vault-import.mjs
          sparse-checkout-cone-mode: false
          persist-credentials: false

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Import with --prune
        env:
          OMNIMIND_API_URL: ${{ secrets.OMNIMIND_API_URL }}
          OMNIMIND_API_KEY: ${{ secrets.OMNIMIND_API_KEY }}
          VAULT_IMPORT_USER_EMAIL: ${{ secrets.VAULT_IMPORT_USER_EMAIL }}
          OMNIMIND_AGENT_KEY: ${{ secrets.OMNIMIND_AGENT_KEY }}
          DRY_RUN: ${{ github.event_name == 'workflow_dispatch' && inputs.dry_run && '--dry-run' || '' }}
        run: node boardroom/scripts/vault-import.mjs --vault vault --prune $DRY_RUN --report "$RUNNER_TEMP/vault-sync.json"

      # The report lists note paths and titles, so it stays in this private repo, briefly.
      - name: Upload the sync report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: vault-sync-report
          path: ${{ runner.temp }}/vault-sync.json
          if-no-files-found: ignore
          retention-days: 7
```

**First run: dry run first.** Commit the workflow and don't push a note yet. Open Actions → *Sync vault to OmniMind* → *Run workflow*, and leave **dry_run** ticked (the default). Read the log. Check the note count per domain, `ministry held back`, the budget line, and above all `prune (dry run): would archive N`. On the first sync after a manual import that number should be 0, or only notes you really deleted. If the dry run is green and the numbers look right, run it again with dry_run unticked, or just push. Every push to `main` that touches `wiki/` or `.raw/` then syncs. Exit code 1 (a write failed) fails the run, and the report artifact says which note failed and why.

## Verify

- BoardRoom → Memory Explorer: filter tag `vault`.
- Any MCP client on a `josh-business` token: `memory_search "<a phrase from a note>"`.
- `GET /memories?tags=vault&limit=1` with the agent headers → `total` equals the number of imported notes.

**Regression guard (RD-7).** CI's `e2e` job imports the synthetic vault in `tests/fixtures/vault/` (invented notes; answer key `expected.json`) into a throwaway OmniMind + BoardRoom and asserts: every importable note lands once in `josh-business`, ministry and plumbing stay out, the wikilinks reach `GET /graph` as memory→memory edges, a keyword and a natural-language question each find their note in the top 3, a re-run writes nothing, and, after a note and a wikilink are removed from its copy, `--prune --dry-run` lists exactly those and `--prune` archives the note and removes the two stale links. Locally: `node tests/e2e/live/checks/vault-import.mjs --standalone` (needs `BOARDROOM_URL`, `OMNIMIND_URL`, `OMNIMIND_API_KEY`), or as one step of `pnpm e2e:live`. Never point it at the real vault; the fixture is the contract.

## Ministry notes

When the ministry embedding path is live (local embeddings, `MINISTRY_DEFERRED` lifted), extend the importer to write the held-back list to `tgfc-ministry` with `domain: ministry`. Until then they stay in the vault only.
