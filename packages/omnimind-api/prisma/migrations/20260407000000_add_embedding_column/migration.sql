-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column.
-- AUDIT-2026-10-02 / O-104: idempotent so this applies cleanly after 0_init
-- (which already creates the column) on a fresh database.
ALTER TABLE "memory_entries" ADD COLUMN IF NOT EXISTS "embedding" vector(1536);

-- Create IVFFlat index for cosine similarity
CREATE INDEX IF NOT EXISTS "memory_entry_embedding_idx" ON "memory_entries" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
