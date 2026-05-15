import { validateEnv } from '@boardroom/shared';

export function validateBoardRoomEnv(): void {
  const isProd = process.env.NODE_ENV === 'production';
  validateEnv([
    { name: 'JWT_SECRET', required: true, description: 'Secret for JWT signing' },
    { name: 'OMNIMIND_API_KEY', required: true, description: 'API key for OmniMind service' },
    { name: 'OMNIMIND_API_URL', required: true, description: 'URL of OmniMind API service' },
    { name: 'ANTHROPIC_API_KEY', required: true, description: 'Anthropic API key for Claude' },
  ]);

  // SUB-02: If Stripe is enabled in production, the webhook secret must be
  // present — otherwise webhooks silently fail and subscription state drifts.
  if (isProd && process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('FATAL: STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is missing in production.');
    process.exit(1);
  }
}
