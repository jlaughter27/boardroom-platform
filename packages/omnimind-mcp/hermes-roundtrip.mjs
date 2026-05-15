// Hermes end-to-end round-trip test against production OmniMind-MCP
// Run from /Users/Joshua/boardroom-platform/packages/omnimind-mcp
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_INDEX = join(__dirname, 'dist', 'index.js');

async function run() {
  console.log('═══ HERMES ROUND-TRIP TEST ═══\n');

  const client = new Client({ name: 'hermes-roundtrip', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_INDEX],
    env: { ...process.env },
  });

  await client.connect(transport);
  console.log('✓ Connected to MCP server');

  const USER_ID = 'cmnrmblck0000o201oeam2w99'; // Josh's prod user ID
  const writeMarker = `hermes-smoke-${Date.now()}`;
  console.log(`\n--- 1. memory_write (marker: ${writeMarker}) ---`);
  const writeResult = await client.callTool({
    name: 'memory_write',
    arguments: {
      userId: USER_ID,
      content: `Hermes end-to-end smoke test. Marker: ${writeMarker}. Proves seam works: agent context, outbox, scope enforcement, Postgres write, audit log.`,
      domain: 'business',
      tags: ['hermes', 'smoke-test', writeMarker],
      importance: 0.6,
      skipExtraction: true, // ANTHROPIC_API_KEY on prod is revoked; skip fact extraction to verify rest of seam
    },
  });
  console.log(JSON.stringify(writeResult, null, 2).slice(0, 1500));

  console.log('\n--- 2. wait 3s for embedding ---');
  await new Promise(r => setTimeout(r, 3000));

  console.log(`\n--- 3. memory_search ---`);
  const searchResult = await client.callTool({
    name: 'memory_search',
    arguments: { userId: USER_ID, query: writeMarker, limit: 5 },
  });
  console.log(JSON.stringify(searchResult, null, 2).slice(0, 2000));

  await transport.close();
  console.log(`\n═══ ROUND-TRIP COMPLETE — marker: ${writeMarker} ═══`);
  console.log(`User: ${USER_ID} (test@boardroom.ai)`);
}

run().catch(e => {
  console.error('FAILED:', e);
  process.exit(1);
});
