-- Lane A1 (2026-10-18): per-user MCP tokens + OAuth identity resolution.
-- Idempotent per prisma/migrations/README.md (R-O-08): safe on re-runs and on
-- databases that were previously `db push`ed.

-- CreateTable
CREATE TABLE IF NOT EXISTS "mcp_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "scopes" TEXT[],
    "source_weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "mcp_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_tokens_agent_name_key" ON "mcp_tokens"("agent_name");
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_tokens_token_hash_key" ON "mcp_tokens"("token_hash");
CREATE INDEX IF NOT EXISTS "mcp_tokens_user_id_idx" ON "mcp_tokens"("user_id");
CREATE INDEX IF NOT EXISTS "mcp_tokens_token_hash_idx" ON "mcp_tokens"("token_hash");

-- CreateTable
CREATE TABLE IF NOT EXISTS "mcp_oauth_identities" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "scopes" TEXT[],
    "source_weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "mcp_oauth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_oauth_identities_issuer_subject_key" ON "mcp_oauth_identities"("issuer", "subject");
CREATE INDEX IF NOT EXISTS "mcp_oauth_identities_user_id_idx" ON "mcp_oauth_identities"("user_id");
