import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../lib/logger';

/**
 * The sentence a persona card shows when its call fails. Provider failures
 * (Anthropic API errors, network) used to reach the card verbatim — e.g.
 * `401 {"type":"error","error":{"type":"authentication_error",…}}` — found by
 * the 2026-10-23 real-data e2e. They now read as one plain sentence; the raw
 * error is logged server-side. Our own errors (schema validation, truncation,
 * context fetch) already read as sentences and pass through unchanged.
 */
export function personaErrorMessage(error: unknown, personaId?: string): string {
  if (error instanceof Anthropic.APIError) {
    logger.warn('persona call failed at the AI provider', { personaId, status: error.status, error: error.message.slice(0, 500) });
    if (error instanceof Anthropic.APIUserAbortError) return 'Cancelled.';
    if (error instanceof Anthropic.APIConnectionTimeoutError) return 'The AI provider timed out. Retry in a moment.';
    if (error instanceof Anthropic.APIConnectionError) return 'Couldn’t reach the AI provider. Retry in a moment.';
    if (error instanceof Anthropic.AuthenticationError) return 'The AI provider rejected this server’s API key. An admin needs to update it.';
    if (error instanceof Anthropic.PermissionDeniedError) return 'The AI provider refused this request for this account.';
    if (error instanceof Anthropic.RateLimitError) return 'The AI provider is rate-limiting requests. Retry in a minute.';
    if (error instanceof Anthropic.BadRequestError) return 'The AI provider rejected the request. Retry; if it repeats, the server log has the detail.';
    if (error.status === 529 || error instanceof Anthropic.InternalServerError) return 'The AI provider is overloaded or unavailable. Retry shortly.';
    return `The AI provider returned an error${error.status ? ` (${error.status})` : ''}. Retry shortly.`;
  }
  return error instanceof Error ? error.message : 'Unknown error';
}
