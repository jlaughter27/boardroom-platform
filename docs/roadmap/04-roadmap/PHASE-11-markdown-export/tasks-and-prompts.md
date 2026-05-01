# PHASE 11 — Tasks & Prompts

---

## Task 11.1 — Vault layout + frontmatter contract

**Scope:** Documentation-first task. Lock the vault layout and frontmatter schema before any code.

**Prompt:**
> Read `docs/research/omnimind-roadmap-2026/wave1-research/04-external-interfaces.md` §3 and §4. Write `docs/contracts/markdown-vault.contract.md` defining: directory layout (memories/, decisions/, entities/{people,goals,projects,tasks}/, cortex/, .omnimind/), frontmatter schema for each entity type (Zod-style field list with types and required/optional), file naming conventions (`{slugified-title}.md` for entities, `{id}.md` for memories/decisions to avoid title collisions), wikilink conventions (`[[entities/people/alex-chen]]`, deep links via `#heading`), the `.omnimind/manifest.json` structure (schema version, last sync, file count per type), and the `_conflicts/` folder naming. No code yet. Get my approval before Task 11.2.

**Verification:** Contract doc exists; approved manually.

---

## Task 11.2 — GitHub OAuth provisioning + token storage

**Scope:** Add GitHub OAuth flow with `repo` scope. Extend `OAuthToken` to support `provider='github-vault'`.

**Prompt:**
> In `packages/omnimind-api/`: add a new OAuth flow for GitHub vault sync. Routes: `GET /oauth/github-vault/start` (initiates flow, stores state in Postgres), `GET /oauth/github-vault/callback` (exchanges code for token, encrypts via existing `ENCRYPTION_KEY` mechanism, writes to `OAuthToken` with `provider='github-vault'`). Update `packages/omnimind-api/prisma/schema.prisma` only if the existing `OAuthToken.provider` enum needs the new value — extend it; do NOT rename. Add `repo` scope to the OAuth request. Add `.env.example` entries: `GITHUB_VAULT_CLIENT_ID`, `GITHUB_VAULT_CLIENT_SECRET`. Do NOT touch the existing Gmail/Calendar OAuth code — this is a separate provider entry. Add unit tests for the callback exchange.

**Verification:** Manual flow: visit `/oauth/github-vault/start`, authorize, observe a row in `OAuthToken` with encrypted token; `pnpm typecheck` clean.

---

## Task 11.3 — Markdown renderer per entity type

**Scope:** Pure-function renderers: `renderMemory(m): string`, `renderDecision(d): string`, `renderPerson(p): string`, etc. No I/O.

**Prompt:**
> In `packages/omnimind-api/src/vault/renderers/`: create one file per entity type (`memory.renderer.ts`, `decision.renderer.ts`, `person.renderer.ts`, `goal.renderer.ts`, `project.renderer.ts`, `task.renderer.ts`, `weekly-memo.renderer.ts`, etc.). Each exports a pure function `(entity, context) => string` returning a complete markdown file (frontmatter + body). Frontmatter must match `docs/contracts/markdown-vault.contract.md` exactly. Wikilinks for entity references — pass an `entityIndex: Map<id, vaultPath>` in context so the renderer resolves IDs to paths. Body sections per the contract. Use `gray-matter` (already a candidate dep) or write a minimal YAML serializer. Add unit tests with snapshot fixtures in `tests/unit/vault/renderers/`.

**Verification:** Snapshot tests green; manual eyeball of a rendered memory and a rendered project file.

---

## Task 11.4 — Vault assembler service

**Scope:** Service that takes a userId and returns `Map<vaultPath, fileContent>` for the entire vault.

**Prompt:**
> In `packages/omnimind-api/src/vault/`: create `vault-assembler.service.ts` exporting `assembleVault(userId): Promise<Map<string, string>>`. Steps: (1) load all entities from DB filtered by userId and deletedAt IS NULL, (2) build the entity index for wikilink resolution, (3) call each renderer, (4) generate `.omnimind/manifest.json` with schema version + counts + ISO timestamp, (5) generate vault-level `README.md` documenting the layout (read from a template in `packages/omnimind-api/src/vault/templates/vault-readme.template.md`). Stream-friendly: yield files as they're rendered to keep memory bounded for large vaults. Add integration test with a seeded test user.

**Verification:** Integration test green; manual spot-check of the assembled vault for a test user with 10 memories, 5 decisions, 3 projects.

---

## Task 11.5 — Git push worker

**Scope:** Worker that pushes the assembled vault to the user's GitHub repo using their OAuth token.

