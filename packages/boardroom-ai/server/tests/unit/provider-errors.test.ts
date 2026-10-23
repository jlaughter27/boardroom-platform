import { describe, it, expect, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';

vi.mock('../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { personaErrorMessage } from '../../src/agents/provider-errors';

const apiError = (status: number) =>
  Anthropic.APIError.generate(status, { type: 'error', error: { type: 'x', message: 'raw provider detail' } }, 'raw', new Headers());

describe('personaErrorMessage (2026-10-23 real-data e2e: raw provider JSON reached the persona card)', () => {
  it('never shows provider JSON: 401 / 403 / 429 / 400 / 500 / 529 read as plain sentences', () => {
    const cases: Array<[number, RegExp]> = [
      [401, /rejected this server’s API key/],
      [403, /refused this request/],
      [429, /rate-limiting/],
      [400, /rejected the request/],
      [500, /overloaded or unavailable/],
      [529, /overloaded or unavailable/],
    ];
    for (const [status, re] of cases) {
      const msg = personaErrorMessage(apiError(status), 'critic');
      expect(msg).toMatch(re);
      expect(msg).not.toMatch(/[{}]|raw provider detail/);
    }
  });

  it('connection failures and timeouts read as retryable', () => {
    expect(personaErrorMessage(new Anthropic.APIConnectionError({ message: 'socket hang up' }))).toMatch(/Couldn’t reach/);
    expect(personaErrorMessage(new Anthropic.APIConnectionTimeoutError())).toMatch(/timed out/);
  });

  it('our own errors pass through unchanged', () => {
    expect(personaErrorMessage(new Error('Persona response failed validation: analysis is required'))).toBe('Persona response failed validation: analysis is required');
    expect(personaErrorMessage('weird')).toBe('Unknown error');
  });
});
