import { describe, it, expect, vi } from 'vitest';
import { recordUsage, toUsageBody } from '../../src/lib/llm-usage';

const usage = { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 } as any;

async function flush() { await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0)); }

describe('llm-usage', () => {
  it('maps Anthropic usage to the POST /usage/llm body', () => {
    expect(toUsageBody({ purpose: 'persona:critic', model: 'claude-haiku-4-5', usage, durationMs: 812.4, sessionId: 's1', userId: 'u1' })).toEqual({
      service: 'boardroom-ai', purpose: 'persona:critic', model: 'claude-haiku-4-5',
      inputTokens: 1200, outputTokens: 300, cacheReadTokens: 1000, cacheWriteTokens: 0,
      durationMs: 812, sessionId: 's1', userId: 'u1',
    });
    expect(toUsageBody({ purpose: 'x', model: 'm', usage: undefined })).toBeNull();
    expect(toUsageBody({ purpose: 'x', model: 'm', usage: { input_tokens: 1, output_tokens: 2 } as any })).toMatchObject({ cacheReadTokens: 0, cacheWriteTokens: 0 });
  });

  it('posts fire-and-forget through the sink', async () => {
    const sink = { postLlmUsage: vi.fn().mockResolvedValue({ id: 'u', costUsd: 0.001 }) };
    recordUsage({ purpose: 'ceo', model: 'claude-sonnet-5-5', usage, sink });
    await flush();
    expect(sink.postLlmUsage).toHaveBeenCalledOnce();
    expect(sink.postLlmUsage.mock.calls[0][0]).toMatchObject({ purpose: 'ceo', model: 'claude-sonnet-5-5', inputTokens: 1200 });
  });

  it('never throws when the sink rejects or throws synchronously', async () => {
    const rejecting = { postLlmUsage: vi.fn().mockRejectedValue(new Error('boom')) };
    expect(() => recordUsage({ purpose: 'ceo', model: 'm', usage, sink: rejecting })).not.toThrow();
    const throwing = { postLlmUsage: vi.fn(() => { throw new Error('sync boom'); }) };
    expect(() => recordUsage({ purpose: 'ceo', model: 'm', usage, sink: throwing as any })).not.toThrow();
    await flush();
  });

  it('is a no-op without usage', async () => {
    const sink = { postLlmUsage: vi.fn() };
    recordUsage({ purpose: 'ceo', model: 'm', usage: null, sink });
    await flush();
    expect(sink.postLlmUsage).not.toHaveBeenCalled();
  });
});
