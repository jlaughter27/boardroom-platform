# Persona Marketplace

> Constraints reminder: Respect ADRs 001-013. See [`../01-foundations/CONSTRAINTS.md`](../01-foundations/CONSTRAINTS.md). In particular, ADR-005 keeps persona prompts in markdown — that already aligns with a marketplace shape.

---

## User stories

- **Solo founder Maya** has spent six months tuning a "VC pitch reviewer" persona. She wants to share it with three friends starting their own seed rounds without copy-pasting the system prompt into Slack DMs.
- **Consulting firm Anchorlight** wants every consultant to use the same "client-call critic" persona. They want to publish it to a private registry, version it, and have new hires `omnimind persona install` it on day one.
- **The OmniMind team** wants curated "verified" personas (security reviewer, financial auditor, legal pre-screen) discoverable in-app for users who don't know where to start.
- **Builder Devon** wants to fork the official "Doer" persona, add a `tone: brutal` system instruction, and publish under his own name with attribution.

The thread: **the prompt is the product**. Once people put real time into shaping a persona, they want to share it the same way they share dotfiles, GitHub Actions, or VS Code extensions — git-cloneable, versioned, forkable.

## Approach

Borrow the **Claude Code Plugin shape** (the closest "right shape" reference in 2026): personas are git directories with a manifest, distribution is `git URL` + version tag, sandboxing reuses the existing validation pipeline, trust comes from signed manifests.

Three pillars:

1. **Persona = a directory** with a manifest, a system prompt, optional examples and evals
2. **Distribution = git URL** with semver tags
3. **Discovery = a thin docs site** scraping a community-maintained `awesome-omnimind-personas` repo (no central registry to start)

### Manifest format (`manifest.yaml`)

```yaml
name: vc-pitch-reviewer
display_name: "VC Pitch Reviewer"
description: "Reviews investor decks like a Series A partner — focuses on TAM, GTM, and unit economics."
version: 1.3.0
author: maya@example.com
license: MIT

system_prompt: prompts/vc-pitch-reviewer.system.md

target_modes:
  - decide
  - stress-test

tool_restrictions:
  allowed:
    - web_search
    - calculator
  denied:
    - "*"  # default-deny

context_strategy:
  max_memories: 8
  domain_filter: ["business", "fundraising"]
  recency_boost: 1.2

dependencies:
  omnimind: ">=2.0 <3.0"

examples:
  - inputs/seed-deck.md
  - inputs/series-a-deck.md
```

### File layout

```
vc-pitch-reviewer/
├── manifest.yaml
├── prompts/
│   └── vc-pitch-reviewer.system.md
├── examples/
│   ├── inputs/
│   └── outputs/
├── evals/
│   └── pitch-quality.eval.yaml
├── README.md
└── LICENSE
```

`manifest.yaml` + `prompts/*.system.md` are required; everything else is optional but recommended.

### Distribution

Install commands:

```bash
omnimind persona install github:maya/vc-pitch-reviewer@v1.3.0
omnimind persona install https://github.com/maya/vc-pitch-reviewer.git#v1.3.0
omnimind persona install ./local-path/
```

Under the hood:
1. Resolve the git URL + tag, clone into a temp dir
2. Validate `manifest.yaml` against a Zod schema (per ADR-012)
3. Validate the system prompt loads via `prompt-loader.ts` (per ADR-005)
4. Verify signature if `manifest.sig` present (see Trust below)
5. Copy into the user's `CustomPersona` row + persisted prompt

### Trust + signed manifests

Two tiers:

- **Verified personas** — published by the OmniMind team or vetted contributors. Manifests signed with the org's sigstore identity. Install warning: "Verified by OmniMind."
- **Unverified personas** — anyone can publish; `omnimind persona install` shows an "unverified, review the manifest before continuing" warning, mirroring `npm install` for fresh packages.

Sandboxing is structural: the manifest declares `tool_restrictions.allowed` (default-deny), and OmniMind's tool dispatcher refuses anything outside that list. Even a malicious persona can't invoke `web_search` if the manifest doesn't allow it.

### Discovery

v1: thin web UI scraping a community-maintained `awesome-omnimind-personas` GitHub repo. README parsed for entries; each entry links to the install command and the source repo.

v2: in-app discovery with search, ratings, version history, and curated collections. Defer until 100+ public personas exist.

## Schema impact

The existing `CustomPersona` model already exists and stores user-customized personas. Extend it to track install provenance:

```prisma
model CustomPersona {
  id              String   @id @default(cuid())
  userId          String
  name            String
  displayName     String
  description     String?
  systemPrompt    String   // resolved, loaded into memory
  manifest        Json?    // full manifest snapshot
  source          String?  // git URL or "local"
  sourceVersion   String?  // semver tag or commit SHA
  signatureValid  Boolean? // null = unverified, true/false = checked
  toolRestrictions Json?
  installedAt     DateTime @default(now())
  user            User     @relation(fields: [userId], references: [id])

  @@unique([userId, name])
  @@index([userId])
}
```

## API surface

- `POST /v1/personas/install` — body: `{ source: string, version?: string }`
- `GET /v1/personas/installed` — list user's personas
- `DELETE /v1/personas/installed/:id`
- `POST /v1/personas/installed/:id/upgrade` — pull a newer version from the same source
- `GET /v1/personas/marketplace/featured` — curated list (read-only, served from a static manifest)

## Phases

- [`../04-roadmap/PHASE-DEFERRED/`](../04-roadmap/PHASE-DEFERRED/) — slot as Phase 17 once MCP server (Phase 10) ships and the OAuth + signing infrastructure is in place
- Estimated effort: ~4-6 weeks (CLI + install pipeline + signature verification + featured-list UI)

## Risks

- **Prompt injection in shared personas.** A malicious persona's system prompt could try to exfiltrate memory. Mitigation: tool restrictions enforced server-side; the validation pipeline already runs Zod on memory writes; user warned on first invocation of any unverified persona.
- **Persona spam / quality dilution.** Open marketplace fills with low-quality forks. Mitigation: signed-manifest verification creates a quality signal; community curation through `awesome-omnimind-personas` filters the long tail.
- **Version sprawl.** Users install a persona, never upgrade, miss security fixes. Mitigation: `omnimind persona check-updates` command; in-app notification when a verified persona has a major version bump.
- **License compliance.** Forking + republishing personas with incompatible licenses. Mitigation: required `license` field in manifest; OmniMind UI displays it on every install.
- **Tool restriction bypass attempts.** A persona might try to use prompt-injection to convince the model to ignore restrictions. Mitigation: restrictions enforced at the **dispatcher layer** (server-side), not in the prompt.

## Success metrics

- ≥ 50 community-published personas within 6 months of launch
- ≥ 10 OmniMind-verified personas at launch (seeded by the team)
- ≥ 30% of paying users install at least one marketplace persona within 60 days
- Zero security incidents from marketplace personas in the first 12 months
- Median install-to-first-use time < 2 minutes

## Dependencies on other features

- **Memory MCP server** (Phase 10) — shares the OAuth + scope vocabulary; some personas may declare MCP-tool dependencies
- **Public SDK** (Phase 13) — examples can demonstrate persona invocation programmatically
- **Observability suite** (Phase 14) — per-persona invocation metrics show which marketplace personas are actually used
- **Webhooks event bus** (Phase 12) — `persona.installed` and `persona.invoked` events for downstream automation
