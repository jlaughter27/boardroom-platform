// Tool Zod schemas — matches packages/shared/src/types/tool.types.ts

import { z } from 'zod';

// ── Tool Definition Schema ──

export const ToolDefinitionSchema = z.object({
  name: z.string().describe('Tool name identifier'),
  description: z.string().describe('Human-readable tool description'),
  inputSchema: z.record(z.string(), z.unknown()).describe('JSON Schema for tool input'),
  personaPermissions: z.array(z.string()).describe('Persona IDs allowed to use this tool'),
});

export type ToolDefinitionInput = z.infer<typeof ToolDefinitionSchema>;

// ── Tool Invocation Schema ──

export const ToolInvocationSchema = z.object({
  toolName: z.string().describe('Name of the tool to invoke'),
  input: z.record(z.string(), z.unknown()).describe('Input parameters for the tool'),
  personaId: z.string().describe('Persona requesting the tool invocation'),
  sessionId: z.string().describe('Session in which the tool is invoked'),
});

export type ToolInvocationInput = z.infer<typeof ToolInvocationSchema>;

// ── Tool Result Schema ──

export const ToolResultSchema = z.object({
  toolName: z.string().describe('Name of the tool that was invoked'),
  output: z.string().describe('Tool output content'),
  durationMs: z.number().describe('Execution duration in milliseconds'),
  cached: z.boolean().describe('Whether the result was served from cache'),
});

export type ToolResultInput = z.infer<typeof ToolResultSchema>;
