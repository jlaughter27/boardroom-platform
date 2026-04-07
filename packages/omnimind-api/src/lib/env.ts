import { validateEnv } from '@boardroom/shared';

export function validateOmniMindEnv(): void {
  validateEnv([
    { name: 'DATABASE_URL', required: true, description: 'PostgreSQL connection string' },
    { name: 'OMNIMIND_API_KEY', required: true, description: 'API key for service-to-service auth' },
    { name: 'ANTHROPIC_API_KEY', required: true, description: 'Anthropic API key for Claude' },
    { name: 'OPENAI_API_KEY', required: true, description: 'OpenAI API key for embeddings' },
    { name: 'ENCRYPTION_KEY', required: process.env.NODE_ENV === 'production', description: 'AES-256 key for OAuth token encryption' },
  ]);
}
