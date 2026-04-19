# PHASE 17 — Persona Marketplace

**Time budget:** 4-6 weeks
**Sequence:** After Phase 16 (cortex isolation) — uses the same observability + service patterns. Can ship in parallel with Phase 16 if focus allows.
**Owner:** dev
**Confidence:** MED (closest pattern is Claude Code Plugins; persona-specific UX is novel)

---

## What this is

Let third parties (and power users) publish reusable personas as **git-installable packages**, signed and sandboxed by OmniMind. The `CustomPersona` schema is already there; the missing layer is the install flow, manifest convention, signing/verification, and a thin discovery surface.

Concretely:

- **Persona = a directory in a git repo.** Layout:
  ```
  persona-name/
    manifest.yaml         # name, description, version, author, target modes, tool restrictions, scope hashes
    prompt.system.md      # the actual system prompt
    examples/             # optional sample inputs/outputs for evals
    evals/                # optional rubrics for the persona
    README.md             # human-readable
  ```
- **Manifest schema (Zod-validated):**
  ```yaml
  manifest_version: 1
  name: "Skeptical-Investor"
  version: "1.2.0"
  author: "github:alice/personas-pack"
  description: "VC-style critique persona for fundraising decisions"
  target_modes: ["decide", "stress-test"]
  tools_allowed: ["webSearch"]                 # subset of registered tools
  tools_denied: ["createMemory"]               # explicit denylist for safety
  context_budget_items: 7
  recommended_for: ["fundraising", "valuation"]
  signature: "sigstore:..."                    # optional; "verified" badge when present
  hashes:
    prompt_sha256: "..."
    examples_sha256: "..."
  ```
- **Install:** `omnimind persona install github:alice/personas-pack#skeptical-investor@v1.2.0` (CLI command — implemented as an MCP tool or admin API). Resolves git ref, fetches files, validates manifest against Zod schema, verifies signature if present, computes hashes and compares to manifest, persists to `CustomPersona` table with `source_url`, `version`, `manifest_signature_status: 'verified'|'unverified'|'untrusted'`.
- **Sigstore-style signed manifests.** "Verified" personas have signatures published via [sigstore](https://sigstore.dev/) tying the manifest to a specific GitHub identity. Unverified personas load with a clear warning (echoes `npm audit` UX).
- **Sandbox via existing validation pipeline.** Imported personas go through Zod validation; tool calls restricted to `tools_allowed` and explicitly excluded by `tools_denied`. Prompt cannot bypass the validation pipeline.
- **Discovery: thin docs site initially.** A community-maintained `awesome-omnimind-personas` GitHub repo, scraped weekly into a static directory page on the marketing site. v2 (deferred): in-app search + ratings.
- **No monetization in v1.** All personas free. Stripe + revenue share is a separate Phase (DEFERRED until 100+ verified personas exist and at least one creator asks).

---

## Why now

1. **The CustomPersona schema is half-built furniture.** It exists, but there's no pathway to put a persona in it that came from outside our team.
2. **Distinctive product wedge.** Neither ChatGPT Custom GPTs (no version history, opaque ranking) nor Cursor `.cursorrules` (zero distribution) nail the persona-as-package shape. Claude Code Plugins is closest but isn't persona-focused.
3. **Community surface for the brand.** "Try Alex's Skeptical-Investor persona" is a more concrete value prop than "we have memory."

## Prerequisites

- Phase 10 (MCP) complete — install flow can be exposed as an MCP tool
- Phase 12 (webhooks) complete — `persona.invoked` event already emitted; marketplace personas can subscribe to their own invocations
- Phase 13 (SDK) complete — example personas in the marketplace reference the SDK for auxiliary calls
- `CustomPersona` table audited and extended for the new fields (source_url, version, signature_status, hashes)

## Exit criteria

- [ ] Manifest schema in `packages/shared/src/validation/persona-manifest.schema.ts` (existing convention is `*.schema.ts`)
- [ ] Install endpoint: MCP tool `installPersona({ source: "github:..." })` AND admin API route `POST /admin/personas/install`
- [ ] Manifest signature verification via sigstore-compatible library (`@sigstore/verify` or equivalent)
- [ ] `CustomPersona` schema extended (additive, via Phase 15 migration) with: `sourceUrl`, `version`, `manifestSignatureStatus enum`, `installedAt`, `installedBy`
- [ ] Tool allowlist enforcement: invoking an installed persona with `tools_denied` includes that tool → 403 from the agent runtime
- [ ] Three example personas published (in our own repo `omnimind-personas/`) covering different modes; serve as canonical references
- [ ] `awesome-omnimind-personas` community repo created with submission template
- [ ] Discovery page on the marketing site lists all repos in awesome-list; updated weekly via a scheduled action
- [ ] User-facing docs: `docs/USER-PERSONA-MARKETPLACE.md` covering install, uninstall, trust model, signature verification
- [ ] Author-facing docs: `docs/AUTHOR-PERSONA-PACKAGE.md` covering manifest schema, signing instructions, submission to awesome-list
- [ ] Eval scenario: install a persona from a test repo, invoke it, assert tool restrictions enforced; uninstall; verify removal

## Dependencies

- **Upstream:** Phases 10, 12, 13
- **Downstream blocks:** none in this roadmap; future paid-personas phase is deferred
- **Concurrency:** Can ship in parallel with Phase 16 (cortex isolation) — different files

## Blast radius

- **New install/uninstall flow** that mutates the `CustomPersona` table. Mitigated by the existing soft-delete pattern.
- **Network surface:** install fetches from arbitrary git URLs. Mitigation: enforce HTTPS-only for source URLs; allowlist GitHub.com initially; disallow file:// and arbitrary protocols.
- **Trust:** unverified personas could include prompt-injection attacks targeting users. Mitigation: clear "unverified" UI badge; tool restrictions enforced server-side, not client-side.
- **Risk:** a malicious persona's `tools_allowed` claim could be ignored if enforcement is buggy. Mitigation: comprehensive eval scenario in Task 17.8 verifies the enforcement.
- **Rollback:** `PERSONA_MARKETPLACE_ENABLED=false` disables install endpoints; existing installed personas keep working. Hard rollback removes installed personas via SQL.

---

**Constraints reminder:** Respect ADR-001 (no frameworks), ADR-002 (Anthropic only), ADR-003 (pgvector only), ADR-009 (node-cron only). All prompts in `docs/prompts/*.system.md`. All LLM tool outputs Zod-validated. CLAUDE.md service-boundary rules apply.
