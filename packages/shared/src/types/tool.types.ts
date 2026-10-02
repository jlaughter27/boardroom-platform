// Tool types — Phase 3 (Claude)
// Tool invocation definitions for persona-scoped tool use

import type { PersonaId } from './persona.types';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  personaPermissions: PersonaId[];
}

export interface ToolInvocation {
  toolName: string;
  input: Record<string, unknown>;
  personaId: PersonaId;
  sessionId: string;
}

export interface ToolResult {
  toolName: string;
  output: string;
  durationMs: number;
  cached: boolean;
}

/**
 * Known tool identifiers. `document_read` is a stub BoardRoom does not
 * register (B-114) and has no TOOL_PERMISSIONS entry; it is kept in the union
 * only so the stub module compiles.
 */
export type ToolName = 'web_search' | 'calculator' | 'document_read';
