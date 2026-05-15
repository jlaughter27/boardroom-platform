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
  /**
   * True if the user is on the `ADMIN_USER_IDS` server allowlist.
   * Optional for backward compatibility — older /auth/me responses omit it.
   */
  isAdmin?: boolean;
  /**
   * UX-1.4. True if the user has clicked the email-verification link.
   * Optional for backward compatibility — older /auth/me responses omit it.
   */
  emailVerified?: boolean;
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
