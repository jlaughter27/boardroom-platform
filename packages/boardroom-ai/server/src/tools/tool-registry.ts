import type { PersonaId, ToolResult, ToolName } from '@boardroom/shared';
import { TOOL_PERMISSIONS, TOOL_LIMITS } from '@boardroom/shared';

// Anthropic SDK tool definition format
export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

export interface ToolHandler {
  definition: AnthropicToolDef;
  execute: (input: Record<string, unknown>) => Promise<string>;
}

class ToolRegistry {
  private tools = new Map<string, ToolHandler>();
  private sessionInvocations = new Map<string, number>(); // sessionId -> count

  register(handler: ToolHandler): void {
    this.tools.set(handler.definition.name, handler);
  }

  getToolsForPersona(personaId: PersonaId): AnthropicToolDef[] {
    const allowed: AnthropicToolDef[] = [];
    for (const [name, handler] of this.tools) {
      const perms = TOOL_PERMISSIONS[name as ToolName];
      if (perms && perms.includes(personaId)) {
        allowed.push(handler.definition);
      }
    }
    return allowed;
  }

  async execute(name: string, input: Record<string, unknown>, sessionId: string): Promise<ToolResult> {
    const handler = this.tools.get(name);
    if (!handler) return { toolName: name, output: `Unknown tool: ${name}`, durationMs: 0, cached: false };

    // Check session limit
    const count = this.sessionInvocations.get(sessionId) ?? 0;
    if (count >= TOOL_LIMITS.maxInvocationsPerSession) {
      return { toolName: name, output: 'Tool invocation limit reached for this session', durationMs: 0, cached: false };
    }
    this.sessionInvocations.set(sessionId, count + 1);

    const start = Date.now();
    try {
      const output = await handler.execute(input);
      return { toolName: name, output, durationMs: Date.now() - start, cached: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Tool execution failed';
      return { toolName: name, output: `Error: ${msg}`, durationMs: Date.now() - start, cached: false };
    }
  }

  resetSession(sessionId: string): void {
    this.sessionInvocations.delete(sessionId);
  }
}

export const toolRegistry = new ToolRegistry();
