-- Lane A1 hardening (2026-10-18, identity review A5 / A8 / A10).
-- Idempotent per prisma/migrations/README.md: safe on re-runs, on fresh DBs
-- (after 0_init + 20261018000000_mcp_tokens) and on databases that already
-- carry the Lane A1 tables.

-- A8: token_hash already has the unique index mcp_tokens_token_hash_key.
DROP INDEX IF EXISTS "mcp_tokens_token_hash_idx";

-- A5: one agent_name per OAuth identity (rate bucket / audit agentId per
-- identity, not per OAuth client). Rows written before this migration shared
-- `oauth:<client>`; every row in a duplicate group gets the suffix new rows
-- carry (`-<last 8 chars of id>`) before the unique index is created.
UPDATE "mcp_oauth_identities"
SET "agent_name" = "agent_name" || '-' || right("id", 8)
WHERE "agent_name" IN (
  SELECT "agent_name" FROM "mcp_oauth_identities" GROUP BY "agent_name" HAVING count(*) > 1
);
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_oauth_identities_agent_name_key" ON "mcp_oauth_identities"("agent_name");

-- A8: FKs → users(id) ON DELETE CASCADE ("users" is the User table, PK "id"
-- TEXT). Credentials whose user row is already gone are removed first so the
-- constraint can be added on a populated table; they could never be used
-- (introspect would answer for a user that does not exist).
DELETE FROM "mcp_tokens" t
WHERE NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = t."user_id");
DELETE FROM "mcp_oauth_identities" i
WHERE NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = i."user_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mcp_tokens_user_id_fkey') THEN
    ALTER TABLE "mcp_tokens"
      ADD CONSTRAINT "mcp_tokens_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mcp_oauth_identities_user_id_fkey') THEN
    ALTER TABLE "mcp_oauth_identities"
      ADD CONSTRAINT "mcp_oauth_identities_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
