import { z } from 'zod';

export interface McpTool {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: z.ZodObject<any>;
  execute(raw: unknown): Promise<unknown>;
}

export interface AgentContext {
  agentId: string;
  agentName: string;
  tenantId: string;
  scopes: string[];
  sourceWeight: number;
}

export interface FactWithAction {
  text: string;
  type: 'decision' | 'blocker' | 'status' | 'context' | 'preference';
  action: 'create' | 'update';
  supersedes?: string;
}

/** Successful memory_write: ids actually created / updated (as reported by the API). */
export interface MemoryWriteSuccess {
  ok: true;
  created: string[];
  updated: string[];
  skipped: number;
}

/**
 * Refused memory_write. `created`/`updated`/`skipped` are kept (always empty)
 * so callers that only look at those fields keep working; `ok: false` plus
 * `error` is the discriminator. M-109: replaces the old
 * `as unknown as MemoryWriteResult` smuggling.
 */
export interface MemoryWriteRefused {
  ok: false;
  error: 'MINISTRY_DEFERRED' | 'FACT_EXTRACTOR_UNAVAILABLE';
  message: string;
  created: string[];
  updated: string[];
  skipped: number;
}

export type MemoryWriteResult = MemoryWriteSuccess | MemoryWriteRefused;

export interface AuditEntry {
  agentId: string;
  tenantId: string;
  toolName: string;
  inputJson: unknown;
  outputJson?: unknown;
  errorMessage?: string;
  durationMs: number;
}

export class ScopeDeniedError extends Error {
  readonly code = 'SCOPE_DENIED';
  constructor(required: string, agentName: string) {
    super(`Agent "${agentName}" lacks required scope: ${required}`);
    this.name = 'ScopeDeniedError';
  }
}

export class McpValidationError extends Error {
  readonly code = 'VALIDATION_ERROR';
  readonly issues: ReadonlyArray<{ path: string; message: string }>;
  constructor(message: string, issues: ReadonlyArray<{ path: string; message: string }> = []) {
    super(message);
    this.name = 'McpValidationError';
    this.issues = issues;
  }
}
