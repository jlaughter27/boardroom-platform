import { randomBytes } from 'crypto';
import { hashApiKey, assertSourceWeight } from './lib/auth';
import { createOmniMindClient } from './lib/client';

function parseArgs(): {
  agent: string; tenant: string; scopes: string; sourceWeight: number;
} {
  const args = process.argv.slice(3);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };

  const agent = get('--agent');
  const tenant = get('--tenant');
  const scopes = get('--scopes') ?? 'memory:read';
  const sourceWeightRaw = get('--source-weight') ?? '1.0';

  if (!agent || !tenant) {
    console.error('Usage: omnimind-mcp keygen --agent <name> --tenant <id> --scopes "<list>" [--source-weight <float 0..2>]');
    process.exit(1);
  }

  let sourceWeight: number;
  try {
    sourceWeight = assertSourceWeight(sourceWeightRaw, '--source-weight'); // F-217
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  return { agent, tenant, scopes, sourceWeight };
}

/** SQL-literal escape for the fallback statement (single quotes doubled). */
function sqlLit(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

/**
 * F-208 — Fallback INSERT for when `POST /mcp/agents` is unreachable.
 * Targets the real table (`agents`, see `@@map("agents")` in schema.prisma)
 * and generates a Prisma-compatible text id (cuid is app-side only, so use
 * gen_random_uuid()::text — any unique text works for `String @id`).
 */
export function buildFallbackSql(params: { agent: string; keyHash: string; tenant: string; scopes: string[]; sourceWeight: number }): string {
  const scopeArray = `ARRAY[${params.scopes.map(sqlLit).join(', ')}]::text[]`;
  return [
    `INSERT INTO agents (id, name, api_key_hash, tenant_id, scopes, source_weight, created_at)`,
    `VALUES (gen_random_uuid()::text, ${sqlLit(params.agent)}, ${sqlLit(params.keyHash)}, ${sqlLit(params.tenant)}, ${scopeArray}, ${params.sourceWeight}, NOW())`,
    `ON CONFLICT (name) DO UPDATE SET api_key_hash = EXCLUDED.api_key_hash, tenant_id = EXCLUDED.tenant_id, scopes = EXCLUDED.scopes, source_weight = EXCLUDED.source_weight;`,
  ].join('\n');
}

export async function runKeygen(): Promise<void> {
  const { agent, tenant, scopes, sourceWeight } = parseArgs();
  const client = createOmniMindClient();

  const rawKey = `omk_${randomBytes(32).toString('hex')}`;
  const keyHash = hashApiKey(rawKey);
  const scopeList = scopes.split(',').map(s => s.trim()).filter(Boolean);

  try {
    await client.registerAgent({
      name: agent,
      apiKeyHash: keyHash,
      tenantId: tenant,
      scopes: scopeList,
      sourceWeight,
    });
    console.log(`[keygen] ✅ Agent registered via API (POST /mcp/agents)`);
  } catch (err) {
    console.warn(`\n[keygen] Could not register via API (${(err as Error).message}).`);
    console.warn(`[keygen] Preferred fix: re-run once the API is reachable. Manual fallback (psql, table "agents"):\n`);
    console.log(buildFallbackSql({ agent, keyHash, tenant, scopes: scopeList, sourceWeight }));
    console.log('');
  }

  console.log('\n=== AGENT KEY — COPY NOW, NEVER SHOWN AGAIN ===');
  console.log(`Agent:        ${agent}`);
  console.log(`Tenant:       ${tenant}`);
  console.log(`Scopes:       ${scopeList.join(', ')}`);
  console.log(`SourceWeight: ${sourceWeight}`);
  console.log(`\nAgent key: ${rawKey}`);
  console.log('\nStore in 1Password / macOS Keychain.');
  console.log('Set it as  OMNIMIND_MCP_AGENT_KEY  in this agent\'s MCP config env.');
  console.log('  → the MCP server sends it to OmniMind as the x-agent-key header on every request.');
  console.log('Do NOT put it in OMNIMIND_MCP_API_KEY — that variable is the INBOUND bearer token');
  console.log('  for HTTP-mode clients (e.g. ChatGPT Desktop), unrelated to this key.\n');
}
