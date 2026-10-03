// Phase 6 context types — core context block, reflection capsules, entity
// change diffs, commitment nudges, LLM usage accounting.
// Companion Zod schemas: packages/shared/src/validation/context.schema.ts
// Contract: docs/contracts/PHASE-6-CONTRACTS.md (owner: A1)

import type { ContextCapsule } from './context-capsule.types';
import type { Decision } from './decision.types';
import type { Commitment } from './commitment.types';
import type { MemoryApiRecord } from './memory.types';

// ── Core context (GET /context/core) ──

export interface CoreContextResponse {
  /** Deterministic markdown block — sorted keys, no timestamps inside. */
  block: string;
  tokensEstimate: number;
  /** sha256 of `block`; identical input → identical hash. */
  hash: string;
  /** ISO timestamp of when this block was rendered (outside the block). */
  generatedAt: string;
}

// ── Reflection / capsules ──

export type ReflectableEntityType = 'goal' | 'project' | 'person';

export interface ReflectRequest {
  entityType: ReflectableEntityType;
  entityId: string;
}

/** ContextCapsule with the Phase 6 provenance columns. */
export interface ReflectedContextCapsule extends ContextCapsule {
  sourceMemoryIds: string[];
  importanceSeen: number;
  version: number;
}

/** Shape the reflection prompt must return (Zod-validated before persisting). */
export interface ReflectionLLMOutput {
  summary: string;
  openRisks: string[];
  unresolvedQuestions: string[];
  recentChanges: string[];
  activeStakeholders: string[];
}

export interface CapsulesResponse {
  items: ReflectedContextCapsule[];
}

// ── "What changed since last time" (GET /decisions/changes) ──

export interface EntityChangesResponse {
  since: string;
  memories: MemoryApiRecord[];
  decisions: Decision[];
  commitments: Commitment[];
  capsule: ReflectedContextCapsule | null;
}

// ── Commitment nudges (GET /commitments/nudges) ──

export interface CommitmentNudgesResponse {
  dueSoon: Commitment[];
  overdue: Commitment[];
}

// ── Interactive memo (PATCH /cortex/memo/:id/items/:itemKey) ──

export type MemoItemStateValue = 'accepted' | 'dismissed' | 'snoozed';

export interface MemoItemState {
  state: MemoItemStateValue;
  /** ISO — only for `snoozed` */
  until?: string;
  /** Memory id written when `accepted` */
  memoryId?: string;
}

export interface MemoItemStateRequest {
  state: MemoItemStateValue;
  until?: string;
}

// ── LLM usage (POST /usage/llm, GET /usage/llm/summary) ──

export interface LlmUsageCreateRequest {
  service: string;
  purpose: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  durationMs?: number;
  sessionId?: string;
  userId?: string;
  tenantId?: string;
}

export interface LlmUsageCreateResponse {
  id: string;
  costUsd: number;
}

export interface LlmUsageByDay {
  /** YYYY-MM-DD (UTC) */
  date: string;
  usd: number;
  calls: number;
}

export interface LlmUsageByPurpose {
  purpose: string;
  usd: number;
  calls: number;
  /** cacheRead / (input + cacheRead + cacheWrite); 0 when no input tokens */
  cacheHitRate: number;
}

export interface LlmUsageByModel {
  model: string;
  usd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmUsageSummary {
  days: number;
  totalUsd: number;
  byDay: LlmUsageByDay[];
  byPurpose: LlmUsageByPurpose[];
  byModel: LlmUsageByModel[];
}
