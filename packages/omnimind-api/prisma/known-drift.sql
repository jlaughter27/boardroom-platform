-- Accepted migration drift (M0-A3). Read by the "Migration drift guard" step in
-- .github/workflows/ci.yml.
--
-- The guard runs
--   prisma migrate diff --from-migrations prisma/migrations \
--     --to-schema-datamodel prisma/schema.prisma \
--     --shadow-database-url <omnimind_shadow> --script --exit-code
-- and fails unless its output, with `--` comment lines and blank lines removed,
-- is exactly the statements below. Any other difference means schema.prisma and
-- prisma/migrations disagree: add a migration instead of editing this file.
--
-- Each statement is what Prisma WOULD run to make the database match
-- schema.prisma. All four objects were created on purpose in raw SQL by a
-- migration and are kept in production, so these statements must never be
-- applied. In particular, a `prisma migrate dev` migration generated from
-- schema.prisma will contain them: delete them from the generated SQL.
--
--   idx_memory_content_trgm / idx_memory_title_trgm
--       GIN trigram indexes (20250410_add_search_indexes) used by
--       trigram-search.ts.
--   memory_entry_embedding_idx
--       IVFFlat vector_cosine_ops index (20260407000000_add_embedding_column)
--       used by semantic-search.ts. schema.prisma declares `embedding` as
--       Unsupported("vector(1536)"), so Prisma cannot model this index.
--   memory_entries.agent_id DEFAULT 'legacy'
--       Defence-in-depth default (20260515_agent_id_required). The service
--       layer always passes an agentId; schema.prisma has no default so the
--       Prisma client keeps the field required.
--
-- When one of these objects moves into schema.prisma, or is dropped by a
-- migration, the guard goes red until the matching statement is removed here.

-- DropIndex
DROP INDEX "idx_memory_content_trgm";

-- DropIndex
DROP INDEX "idx_memory_title_trgm";

-- DropIndex
DROP INDEX "memory_entry_embedding_idx";

-- AlterTable
ALTER TABLE "memory_entries" ALTER COLUMN "agent_id" DROP DEFAULT;
