// Utility types — TASK-004
// Common types for partial updates, filters, pagination, and API utilities

// ── Partial Update Types ──

/**
 * Makes all properties in T optional (except those specified as required)
 * while also making nested objects partial recursively.
 */
export type DeepPartial<T> = T extends object
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;

/**
 * Makes all properties in T optional, but doesn't recurse into nested objects
 */
export type PartialUpdate<T> = {
  [P in keyof T]?: T[P] extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T[P] extends ReadonlyArray<infer U>
    ? ReadonlyArray<DeepPartial<U>>
    : DeepPartial<T[P]>;
};

// ── Filter Types ──

export interface BaseFilter {
  offset?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  includeDeleted?: boolean;
}

export interface DateRangeFilter {
  from?: Date | string;
  to?: Date | string;
}

export interface MemoryFilter extends BaseFilter {
  userId: string;
  domain?: string;
  memoryClass?: ('WORKING' | 'EPISODIC' | 'SEMANTIC' | 'DECISION')[];
  status?: ('DRAFT' | 'CONFIRMED' | 'SUPERSEDED' | 'ARCHIVED' | 'REJECTED')[];
  confidence?: ('HIGH' | 'MEDIUM' | 'LOW' | 'SPECULATIVE')[];
  tags?: string[];
  search?: string;
  createdAt?: DateRangeFilter;
  updatedAt?: DateRangeFilter;
  importanceMin?: number;
  importanceMax?: number;
}

export interface DecisionFilter extends BaseFilter {
  userId: string;
  status?: ('OPEN' | 'DECIDED' | 'REVIEWED' | 'REVISED')[];
  search?: string;
  createdAt?: DateRangeFilter;
  updatedAt?: DateRangeFilter;
  reviewDue?: boolean; // decisions where reviewAt is in the past or near future
  hasOutcome?: boolean; // decisions with outcome populated
}

export interface CommitmentFilter extends BaseFilter {
  userId: string;
  status?: ('OPEN' | 'COMPLETED' | 'MISSED' | 'DEFERRED')[];
  stakeholderId?: string;
  projectId?: string;
  deadline?: DateRangeFilter;
  overdue?: boolean; // commitments with deadline in past and status OPEN
  completed?: boolean; // commitments with status COMPLETED
}

export interface PersonFilter extends BaseFilter {
  userId: string;
  domains?: string[];
  importanceMin?: number;
  importanceMax?: number;
  relationshipToUser?: string;
  search?: string;
  lastContactSince?: Date | string; // people contacted since this date
}

export interface ProjectFilter extends BaseFilter {
  userId: string;
  status?: string[];
  domain?: string;
  deadline?: DateRangeFilter;
  search?: string;
}

export interface TaskFilter extends BaseFilter {
  userId: string;
  status?: string[];
  owner?: string;
  priorityMin?: number;
  priorityMax?: number;
  deadline?: DateRangeFilter;
  overdue?: boolean;
  search?: string;
}

export interface GoalFilter extends BaseFilter {
  userId: string;
  level?: number[];
  status?: string[];
  domain?: string;
  deadline?: DateRangeFilter;
  search?: string;
}

// ── Pagination Types ──

export interface PaginationParams {
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationParams;
}

export interface CursorPaginationParams {
  cursor?: string;
  limit: number;
  direction: 'forward' | 'backward';
}

export interface CursorPaginatedResult<T> {
  items: T[];
  nextCursor?: string;
  prevCursor?: string;
  hasMore: boolean;
}

// ── Search Types ──

export interface HybridSearchParams {
  userId: string;
  query: string;
  types?: ('memory' | 'person' | 'goal' | 'project' | 'decision' | 'task')[];
  domain?: string;
  limit?: number;
  includeSemantic?: boolean;
  includeFts?: boolean;
  includeTrigram?: boolean;
  filters?: Record<string, any>;
}

export interface SearchResult<T> {
  item: T;
  score: number;
  source: 'semantic' | 'fts' | 'trigram' | 'structured';
  matchedFields?: string[];
  highlights?: string[];
}

// ── API Utility Types ──

export type WithUserId<T> = T & { userId: string };

export type WithoutId<T> = Omit<T, 'id'>;

export type WithTimestamps<T> = T & {
  createdAt: Date;
  updatedAt: Date;
};

export type WithOptimisticLocking<T> = T & {
  version: number;
};

export type EntityResponse<T> = {
  data: T;
  meta?: {
    warnings?: string[];
    suggestions?: string[];
    related?: Array<{
      type: string;
      id: string;
      title: string;
      relevance: number;
    }>;
  };
};

// ── Validation Utility Types ──

export interface ValidationOptions {
  skipAsync?: boolean;
  skipContradiction?: boolean;
  requireConfirmation?: boolean;
}

export interface ValidationContext {
  userId: string;
  operation: 'create' | 'update' | 'delete';
  source?: 'user' | 'agent' | 'import';
  timestamp: Date;
}

// ── Batch Operation Types ──

export interface BatchOperation<T> {
  items: T[];
  operation: 'create' | 'update' | 'delete' | 'link';
  options?: {
    skipValidation?: boolean;
    skipNotifications?: boolean;
    transaction?: boolean;
  };
}

export interface BatchResult<T> {
  succeeded: Array<{
    item: T;
    id: string;
    status: 'created' | 'updated' | 'deleted' | 'linked';
  }>;
  failed: Array<{
    item: T;
    error: string;
    details?: any;
  }>;
  total: number;
  successCount: number;
  failureCount: number;
}