import { createMcpServer } from './server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';

export async function runSmoke(): Promise<void> {
  console.log('[smoke] Starting OmniMind-MCP smoke test...');

  // Check env vars
  const required = ['OMNIMIND_API_URL', 'OMNIMIND_API_KEY', 'OMNIMIND_MCP_AGENT_NAME', 'OMNIMIND_MCP_TENANT_ID'];
  for (const v of required) {
    if (!process.env[v]) {
      console.error(`[smoke] Missing required env var: ${v}`);
      process.exit(1);
    }
  }

  // Spawn MCP server as child process
  const child = spawn(process.execPath, [__filename.replace('smoke', 'index')], {
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  const client = new Client({ name: 'smoke-client', version: '0.1.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [__filename.replace('smoke', 'index')] });

  try {
    await client.connect(transport);
    console.log('[smoke] ✅ Connected to MCP server');

    // List tools
    const tools = await client.listTools();
    const toolNames = tools.tools.map(t => t.name);
    console.log(`[smoke] ✅ Tools available (${toolNames.length}): ${toolNames.join(', ')}`);

    const requiredTools = ['memory_write', 'memory_search', 'status_get'];
    for (const t of requiredTools) {
      if (!toolNames.includes(t)) {
        throw new Error(`Missing required tool: ${t}`);
      }
    }

    console.log('[smoke] ✅ All required tools present');
    console.log('[smoke] Smoke test PASSED ✅');
  } finally {
    await transport.close().catch(() => {});
    child.kill();
  }
}
