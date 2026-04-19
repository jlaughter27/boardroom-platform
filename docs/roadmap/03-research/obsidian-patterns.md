# Obsidian — What Omnimind Takes for Markdown Export

**Source:** `docs/research/omnimind-roadmap-2026/wave1-research/04-external-interfaces.md` §3-4 (markdown-as-data, git as sync backend).

Obsidian set the de facto standard for "your knowledge as a folder of markdown." It is not a memory system; it is a human-first editor over a portable file format. Omnimind is not Obsidian — but the **export contract** Obsidian normalized is the right interoperability target for omnimind's data portability story.

This document covers what omnimind takes from the Obsidian convention (Phase 11) and what we explicitly leave on the table.

---

## ADOPT

### Markdown-as-data export — Phase 11

**What Obsidian normalized.** A vault is a folder of `.md` files. Each file is a self-contained note. Relationships are computed from links (wikilinks). Metadata lives in YAML frontmatter between `---` fences. Hidden `.obsidian/` folder for app-specific config.

**Why omnimind adopts.** Three product wins:
1. **Data portability.** Users can leave omnimind with their knowledge intact. Their export is readable in Obsidian, VS Code, Notion (via importer), Logseq, plain `cat`. There is no lock-in.
2. **GitHub as backup.** Push the vault to a user-owned GitHub repo via OAuth. Free private repos for individuals; paid for teams. GitHub's diff/history UI becomes a free "memory timeline."
3. **External tooling.** Users can grep, ripgrep, build their own analytics, plug into Zettlr/Obsidian/Logseq. Omnimind doesn't have to build every viewer.

### Frontmatter convention — every database field maps to a YAML key

**Obsidian's reserved keys.** `tags`, `aliases`, `cssclass`, `publish`. Everything else is user-defined.

**Omnimind's frontmatter for memories** (example from `wave1-research/04-external-interfaces.md` §3):

```yaml
---
id: mem_01HXYZ...
domain: business
created: 2026-04-18T14:32:00Z
confidence: 0.82
source: session_01HW...
entities: [person:alex_chen, project:q2_pricing]
embedding_hash: sha256:7f2c...
---
```

**Conventions:** ISO-8601 timestamps; lowercase kebab-case tags; entity references as wikilinks in body or as typed strings in frontmatter; embedding excluded but hash recorded so re-embedding can be skipped on import if the model version matches. Embeddings regenerate on import — they are derived data, not source.

### Wikilink-style entity references — already partially have this

**Obsidian's syntax.** `[[Project Q2 Pricing]]` resolves by title. `[[Project Q2 Pricing#Decision]]` deep-links to a heading. `[[mem_01HXYZ|the pricing call]]` is alias-display. Wikilinks are content-addressed, not path-based — files move freely.

**What omnimind already has.** The typed link tables (`MemoryEntityLink`, `GoalProjectLink`, `ProjectPersonLink`, `ProjectTaskLink`, `DecisionProjectLink`, `TaskDependency`, `CommitmentLink`) implement the same many-to-many entity reference model in SQL. The export layer translates these joins into wikilinks; the import layer parses wikilinks back into link-table rows.

