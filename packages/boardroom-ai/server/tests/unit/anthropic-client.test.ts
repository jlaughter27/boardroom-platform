import { describe, it, expect } from 'vitest';
import { MODEL_IDS } from '@boardroom/shared';
import { sanitizeParamsForModel, createAnthropicClient } from '../../src/lib/anthropic-client';

describe('anthropic-client guard (Haiku rejects output_config.effort)', () => {
  it('drops output_config for Haiku and keeps it for Sonnet', () => {
    const haiku = sanitizeParamsForModel({ model: MODEL_IDS.haiku, max_tokens: 10, output_config: { effort: 'low' } });
    expect('output_config' in haiku).toBe(false);
    const sonnet = sanitizeParamsForModel({ model: MODEL_IDS.sonnet, max_tokens: 10, output_config: { effort: 'medium' } });
    expect(sonnet.output_config).toEqual({ effort: 'medium' });
  });

  it('wraps messages.create and messages.stream', () => {
    const client = createAnthropicClient('test-key');
    expect(typeof client.messages.create).toBe('function');
    expect(typeof client.messages.stream).toBe('function');
  });
});
