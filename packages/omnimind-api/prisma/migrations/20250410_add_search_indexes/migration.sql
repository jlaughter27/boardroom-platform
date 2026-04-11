-- Migration: Add trigram and full-text search indexes for hybrid retrieval
-- These are PostgreSQL-specific indexes not supported by Prisma natively
-- Run manually or via `npx prisma migrate dev --name add_search_indexes`

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

-- Add composite index for hybrid retrieval optimization
CREATE INDEX IF NOT EXISTS idx_memory_user_content_trgm 
ON memory_entries 
USING gin (userId, content gin_trgm_ops) 
WHERE deletedAt IS NULL;

-- Add index for source reference lookups
CREATE INDEX IF NOT EXISTS idx_memory_sourceref 
ON memory_entries(sourceRef) 
WHERE sourceRef IS NOT NULL;

-- Add partial index for active memories (excludes soft-deleted)
CREATE INDEX IF NOT EXISTS idx_memory_active 
ON memory_entries(userId, createdAt DESC) 
WHERE deletedAt IS NULL;

COMMENT ON INDEX idx_memory_content_trgm IS 'Trigram index for fuzzy text matching in content';
COMMENT ON INDEX idx_memory_content_fts IS 'Full-text search index for content (English)';
COMMENT ON INDEX idx_memory_title_trgm IS 'Trigram index for fuzzy title matching';
COMMENT ON INDEX idx_memory_title_fts IS 'Full-text search index for titles (English)';
