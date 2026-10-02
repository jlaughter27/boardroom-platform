import { validateEnv } from '@boardroom/shared';
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
  if (requireAgentKey !== undefined && !['true', 'false'].includes(requireAgentKey.toLowerCase())) {
    logger.warn('OMNIMIND_REQUIRE_AGENT_KEY should be "true" or "false"; treating as false', { value: requireAgentKey });
  }
}
