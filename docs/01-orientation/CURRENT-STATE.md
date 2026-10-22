# Current State — What's Live, What's Next

> Living document. Update after each deploy or phase completion.
>
> **Last updated:** 2026-10-22 (Phase 8, M0-D1 status truth pass)

**One-line summary:** the merged code runs the whole loop green locally and in CI, but nothing about production has been observed since PR #22 merged. Phase 8 (`docs/roadmap/PHASE-8-ROADMAP.md`) exists to close that gap, make the memory one tenant-safe memory, and run a 30-day dogfood from 2026-11-12.

## Where `main` is

| | |
|---|---|
| Head | `c2c6fca` — PR #24, Phase 8 dev roadmap (docs only) |
| Before it | `fc19563` — PR #23, `@modelcontextprotocol/sdk` bumped to `^1.32.1` for two high advisories; `cdef1ef` — PR #22, Phase 7.5 (visualization, Apple-grade UI foundation, live e2e, MCP go-live script) |
| CI | Green: run 39868876211 on `c2c6fca` and run 39864122262 on `fc19563`, all five jobs `success` (verify, Docker ×3, Retrieval IR eval); the `fc19563` run was the first omnimind-mcp image build on main. Run 39860431324 on `cdef1ef` failed at the dependency audit. |
| Branch protection | None on `main` (`docs/STATUS/BLOCKERS.md` BLK-105) |

Shipped-phase history with SHAs: `docs/STATUS/PHASE-PROGRESS-TRACKER.md` → "Shipped phases → roadmap phases".

## Deployment status

| Service | Railway | What is known |
|---|---|---|
| BoardRoom AI | `boardroom-ai-production-1092.up.railway.app` | Auto-deploys every push to `main`. **The deploys of `cdef1ef`, `fc19563` and `c2c6fca` are unverified**: the sandbox has no Railway credential and cannot reach `*.up.railway.app`. |
| OmniMind API | `omnimind-api-production.up.railway.app` | Same. Migrations run at boot (`docker-entrypoint.sh` → `prisma migrate deploy`); whether `20261018000000_mcp_tokens` and `20261018000001_mcp_identity_hardening` applied in prod is the first thing M0-F4 checks. |
| OmniMind MCP | `packages/omnimind-mcp` (third service, `railway.toml` present) | **Never launched.** No OAuth issuer is configured (ADR-016 Proposed). Launch is founder item M1-F1. |
| PostgreSQL | Railway plugin (pgvector + pg_trgm) | **No backup since the 2026-05-09 drill**; `services/backup` is not deployed (BLK-104). |

All three `railway.toml` files use `healthcheckPath = "/health"` and `numReplicas = 1`. BoardRoom still reaches OmniMind over the public domain (private networking is Phase 8 M3-F2).

## What's built

- **BoardRoom AI** — 7-persona decision sessions with a debate protocol, disagreement ledger, pre-mortem mode, decision commit with a required forecast, outcome reviews and calibration; dashboard chart system and communities knowledge graph; Settings → Connected AI tools (mint and revoke per-user `omt_` tokens).
- **OmniMind API** — all persistent data (43 Prisma models), validation pipeline, hybrid retrieval (vector + FTS + trigram), `asOf` temporal validity, reflection capsules, commitment nudges, cortex jobs, per-call LLM usage, idempotency keys, delegated MCP identity.
- **OmniMind MCP** — hosted Streamable HTTP gateway, 20 tools, 3 prompts, 4 resource templates; per-user tokens and OAuth resource-server mode.
- **Shared** — types, Zod schemas, constants, pure utils.

Detail by phase: `docs/STATUS/CURRENT-PHASE.md`; full changelog: `docs/STATUS/CHANGELOG.md`.

## Tests

Package baselines the Phase 8 roadmap requires every change to keep: shared 151 · mcp 255 · api 1,175 · server 284 · client 436. The last recorded live-stack run (2026-10-20, `CHANGELOG.md`): `pnpm test:e2e` 55/55, `pnpm e2e:live` journey 22/22. CI (`.github/workflows/ci.yml`) runs frozen install, typecheck incl. client, tests, audit, Docker builds and the labeled retrieval eval on every PR.

## What's next

Phase 8, milestone M0 (W1, 2026-10-22 → 10-28): rotate the R-103 secrets, take a `pg_dump`, keep `main` green, make deploys identifiable by SHA, add a migration-drift guard, and make the status docs true. Lanes B and C start M1 work in parallel (entity-tenancy ADR-017, deferred-extraction `memory_write`, decision-session honesty). Active items: `docs/STATUS/CURRENT-PHASE.md`. Open blockers: `docs/STATUS/BLOCKERS.md`.

## Known limitations

The maintained list is `.claude/CLAUDE.md` → "Known Limitations". The ones that matter most this week: Railway auto-deploys `main` regardless of CI (1), in-memory rate limiting (2), the public domain for service-to-service calls (3), and single replica per service (7).

## Key files to start any session

| Need | Read |
|------|------|
| Active phase and items | `docs/STATUS/CURRENT-PHASE.md` |
| The plan | `docs/roadmap/PHASE-8-ROADMAP.md` |
| Quick context | `docs/01-orientation/PROJECT-BRIEF.md` |
| Architecture map | `docs/01-orientation/ARCHITECTURE-QUICK-REF.md` |
| Deployment & Railway | `docs/03-operations/DEPLOYMENT-RUNBOOK.md` |
| MCP operator path | `docs/runbooks/omnimind-mcp.md` |
| What breaks easily | `docs/02-reference/FRAGILE-ZONES.md` |
| Architectural decisions | `docs/02-reference/DECISIONS.md` |
| Dev rules & conventions | `.claude/CLAUDE.md` |
| API contracts | `docs/contracts/omnimind-api.contract.md`, `docs/contracts/boardroom-api.contract.md` |
