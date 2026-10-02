// Hermes end-to-end round-trip test against a live OmniMind-MCP.
// Run from packages/omnimind-mcp after `pnpm build`.
//
// Required env (same as the MCP server itself): OMNIMIND_API_URL, OMNIMIND_API_KEY,
// OMNIMIND_MCP_AGENT_NAME, OMNIMIND_MCP_TENANT_ID, OMNIMIND_MCP_SCOPES (needs memory:write).
// Required: HERMES_USER_ID — the OmniMind user id to write under (M-108: no hardcoded prod id).
// Optional: HERMES_SKIP_EXTRACTION=false to exercise the Haiku fact extractor (needs ANTHROPIC_API_KEY).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_INDEX = join(__dirname, 'dist', 'index.js');

async function run() {
  console.log('═══ HERMES ROUND-TRIP TEST ═══\n');

  const USER_ID = process.env.HERMES_USER_ID;
  if (!USER_ID) {
    console.error('HERMES_USER_ID is required (the OmniMind user id to write the smoke memory under).');
    process.exit(1);
  }
  const skipExtraction = (process.env.HERMES_SKIP_EXTRACTION ?? 'true') !== 'false';

  const client = new Client({ name: 'hermes-roundtrip', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_INDEX],
    env: { ...process.env },
  });

  await client.connect(transport);
  console.log('✓ Connected to MCP server');

  const writeMarker = `hermes-smoke-${Date.now()}`;
  console.log(`\n--- 1. memory_write (marker: ${writeMarker}, skipExtraction=${skipExtraction}) ---`);
  const writeResult = await client.callTool({
    name: 'memory_write',
    arguments: {
      userId: USER_ID,
      content: `Hermes end-to-end smoke test. Marker: ${writeMarker}. Proves seam works: agent context, outbox, scope enforcement, Postgres write, audit log.`,
      domain: 'business',
      tags: ['hermes', 'smoke-test', writeMarker],
      importance: 0.6,
      skipExtraction,
    },
  });
  console.log(JSON.stringify(writeResult, null, 2).slice(0, 1500));

  console.log('\n--- 2. wait 3s for embedding ---');
  await new Promise(r => setTimeout(r, 3000));

  console.log(`\n--- 3. memory_search (by marker tag) ---`);
  const searchResult = await client.callTool({
    name: 'memory_search',
    arguments: { userId: USER_ID, query: writeMarker, tags: [writeMarker], limit: 5 },
  });
  console.log(JSON.stringify(searchResult, null, 2).slice(0, 2000));

  await transport.close();
  console.log(`\n═══ ROUND-TRIP COMPLETE — marker: ${writeMarker} ═══`);
  console.log(`User: ${USER_ID}`);
}

run().catch(e => {
  console.error('FAILED:', e);
  process.exit(1);
});
