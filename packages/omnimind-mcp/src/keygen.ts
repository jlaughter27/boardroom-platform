import { randomBytes } from 'crypto';
import { hashApiKey } from './lib/auth';
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
  const sourceWeight = parseFloat(get('--source-weight') ?? '1.0');

  if (!agent || !tenant) {
    console.error('Usage: omnimind-mcp keygen --agent <name> --tenant <id> --scopes "<list>" [--source-weight <float>]');
    process.exit(1);
  }

  return { agent, tenant, scopes, sourceWeight };
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
    console.log(`[keygen] ✅ Agent registered via API`);
  } catch (err) {
    console.warn(`\n[keygen] Could not register via API (${(err as Error).message}). Use the SQL below to insert manually:\n`);
    console.log(`INSERT INTO "Agent" (id, name, api_key_hash, tenant_id, scopes, source_weight, created_at)`);
    console.log(`VALUES (gen_random_uuid(), '${agent}', '${keyHash}', '${tenant}', ARRAY[${scopeList.map(s => `'${s}'`).join(', ')}], ${sourceWeight}, NOW())\n`);
    console.log(`ON CONFLICT (name) DO UPDATE SET api_key_hash = EXCLUDED.api_key_hash, scopes = EXCLUDED.scopes, source_weight = EXCLUDED.source_weight;`);
  }

  console.log('\n=== API KEY — COPY NOW, NEVER SHOWN AGAIN ===');
  console.log(`Agent:        ${agent}`);
  console.log(`Tenant:       ${tenant}`);
  console.log(`Scopes:       ${scopeList.join(', ')}`);
  console.log(`SourceWeight: ${sourceWeight}`);
  console.log(`\nAPI Key: ${rawKey}`);
  console.log('\nStore in 1Password / macOS Keychain. Set as OMNIMIND_MCP_API_KEY env var.\n');
}
