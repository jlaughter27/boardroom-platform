# DEF-007 — Feature Flag DB Tables

**Capability:** A `FeatureFlag` and `FeatureFlagAssignment` table system enabling per-user, per-tier, per-cohort feature flag rollouts without a code deploy. UI for ops to toggle flags. Audit log of who flipped what when.

**Status:** DEFERRED.

**Trigger to flip back to ACTIVE:**
Horizontal scaling — i.e., **>1 Railway instance running a service** (Phase 19's outcome). Until then, env-var flags + redeploy is fast enough (Railway redeploys in ~3 min) and doesn't have the per-instance state problem.

**Work estimate when triggered:** 2 weeks.

Breakdown:
- 0.5 week: schema. `FeatureFlag(key, description, defaultValue, type enum('bool','string','number'), createdAt, updatedAt, createdBy)` + `FeatureFlagAssignment(flagKey, scope enum('user','tier','cohort'), scopeValue, value, expiresAt, createdAt, createdBy)`. Audit log via the existing audit pattern (or DEF-009 audit table).
- 0.5 week: middleware + helper. `getFlag(req, key, defaultValue)` reads scope chain (user → tier → cohort → global). In-memory LRU cache with 30s TTL and a Postgres LISTEN-driven invalidator.
- 0.5 week: ops UI under `/admin/flags` (basic React or even server-rendered) for set/unset/expiry.
- 0.5 week: docs + migration of existing env-var flags to the new system (one batch, audit each).

**Why deferred:**

A single Railway instance + env-var flags is faster to operate than a flag-table-with-UI for the current scale. Every deferred capability we add to the schema is one more thing to migrate later. The pattern is well-known and battle-tested (LaunchDarkly, Unleash, Statsig); no novel architecture work required when triggered.

**Critical interaction with Phase 19:**

Phase 19 ships >1 API replica. At that point, env-var flags STOP being a fast rollout mechanism — every flag flip requires a redeploy of every replica, which can stagger over minutes and produce inconsistent behavior. **This is the moment Phase 19 must include flag-table migration as a sub-task,** OR this deferred item must be promoted to a real phase that ships before Phase 19.

Recommended sequencing: pull this in as Phase 18.5 (between fairness and horizontal scale), or fold the schema migration into Phase 19's prerequisites.

**References:**
- `docs/roadmap/04-roadmap/PHASE-19-horizontal-api-scale/testing-and-rollback.md` — calls out replica drift in feature flags as a failure mode
- LaunchDarkly's "Feature Management at Scale" docs — pattern reference
- Unleash open-source — closest thing to a battle-tested OSS implementation; consider adopting rather than building
