-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column
ALTER TABLE "memory_entries" ADD COLUMN "embedding" vector(1536);

-- Create IVFFlat index for cosine similarity
CREATE INDEX "memory_entry_embedding_idx" ON "memory_entries" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
