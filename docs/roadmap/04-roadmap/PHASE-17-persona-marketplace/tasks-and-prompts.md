# PHASE 17 — Tasks & Prompts

---

## Task 17.1 — Manifest schema + sample personas

**Scope:** Lock the manifest schema. Author 3 sample personas in a sister repo as canonical references.

**Prompt:**
> Read `docs/research/omnimind-roadmap-2026/wave1-research/04-external-interfaces.md` §6. Define the persona manifest schema in `packages/shared/src/validation/persona-manifest.zod.ts` matching the README's manifest example. Required fields: manifest_version (literal 1), name (1-64 chars, kebab-case), version (semver), author, description (1-500 chars), target_modes (array of `decide|stress-test|plan|brainstorm`), tools_allowed (string array — must be subset of registered tool names), tools_denied (string array), context_budget_items (1-10, default 7). Optional: signature (string), hashes (object), recommended_for (string array, max 10). Add JSDoc on every field linking to the user-facing docs (Task 17.6). Then create a sister repo `omnimind-personas` (or sub-directory `examples/personas/`) with three personas: `socratic-questioner` (deep questioning persona for the questionnaire mode), `risk-radar` (risk-spotting persona for stress-test mode), `customer-voice` (CSAT-style persona for decide mode). Each has a real prompt (write good ones; reference `docs/prompts/` style) plus README.

**Verification:** Schema parses each sample manifest cleanly; sample personas reviewed and good enough to ship as references.

---

## Task 17.2 — Schema migration: extend CustomPersona

**Scope:** Add `sourceUrl`, `version`, `manifestSignatureStatus`, `installedAt`, `installedBy`, `manifestRaw`, `promptHash`.

**Prompt:**
> In `packages/omnimind-api/prisma/schema.prisma`: extend the existing `CustomPersona` model with new optional fields: `sourceUrl String?`, `version String?`, `manifestSignatureStatus enum('verified','unverified','untrusted')?`, `installedAt DateTime?`, `installedBy String?` (userId of installer), `manifestRaw Json?`, `promptHash String?`. All nullable (additive). Add an index on `sourceUrl` for de-dup checks. Generate a Phase 15-compliant migration. Update Zod schemas in `packages/shared/src/validation/`.

**Verification:** `pnpm prisma migrate dev` creates a clean migration; existing rows unaffected; new fields default to null.

---

## Task 17.3 — Install service: fetch + validate + persist

**Scope:** Core install logic. Pure function (no HTTP route yet).

**Prompt:**
> In `packages/omnimind-api/src/personas/`: create `install.service.ts` exporting `installPersonaFromGit(sourceUrl: string, installedBy: string): Promise<InstallResult>`. Steps: (1) parse sourceUrl via a strict Zod schema accepting only `github:owner/repo[#path][@ref]` form (no other protocols, no arbitrary URLs) — define this in `packages/shared/src/validation/`, (2) fetch the manifest.yaml + prompt.system.md + examples/ via the GitHub Contents API (use existing GitHub OAuth path from Phase 11 if present; else unauthenticated for public repos with rate-limit awareness), (3) parse manifest YAML, validate against the Zod schema from Task 17.1, (4) verify each `hashes.*` matches the actual fetched content (SHA-256), (5) if `signature` present, verify via sigstore (Task 17.4), (6) check `tools_allowed` against the registered tool registry — reject if any unknown tool, (7) UPSERT into `CustomPersona` with all new fields populated. Return `{ persona, signatureStatus, warnings }`. Add unit tests with mocked GitHub responses.

**Verification:** Unit tests green; install a sample persona from the omnimind-personas repo successfully.

---

## Task 17.4 — Signature verification via sigstore

**Scope:** Optional signature verification. Personas without signatures load as "unverified" with a UI warning; with valid sigs, "verified".

**Prompt:**
> In `packages/omnimind-api/src/personas/`: add `signature.verifier.ts` using `@sigstore/verify` (or equivalent). Verify the manifest signature against sigstore's public Rekor log. Match the signing identity to the manifest's `author` field — if author is `github:alice/personas-pack`, the signing identity must be a GitHub Actions OIDC token from `alice/personas-pack`. Reject mismatched signatures as 'untrusted'. Personas without `signature` field load as 'unverified' (no error). Add a CLI helper `packages/omnimind-cron/scripts/sign-persona.ts` documenting how a persona author signs their manifest in their repo's GitHub Actions workflow (the steps go into `docs/AUTHOR-PERSONA-PACKAGE.md`).

**Verification:** Sign one of the sample personas via a real sigstore flow; verify it loads as 'verified'; tamper with the manifest; verify it loads as 'untrusted'.

---

## Task 17.5 — Install routes (MCP tool + admin API)

**Scope:** Two surfaces: an MCP tool for Claude Desktop users to install via natural language, and an admin API for power-user CLIs.

