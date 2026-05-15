import { validateEnv } from '@boardroom/shared';

export function validateOmniMindEnv(): void {
  validateEnv([
    { name: 'DATABASE_URL', required: true, description: 'PostgreSQL connection string' },
    { name: 'OMNIMIND_API_KEY', required: true, description: 'API key for service-to-service auth' },
    { name: 'ANTHROPIC_API_KEY', required: true, description: 'Anthropic API key for Claude' },
    { name: 'OPENAI_API_KEY', required: true, description: 'OpenAI API key for embeddings' },
    // Phase 0.25.5 — ENCRYPTION_KEY is required in ALL non-test environments
    // unless ALLOW_PLAINTEXT_DEV=true is set explicitly. The fail-closed check
    // lives in src/lib/crypto.ts (process.exit(1) at module load if violated);
    // this declaration documents the intent at the env-validation layer.
    { name: 'ENCRYPTION_KEY', required: process.env.NODE_ENV !== 'test' && process.env.ALLOW_PLAINTEXT_DEV !== 'true', description: 'AES-256 key (64 hex chars) for OAuth token encryption. Set ALLOW_PLAINTEXT_DEV=true for local dev only.' },
  ]);
}
