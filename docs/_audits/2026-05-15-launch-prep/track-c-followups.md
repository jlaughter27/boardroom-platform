# Track C Follow-ups

**Date:** 2026-05-15
**Owner:** future Wave 2/3 work
**Status:** open

Items discovered during Track C (test infra + CI) that are out of
scope for this track but must be addressed before the CI workflow
gives full confidence.

---

## C-FU-01 — Shared package build is broken on `main`

**Severity:** P0 (blocks CI test job + every downstream build)

`packages/shared/src/utils/validation-helpers.ts` has four TS errors
under TypeScript 5.9:

```
src/utils/validation-helpers.ts(314,5): error TS2740: Type
'ZodOptional<ZodString>' is missing the following properties from
type 'ZodString': _regex, _addCheck, email, url, and 44 more.
src/utils/validation-helpers.ts(341,5): error TS2740 (same shape)
src/utils/validation-helpers.ts(366,21): error TS2339: Property 'min'
does not exist on type 'ZodEffects<ZodString, string, string>'.
src/utils/validation-helpers.ts(368,5): error TS2739: Type
'ZodOptional<ZodEffects<ZodString, string, string>>' is missing
innerType, sourceType.
```

These pre-date Track C (introduced in commit `3e01bc2`, TASK-007).
Because the turbo pipeline declares `test.dependsOn: ['^build']`,
`pnpm test` at workspace root fails immediately on the shared build
step, and the new CI workflow added in Track C inherits that
failure.

**Action:** Track B should either tighten the validation-helpers
typings (the cleanest fix is preserving the inferred narrower Zod
generic by extracting helper functions) or pin Zod to the version
the original author used. The functions themselves run correctly —
this is a TS-type-only regression caused by a Zod minor bump.

Until C-FU-01 is fixed, the `test` and `build` jobs in
`.github/workflows/ci.yml` will fail on the very first run. The
`typecheck` job uses `tsc --noEmit` per-package and is not affected.

## C-FU-02 — `omnimind-api` tests need a Postgres service container

The omnimind-api integration tests under
`packages/omnimind-api/tests/integration/*.ts` require:
- Postgres 16 with `pgvector` + `pg_trgm` extensions
- Either a real DB seeded by `prisma db push` or a mock layer

The CI workflow intentionally skips these with a TODO. Wire up a
`services: postgres:` block on the `test` job, run
`CREATE EXTENSION` + `prisma db push` in a `before:` step, and inject
`DATABASE_URL` into the test env.

## C-FU-03 — Coverage thresholds not enforced

Vitest is configured with `provider: 'v8'` in all three configs but
no `coverage.thresholds` are set and no `--coverage` flag is passed
in CI. Audit 05 recommends 80% for `agents/`, `services/omnimind-client.ts`,
`middleware/`; 50% baseline for client.

Add `coverage.thresholds.lines` to each vitest config and append
`--coverage` to the CI test step once thresholds are agreed.

## C-FU-04 — Several critical-path tests written as `.skip`

The following test files contain `.skip` blocks pending Track A
deliverables. They must be flipped to live tests when the
corresponding fixes ship:

| Test file | Audit ID | Depends on |
|---|---|---|
| `server/tests/unit/admin.routes.test.ts` (3 cases) | ADM-01 | new admin.routes.ts + requireAdmin middleware |
| `server/tests/unit/stripe-webhook.test.ts` (2 cases) | SUB-01, SUB-09 | explicit missing-signature 400, idempotency layer |
| `server/tests/unit/subscription.middleware.fail-closed.test.ts` (1 case) | SUB-03 | NODE_ENV-aware fail-closed |
| `server/tests/unit/error-handler.test.ts` (3 cases) | (audit §5 row 9) | middleware/error-handler.ts |

Total: 9 skipped tests gated on Track A.

## C-FU-05 — Branch protection not yet configured

`.github/workflows/ci.yml` exists but is not a hard gate until the
GitHub repo settings require it. Action item for the repo admin:

- Settings -> Branches -> Branch protection rules -> `main`
- Require status checks to pass before merging
- Required checks: `typecheck`, `test`, `build`
