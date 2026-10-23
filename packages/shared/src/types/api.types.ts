// API request/response types — TASK-004 (DeepSeek)
// Implement from: docs/contracts/omnimind-api.contract.md

import type { Confidence, MemoryClass, SourceType } from './memory.types';
import type { PersonaId } from './persona.types';

// --- Memory endpoints ---

export interface CreateMemoryRequest {
  title: string;
  content: string;
  domain: string;
  tags?: string[];
  memoryClass?: MemoryClass;
  importance?: number;
  confidence?: Confidence;
  sourceType: SourceType;
  sourceRef?: string;
  relatedEntityIds?: string[];
  metadata?: Record<string, unknown>;
  /** false skips the near-duplicate auto-supersede on agent writes (bulk imports that key their own rows). Default true. */
  dedup?: boolean;
}

export interface CreateMemoryResponse {
  id: string;
  status: 'created';
  validation: {
    syncPassed: boolean;
    errors: string[];
  };
}

// --- Context endpoints ---

export interface ContextForPersonaRequest {
  query: string;
  persona: PersonaId;
  userId: string;
  maxItems?: number;
  includeEntities?: ('memories' | 'people' | 'goals' | 'projects' | 'decisions')[];
}

export interface ContextItem {
  type: 'memory' | 'person' | 'goal' | 'project' | 'decision';
  id: string;
  content: string;
  relevanceScore: number;
  source: 'structured' | 'fts' | 'trigram' | 'semantic';
  whyIncluded: string;
}

export interface ContextForPersonaResponse {
  items: ContextItem[];
  tokenEstimate: number;
  retrievalMetadata: {
    totalCandidates: number;
    layersUsed: string[];
  };
}

// --- Sufficiency ---

export interface SufficiencyScore {
  score: number;
  missingDimensions: string[];
  suggestedQuestions: string[];
  inferredIntent: string;
  canProceed: boolean;
}

// --- Auth ---

export interface AuthUser {
  userId: string;
  email: string;
  name: string;
}

// --- Session summaries ---

export interface SessionSummary {
  id: string;
  question: string;
  mode: import('./modes.types').UserMode;
  personaCount: number;
  hasSynthesis: boolean;
  createdAt: string;
}

// --- Session dispatch ---

/**
 * Body of POST /sessions/:id/dispatch. Omit `personaIds` to run every persona of
 * the session's mode; pass ids to re-run only those (a retry — the debate round
 * is not re-run). Companion schema: `DispatchSessionBodySchema`.
 */
export interface DispatchSessionRequest {
  personaIds?: PersonaId[];
}

/** One link in `POST /memories/links/batch`. Companion schema: `BatchMemoryLinkItemSchema`. */
export interface BatchMemoryLinkItem {
  memoryId: string;
  entityType: string;
  entityId: string;
  linkType?: string;
}

/** `POST /memories/links/batch` body (≤ 500 links). Companion schema: `BatchMemoryLinksBodySchema`. */
export interface BatchMemoryLinksRequest {
  links: BatchMemoryLinkItem[];
}

export interface BatchMemoryLinksResponse {
  /** Links newly written. */
  created: number;
  /** Valid links that already existed (idempotent re-run). */
  existing: number;
  /** Links refused, by index in the request. */
  rejected: { index: number; reason: 'unknown_entity_type' | 'memory_not_found' | 'entity_not_found' | 'self_link' }[];
}

// --- Common ---

export interface ValidationError {
  error: 'validation_failed';
  details: { field: string; message: string }[];
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}
