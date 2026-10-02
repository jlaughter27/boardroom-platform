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
  // Phase 6
  'memory_reflect', 'memory_consolidate', 'graph_neighborhood',
] as const;

export const REQUIRED_PROMPTS = ['session_start', 'decision_review', 'session_end'] as const;
export const REQUIRED_RESOURCE_TEMPLATES = [
  'omnimind://{tenant}/status',
  'omnimind://{tenant}/goal/{id}',
  'omnimind://{tenant}/person/{id}',
  'omnimind://{tenant}/graph/{nodeId}',
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
 *   Tier 1 (always): spawn the stdio server, list tools / prompts / resource
 *   templates, assert all 18 tools (each with annotations + outputSchema),
 *   3 prompts and 4 resource templates are present.
 *   Tier 2 (M-108, opt-in): when `OMNIMIND_MCP_SMOKE_USER_ID` is set, actually
 *   execute `status_get`, `memory_search` and — using the first memory the
 *   search returns (or `OMNIMIND_MCP_SMOKE_NODE_ID`) — `graph_neighborhood`
 *   against the configured OmniMind API and fail on a tool-level error
 *   (SCOPE_DENIED / VALIDATION_ERROR / HTTP failure). Read-only — nothing is written.
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

  const client = new Client({ name: 'smoke-client', version: '0.2.0' });
  // Pass full env so the spawned server inherits all OMNIMIND_MCP_* vars
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [__filename.replace(/smoke\.(js|ts)$/, 'index.$1')],
    env: { ...process.env } as Record<string, string>,
  });

  try {
    await client.connect(transport);
    console.log('[smoke] ✅ Connected to MCP server');

    // Tier 1 — tool inventory (+ Phase 6 spec conformance: annotations, outputSchema)
    const tools = await client.listTools();
    const toolNames = tools.tools.map(t => t.name);
    console.log(`[smoke] ✅ Tools available (${toolNames.length}): ${toolNames.join(', ')}`);

    const missing = REQUIRED_TOOLS.filter(t => !toolNames.includes(t));
    if (missing.length > 0) throw new Error(`Missing tools: ${missing.join(', ')}`);
    const unannotated = tools.tools.filter(t => !t.annotations || !t.outputSchema).map(t => t.name);
    if (unannotated.length > 0) throw new Error(`Tools without annotations/outputSchema: ${unannotated.join(', ')}`);
    console.log(`[smoke] ✅ All ${REQUIRED_TOOLS.length} required tools present, each with annotations + outputSchema`);

    const prompts = await client.listPrompts();
    const promptNames = prompts.prompts.map(p => p.name);
    const missingPrompts = REQUIRED_PROMPTS.filter(p => !promptNames.includes(p));
    if (missingPrompts.length > 0) throw new Error(`Missing prompts: ${missingPrompts.join(', ')}`);
    console.log(`[smoke] ✅ Prompts (${promptNames.length}): ${promptNames.join(', ')}`);

    const templates = await client.listResourceTemplates();
    const templateUris = templates.resourceTemplates.map(t => t.uriTemplate);
    const missingTemplates = REQUIRED_RESOURCE_TEMPLATES.filter(t => !templateUris.includes(t));
    if (missingTemplates.length > 0) throw new Error(`Missing resource templates: ${missingTemplates.join(', ')}`);
    console.log(`[smoke] ✅ Resource templates (${templateUris.length}): ${templateUris.join(', ')}`);

    // Tier 2 — live read-only tool execution (opt-in)
    const userId = process.env.OMNIMIND_MCP_SMOKE_USER_ID;
    let executed = 0;
    if (!userId) {
      console.log('[smoke] ℹ️  Set OMNIMIND_MCP_SMOKE_USER_ID=<user id> to also execute status_get + memory_search + graph_neighborhood against the API.');
    } else {
      const status = await client.callTool({ name: 'status_get', arguments: { userId } });
      if (status.isError) throw new Error(`status_get failed: ${textOf(status)}`);
      const statusJson = (status.structuredContent ?? JSON.parse(textOf(status))) as { counts?: Record<string, number>; commitmentsDueSoon?: { dueSoon: unknown[]; overdue: unknown[]; error?: string } };
      console.log(`[smoke] ✅ status_get OK — counts=${JSON.stringify(statusJson.counts ?? {})} dueSoon=${statusJson.commitmentsDueSoon?.dueSoon.length ?? 0} overdue=${statusJson.commitmentsDueSoon?.overdue.length ?? 0}${statusJson.commitmentsDueSoon?.error ? ` (nudges unavailable: ${statusJson.commitmentsDueSoon.error})` : ''}`);
      executed++;

      const query = process.env.OMNIMIND_MCP_SMOKE_QUERY ?? 'smoke';
      const search = await client.callTool({ name: 'memory_search', arguments: { userId, query, limit: 3 } });
      if (search.isError) throw new Error(`memory_search failed: ${textOf(search)}`);
      const searchJson = (search.structuredContent ?? JSON.parse(textOf(search))) as { count?: number; nextCursor?: string | null; memories?: Array<{ id: string }> };
      console.log(`[smoke] ✅ memory_search OK — query="${query}" count=${searchJson.count ?? 0} nextCursor=${searchJson.nextCursor ?? 'null'}`);
      executed++;

      const nodeId = process.env.OMNIMIND_MCP_SMOKE_NODE_ID ?? (searchJson.memories?.[0] ? `memory:${searchJson.memories[0].id}` : undefined);
      if (!nodeId) {
        console.log('[smoke] ℹ️  No memory returned and OMNIMIND_MCP_SMOKE_NODE_ID unset — skipping graph_neighborhood.');
      } else {
        const graph = await client.callTool({ name: 'graph_neighborhood', arguments: { userId, nodeId, hops: 1 } });
        if (graph.isError) throw new Error(`graph_neighborhood failed: ${textOf(graph)}`);
        const graphJson = (graph.structuredContent ?? JSON.parse(textOf(graph))) as { nodes?: unknown[]; edges?: unknown[]; truncated?: boolean };
        console.log(`[smoke] ✅ graph_neighborhood OK — node=${nodeId} nodes=${graphJson.nodes?.length ?? 0} edges=${graphJson.edges?.length ?? 0}`);
        executed++;
      }
    }

    console.log(`[smoke] smoke OK — ${toolNames.length} tools, ${promptNames.length} prompts, ${templateUris.length} resource templates registered${executed ? `, ${executed} tools executed` : ''}`);
  } finally {
    await transport.close().catch(() => {});
  }
}
