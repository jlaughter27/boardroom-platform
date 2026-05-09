import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from '../server';

export async function startStdioServer(): Promise<void> {
  const { server, agentCtx } = createMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  console.error(`[omnimind-mcp] stdio transport started`);
  console.error(`[omnimind-mcp] agent=${agentCtx.agentName} tenant=${agentCtx.tenantId} scopes=${agentCtx.scopes.join(',')}`);
}
