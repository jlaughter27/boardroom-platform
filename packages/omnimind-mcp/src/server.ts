import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createOmniMindClient } from './lib/client';
import { resolveAgentFromEnv } from './lib/auth';
import { memoryWriteTool, memorySearchTool, memorySupersedeT } from './tools/memory.tool';
import { decisionLogTool } from './tools/decision.tool';
import { taskUpsertTool, taskStatusTool, taskListTool, taskCompleteTool, taskBlockTool } from './tools/task.tool';
import { projectStatusTool, projectSummaryTool } from './tools/project.tool';
import { personGetTool } from './tools/person.tool';
import { commitmentLogTool, commitmentListTool } from './tools/commitment.tool';
import { statusGetTool } from './tools/status.tool';
import { ScopeDeniedError, McpValidationError } from './types';
import type { AgentContext, McpTool } from './types';

export function createMcpServer(ctx?: AgentContext) {
  const agentCtx = ctx ?? resolveAgentFromEnv();
  const client = createOmniMindClient();

  const server = new McpServer({
    name: 'omnimind-mcp',
    version: '0.1.0',
  });

  const tools: McpTool[] = [
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
  ];

  for (const tool of tools) {
    server.tool(
      tool.name,
      tool.description,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tool.inputSchema.shape as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (args: any) => {
        try {
          const result = await tool.execute(args);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          if (err instanceof ScopeDeniedError) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'SCOPE_DENIED', message: (err as Error).message }) }],
              isError: true,
            };
          }
          if (err instanceof McpValidationError) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'VALIDATION_ERROR', message: (err as Error).message }) }],
              isError: true,
            };
          }
          throw err;
        }
      }
    );
  }

  return { server, agentCtx };
}
