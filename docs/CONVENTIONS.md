# Conventions — BoardRoom + OmniMind Platform

> **Draft — staged in `docs/_inventory/` during PR 2 (Phase D bucket migration).** Will move to `docs/CONVENTIONS.md` as part of §10 commit 12. Captures the naming, lifecycle, and stub conventions actually used in the codebase and the migration map; not aspirational.

**Audience.** Anyone (Claude or human) about to add, rename, or relocate a doc, code module, or entity.

**Default policy.** When in doubt, follow the closest existing example. Inventing new conventions requires an ADR or PR-description rationale.

---

## Doc-tree taxonomy (post-Phase-D)

Every doc lives in exactly one of these buckets. Adding a new doc means picking a bucket; if none fit, that's a signal to create an ADR before adding the doc.

| Bucket | What goes here | Anti-pattern |
|---|---|---|
| `docs/01-orientation/` | First-touch onboarding for new contributors. ≤3 files at a time. | Reference material that doesn't change much |
| `docs/02-reference/` | Durable reference (specs, ADRs, framework docs). Stable; updated rarely. | Living session state |
| `docs/03-operations/` | Runbooks for deploy, recovery, ops. Concrete commands and checklists. | Aspirational planning |
| `docs/_reports/` | Historical reports — preserved for audit, not maintained. | New reports without a date in the title |
| `docs/STATUS/` | Live session state. Updated every session. The only place where "what's happening right now" lives. | Anything that doesn't change session-to-session |
| `docs/_meta/` | Agent-instruction meta (load order, handoff templates, session checklists). | Project documentation |
| `docs/_archive/` | Frozen content. Never edited after archival. | Active references |
| `docs/_inventory/` | Phase-A-through-E migration planning artifacts. Removed after Phase E exits. | Anything outside the current migration cycle |
| `docs/roadmap/` | OmniMind memory-system roadmap (the 18-agent-pipeline output, 151 files). Treated as a self-contained subtree. | Top-level platform docs |
| `docs/prompts/*.system.md` | Persona prompts loaded at runtime by `prompt-loader.ts`. | Anything not loaded by code |
| `docs/tasks/` | Per-phase task specs. Historical; the live task index lives at `docs/STATUS/PHASE-PROGRESS-TRACKER.md`. | Status updates |
| `docs/contracts/` | Service-to-service API contracts. Pinned interfaces. | Implementation notes |

## Naming

### Files

- **Markdown docs:** `UPPER-KEBAB-CASE.md` for top-level entries (`MASTER-FRAMEWORK.md`, `PROJECT-BRIEF.md`); `lowercase-kebab.md` for subordinate entries (`auth.routes.ts.md`).
- **System prompts:** `lowercase-with-hyphens.system.md` (loaded by code) — the `.system.md` suffix is a contract, not a stylistic choice.
- **Code files:** `camelCase.ts` for utilities; `PascalCase.tsx` for React components; `kebab-case.test.ts` for tests; `routes/<resource>.routes.ts` for routers.
- **Migration artifacts:** `PHASE-<letter>-<TOPIC>.md` (e.g. `PHASE-C-MIGRATION-MAP.md`).

### Entities

- **TypeScript types:** `interface` for object shapes, `type` for unions/intersections/utility types. Both `PascalCase`.
- **Zod schemas:** `<entity>Schema` (e.g. `userSchema`). Prefer `z.infer<typeof userSchema>` over hand-written types.
- **Constants:** `UPPER_SNAKE_CASE`, marked `as const`.
- **Enums:** TypeScript `enum` keyword (matches Prisma enum conventions).

### Branches

- `feat/<scope>` for new features (`feat/onboarding-bootstrap`)
- `fix/<scope>` for bug fixes
- `chore/<scope>` for housekeeping (`chore/docs-phase-D-migration`)
- `refactor/<scope>` for non-behavior-changing refactors
- `claude/<animal-noun>` for Claude-generated session branches (legacy convention; check before deleting)
- `cascade/<task-noun>` for Windsurf-Cascade-generated branches (auto-named by tooling)

