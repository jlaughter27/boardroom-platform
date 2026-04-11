/**
 * API Response Types
 * Additional response types not covered by api.types.ts
 */

// Generic API response wrapper
export interface ApiResponse<T> {
  data: T;
  meta?: {
    total?: number;
    offset?: number;
    limit?: number;
  };
}

// Standard error response format
export interface ErrorResponse {
  error: string;
  message: string;
  details?: Array<{
    field: string;
    message: string;
  }>;
  retryAfter?: number;
}

// Generic entity responses for CRUD operations
export interface EntityCreatedResponse {
  id: string;
  status: 'created';
}

export interface EntityUpdatedResponse {
  id: string;
  status: 'updated';
}

export interface EntityDeletedResponse {
  id: string;
  status: 'deleted';
}

// Health check response
export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'error';
  dbConnected: boolean;
  timestamp: string;
}
