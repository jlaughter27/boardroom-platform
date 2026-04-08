#!/bin/sh
set -e

# Run Prisma migrations (using globally installed prisma@6.19.3)
prisma migrate deploy

# Enable pgvector extension (idempotent)
prisma db execute --stdin <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL

# Start the server
exec node dist/index.js
