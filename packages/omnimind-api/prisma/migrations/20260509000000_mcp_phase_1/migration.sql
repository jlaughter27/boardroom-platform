-- Migration: mcp_phase_1
-- Adds OmniMind-MCP infrastructure: Tenant, Agent, McpAuditLog models,
-- MCP fields on MemoryEntry, and two new SourceType enum values.

-- 1. Extend MemoryEntry with MCP tracking fields
ALTER TABLE "memory_entries"
  ADD COLUMN IF NOT EXISTS "agent_id"        TEXT,
  ADD COLUMN IF NOT EXISTS "tenant_id"       TEXT NOT NULL DEFAULT 'josh-personal',
  ADD COLUMN IF NOT EXISTS "embedding_model" TEXT NOT NULL DEFAULT 'openai-text-embedding-3-small';

CREATE INDEX IF NOT EXISTS "memory_entries_tenant_id_deleted_at_idx"
  ON "memory_entries" ("tenant_id", "deleted_at");

CREATE INDEX IF NOT EXISTS "memory_entries_agent_id_created_at_idx"
  ON "memory_entries" ("agent_id", "created_at");

-- 2. Add new SourceType enum values (PostgreSQL ALTER TYPE is additive-only)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'SourceType'::regtype AND enumlabel = 'MCP_AGENT'
  ) THEN
    ALTER TYPE "SourceType" ADD VALUE 'MCP_AGENT';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'SourceType'::regtype AND enumlabel = 'SESSION_SUMMARY'
  ) THEN
    ALTER TYPE "SourceType" ADD VALUE 'SESSION_SUMMARY';
  END IF;
END;
$$;

-- 3. Tenant table
CREATE TABLE IF NOT EXISTS "tenants" (
  "id"         TEXT         NOT NULL,
  "name"       TEXT         NOT NULL,
  "created_at" TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- 4. Agent table
CREATE TABLE IF NOT EXISTS "agents" (
  "id"           TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "name"         TEXT         NOT NULL,
  "api_key_hash" TEXT         NOT NULL,
  "tenant_id"    TEXT         NOT NULL,
  "scopes"       TEXT[]       NOT NULL DEFAULT '{}',
  "source_weight" FLOAT8      NOT NULL DEFAULT 1.0,
  "created_at"   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMPTZ,
  CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "agents_name_key" ON "agents" ("name");
CREATE INDEX IF NOT EXISTS "agents_tenant_id_idx" ON "agents" ("tenant_id");

-- 5. McpAuditLog table
CREATE TABLE IF NOT EXISTS "mcp_audit_logs" (
  "id"            TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "agent_id"      TEXT         NOT NULL,
  "tenant_id"     TEXT         NOT NULL,
  "tool_name"     TEXT         NOT NULL,
  "input_json"    JSONB        NOT NULL,
  "output_json"   JSONB,
  "error_message" TEXT,
  "duration_ms"   INTEGER      NOT NULL,
  "created_at"    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mcp_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "mcp_audit_logs_agent_id_created_at_idx"
  ON "mcp_audit_logs" ("agent_id", "created_at");

CREATE INDEX IF NOT EXISTS "mcp_audit_logs_tenant_id_created_at_idx"
  ON "mcp_audit_logs" ("tenant_id", "created_at");

-- 6. Seed tenants
INSERT INTO "tenants" ("id", "name") VALUES
  ('josh-personal',  'Josh Personal'),
  ('josh-business',  'Josh Business (umbrella)'),
  ('tgfc-ministry',  'TGFC Ministry')
ON CONFLICT ("id") DO NOTHING;
