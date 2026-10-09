-- AUDIT-2026-10-02 / M-103: agent-key verification looks agents up by the
-- sha256 of the raw `omk_...` key sent in `x-agent-key`. Index the hash so the
-- per-request lookup is O(log n).
CREATE INDEX IF NOT EXISTS "agents_api_key_hash_idx" ON "agents"("api_key_hash");
