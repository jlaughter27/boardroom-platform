# PHASE 11 — Markdown Export + Git Sync

**Time budget:** 3-4 weeks (research-validated; original 1w estimate did not account for vault-layout design + git OAuth + conflict folder)
**Sequence:** Concurrent with Phase 10 (no shared files); parallel team-mate ships this while another ships MCP.
**Owner:** dev
**Confidence:** MED (vault layout decisions are durable; git sync conflict story has known sharp edges)

---

## What this is

Make every user's data **portable, auditable, and editable in their own tools**. Concretely:

- **On-demand export** to a user-owned GitHub repo via OAuth. User clicks "Export to GitHub", we push a vault.
- **Vault layout** (Obsidian-compatible):
  ```
  /memories/                  — one .md per memory
  /decisions/                 — one .md per decision
  /entities/people/           — one .md per Person
  /entities/goals/            — one .md per Goal
  /entities/projects/         — one .md per Project
  /entities/tasks/            — one .md per Task
  /cortex/                    — weekly memos, patterns, contradictions
  /.omnimind/                 — metadata: schema version, embedding hashes, manifest
  README.md                   — vault-level README explaining the layout
  ```
- **Frontmatter convention:** YAML with every database field as a key. Reserved keys: `id`, `domain`, `created`, `confidence`, `source`, `entities` (wikilink list), `embedding_hash`. Dates ISO-8601. Tags lowercase kebab-case.
- **Wikilinks** for entity references: `[[entities/people/alex-chen]]`, `[[entities/projects/q2-pricing#Decision]]`.
- **Re-import on demand** with a **conflict folder** (`_conflicts/{id}-{timestamp}.md`) for any file edited both sides since the last sync. No bidirectional CRDT in v1.
- **Encryption at rest:** plaintext default; opt-in `age`-based encryption deferred to v2.

---

## Why now

1. **"Your data is yours" is a sales argument** for indie hackers and consultants. Memory tools that can't export are a lock-in red flag.
2. **Auditability for the founder.** Markdown vault is a debugger's gift — when retrieval gets weird, eyeballing the raw memory in Obsidian beats any UI.
3. **Future-proofs against the database** — if Postgres melts, the user still has the data.

## Prerequisites

- Phase 0-9 complete (entity tables stable; bi-temporal-lite landed in Phase 1)
- GitHub OAuth app provisioned (separate from any existing GitHub OAuth — this one needs `repo` scope)
- `OAuthToken` table already exists (Phase 3 integrations) — extend it for GitHub
- Decision on vault root directory naming (`omnimind-vault-{userId}` is the default; user can rename)

## Exit criteria

- [ ] `POST /export/github` initiates an export job; returns `{ jobId }`
- [ ] Background worker (graphile-worker by Phase 18; node-cron-driven for v1) processes export within 5 min for accounts <1k memories
- [ ] User-owned repo receives a clean commit with the full vault
- [ ] Re-running export updates only changed files (idempotent diff-and-write)
- [ ] `POST /import/github` pulls the user's repo and reconciles changes back into the database
- [ ] Conflict folder populated for any file modified on both sides (LWW with the loser preserved)
- [ ] Vault README.md self-documents the layout
- [ ] `/.omnimind/manifest.json` includes schema version, last sync timestamp, file count per type
- [ ] Eval scenario: round-trip 50 memories + 10 decisions + 20 entities through export → modify → import; verify referential integrity
- [ ] `docs/contracts/markdown-vault.contract.md` documents the layout + frontmatter schema

## Dependencies

- **Upstream:** Phase 1 (entity tables), Phase 4 (entity link tables for wikilink generation)
- **Downstream blocks:** Phase 10's `memory://{id}` resource handler can reuse the markdown rendering once landed; doesn't block Phase 10 because Phase 10 ships inline minimal renderers
- **Concurrency:** Parallel-safe with Phase 10. Both can ship in the same release window.

## Blast radius

- **Net-new code surface.** New routes, new export/import services, new GitHub OAuth path. Modifies `OAuthToken` schema (additive — new `provider='github-vault'` value).
- **Risk concentration:** the diff-and-write logic on re-export. If broken, every re-export overwrites unchanged files and pollutes git history. Mitigated by a per-file SHA256 comparison before write.
- **Rollback:** disable via `VAULT_EXPORT_ENABLED=false`; existing exports remain in user repos and are unaffected.

---

**Constraints reminder:** Respect ADR-001 (no frameworks), ADR-002 (Anthropic only), ADR-003 (pgvector only), ADR-009 (node-cron only). All prompts in `docs/prompts/*.system.md`. All LLM tool outputs Zod-validated. CLAUDE.md service-boundary rules apply.
