/**
 * Haiku 4.5 returns 400 on `output_config.effort`; createAnthropicClient()
 * strips it centrally for the Haiku tier on BOTH `messages.create` and
 * `messages.stream`.
 *
 * R-B-07a: the previous version of this file only checked that the two
 * methods were functions. The SDK's `stream()` runs
 * `MessageStream.createMessage(this, params)`, which calls
 * `messages.create({ ...params, stream: true }).withResponse()` on the SAME
 * instance — so spying on the SDK's underlying `create` lets us prove the
 * guard actually runs on the streaming path too.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { MODEL_IDS } from '@boardroom/shared';
import { sanitizeParamsForModel, createAnthropicClient } from '../../src/lib/anthropic-client';

/** Minimal, well-formed Messages stream so MessageStream can finish normally. */
function fakeStream() {
  const events = [
    { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'test', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{}' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ];
  return {
    controller: new AbortController(),
    async *[Symbol.asyncIterator]() { for (const e of events) yield e; },
  };
}

const nonStreamMessage = {
  id: 'msg_test', type: 'message', role: 'assistant', model: 'test',
  content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn', stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
};

let createSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Replace the SDK's underlying create on the prototype BEFORE the wrapper
  // binds it, so both the direct `.create` path and the `.stream` → `.create`
  // path end here.
  createSpy = vi.spyOn(Anthropic.Messages.prototype, 'create').mockImplementation(((params: { stream?: boolean }) => {
    const payload = params.stream ? fakeStream() : nonStreamMessage;
    const result = Promise.resolve(payload) as Promise<unknown> & { withResponse: () => Promise<unknown> };
    result.withResponse = async () => ({ response: new Response(null), data: payload });
    return result;
  }) as never);
});

afterEach(() => { createSpy.mockRestore(); });

const baseParams = (model: string) => ({
  model,
  max_tokens: 10,
  messages: [{ role: 'user' as const, content: 'hi' }],
  output_config: { effort: 'low' as const },
});

describe('sanitizeParamsForModel', () => {
  it('drops output_config for Haiku and keeps it for Sonnet', () => {
    const haiku = sanitizeParamsForModel({ model: MODEL_IDS.haiku, max_tokens: 10, output_config: { effort: 'low' } });
    expect('output_config' in haiku).toBe(false);
    const sonnet = sanitizeParamsForModel({ model: MODEL_IDS.sonnet, max_tokens: 10, output_config: { effort: 'medium' } });
    expect(sonnet.output_config).toEqual({ effort: 'medium' });
  });
});

describe('createAnthropicClient guard — via messages.create', () => {
  it('Haiku: output_config never reaches the SDK', async () => {
    const client = createAnthropicClient('test-key');
    await client.messages.create(baseParams(MODEL_IDS.haiku) as never);
    expect(createSpy).toHaveBeenCalledTimes(1);
    const sent = createSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.model).toBe(MODEL_IDS.haiku);
    expect(sent).not.toHaveProperty('output_config');
  });

  it('Sonnet: output_config is passed through', async () => {
    const client = createAnthropicClient('test-key');
    await client.messages.create(baseParams(MODEL_IDS.sonnet) as never);
    const sent = createSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.model).toBe(MODEL_IDS.sonnet);
    expect(sent.output_config).toEqual({ effort: 'low' });
  });
});

describe('createAnthropicClient guard — via messages.stream (R-B-07a)', () => {
  it('Haiku: the underlying create({...params, stream:true}) call has NO output_config', async () => {
    const client = createAnthropicClient('test-key');
    const stream = client.messages.stream(baseParams(MODEL_IDS.haiku) as never);
    await stream.done();
    expect(createSpy).toHaveBeenCalledTimes(1);
    const sent = createSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.stream).toBe(true);
    expect(sent.model).toBe(MODEL_IDS.haiku);
    expect(sent).not.toHaveProperty('output_config');
  });

  it('Sonnet: the underlying create({...params, stream:true}) call keeps output_config', async () => {
    const client = createAnthropicClient('test-key');
    const stream = client.messages.stream(baseParams(MODEL_IDS.sonnet) as never);
    await stream.done();
    expect(createSpy).toHaveBeenCalledTimes(1);
    const sent = createSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.stream).toBe(true);
    expect(sent.model).toBe(MODEL_IDS.sonnet);
    expect(sent.output_config).toEqual({ effort: 'low' });
  });
});
