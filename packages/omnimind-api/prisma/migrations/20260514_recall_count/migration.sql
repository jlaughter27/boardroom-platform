-- WS-3: Recall reinforcement
-- Adds recall_count field to memory_entries. Incremented on every successful
-- retrieval (semantic / fulltext / trigram / structured hit). The exponential
-- decay strength formula uses this to amplify well-used memories:
--   strength = importance * EXP(-λ * days_since_access) * (1 + recall_count * 0.2)
--
-- This is a forward-only, backwards-compatible change: existing rows default
-- to 0 (no recall history yet), which makes their strength formula reduce to
-- the existing exponential-decay calculation.

ALTER TABLE "memory_entries"
  ADD COLUMN IF NOT EXISTS "recall_count" INTEGER NOT NULL DEFAULT 0;