**Prompt:**
> (a) In `packages/omnimind-api/src/mcp/tools/`: create `install-persona.tool.ts` registering MCP tool `installPersona({ sourceUrl: string })`. Requires the `omnimind:personas:install` OAuth scope. Calls `installPersonaFromGit` from Task 17.3. Returns the persona summary plus signature status. (b) In `packages/omnimind-api/src/routes/`: create `personas-marketplace.routes.ts`. Routes: `POST /personas/install` (auth: user JWT; body: `{ sourceUrl }`), `DELETE /personas/:id` (uninstall — soft delete via existing pattern), `GET /personas/installed` (list user's installed personas with signature status). Both surfaces enforce per-user persona caps (max 50 installed; constant in `packages/shared/src/constants/`). Add integration tests.

**Verification:** Install a persona via curl; install via Claude Desktop using the MCP tool; both succeed and show in `GET /personas/installed`.

---

## Task 17.6 — Tool restriction enforcement at runtime

**Scope:** When an installed persona is invoked, its `tools_allowed` and `tools_denied` constraints must be enforced inside the agent runtime, not the prompt.

**Prompt:**
> In `packages/boardroom-ai/server/src/agents/agent.ts` (or its tool dispatcher): when invoking an installed persona, pass the persona's `tools_allowed` + `tools_denied` to the tool dispatcher. Before any tool call, check: tool name is in `tools_allowed` (or `tools_allowed` is the special value `*` for verified personas), AND tool name is NOT in `tools_denied`. On violation, return a tool error to the model: `{ error: "Tool '{name}' not allowed by persona manifest" }` and emit a warn log. Add unit tests covering: empty allowlist, wildcard allowlist, denylist override, unknown tool. Add an eval scenario `eval/scenarios/persona-tool-restrictions.scenario.ts` that installs a test persona with restrictive lists, attempts to invoke a denied tool, asserts the runtime blocks it.

**Verification:** Eval scenario green; restrictive persona cannot invoke a denied tool no matter what the prompt asks.

---

## Task 17.7 — `awesome-omnimind-personas` repo + scrape job

**Scope:** Set up the community curation repo + a weekly scrape building a static discovery page.

**Prompt:**
> Create the `awesome-omnimind-personas` GitHub repo (or describe the steps for me to do it). Include: README with submission rules (must have valid manifest.yaml, must be MIT/Apache/permissive license, must have a README explaining what it does), a `personas.yaml` registry file (list of `{ source_url, name, description, tags }` entries), a CONTRIBUTING.md, a GitHub Actions workflow that validates each PR's `personas.yaml` entry (fetches the source URL, validates the manifest). Then in `packages/omnimind-cron/src/jobs/`: add `marketplace-scrape.job.ts` running weekly (Saturday 6am UTC). Steps: fetch the latest `personas.yaml` from the awesome repo, for each entry fetch the manifest, validate, build a JSON file `marketplace-directory.json` and upload to a static asset host (or commit to a docs branch). The marketing site reads this JSON and renders cards.

**Verification:** Awesome repo accepts a PR with a sample persona; scrape job builds a valid directory JSON.

---

## Task 17.8 — Eval scenario: end-to-end install + isolation

**Scope:** Comprehensive eval covering install, restrictions, uninstall, signature handling.

**Prompt:**
> In `eval/scenarios/`: create `persona-marketplace-e2e.scenario.ts`. Steps: (1) install a persona from a fixture repo (use a test fixture under `eval/fixtures/personas/`), (2) verify it appears in `GET /personas/installed` with status 'unverified', (3) invoke it and verify tool restrictions enforced, (4) install a signed version of the same persona, verify status flips to 'verified', (5) tamper with the fixture's prompt, attempt re-install, verify hash mismatch is caught, (6) per-tenant isolation: user A's installed persona is NOT visible to user B (queries scoped by userId), (7) uninstall, verify soft-delete and that subsequent invocation returns "persona not found". Add a rubric in `eval/rubrics/persona-marketplace.rubric.md`. Wire into `npm run eval:all`.

**Verification:** Eval scenario passes; per-tenant isolation verified.

---

## Task 17.9 — User + author docs

**Scope:** Two docs files.

**Prompt:**
> Write `docs/USER-PERSONA-MARKETPLACE.md` covering: how to find personas (link to the discovery page), how to install (UI flow + MCP tool + curl examples), what "verified" vs "unverified" means in plain English, how to inspect a persona's prompt before install (we render it in the install confirmation), how to uninstall, security implications of unverified personas. Write `docs/AUTHOR-PERSONA-PACKAGE.md` covering: directory layout, manifest schema (link to the Zod source), prompt-writing guidance (consistency with our own personas in `docs/prompts/`), signing via sigstore + GitHub Actions (worked example), submitting to the awesome repo, versioning (semver), how to ship a v2 without breaking existing users.

**Verification:** Docs reviewed; an external author can follow them to publish a working persona.
