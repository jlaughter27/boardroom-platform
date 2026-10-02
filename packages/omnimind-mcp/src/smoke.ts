import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export const REQUIRED_TOOLS = [
  'memory_write', 'memory_search', 'memory_supersede',
  'decision_log',
  'task_upsert', 'task_status', 'task_list', 'task_complete', 'task_block',
  'project_status', 'project_summary',
  'person_get',
  'commitment_log', 'commitment_list',
  'status_get',
] as const;

function textOf(result: unknown): string {
  const raw = result && typeof result === 'object' ? (result as { content?: unknown }).content : undefined;
  const content = Array.isArray(raw) ? raw : [];
  return content
    .map(c => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : ''))
    .join('');
}

/**
 * Smoke test.
 *
 *   Tier 1 (always): spawn the stdio server, list tools, assert all 15 present.
 *   Tier 2 (M-108, opt-in): when `OMNIMIND_MCP_SMOKE_USER_ID` is set, actually
 *   execute `status_get` and `memory_search` against the configured OmniMind
 *   API and fail on a tool-level error (SCOPE_DENIED / VALIDATION_ERROR /
 *   HTTP failure). Read-only — nothing is written.
 */
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
    args: [__filename.replace(/smoke\.(js|ts)$/, 'index.$1')],
    env: { ...process.env } as Record<string, string>,
  });

  try {
    await client.connect(transport);
    console.log('[smoke] ✅ Connected to MCP server');

    // Tier 1 — tool inventory
    const tools = await client.listTools();
    const toolNames = tools.tools.map(t => t.name);
    console.log(`[smoke] ✅ Tools available (${toolNames.length}): ${toolNames.join(', ')}`);

    const missing = REQUIRED_TOOLS.filter(t => !toolNames.includes(t));
    if (missing.length > 0) throw new Error(`Missing tools: ${missing.join(', ')}`);
    console.log('[smoke] ✅ All 15 required tools present');

    // Tier 2 — live read-only tool execution (opt-in)
    const userId = process.env.OMNIMIND_MCP_SMOKE_USER_ID;
    if (!userId) {
      console.log('[smoke] ℹ️  Set OMNIMIND_MCP_SMOKE_USER_ID=<user id> to also execute status_get + memory_search against the API.');
    } else {
      const status = await client.callTool({ name: 'status_get', arguments: { userId } });
      if (status.isError) throw new Error(`status_get failed: ${textOf(status)}`);
      const statusJson = JSON.parse(textOf(status)) as { counts?: Record<string, number> };
      console.log(`[smoke] ✅ status_get OK — counts=${JSON.stringify(statusJson.counts ?? {})}`);

      const query = process.env.OMNIMIND_MCP_SMOKE_QUERY ?? 'smoke';
      const search = await client.callTool({ name: 'memory_search', arguments: { userId, query, limit: 3 } });
      if (search.isError) throw new Error(`memory_search failed: ${textOf(search)}`);
      const searchJson = JSON.parse(textOf(search)) as { count?: number };
      console.log(`[smoke] ✅ memory_search OK — query="${query}" count=${searchJson.count ?? 0}`);
    }

    console.log(`[smoke] smoke OK — ${toolNames.length} tools registered${userId ? ', 2 tools executed' : ''}`);
  } finally {
    await transport.close().catch(() => {});
  }
}