## Lifecycle

### Doc lifecycle

1. **Draft** — staged in `docs/_inventory/draft-*.md` during a planning phase. Not linked from elsewhere.
2. **Active** — in a primary bucket (`01-orientation/`, `02-reference/`, etc.). Reachable from `docs/INDEX.md`.
3. **Archived** — moved to `docs/_archive/<topic>/` with no stub. Reachable only via direct path.
4. **Deleted** — gone. No stub. Acceptable only if `inbound_count = 0` per the Phase A inventory.

### Stub format (post-move redirects)

When a doc moves to a new bucket and inbound references still point at the old path, leave a stub:

```markdown
> Moved to `<new-path>`. <!-- AGENT_REDIRECT_ONLY -->
```

The HTML marker `<!-- AGENT_REDIRECT_ONLY -->` is grep-able by the Phase E tripwire test. Stubs are scaffolding only — Phase E deletes them all within 30 days of Phase D's merge.

### Code lifecycle

1. **Active** — imported by at least one other module that's reachable from a service entry point.
2. **Quarantined** — moved to `_disabled/` directory. `tsconfig.json` excludes the directory. Preserved for reference but not built.
3. **Deleted** — removed from git. Acceptable only after a quarantine period of ≥1 phase.

## Reference resolution

Doc-path references in markdown can take three forms:

1. **Markdown link:** `[label](path)` — preferred for prose
2. **Backtick path:** `` `path` `` — preferred for inline mentions
3. **Bare-text path:** `path` (with trailing space or punctuation) — acceptable in lists and tables

All three are detected by `scripts/check-doc-links.py` and `docs/_inventory/scripts/inventory.py`. Glob patterns and template placeholders (containing `*`, `?`, `{}`, `[]`) are skipped — they're not literal paths.

## Inbound counts and orphans

A doc's **inbound count** is the number of other docs/code files that reference it (resolved per the rules above). Tracked in `docs/_inventory/files.json` after each Phase A inventory pass.

- **Orphan:** `inbound_count = 0`. Candidate for archive or deletion. Surface during inventory passes.
- **Hub:** `inbound_count ≥ 5`. Likely a reference document. Should NEVER be moved without updating every inbound ref (or leaving a redirect stub).

## Decisions and ADRs

ADRs (Architecture Decision Records) live in `docs/02-reference/DECISIONS.md` (top-level) and `docs/roadmap/08-references/adrs/` (roadmap-specific).

**When to write an ADR:**
- Choosing one of multiple plausible approaches with non-trivial trade-offs
- Locking in a stack/library/tool that's hard to change later
- Adopting an inviolable rule (e.g. "BoardRoom → OmniMind via HTTP only")
- Reversing a previous ADR (always reference the prior ADR by number)

**When NOT to write an ADR:**
- Tactical bug fixes
- Routine refactors
- Style choices already covered by existing conventions

## Phase-gated planning

Long-running migrations follow A-E phases:
- **A** — read-only inventory of current state
- **B** — target tree design (reviewed by validators)
- **C** — concrete migration map (every file move, code edit, CI assertion enumerated)
- **D** — execute migration (PRs that move files, edit references, add CI gates)
- **E** — cleanup of redirect stubs after a 30-day grace window

Each phase exits with a written checkpoint in `docs/_inventory/CHECKPOINT-phase-<letter>.md` plus an append-only entry in `docs/_inventory/EXECUTION-LOG.md`. The master execution prompt lives at `docs/_inventory/MASTER-EXECUTION-PROMPT.md`.

## See also

- `docs/GLOSSARY.md` — code prefixes, statuses, modes, persona names
- `docs/INDEX.md` — categorized map of the docs tree
- `docs/02-reference/DECISIONS.md` — ADRs with rationale
- `docs/_inventory/PHASE-C-MIGRATION-MAP.md` — current Phase D plan (versioned v1.4)
