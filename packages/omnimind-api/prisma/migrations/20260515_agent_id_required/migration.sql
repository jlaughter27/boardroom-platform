-- WS-4.1: agent_id NOT NULL enforcement
--
-- Background: Hermes integration testing surfaced that some memory rows had
-- agent_id IS NULL despite WS-1 wiring the MCP attribution headers through
-- the seam. Non-MCP callers (BoardRoom AI, internal jobs) write through the
-- same service entry point but don't attach an agent context, leaving the
-- column null.
--
-- Fix:
--   1. Backfill all existing NULL agent_id rows to 'legacy' — descriptive
--      marker that these rows pre-date the NOT NULL constraint and have no
--      attribution. Distinct from 'unknown' (which would imply we couldn't
--      figure it out) — 'legacy' clearly signals "before the constraint".
--   2. Set DEFAULT 'legacy' so any code path that fails to provide an
--      agent_id (a bug at the service layer) still satisfies the NOT NULL.
--      This is defense in depth — the service layer should always pass one.
--   3. Add the NOT NULL constraint.
--
-- The companion service-layer change (memory.service.ts) defaults missing
-- agent context to 'boardroom-ai' so new BoardRoom AI writes are correctly
-- attributed rather than landing on the 'legacy' DEFAULT.

UPDATE "memory_entries" SET "agent_id" = 'legacy' WHERE "agent_id" IS NULL;

ALTER TABLE "memory_entries" ALTER COLUMN "agent_id" SET DEFAULT 'legacy';

ALTER TABLE "memory_entries" ALTER COLUMN "agent_id" SET NOT NULL;
