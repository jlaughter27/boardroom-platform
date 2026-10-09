import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createOmniMindClient } from './lib/client';
import { resolveAgentFromEnv } from './lib/auth';
import { memoryWriteTool, memorySearchTool, memorySupersedeT, memoryReflectTool, memoryConsolidateTool } from './tools/memory.tool';
import { decisionLogTool } from './tools/decision.tool';
import { taskUpsertTool, taskStatusTool, taskListTool, taskCompleteTool, taskBlockTool } from './tools/task.tool';
import { projectStatusTool, projectSummaryTool } from './tools/project.tool';
import { personGetTool } from './tools/person.tool';
import { commitmentLogTool, commitmentListTool } from './tools/commitment.tool';
import { statusGetTool } from './tools/status.tool';
import { graphNeighborhoodTool } from './tools/graph.tool';
import { registerResources } from './resources';
import { registerPrompts } from './prompts';
import { ScopeDeniedError, McpValidationError } from './types';
import type { AgentContext, McpTool } from './types';

/** Every tool this server registers, in registration order (18 as of Phase 6). */
export function buildTools(client: ReturnType<typeof createOmniMindClient>, agentCtx: AgentContext): McpTool[] {
  return [
    memoryWriteTool(client, agentCtx),
    memorySearchTool(client, agentCtx),
    memorySupersedeT(client, agentCtx),
    decisionLogTool(client, agentCtx),
    taskUpsertTool(client, agentCtx),
    taskStatusTool(client, agentCtx),
    taskListTool(client, agentCtx),
    taskCompleteTool(client, agentCtx),
    taskBlockTool(client, agentCtx),
    projectStatusTool(client, agentCtx),
    projectSummaryTool(client, agentCtx),
    personGetTool(client, agentCtx),
    commitmentLogTool(client, agentCtx),
    commitmentListTool(client, agentCtx),
    statusGetTool(client, agentCtx),
    // Phase 6
    memoryReflectTool(client, agentCtx),
    memoryConsolidateTool(client, agentCtx),
    graphNeighborhoodTool(client, agentCtx),
  ];
}

export const TOOL_COUNT = 18;

function errorResult(error: string, message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error, message }) }],
    isError: true as const,
  };
}

export function createMcpServer(ctx?: AgentContext) {
  const agentCtx = ctx ?? resolveAgentFromEnv();
  const client = createOmniMindClient();
  // Bind agent identity to the client so every outbound HTTP request carries
  // x-agent-id, x-tenant-id, x-source-weight. The server-side middleware
  // reads these to populate req.agentContext.
  client.setAgentHeaders({
    agentId: agentCtx.agentId,
    tenantId: agentCtx.tenantId,
    sourceWeight: agentCtx.sourceWeight,
  });

  const server = new McpServer({
    name: 'omnimind-mcp',
    version: '0.2.0',
  });

  const tools = buildTools(client, agentCtx);

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        // Zod object schemas are accepted directly (AnySchema); the SDK converts
        // them to JSON Schema for tools/list and validates args / structuredContent.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputSchema: tool.inputSchema as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        outputSchema: tool.outputSchema as any,
        annotations: tool.annotations,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (args: any) => {
        try {
          const result = await tool.execute(args);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
            structuredContent: result as Record<string, unknown>,
          };
        } catch (err) {
          if (err instanceof ScopeDeniedError) return errorResult('SCOPE_DENIED', (err as Error).message);
          if (err instanceof McpValidationError) return errorResult('VALIDATION_ERROR', (err as Error).message);
          throw err;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any
    );
  }

  registerResources(server, client, agentCtx);
  registerPrompts(server, agentCtx);

  return { server, agentCtx, tools };
}
