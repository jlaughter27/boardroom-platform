# Feature Index — "Make It 10/10" Capabilities

**Audience:** Anyone planning, scoping, or implementing the next 12 months of work.
**Purpose:** Single-screen index of every feature spec in this folder, grouped by category, with phase, value prop, and status.
**Sibling docs:** [`../04-roadmap/ROADMAP-OVERVIEW.md`](../04-roadmap/ROADMAP-OVERVIEW.md), [`../01-foundations/CONSTRAINTS.md`](../01-foundations/CONSTRAINTS.md).

> Constraints reminder: every feature respects ADRs 001-013. See [`../01-foundations/CONSTRAINTS.md`](../01-foundations/CONSTRAINTS.md).

---

## Status legend

- **PLANNED** — spec exists, phase folder created, not started
- **IN-PROGRESS** — work has begun under the listed phase
- **SHIPPED** — feature is live in production
- **DEFERRED** — explicitly punted; reason in spec

---

## Category 1 — External Interfaces

| Feature | Phase | Value prop | Status |
|---|---|---|---|
| [Memory MCP server](memory-mcp-server.md) | 10 | BYO-frontend, BYO-model: any MCP client (Claude Desktop, Cursor, custom) can read + write OmniMind memory | PLANNED |
| [Markdown export + import](markdown-export-import.md) | 11 | "Your data, your folder" — Obsidian-style portability, GitHub-as-backup | PLANNED |
| [Webhooks + event bus](webhooks-event-bus.md) | 12 (ship before SDK) | OmniMind-as-platform: Zapier, n8n, custom downstream consumers without in-house glue | PLANNED |
| [Public SDK (TS first, Python second)](public-sdk.md) | 13 | Friction-free integration for third-party developers; mirror of Stripe/Anthropic SDK ergonomics | PLANNED |
| [Persona marketplace](persona-marketplace.md) | 17 | Founders share personas, teams adopt curated ones; git-installable + signed manifests | PLANNED (alternative-deferral spec at `04-roadmap/DEFERRED/persona-marketplace.md` per DEF-014) |

## Category 2 — Observability + Cost Control

| Feature | Phase | Value prop | Status |
|---|---|---|---|
| [Observability suite](observability-suite.md) | 14 | Logs, metrics, traces, alerts — debuggable production at solo-founder cost | PLANNED |
| [Per-tenant cost controls](per-tenant-cost-controls.md) | 18 (initial caps in Phase 0.25) | Per-user $/month caps, spend circuit breaker, "approaching limit" UX | PLANNED |

## Category 3 — Intelligence (Cortex)

| Feature | Phase | Value prop | Status |
|---|---|---|---|
| [Advanced cortex](advanced-cortex.md) | post-Phase 16 | Outcome-decision feedback loop, cross-entity contradictions, decision-quality trends, recommended next-actions | PLANNED |

## Category 4 — Data Portability + Trust

| Feature | Phase | Value prop | Status |
|---|---|---|---|
| [Memory editor UI](memory-editor-ui.md) | 11 | "Let users see and fix what the AI knows" — list/search/edit/soft-delete memories with related-entity context | PLANNED |
| [GDPR data export + deletion](data-export-gdpr.md) | 18 (with RLS rollout) | Full-account export, 30-day soft-then-hard delete, OAuth token cascade | PLANNED |
| [Retrieval explainability](retrieval-explainability.md) | post-Phase 14 | Per-result signal contributions (semantic / FTS / trigram / structured / entity-boost) for trust + debugging | PLANNED |

## Category 5 — Multi-Tenant + Future Architecture

| Feature | Phase | Value prop | Status |
|---|---|---|---|
| [Multi-tenant teams](multi-tenant-teams.md) | 18+ | Shared memories with per-user scopes, role-based access, team-wide cortex | DEFERRED (post-1k users) |

## Category 6 — Advanced Retrieval + Storage

| Feature | Phase | Value prop | Status |
|---|---|---|---|
| [Embedding model versioning](embedding-model-versioning.md) | post-Phase 15 | Survive `text-embedding-3-small` deprecation; 2-model coexistence + backfill | PLANNED |
| [Knowledge graph (deep)](knowledge-graph-deep.md) | DEFERRED (gated) | Apache AGE vs. Neo4j sidecar — when typed link tables stop scaling. Trigger: pattern-match queries become a product feature AND recursive CTE p95 >500ms (see ROADMAP-OVERVIEW). | DEFERRED |

---

## Sequencing rationale

The order matters. Webhooks ship **before** the SDK because the SDK without an event bus reduces to polite polling. Observability ships in Phase 13 alongside the cost-control table because you can't enforce caps you can't measure. The persona marketplace defers until the MCP server is stable — both depend on a public auth story. The deep knowledge graph waits until typed link tables show measurable strain (target: 500+ memories per user, sustained).

## Total scope

15 feature specs. ~12 phases worth of work. Each spec is independently scopable; none rewrite earlier work. Conservative-stack defaults (Postgres-native, no new infra, ADR-respecting) carry the entire plan.
