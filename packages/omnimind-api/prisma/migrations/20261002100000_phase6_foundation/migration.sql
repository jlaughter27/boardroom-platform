-- AlterTable
ALTER TABLE "memory_entries" ADD COLUMN     "consolidated_from" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "decisions" ADD COLUMN     "decided_at" TIMESTAMP(3),
ADD COLUMN     "expected_outcome" TEXT,
ADD COLUMN     "mode" TEXT,
ADD COLUMN     "persona_forecasts" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "probability_success" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "context_capsules" ADD COLUMN     "importance_seen" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "source_memory_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "weekly_memos" ADD COLUMN     "item_states" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "llm_usage" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "tenant_id" TEXT,
    "service" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "session_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "result_id" TEXT,
    "result_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "llm_usage_user_id_created_at_idx" ON "llm_usage"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "llm_usage_created_at_idx" ON "llm_usage"("created_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_scope_key_key" ON "idempotency_keys"("scope", "key");

