import { describe, it, expect, vi } from 'vitest';
import { checkSufficiency } from '../../src/agents/sufficiency';
import { MODEL_IDS } from '@boardroom/shared';

// Mock the prompt-loader module
vi.mock('../../src/lib/prompt-loader', () => ({
  loadSystemPrompt: () => 'Sufficiency check prompt',
}));

describe('sufficiency', () => {
  describe('checkSufficiency()', () => {
    it('returns parsed sufficiency score from LLM response', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                score: 0.85, // Score is 0-1, not percentage
                missingDimensions: ['financial', 'timeline'],
                suggestedQuestions: ['What is the budget?', 'What is the deadline?'],
                inferredIntent: 'Evaluate project feasibility',
                canProceed: true,
              }),
            }],
          }),
        },
      };

      const result = await checkSufficiency('Should we start this project?', mockClient as any);

      expect(mockClient.messages.create).toHaveBeenCalledWith({
        model: MODEL_IDS.haiku,
        max_tokens: 500,
        system: [{ type: 'text', text: 'Sufficiency check prompt', cache_control: { type: 'ephemeral' } }],
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: 'Should we start this project?' }],
      }, { signal: undefined }); // B-111: request options carry the client-disconnect AbortSignal

      expect(result.score).toBe(0.85);
      expect(result.missingDimensions).toEqual(['financial', 'timeline']);
      expect(result.suggestedQuestions).toEqual(['What is the budget?', 'What is the deadline?']);
      expect(result.inferredIntent).toBe('Evaluate project feasibility');
      expect(result.canProceed).toBe(true);
    });

    // R-B-03 — Sonnet 5.5 may put a `thinking` block before the text block.
    it('reads the first TEXT block when the response leads with a thinking block', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            stop_reason: 'end_turn',
            content: [
              { type: 'thinking' as const, thinking: '' },
              { type: 'text' as const, text: JSON.stringify({ score: 0.7, missingDimensions: [], suggestedQuestions: [], inferredIntent: 'Thinking first', canProceed: true }) },
            ],
          }),
        },
      };

      const result = await checkSufficiency('Q', mockClient as any);
      expect(result.score).toBe(0.7);
      expect(result.inferredIntent).toBe('Thinking first');
    });

    it('rejects with a clear max_tokens error instead of a JSON parse error when truncated', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            stop_reason: 'max_tokens',
            content: [{ type: 'text' as const, text: '{"score": 0.7, "missingDim' }],
          }),
        },
      };

      await expect(checkSufficiency('Q', mockClient as any)).rejects.toThrow('LLM output truncated (max_tokens)');
    });

    it('handles empty or non-text response', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{
              type: 'image' as const,
            }],
          }),
        },
      };

      const result = await checkSufficiency('Test question', mockClient as any);

      expect(result.score).toBe(0);
      expect(result.missingDimensions).toEqual([]);
      expect(result.suggestedQuestions).toEqual([]);
      expect(result.inferredIntent).toBe('Test question');
      expect(result.canProceed).toBe(true);
    });

    it('handles JSON parsing errors', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{
              type: 'text' as const,
              text: 'Invalid JSON',
            }],
          }),
        },
      };

      await expect(checkSufficiency('Test question', mockClient as any)).rejects.toThrow();
    });

    it('handles Zod validation errors gracefully', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                // Missing required fields
                score: 1.5, // Out of range
              }),
            }],
          }),
        },
      };

      await expect(checkSufficiency('Test question', mockClient as any)).rejects.toThrow();
    });

    it('strips JSON code fences from response', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{
              type: 'text' as const,
              text: '```json\n' + JSON.stringify({
                score: 0.9,
                missingDimensions: [],
                suggestedQuestions: [],
                inferredIntent: 'Test',
                canProceed: true,
              }) + '\n```',
            }],
          }),
        },
      };

      const result = await checkSufficiency('Test question', mockClient as any);

      expect(result.score).toBe(0.9);
      expect(result.inferredIntent).toBe('Test');
    });

    it('handles triple backticks without json label', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{
              type: 'text' as const,
              text: '```\n' + JSON.stringify({
                score: 0.8,
                missingDimensions: [],
                suggestedQuestions: [],
                inferredIntent: 'Test',
                canProceed: true,
              }) + '\n```',
            }],
          }),
        },
      };

      const result = await checkSufficiency('Test question', mockClient as any);

      expect(result.score).toBe(0.8);
      expect(result.inferredIntent).toBe('Test');
    });
  });
});
