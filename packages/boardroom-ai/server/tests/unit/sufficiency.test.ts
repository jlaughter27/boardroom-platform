import { describe, it, expect, vi } from 'vitest';
import { checkSufficiency } from '../../src/agents/sufficiency';
import { MODEL_MAP } from '@boardroom/shared';

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
        model: MODEL_MAP.haiku,
        max_tokens: 500,
        system: 'Sufficiency check prompt',
        messages: [{ role: 'user', content: 'Should we start this project?' }],
      });

      expect(result.score).toBe(0.85);
      expect(result.missingDimensions).toEqual(['financial', 'timeline']);
      expect(result.suggestedQuestions).toEqual(['What is the budget?', 'What is the deadline?']);
      expect(result.inferredIntent).toBe('Evaluate project feasibility');
      expect(result.canProceed).toBe(true);
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
