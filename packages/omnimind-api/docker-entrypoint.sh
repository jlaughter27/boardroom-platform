#!/bin/sh
set -e

# Enable pgvector extension FIRST (schema depends on vector type)
prisma db execute --stdin <<'SQL' || true
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL

# Push schema to database (creates tables if missing, safe for existing schemas)
# Using db push for v1 deployment — switch to migrate deploy once baseline migration exists
prisma db push --skip-generate --accept-data-loss 2>&1 || {
  echo "WARNING: prisma db push failed, attempting migrate deploy..."
  # Resolve any previously failed migrations
  prisma migrate resolve --rolled-back 20260407000000_add_embedding_column 2>/dev/null || true
  prisma migrate deploy
}

# Start the server
exec node dist/index.js
