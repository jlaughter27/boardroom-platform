-- AUDIT-2026-10-02 / O-103: non-compounding importance decay.
--
-- The weekly decay job previously overwrote `importance` with
-- importance * EXP(-λ·days) using the ALREADY-decayed value as the base, so
-- every run compounded the previous run's decay (irreversible drift to 0).
--
-- Fix: persist the undecayed value in `base_importance` and recompute
--   importance = base_importance * EXP(-λ·days_since_access) * (1 + recall*0.2)
-- from scratch on every run. Backfill = current importance (the best value we
-- have; already-decayed rows will not recover, but they stop drifting).
ALTER TABLE "memory_entries" ADD COLUMN IF NOT EXISTS "base_importance" DOUBLE PRECISION;

UPDATE "memory_entries" SET "base_importance" = "importance" WHERE "base_importance" IS NULL;