**Prompt:**
> In `packages/omnimind-api/src/vault/`: create `git-push.worker.ts`. Use `simple-git` (npm) or `isomorphic-git` (works in worker contexts). Steps: (1) decrypt OAuth token, (2) clone or pull the repo `omnimind-vault-{userId}` (create if missing — need additional `repo` scope check), (3) write each assembled file via SHA256 diff (skip unchanged), (4) `git add -A && git commit -m "OmniMind sync {ISO timestamp}"` only if there are changes, (5) `git push`. On 401 from GitHub, mark the OAuthToken as needing reauth and notify the user. Idempotent: re-running with no changes produces no commit. Add error handling for: repo doesn't exist, token expired, branch protection, rate limit. Add integration test using a sandbox GitHub account or `nock`-mocked git operations.

**Verification:** Manual end-to-end test: user runs export, observes a commit in their repo with expected file tree.

---

## Task 11.6 — Export route + job tracking

**Scope:** API surface. `POST /export/github` enqueues, `GET /export/github/{jobId}` returns status.

**Prompt:**
> In `packages/omnimind-api/src/routes/`: create `vault-export.routes.ts`. `POST /export/github` (auth required) creates an `ExportJob` row (`status: 'queued'|'running'|'completed'|'failed'`, `userId`, `provider='github'`, `startedAt`, `completedAt`, `errorMessage`, `commitSha`), enqueues for the worker (Phase 11 uses node-cron polling; Phase 18 will move to graphile-worker). Returns `{ jobId, status }`. `GET /export/github/{jobId}` returns the job state. Add Zod validation. Wire into `index.ts`. Add `ExportJob` model to `prisma/schema.prisma` with appropriate indexes. Add unit + integration tests.

**Verification:** Curl POST returns 202 with jobId; polling GET shows status transitions; final state has `commitSha`.

---

## Task 11.7 — Re-import + conflict folder

**Scope:** Pull the user's repo, parse markdown back into entities, write conflicts to `_conflicts/`.

**Prompt:**
> In `packages/omnimind-api/src/vault/`: create `vault-importer.service.ts` and `import.worker.ts`. Steps: (1) git pull the user's repo, (2) walk all .md files, parse frontmatter + body into entity candidates via per-type parsers in `packages/omnimind-api/src/vault/parsers/` (mirror the renderers), (3) for each entity, compute hash of current DB state and hash of file state and hash of last-known-export state (stored in `.omnimind/manifest.json`), (4) classify: unchanged, file-changed-only (apply file → DB), db-changed-only (no-op, will export next time), both-changed (CONFLICT — write loser to `_conflicts/{id}-{timestamp}.md`, apply file as winner per LWW), (5) update manifest. All DB writes go through existing validation pipelines, NOT raw Prisma. Reject (don't overwrite) any field that fails Zod validation; log to `ImportJob.warnings`. Add `POST /import/github` route mirroring 11.6.

**Verification:** Eval scenario: export 50 memories, edit 5 in the markdown, edit 3 in the DB, edit 2 in BOTH, run import, verify the 5 are applied, the 3 are preserved, the 2 are in `_conflicts/` with LWW resolution.

---

## Task 11.8 — Eval scenario: round-trip integrity

**Scope:** Comprehensive end-to-end eval.

**Prompt:**
> In `eval/scenarios/`: create `vault-roundtrip.scenario.ts`. Setup: seed a test user with 50 memories, 10 decisions, 20 entities (mix of types), full link table coverage. Steps: (1) export to GitHub, (2) clone the repo locally, (3) verify file count and structure match manifest, (4) parse every file and check frontmatter validates against Zod schemas in `packages/shared/src/validation/`, (5) verify wikilinks resolve to real files, (6) modify 10% of files in various ways (add tag, change body, edit frontmatter), (7) push commits to the repo, (8) re-import, (9) verify changes landed, conflicts handled, no data loss. Add a rubric in `eval/rubrics/vault-integrity.rubric.md`. Wire into `npm run eval:all`.

**Verification:** `npm run eval:all` includes the scenario and passes.

---

## Task 11.9 — Documentation + sample vault

**Scope:** User-facing docs + a sample vault checked into the repo for tutorial purposes.

**Prompt:**
> Write `docs/USER-VAULT-GUIDE.md` explaining: how to enable, what gets exported, how to edit safely (rules: don't change `id` frontmatter, do change body freely, do add wikilinks), how conflicts are handled, how to detach (delete the OAuthToken row + revoke the GitHub app — provide explicit steps). Add a sample vault (5 memories + 2 decisions + 3 entities) under `docs/samples/example-vault/` so users can see the format before connecting. Reference `docs/contracts/markdown-vault.contract.md` for the schema.

**Verification:** Docs reviewed; sample vault parses cleanly with the parser from Task 11.7.
