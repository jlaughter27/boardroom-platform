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

export const SOURCE_WEIGHT_MIN = 0;
export const SOURCE_WEIGHT_MAX = 2;

/**
 * F-217 — A source weight must be a finite number in [0, 2] (the API clamps
 * to the same range). Returns the number or throws with a clear message;
 * never silently coerces.
 */
export function assertSourceWeight(raw: unknown, label = 'sourceWeight'): number {
  const n = typeof raw === 'string' ? Number(raw.trim()) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < SOURCE_WEIGHT_MIN || n > SOURCE_WEIGHT_MAX) {
    throw new Error(
      `${label} must be a finite number between ${SOURCE_WEIGHT_MIN} and ${SOURCE_WEIGHT_MAX} (got ${JSON.stringify(raw)})`
    );
  }
  return n;
}

export function resolveAgentFromEnv(env: NodeJS.ProcessEnv = process.env): AgentContext {
  const agentName = env.OMNIMIND_MCP_AGENT_NAME;
  const tenantId = env.OMNIMIND_MCP_TENANT_ID;
  const scopesRaw = env.OMNIMIND_MCP_SCOPES ?? 'memory:read';
  const sourceWeightRaw = env.OMNIMIND_MCP_SOURCE_WEIGHT;

  if (!agentName) {
    console.error('OMNIMIND_MCP_AGENT_NAME is required');
    process.exit(1);
  }
  if (!tenantId) {
    console.error('OMNIMIND_MCP_TENANT_ID is required');
    process.exit(1);
  }

  let sourceWeight = 1.0;
  if (sourceWeightRaw !== undefined && sourceWeightRaw !== '') {
    try {
      sourceWeight = assertSourceWeight(sourceWeightRaw, 'OMNIMIND_MCP_SOURCE_WEIGHT');
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  }

  const scopes = scopesRaw.split(',').map(s => s.trim()).filter(Boolean);
  const defaultUserId = env.OMNIMIND_MCP_USER_ID?.trim() || undefined;

  return {
    agentId: agentName,
    agentName,
    tenantId,
    scopes,
    sourceWeight,
    ...(defaultUserId ? { defaultUserId } : {}),
  };
}
