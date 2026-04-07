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

export type ToolName = 'web_search' | 'calculator' | 'document_read';
