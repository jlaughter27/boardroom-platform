import { validateEnv } from '@boardroom/shared/node';
import { validateEncryptionKey } from './crypto';
import { logger } from './logger';

export function validateOmniMindEnv(): void {
  validateEnv([
    { name: 'DATABASE_URL', required: true, description: 'PostgreSQL connection string' },
    { name: 'OMNIMIND_API_KEY', required: true, description: 'API key for service-to-service auth' },
    { name: 'ANTHROPIC_API_KEY', required: true, description: 'Anthropic API key for Claude' },
    { name: 'OPENAI_API_KEY', required: true, description: 'OpenAI API key for embeddings' },
    { name: 'ENCRYPTION_KEY', required: process.env.NODE_ENV === 'production', description: 'AES-256 key (64 hex chars) for OAuth tokens + ministry content' },
  ]);

  // F-108: enforce exact key length (32 bytes / 64 hex) — a malformed key is
  // a startup error in every environment; a missing key is fatal in production.
  validateEncryptionKey();

  if (process.env.NODE_ENV === 'production') {
    if (!process.env.OMNIMIND_ADMIN_KEY) {
      // F-104: admin routes answer 503 until this is configured.
      logger.warn('OMNIMIND_ADMIN_KEY is not set — /admin/* and POST /mcp/agents are disabled (503) in production');
    }
  }

  const requireAgentKey = process.env.OMNIMIND_REQUIRE_AGENT_KEY;
  if (requireAgentKey !== undefined && !['true', 'false'].includes(requireAgentKey.trim().toLowerCase())) {
    logger.warn('OMNIMIND_REQUIRE_AGENT_KEY should be "true" or "false"; treating as false', { value: requireAgentKey });
  }

  const posture = agentKeyPostureWarning(process.env);
  if (posture) logger.warn(posture, { OMNIMIND_REQUIRE_AGENT_KEY: requireAgentKey ?? '(unset)' });
}

/**
 * Lane G item 5 — the production posture warning for unverified agent headers.
 * Same parse as agent-context's requireAgentKey(): only "true" (trimmed, any
 * case) turns the legacy x-agent-id / x-tenant-id / x-source-weight fast-path
 * off. The default stays "false" (solo mode depends on it); this makes the
 * choice visible on every production boot instead of silently open.
 */
export function agentKeyPostureWarning(env: Record<string, string | undefined>): string | null {
  if (env.NODE_ENV !== 'production') return null;
  if ((env.OMNIMIND_REQUIRE_AGENT_KEY ?? '').trim().toLowerCase() === 'true') return null;
  return 'SECURITY: OMNIMIND_REQUIRE_AGENT_KEY is not "true" in production — unverified agent identity headers '
    + '(x-agent-id + x-tenant-id + x-source-weight, no x-agent-key) are trusted as-is, so any holder of the service key '
    + 'can claim any agent / tenant / source weight and skip scope enforcement. Set OMNIMIND_REQUIRE_AGENT_KEY=true once the '
    + 'hosted MCP gateway is the only MCP writer (docs/runbooks/omnimind-mcp.md §1, Known Limitation 8).';
}
