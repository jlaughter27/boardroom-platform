-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "TeamMemberRole" AS ENUM ('OWNER', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "MemoryClass" AS ENUM ('WORKING', 'EPISODIC', 'SEMANTIC', 'DECISION');

-- CreateEnum
CREATE TYPE "MemoryStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'SUPERSEDED', 'ARCHIVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'SPECULATIVE');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('MANUAL', 'BOARDROOM_SESSION', 'API_IMPORT', 'AGENT_EXTRACTED', 'MCP_AGENT', 'SESSION_SUMMARY');

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('OPEN', 'DECIDED', 'REVIEWED', 'REVISED');

-- CreateEnum
CREATE TYPE "CommitmentStatus" AS ENUM ('OPEN', 'COMPLETED', 'MISSED', 'DEFERRED');

-- CreateEnum
CREATE TYPE "PatternType" AS ENUM ('BIAS', 'STRENGTH', 'BEHAVIORAL_CYCLE', 'DECISION_STYLE');

-- CreateEnum
CREATE TYPE "ContradictionStatus" AS ENUM ('ACTIVE', 'ACCEPTED_TENSION', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deepgram_api_key" TEXT,
    "anthropic_api_key" TEXT,
    "slack_webhook_url" TEXT,
    "slack_bot_token" TEXT,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" TEXT NOT NULL,
    "role" "TeamMemberRole" NOT NULL DEFAULT 'MEMBER',
    "user_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "team_name" TEXT NOT NULL DEFAULT '',
    "team_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT '',
    "email" TEXT,
    "speaker_index" INTEGER,
    "room_id" TEXT NOT NULL,

    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "word_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcript_entries" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "speaker" INTEGER NOT NULL,
    "speaker_name" TEXT,
    "text" TEXT NOT NULL,
    "is_final" BOOLEAN NOT NULL DEFAULT true,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transcript_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advisor_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "persona_id" TEXT NOT NULL,
    "persona_name" TEXT NOT NULL,
    "persona_color" TEXT NOT NULL,
    "question" TEXT,
    "response" TEXT NOT NULL DEFAULT '',
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "rating" TEXT,
    "parent_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advisor_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_outputs" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "decisions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "action_items" JSONB NOT NULL DEFAULT '[]',
    "unresolved_issues" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "risks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "advisor_insights" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "sector" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "memory_class" "MemoryClass" NOT NULL DEFAULT 'SEMANTIC',
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "confidence" "Confidence" NOT NULL DEFAULT 'MEDIUM',
    "status" "MemoryStatus" NOT NULL DEFAULT 'DRAFT',
    "source_type" "SourceType" NOT NULL DEFAULT 'MANUAL',
    "source_ref" TEXT,
    "source_weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "valid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalid_at" TIMESTAMP(3),
    "superseded_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "embedding" vector(1536),
    "search_vector" tsvector,
    "last_accessed_at" TIMESTAMP(3),
    "recall_count" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "agent_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'josh-personal',
    "embedding_model" TEXT NOT NULL DEFAULT 'openai-text-embedding-3-small',
    "encrypted_content" BYTEA,
    "encryption_key_id" TEXT,
    "encryption_algorithm" TEXT DEFAULT 'aes-256-gcm',
    "room_id" TEXT,

    CONSTRAINT "memory_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decisions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "chosen_path" TEXT,
    "rationale" TEXT,
    "constraints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "DecisionStatus" NOT NULL DEFAULT 'OPEN',
    "review_at" TIMESTAMP(3),
    "outcome" TEXT,
    "outcome_rating" INTEGER,
    "session_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_assumptions" (
    "id" TEXT NOT NULL,
    "decision_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "confidence" "Confidence" NOT NULL DEFAULT 'MEDIUM',
    "review_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_assumptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "persona_responses" JSONB NOT NULL DEFAULT '{}',
    "ceo_synthesis" TEXT,
    "room_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commitments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "stakeholder_id" TEXT,
    "deadline" TIMESTAMP(3),
    "status" "CommitmentStatus" NOT NULL DEFAULT 'OPEN',
    "source_session_id" TEXT,
    "linked_project_id" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "commitments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "relationship_to_user" TEXT,
    "last_contact_at" TIMESTAMP(3),
    "notes" TEXT,
    "interaction_frequency" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "parent_goal_id" TEXT,
    "success_metrics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deadline" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "domain" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "deadline" TIMESTAMP(3),
    "success_metrics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "domain" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "owner" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "deadline" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "estimated_effort" DOUBLE PRECISION,
    "actual_effort" DOUBLE PRECISION,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT,
    "industry" TEXT,
    "decision_frequency" TEXT,
    "risk_profile" JSONB NOT NULL DEFAULT '{"financial":0.5,"technical":0.5,"people":0.5,"strategic":0.5}',
    "value_hierarchy" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cognitive_patterns" JSONB NOT NULL DEFAULT '[]',
    "decision_history_summary" TEXT,
    "onboarding_complete" BOOLEAN NOT NULL DEFAULT false,
    "dashboard_layout" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "context_capsules" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "open_risks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unresolved_questions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active_stakeholders" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recent_changes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stale_after" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "context_capsules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_entity_links" (
    "id" TEXT NOT NULL,
    "memory_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "link_type" TEXT NOT NULL DEFAULT 'relates_to',

    CONSTRAINT "memory_entity_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_project_links" (
    "id" TEXT NOT NULL,
    "goal_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,

    CONSTRAINT "goal_project_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_person_links" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "project_person_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_task_links" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,

    CONSTRAINT "project_task_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_project_links" (
    "id" TEXT NOT NULL,
    "decision_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,

    CONSTRAINT "decision_project_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "depends_on_task_id" TEXT NOT NULL,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commitment_links" (
    "id" TEXT NOT NULL,
    "commitment_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,

    CONSTRAINT "commitment_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thinking_patterns" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "pattern_type" "PatternType" NOT NULL,
    "evidence_count" INTEGER NOT NULL DEFAULT 1,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "first_detected" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_detected" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trend" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "thinking_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contradiction_alerts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "entity_a" JSONB NOT NULL,
    "entity_b" JSONB NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "status" "ContradictionStatus" NOT NULL DEFAULT 'ACTIVE',
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolution" TEXT,

    CONSTRAINT "contradiction_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_memos" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "week_start" TIMESTAMP(3) NOT NULL,
    "week_end" TIMESTAMP(3) NOT NULL,
    "decisions_made" INTEGER NOT NULL DEFAULT 0,
    "decisions_by_category" JSONB NOT NULL DEFAULT '{}',
    "patterns_noticed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active_contradictions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "upcoming_pressure_points" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "thinking_quality_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "score_change" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recommended_focus" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "full_memo_text" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_memos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outcome_review_nudges" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "decision_id" TEXT NOT NULL,
    "decision_title" TEXT NOT NULL,
    "nudge_type" TEXT NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',

    CONSTRAINT "outcome_review_nudges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_personas" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "persona_id" TEXT NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "model_tier" TEXT NOT NULL DEFAULT 'haiku',
    "max_output_tokens" INTEGER NOT NULL DEFAULT 1500,
    "tool_permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "icon" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_personas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "stripe_customer_id" TEXT NOT NULL,
    "stripe_subscription_id" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "plan" TEXT NOT NULL DEFAULT 'pro',
    "price_monthly" INTEGER NOT NULL DEFAULT 0,
    "trial_ends_at" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "expires_at" TIMESTAMP(3),
    "scope" TEXT,
    "calendar_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "api_key_hash" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "scopes" TEXT[],
    "source_weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3),

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_audit_logs" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "input_json" JSONB NOT NULL,
    "output_json" JSONB,
    "error_message" TEXT,
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_digests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "week_start" TIMESTAMP(3) NOT NULL,
    "week_end" TIMESTAMP(3) NOT NULL,
    "memories_created" INTEGER NOT NULL DEFAULT 0,
    "memories_updated" INTEGER NOT NULL DEFAULT 0,
    "decisions_logged" INTEGER NOT NULL DEFAULT 0,
    "tasks_completed" INTEGER NOT NULL DEFAULT 0,
    "top_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "highlights" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_digests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embedding_outbox" (
    "id" TEXT NOT NULL,
    "memory_id" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "last_attempt_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "succeeded_at" TIMESTAMP(3),

    CONSTRAINT "embedding_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_user_id_team_id_key" ON "team_members"("user_id", "team_id");

-- CreateIndex
CREATE INDEX "transcript_entries_session_id_created_at_idx" ON "transcript_entries"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "advisor_messages_session_id_created_at_idx" ON "advisor_messages"("session_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_outputs_session_id_key" ON "meeting_outputs"("session_id");

-- CreateIndex
CREATE INDEX "memory_entries_user_id_domain_idx" ON "memory_entries"("user_id", "domain");

-- CreateIndex
CREATE INDEX "memory_entries_user_id_memory_class_idx" ON "memory_entries"("user_id", "memory_class");

-- CreateIndex
CREATE INDEX "memory_entries_user_id_status_idx" ON "memory_entries"("user_id", "status");

-- CreateIndex
CREATE INDEX "memory_entries_tenant_id_deleted_at_idx" ON "memory_entries"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "memory_entries_agent_id_created_at_idx" ON "memory_entries"("agent_id", "created_at");

-- CreateIndex
CREATE INDEX "decisions_user_id_status_idx" ON "decisions"("user_id", "status");

-- CreateIndex
CREATE INDEX "decision_sessions_user_id_created_at_idx" ON "decision_sessions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "commitments_user_id_status_idx" ON "commitments"("user_id", "status");

-- CreateIndex
CREATE INDEX "people_user_id_idx" ON "people"("user_id");

-- CreateIndex
CREATE INDEX "goals_user_id_idx" ON "goals"("user_id");

-- CreateIndex
CREATE INDEX "projects_user_id_idx" ON "projects"("user_id");

-- CreateIndex
CREATE INDEX "tasks_user_id_idx" ON "tasks"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "user_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "context_capsules_user_id_entity_type_entity_id_key" ON "context_capsules"("user_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "memory_entity_links_entity_type_entity_id_idx" ON "memory_entity_links"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "memory_entity_links_memory_id_entity_type_entity_id_link_ty_key" ON "memory_entity_links"("memory_id", "entity_type", "entity_id", "link_type");

-- CreateIndex
CREATE UNIQUE INDEX "goal_project_links_goal_id_project_id_key" ON "goal_project_links"("goal_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_person_links_project_id_person_id_key" ON "project_person_links"("project_id", "person_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_task_links_project_id_task_id_key" ON "project_task_links"("project_id", "task_id");

-- CreateIndex
CREATE UNIQUE INDEX "decision_project_links_decision_id_project_id_key" ON "decision_project_links"("decision_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_dependencies_task_id_depends_on_task_id_key" ON "task_dependencies"("task_id", "depends_on_task_id");

-- CreateIndex
CREATE INDEX "commitment_links_entity_type_entity_id_idx" ON "commitment_links"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "commitment_links_commitment_id_entity_type_entity_id_key" ON "commitment_links"("commitment_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "thinking_patterns_user_id_idx" ON "thinking_patterns"("user_id");

-- CreateIndex
CREATE INDEX "contradiction_alerts_user_id_idx" ON "contradiction_alerts"("user_id");

-- CreateIndex
CREATE INDEX "weekly_memos_user_id_idx" ON "weekly_memos"("user_id");

-- CreateIndex
CREATE INDEX "outcome_review_nudges_user_id_idx" ON "outcome_review_nudges"("user_id");

-- CreateIndex
CREATE INDEX "custom_personas_user_id_is_active_idx" ON "custom_personas"("user_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "custom_personas_user_id_persona_id_key" ON "custom_personas"("user_id", "persona_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_user_id_key" ON "subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_idx" ON "subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "oauth_tokens_user_id_idx" ON "oauth_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_tokens_user_id_provider_key" ON "oauth_tokens"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "agents_name_key" ON "agents"("name");

-- CreateIndex
CREATE INDEX "agents_tenant_id_idx" ON "agents"("tenant_id");

-- CreateIndex
CREATE INDEX "mcp_audit_logs_agent_id_created_at_idx" ON "mcp_audit_logs"("agent_id", "created_at");

-- CreateIndex
CREATE INDEX "mcp_audit_logs_tenant_id_created_at_idx" ON "mcp_audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "weekly_digests_user_id_week_start_idx" ON "weekly_digests"("user_id", "week_start");

-- CreateIndex
CREATE UNIQUE INDEX "embedding_outbox_memory_id_key" ON "embedding_outbox"("memory_id");

-- CreateIndex
CREATE INDEX "embedding_outbox_succeeded_at_last_attempt_at_idx" ON "embedding_outbox"("succeeded_at", "last_attempt_at");

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_entries" ADD CONSTRAINT "transcript_entries_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisor_messages" ADD CONSTRAINT "advisor_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisor_messages" ADD CONSTRAINT "advisor_messages_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "advisor_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_outputs" ADD CONSTRAINT "meeting_outputs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_entries" ADD CONSTRAINT "memory_entries_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_assumptions" ADD CONSTRAINT "decision_assumptions_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_sessions" ADD CONSTRAINT "decision_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_sessions" ADD CONSTRAINT "decision_sessions_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_source_session_id_fkey" FOREIGN KEY ("source_session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_stakeholder_id_fkey" FOREIGN KEY ("stakeholder_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_linked_project_id_fkey" FOREIGN KEY ("linked_project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_parent_goal_id_fkey" FOREIGN KEY ("parent_goal_id") REFERENCES "goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_entity_links" ADD CONSTRAINT "memory_entity_links_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memory_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_project_links" ADD CONSTRAINT "goal_project_links_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_project_links" ADD CONSTRAINT "goal_project_links_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_person_links" ADD CONSTRAINT "project_person_links_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_person_links" ADD CONSTRAINT "project_person_links_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_task_links" ADD CONSTRAINT "project_task_links_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_task_links" ADD CONSTRAINT "project_task_links_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_project_links" ADD CONSTRAINT "decision_project_links_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_project_links" ADD CONSTRAINT "decision_project_links_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_task_id_fkey" FOREIGN KEY ("depends_on_task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitment_links" ADD CONSTRAINT "commitment_links_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

