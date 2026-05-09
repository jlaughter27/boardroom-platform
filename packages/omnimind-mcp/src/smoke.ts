import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

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

  const client = new Client({ name: 'smoke-client', version: '0.1.0' });
  // Pass full env so the spawned server inherits all OMNIMIND_MCP_* vars
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [__filename.replace('smoke.js', 'index.js')],
    env: { ...process.env } as Record<string, string>,
  });

  try {
    await client.connect(transport);
    console.log('[smoke] ✅ Connected to MCP server');

    // List tools
    const tools = await client.listTools();
    const toolNames = tools.tools.map(t => t.name);
    console.log(`[smoke] ✅ Tools available (${toolNames.length}): ${toolNames.join(', ')}`);

    const requiredTools = [
      'memory_write', 'memory_search', 'memory_supersede',
      'decision_log',
      'task_upsert', 'task_status', 'task_list', 'task_complete', 'task_block',
      'project_status', 'project_summary',
      'person_get',
      'commitment_log', 'commitment_list',
      'status_get',
    ];
    const missing = requiredTools.filter(t => !toolNames.includes(t));
    if (missing.length > 0) throw new Error(`Missing tools: ${missing.join(', ')}`);

    console.log('[smoke] ✅ All 15 required tools present');
    console.log(`[smoke] smoke OK — ${toolNames.length} tools registered`);
  } finally {
    await transport.close().catch(() => {});
  }
}
