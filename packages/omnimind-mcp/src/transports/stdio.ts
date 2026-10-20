import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from '../server';
import { resolveAgentKey } from '../lib/client';

export async function startStdioServer(): Promise<void> {
  const { server, agentCtx } = createMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // M-5 — say which key verifies this single-agent process (never the key itself).
  const agentKey = resolveAgentKey('single-agent');
  console.error(`[omnimind-mcp] stdio transport started`);
  console.error(`[omnimind-mcp] agent=${agentCtx.agentName} tenant=${agentCtx.tenantId} scopes=${agentCtx.scopes.join(',')}`);
  console.error(`[omnimind-mcp] x-agent-key: ${agentKey.source === 'none' ? 'none (unverified x-agent-id / x-tenant-id / x-source-weight headers)' : `from ${agentKey.source}`}`);
}
