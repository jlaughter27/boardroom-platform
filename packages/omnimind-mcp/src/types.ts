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

export interface MemoryWriteResult {
  created: string[];
  updated: string[];
  skipped: number;
}

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
  constructor(message: string) {
    super(message);
    this.name = 'McpValidationError';
  }
}
