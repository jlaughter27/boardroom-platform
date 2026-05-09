# Reality Baseline — Capability Status

> Source-of-truth snapshot for what is implemented, wired, validated, or pending. Update after each phase.

## Owner Map & Scope Freeze

| Area | Owner | Notes |
| --- | --- | --- |
| Backend (OmniMind API) | (assign) | Routing, jobs, DB, rate limiting |
| Frontend/Orchestration (BoardRoom AI) | (assign) | Auth, sessions, personas, billing UI |
| QA/Testing | (assign) | CI gates, e2e, integration |
| DevOps/Infra | (assign) | Deploy, monitoring, backups |
| Security | (assign) | RLS, audit, auth, secrets |
| Product | (assign) | Scope/acceptance, rollout |

**Scope freeze:** No new features enter the baseline until all Phase 1 gates pass (every capability below has status + evidence).

## Capability Matrix (Claim vs Evidence)

Status keys: ✅ Implemented & validated · ⚠️ Implemented, not validated · 🛠️ Implemented, not wired · 📝 Spec-only · ❓ Unknown

| Capability | Status | Evidence / File | Gaps / Notes |
| --- | --- | --- | --- |
| Service routing (OmniMind) | 🛠️ | `packages/omnimind-api/src/index.ts` | Admin & memory-maintenance routers exist but are not mounted. |
| Schedulers: memory cleanup | ❓ | Referenced in `admin.routes.ts` as `memory-cleanup-scheduler` | File missing; determine plan (implement or remove). |
| Schedulers: cortex | ❓ | Referenced in `admin.routes.ts` as `cortex-scheduler` | File missing; determine plan (implement or remove). |
| Rate limiting backend | ⚠️ | `middleware/rate-limiter.ts` (in-memory), Redis path exists | Global uses in-memory; Redis+fallback not default. |
| Billing gate | ⚠️ | `boardroom-ai/server/src/middleware/subscription.middleware.ts` | Fail-open on upstream failure. |
| Stripe webhooks | ⚠️ | `boardroom-ai/server/src/services/stripe.service.ts` | Validation not evidenced; idempotency/signature to verify. |
| OAuth (Google Calendar) | ⚠️ | `boardroom-ai/server/src/routes/integrations.routes.ts` | Need token refresh + context E2E proof. |
| Admin/maintenance APIs | 🛠️ | `omnimind-api/src/routes/admin.routes.ts`, `memory-maintenance.routes.ts` | Not mounted; auth/health/locks unreachable until wired. |
| Architecture docs | 📝 | `docs/architecture/*.md` | Placeholders (TODO). |
| Task specs (024–040) | 📝 | `docs/tasks/phase-immediate/` | Template stubs; needs concrete requirements/AC. |
| CI pipeline | ⚠️ | `.github/workflows/ci.yml` | PNPM version mismatch vs repo pin; limited integration coverage. |
| Tests coverage reality | ⚠️ | `tests/README.md`, `tests/integration/*` | Integration set minimal vs claims; need run + expand. |
| Production readiness doc | ⚠️ | `docs/PRODUCTION-READINESS-CHECKLIST.md` | Contains mixed “complete” and open post-deploy checks; reconcile with baseline. |

## Immediate Actions to Close Phase 1

1) Verify routing and mounts
- [ ] Inspect `packages/omnimind-api/src/index.ts` mounts; decide on admin/memory-maintenance exposure.
- [ ] Decide on scheduler files: implement or remove references.

2) Validate build/test smoke
- [ ] Run `pnpm run typecheck`
- [ ] Run `pnpm run test` (smoke)
- [ ] Run `scripts/test-e2e.sh --tests-only` (or `pnpm test:e2e -- --tests-only`)

3) Collect evidence links per capability
- [ ] Update table above with run outputs (pass/fail), logs, and commit hashes.

4) Owner assignments
- [ ] Fill owner names in the Owner Map.

5) Scope freeze confirmation
- [ ] Record date/time and approvers for Phase 1 freeze here.

## Findings Log (add as you verify)
- [ ] Mounted routes snapshot: (paste server logs)
- [ ] Scheduler status: (running/flagged/absent)
- [ ] Billing gate behavior under failure: (observed)
- [ ] Rate limit source headers: (redis/memory)

## Acceptance Criteria (Phase 1 Gate)
- Every capability has a status (no ❓ Unknown).
- Evidence (file/command/log) linked for each status.
- Owner map populated and scope freeze noted.
- Smoke typecheck/test/e2e executed and results recorded.
