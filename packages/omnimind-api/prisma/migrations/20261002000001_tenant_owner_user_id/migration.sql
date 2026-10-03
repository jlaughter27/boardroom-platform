-- AUDIT-2026-10-02 / O-107: session summaries need a real owner user.
--
-- The session summarizer wrote SESSION_SUMMARY memories under the synthetic
-- user id "mcp:<tenant>", which user-validator rejects on every read path.
-- Each tenant now records the User that owns it; the summarizer resolves the
-- owner and skips (with a one-time log) when it is NULL. Operators set this
-- once per tenant:  UPDATE tenants SET owner_user_id = '<user cuid>' WHERE id = 'josh-business';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "owner_user_id" TEXT;
