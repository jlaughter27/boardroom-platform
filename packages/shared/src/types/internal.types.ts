/**
 * Internal types used across OmniMind services.
 * Exported from shared for consistency, even though they're primarily
 * used within omnimind-api.
 */

export interface ValidationResult {
  valid: boolean;
  errors: { field: string; message: string }[];
}

export interface PipelineResult extends ValidationResult {
  durationMs: number;
}

export interface ScoredResult {
  id: string;
  type: 'memory' | 'person' | 'goal' | 'project' | 'decision';
  content: string;
  title: string;
  relevanceScore: number;
  source: 'structured' | 'fts' | 'trigram' | 'semantic';
  whyIncluded: string;
  tags?: string[];
  importance?: number;
  lastAccessedAt?: Date | null;
}

export interface ContextPackage {
  items: {
    type: ScoredResult['type'];
    id: string;
    content: string;
    relevanceScore: number;
    source: ScoredResult['source'];
    whyIncluded: string;
  }[];
  tokenEstimate: number;
  retrievalMetadata: {
    totalCandidates: number;
    layersUsed: string[];
  };
}
