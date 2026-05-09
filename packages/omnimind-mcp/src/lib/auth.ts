import { timingSafeEqual, createHash } from 'crypto';
import type { AgentContext } from '../types';

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function verifyApiKey(provided: string, storedHash: string): boolean {
  const providedHash = hashApiKey(provided);
  const a = Buffer.from(providedHash, 'utf8');
  const b = Buffer.from(storedHash, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function resolveAgentFromEnv(): AgentContext {
  const agentName = process.env.OMNIMIND_MCP_AGENT_NAME;
  const tenantId = process.env.OMNIMIND_MCP_TENANT_ID;
  const scopesRaw = process.env.OMNIMIND_MCP_SCOPES ?? 'memory:read';
  const sourceWeight = parseFloat(process.env.OMNIMIND_MCP_SOURCE_WEIGHT ?? '1.0');

  if (!agentName) {
    console.error('OMNIMIND_MCP_AGENT_NAME is required');
    process.exit(1);
  }
  if (!tenantId) {
    console.error('OMNIMIND_MCP_TENANT_ID is required');
    process.exit(1);
  }

  const scopes = scopesRaw.split(',').map(s => s.trim()).filter(Boolean);

  return {
    agentId: agentName,
    agentName,
    tenantId,
    scopes,
    sourceWeight: isNaN(sourceWeight) ? 1.0 : sourceWeight,
  };
}
