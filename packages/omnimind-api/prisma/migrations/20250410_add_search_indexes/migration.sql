-- Migration: Add trigram and full-text search indexes for hybrid retrieval
-- These are PostgreSQL-specific indexes not supported by Prisma natively.
--
-- AUDIT-2026-10-02 / O-104: this file originally referenced camelCase column
-- names (userId, deletedAt, sourceRef, createdAt) that do not exist on
-- "memory_entries" (the table uses snake_case via @map). It never executed in
-- production because docker-entrypoint.sh marks it `--applied` as part of the
-- db-push baseline. On an empty database `migrate deploy` DID execute it and
-- crashed at the first bad index. Column names are now correct and every
-- statement is idempotent so this migration is safe on both fresh databases
-- (after 0_init) and existing databases.

-- Enable required extensions (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- Add trigram index for fuzzy text matching on memory content
CREATE INDEX IF NOT EXISTS idx_memory_content_trgm
ON memory_entries
USING gin (content gin_trgm_ops);

-- Add full-text search index for English text
CREATE INDEX IF NOT EXISTS idx_memory_content_fts
ON memory_entries
USING gin (to_tsvector('english', content));

-- Add trigram index for memory titles
CREATE INDEX IF NOT EXISTS idx_memory_title_trgm
ON memory_entries
USING gin (title gin_trgm_ops);

-- Add full-text search index for titles
CREATE INDEX IF NOT EXISTS idx_memory_title_fts
ON memory_entries
USING gin (to_tsvector('english', title));

-- Add composite index for hybrid retrieval optimization (btree_gin for user_id)
CREATE INDEX IF NOT EXISTS idx_memory_user_content_trgm
ON memory_entries
USING gin (user_id, content gin_trgm_ops)
WHERE deleted_at IS NULL;

-- Add index for source reference lookups
CREATE INDEX IF NOT EXISTS idx_memory_sourceref
ON memory_entries(source_ref)
WHERE source_ref IS NOT NULL;

-- Add partial index for active memories (excludes soft-deleted)
CREATE INDEX IF NOT EXISTS idx_memory_active
ON memory_entries(user_id, created_at DESC)
WHERE deleted_at IS NULL;

COMMENT ON INDEX idx_memory_content_trgm IS 'Trigram index for fuzzy text matching in content';
COMMENT ON INDEX idx_memory_content_fts IS 'Full-text search index for content (English)';
COMMENT ON INDEX idx_memory_title_trgm IS 'Trigram index for fuzzy title matching';
COMMENT ON INDEX idx_memory_title_fts IS 'Full-text search index for titles (English)';
