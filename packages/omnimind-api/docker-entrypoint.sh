#!/bin/sh
set -e

# Run Prisma migrations
npx prisma migrate deploy

# Enable pgvector extension (idempotent)
npx prisma db execute --stdin <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL

# Start the server
exec node dist/index.js
