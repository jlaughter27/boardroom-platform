# Markdown Export + Import (Obsidian-Style Vault)

> Constraints reminder: Respect ADRs 001-013. See [`../01-foundations/CONSTRAINTS.md`](../01-foundations/CONSTRAINTS.md).

---

## Problem

Today, OmniMind data lives only in Postgres. If a user wants to read their memories outside BoardRoom, back them up offline, fork them into a research notebook, or take them to a competitor, they can't. That's a trust ceiling. The strongest signal we can send to a "your data, your tools" audience — the same audience Obsidian, Logseq, Reflect, and self-hosters care about — is **a folder of markdown files that round-trips losslessly with the database**.

Without it, OmniMind is "yet another SaaS that holds your second brain hostage." With it, OmniMind becomes the *intelligence* on top of a vault the user owns, syncs to GitHub, and could in principle read with `cat`.

## Approach

Adopt the Obsidian conventions — flat directory of `.md` files, YAML frontmatter, wikilinks, hidden dotfolders for app state — and ship a v1 that is **export-only with manual git push to a user-owned GitHub repo**. v2 adds bidirectional sync and CRDT-based merge.

### Vault layout

```
omnimind-vault-{userId}/
├── memories/
│   ├── 2026-04-18-pricing-call.md
│   └── 2026-04-19-launch-prep.md
├── decisions/
│   └── d-q2-pricing-strategy.md
├── entities/
│   ├── people/
│   │   └── alex-chen.md
│   ├── goals/
│   │   └── ship-q2-launch.md
│   ├── projects/
│   │   └── q2-pricing.md
│   └── tasks/
│       └── send-pricing-deck.md
├── cortex/
│   ├── memos/2026-W16.md
│   └── contradictions/2026-04-15.md
├── attachments/
│   └── (binary uploads; SHA-named)
└── .omnimind/
    ├── config.yaml          # vault format version, last-export ts
    ├── embeddings.lock      # SHA hashes per memory; skips re-embed on import
    └── schema-version.json
```

User data at the root; OmniMind app state in `.omnimind/`. This mirrors how `.git/` and `.obsidian/` work — a deliberate convention so the vault remains user-readable even after OmniMind goes away.

### Frontmatter convention

Every markdown file has a YAML header. The rule: **every Prisma column maps to a frontmatter key or a body section with a documented marker**. ISO-8601 dates, lowercase kebab-case tags, entity references as wikilinks.

Memory example:

```yaml
---
id: mem_01HXYZABC
domain: business
created: 2026-04-18T14:32:00Z
updated: 2026-04-18T14:32:00Z
confidence: 0.82
source_session: session_01HW...
entities:
  - "[[entities/people/alex-chen]]"
  - "[[entities/projects/q2-pricing]]"
embedding_model: text-embedding-3-small
embedding_hash: sha256:7f2c...
deleted_at: null
---

# Pricing call with Alex

Discussed bumping the Pro tier from $49 to $79. Alex pushed back on...
```

Embeddings themselves are NOT exported (they regenerate on import). The hash is recorded so re-embedding can be skipped if the model version matches — saves ~30s per 100 memories on re-import.

### Wikilinks

Entity references use `[[entities/people/alex-chen]]` (path-based, Obsidian-compatible). On export, OmniMind resolves entity IDs to vault paths. On import, the reverse. Wikilinks are content-addressed by file existence, so users can rename/move freely.

## Phasing

### v1 (Phase 11) — export-only

- Background job (`graphile-worker` cron) generates the vault on demand or on a schedule.
- User triggers export via UI button or scheduled push (weekly default).
- Output: a directory in `/tmp` plus a one-time download URL OR a commit to the user's `omnimind-vault-{userId}` GitHub repo via OAuth.
- Re-import is supported but treated as a "migration": conflicts go to `_conflicts/{id}-{timestamp}.md` and surface in the memory editor UI for review.

### v2 (Phase 18+) — bidirectional with conflict resolution

- File-watcher on the GitHub repo (webhook-on-push) re-derives state through the validation pipeline.
- Last-write-wins per file, with conflict folder for divergent edits.
- CRDT-backed merge (Yjs) for power users who want true multi-device.

## Git sync (user-owned GitHub repo)

OmniMind ships an OAuth GitHub App. On first export the user authorises the app; OmniMind creates `omnimind-vault-{userId}` (private by default), commits the vault, and stores the OAuth token in the existing `OAuthToken` table (encrypted with `ENCRYPTION_KEY`). Subsequent exports are commits to the same repo with messages like `chore: omnimind sync 2026-04-18T14:32Z`.

User can fork, archive, share, or detach the repo at any time. OmniMind never owns the canonical copy of the vault — the user's GitHub does.

## Schema impact

```prisma
model VaultExport {
  id            String   @id @default(cuid())
  userId        String
  triggeredBy   String   // "manual" | "scheduled" | "deletion"
  status        String   // "pending" | "succeeded" | "failed"
  vaultFormat   String   // semver of the vault layout
  memoryCount   Int
  decisionCount Int
  entityCount   Int
  githubCommit  String?  // SHA if pushed to user's repo
  errorMessage  String?
  createdAt     DateTime @default(now())
  completedAt   DateTime?
  user          User     @relation(fields: [userId], references: [id])

  @@index([userId, createdAt])
}
```

`MemoryEntry.embeddingHash` is added (also useful for embedding model versioning — see [embedding-model-versioning.md](embedding-model-versioning.md)).

## API surface

- `POST /v1/vault/exports` — kick off an export, returns `VaultExport` row
- `GET /v1/vault/exports/:id` — poll status
- `GET /v1/vault/exports/:id/download` — one-time signed URL (zip)
- `POST /v1/vault/github/connect` — OAuth init for GitHub
- `POST /v1/vault/imports` — v2 only; takes a vault zip or git URL

## Phases

- [`../04-roadmap/PHASE-11-markdown-export/`](../04-roadmap/PHASE-11-markdown-export/) — v1
- v2 (bidirectional) is unscheduled

## Risks

- **Encryption at rest in the user's repo.** Private GitHub repo means GitHub is the trust anchor. For paranoid users, opt-in `age` encryption gives "GitHub holds ciphertext, OmniMind holds the key." Adds friction (no GitHub web preview). Realistic 2026 default: plaintext in private repos with opt-in encryption flag in `.omnimind/config.yaml`.
- **Markdown + YAML conflict math.** Line-based git merges of YAML are atrocious. v1 sidesteps with export-only + last-write-wins; v2 CRDT is real engineering.
- **Schema drift between vault format and Prisma schema.** Mitigation: `vaultFormat` semver in `VaultExport` row; importer rejects unknown majors with a clear migration error.
- **Embedding regeneration cost on re-import.** Mitigation: `embedding_hash` in frontmatter; importer skips re-embed if hash + model match.
- **GitHub rate limits on bulk pushes.** Mitigation: chunked commits (max 1000 files per commit), exponential backoff.

## Success metrics

- 100% of fields round-trip losslessly on export → re-import (verified by integration test diffing pre/post Prisma rows)
- < 30s export time for a 1,000-memory vault
- < 5% of users hit a re-import conflict (target after first 30 days of v2)
- ≥ 20% of paying users connect their GitHub vault within 90 days

## Dependencies on other features

- **Memory editor UI** (Phase 11) — surfaces re-import conflicts for review
- **Embedding model versioning** (Phase 14) — `embedding_hash` is shared infrastructure
- **GDPR data export + deletion** (Phase 13) — vault export is a building block for the GDPR "give me everything" endpoint
- **Webhooks event bus** (Phase 13) — `vault.exported` event for downstream automation
