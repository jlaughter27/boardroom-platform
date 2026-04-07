import { validateEnv } from '@boardroom/shared';

export function validateBoardRoomEnv(): void {
  validateEnv([
    { name: 'JWT_SECRET', required: true, description: 'Secret for JWT signing' },
    { name: 'OMNIMIND_API_KEY', required: true, description: 'API key for OmniMind service' },
    { name: 'OMNIMIND_API_URL', required: true, description: 'URL of OmniMind API service' },
    { name: 'ANTHROPIC_API_KEY', required: true, description: 'Anthropic API key for Claude' },
  ]);
}
