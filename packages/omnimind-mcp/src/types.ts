import { z } from 'zod';

/**
 * MCP spec 2025-11-25 tool annotations. All four are HINTS for clients; the
 * server still enforces scopes. `openWorldHint` is always false here — every
 * tool talks to the closed OmniMind store, never the open internet.
 */
export interface McpToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: false;
}

export interface McpTool {
  name: string;
  /** Human-readable title shown by clients (spec `title`). */
  title: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: z.ZodObject<any>;
  /** Zod object schema from `@boardroom/shared` `validation/mcp.schema.ts`; the result is returned as `structuredContent`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outputSchema: z.ZodObject<any>;
  annotations: McpToolAnnotations;
  execute(raw: unknown): Promise<unknown>;
}

export const READ_ONLY_ANNOTATIONS: McpToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
/** Additive write (new row); safe to retry only when the caller passes an `idempotencyKey`. */
export const ADDITIVE_WRITE_ANNOTATIONS: McpToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
/** Write that converges on the same state when repeated (upsert / status transition). */
export const IDEMPOTENT_WRITE_ANNOTATIONS: McpToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
/** Write that invalidates / replaces existing content. */
export const DESTRUCTIVE_WRITE_ANNOTATIONS: McpToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

export interface AgentContext {
  agentId: string;
  agentName: string;
  tenantId: string;
  scopes: string[];
  sourceWeight: number;
  /**
   * Phase 6 — user the `omnimind://` resources read on behalf of (env
   * `OMNIMIND_MCP_USER_ID`). Tools always take `userId` explicitly; resources
   * have no argument channel, so they need a bound user. Optional: when unset,
   * resource reads return a typed `NO_USER_BOUND` error payload.
   */
  defaultUserId?: string;
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