**Conflict with rich entity types.** Obsidian wikilinks are untyped (`[[Alice Chen]]` doesn't say "this is a Person"). Omnimind needs typed references. The compromise: prefix the link text with the entity type (`[[person:alex_chen]]`, `[[project:q2_pricing]]`), or use frontmatter for typed references and wikilinks in body text for prose readability. Phase 11 picks frontmatter as primary, wikilinks as secondary, both written to disk.

### Vault structure — `memories/`, `decisions/`, `entities/`

Adopt the per-domain folder convention because it makes hand-navigation tolerable:

```
my-omnimind-vault/
├── memories/
│   ├── 2026-04-18-pricing-call.md
│   └── ...
├── decisions/
│   ├── 2026-03-q2-pricing-strategy.md
│   └── ...
├── entities/
│   ├── people/
│   │   └── alex-chen.md
│   ├── goals/
│   ├── projects/
│   │   └── q2-pricing.md
│   └── tasks/
├── cortex/
│   ├── memos/
│   │   └── 2026-W15.md
│   ├── patterns/
│   └── contradictions/
└── .omnimind/
    ├── manifest.json
    └── embedding-cache.jsonl
```

User-meaningful data at the root. App metadata in `.omnimind/`. Manifest declares schema version, export timestamp, tool version, embedding model. Embedding cache (jsonl of `{id, hash, model, timestamp}`) lets re-import skip re-embedding for unchanged content.

### Git as the sync backend

**Three patterns from the research** ([wave1-research/04-external-interfaces.md §4](../../research/omnimind-roadmap-2026/wave1-research/04-external-interfaces.md)):
- Repo-per-user (`omnimind-vault-{userId}` on user's GitHub) — simplest, lets user fork/share/archive.
- Branch-per-user in one org repo — central backup, but violates "your data."
- Forked-vault (Logseq pattern) — server holds canonical, user clones, sync via git push/pull.

**Omnimind's choice (Phase 11):** repo-per-user with OAuth-granted push access. User owns the repo; omnimind is the writer. Trivial to fork or archive; trivial to leave omnimind with the data.

**Conflict handling.** Last-write-wins per file with a conflict folder (`_conflicts/{id}-{timestamp}.md`). Markdown + YAML merge terribly with line-based git when two clients edit the same file; CRDTs (Yjs/Automerge) are the right answer for multi-device but defer to Phase 11.5 or later. v1 of the export ships LWW + conflict folder.

---

## DON'T TAKE

### Human-first editing UX

**Obsidian's killer feature.** Live preview, internal linking with autocomplete, plugin ecosystem (Dataview, Templater, Calendar), graph view, mobile sync, web clipper. Obsidian is a *first-class editor* for markdown.

**Why omnimind doesn't compete.** Building an editor is not omnimind's DNA. The product is decision intelligence with a structured, persona-driven workflow — not "your knowledge in a folder." Users who want a markdown editor have Obsidian; users who want decision intelligence have omnimind. The export is the bridge, not the destination.

### Obsidian's plugin ecosystem

**Why not.** Obsidian plugins are first-party JavaScript with unrestricted access to the vault. Omnimind has a different extensibility model (custom personas, MCP server, persona marketplace) that targets agent integration, not editor extension. Trying to be both an "open editor" and a "structured agent backend" is two products.

### Bi-directional sync as v1

**The hard problem.** Real-time sync between the omnimind DB and a markdown vault means: detecting file changes, reconciling against in-flight DB writes, handling user edits to derived fields (frontmatter `embedding_hash`), handling structural conflicts (user renames a person; downstream wikilinks break). The wave-1 research is explicit that there's no clean industry consensus on file+DB coexistence; the realistic options all have tradeoffs ([wave1-research/04-external-interfaces.md §8](../../research/omnimind-roadmap-2026/wave1-research/04-external-interfaces.md)).

**Omnimind's v1 stance.** Database-primary, scheduled export, conflict-folder on re-import. Defer real-time bidirectional sync. Design markdown from day one to be **losslessly re-importable** even if round-trip isn't real-time. Bidirectional sync is a Phase 12+ research project; do not block Phase 11 on it.

### Encryption-at-rest as a default

**The Obsidian convention.** Plaintext markdown in private repos. The user's GitHub account is the trust anchor.

**Omnimind's compromise.** Plaintext in private repos by default. `age`-based or `git-crypt` encrypted-at-rest is an opt-in for paranoid users (Phase 11.5). The friction (no GitHub web preview, key-management UX) is real; v1 doesn't force it on everyone.

---

## Net export contract

When Phase 11 ships, the user gets:

1. A **GitHub repo** under their account, written by omnimind via OAuth.
2. Folder layout: `memories/`, `decisions/`, `entities/{people,goals,projects,tasks}/`, `cortex/{memos,patterns,contradictions}/`, plus `.omnimind/` for manifest + embedding cache.
3. Every file has YAML frontmatter with `id`, timestamps, source, confidence, entity refs, embedding hash.
4. Body text uses wikilinks (`[[person:alex_chen]]`) for entity references.
5. A `MANIFEST.json` declaring schema version, export timestamp, omnimind version, embedding model, and a JSON Schema per entity type.
6. Re-import is "diff against the manifest, write conflicts to `_conflicts/`, regenerate embeddings only for changed content." Idempotent: re-importing the same vault is a no-op.

The promise: "you can leave omnimind with everything intact, and external tools (Obsidian, VS Code, ripgrep, your own scripts) can read it without omnimind running." That is the Obsidian-shaped contract — without trying to be Obsidian.

This becomes ADR-018 ("Markdown export via git as data portability layer") at the end of Phase 11.
