import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from '../../src/agents/agent';
import type { PersonaConfig, PersonaResponse, ContextItem, ToolResult } from '@boardroom/shared';
import { MODEL_MAP } from '@boardroom/shared';

// Mock the prompt-loader module
vi.mock('../../src/lib/prompt-loader', () => ({
  loadPrompt: () => 'Test system prompt',
}));

describe('Agent', () => {
  let mockClient: any;
  let mockConfig: PersonaConfig;
  let agent: Agent;

  beforeEach(() => {
    mockClient = {
      messages: {
        create: vi.fn(),
        stream: vi.fn(),
      },
    };

    mockConfig = {
      model: 'haiku',
      maxOutputTokens: 1000,
      temperature: 0.7,
      tools: [],
    };

    agent = new Agent(mockConfig, mockClient as any, 'Test system prompt');
  });

  describe('reason() method', () => {
    it('returns validated PersonaResponse from LLM', async () => {
      const mockResponse = {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            personaId: 'optimist',
            situationReading: 'Test reading',
            keyAssumptions: ['Assumption 1'],
            analysis: 'Test analysis',
            recommendation: 'Test recommendation',
            uncertainties: ['Uncertainty 1'],
            sourceMemoryIds: [],
            confidence: 0.8,
            dissentFlag: false,
          }),
        }],
      };

      mockClient.messages.create.mockResolvedValue(mockResponse);

      const question = 'Should we hire?';
      const context: ContextItem[] = [{
        id: 'ctx-1',
        type: 'memory',
        content: 'Previous hiring decision',
        source: 'user_input',
        relevanceScore: 0.8,
        createdAt: new Date().toISOString(),
      }];

      const result = await agent.reason(question, context);

      expect(mockClient.messages.create).toHaveBeenCalledWith({
        model: MODEL_MAP.haiku,
        max_tokens: 1000,
        system: 'Test system prompt',
        messages: [{
          role: 'user',
          content: expect.stringContaining('Context') && expect.stringContaining('Question'),
        }],
      });

      expect(result.personaId).toBe('optimist');
      expect(result.situationReading).toBe('Test reading');
      expect(result.recommendation).toBe('Test recommendation');
    });

    it('handles empty text response gracefully', async () => {
      const mockResponse = {
        content: [{
          type: 'image' as const,
        }],
      };

      mockClient.messages.create.mockResolvedValue(mockResponse);

      await expect(agent.reason('Test question', [])).rejects.toThrow('Empty response from LLM');
    });

    it('handles JSON parsing errors', async () => {
      const mockResponse = {
        content: [{
          type: 'text' as const,
          text: 'Invalid JSON',
        }],
      };

      mockClient.messages.create.mockResolvedValue(mockResponse);

      await expect(agent.reason('Test question', [])).rejects.toThrow();
    });
  });

  describe('reasonWithTools() method', () => {
    it('executes tools and returns response with tool invocations', async () => {
      const mockToolResponse = {
        content: [
          {
            type: 'tool_use' as const,
            id: 'tool-1',
            name: 'calculator',
            input: { expression: '2+2' },
          },
        ],
      };

      const mockTextResponse = {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            personaId: 'technician',
            situationReading: 'Tool test',
            keyAssumptions: [],
            analysis: 'Test analysis',
            recommendation: 'Test recommendation',
            uncertainties: [],
            sourceMemoryIds: [],
            confidence: 0.9,
            dissentFlag: false,
          }),
        }],
      };

      mockClient.messages.create
        .mockResolvedValueOnce(mockToolResponse)
        .mockResolvedValueOnce(mockTextResponse);

      const mockToolExecutor = vi.fn().mockResolvedValue({
        toolName: 'calculator',
        output: '2+2 = 4',
        durationMs: 10,
      } as ToolResult);

      const tools = [{
        name: 'calculator',
        description: 'Calculator tool',
        input_schema: {
          type: 'object',
          properties: {
            expression: { type: 'string' },
          },
        },
      }];

      const result = await agent.reasonWithTools(
        'Calculate 2+2',
        [],
        tools as any,
        mockToolExecutor
      );

      expect(mockClient.messages.create).toHaveBeenCalledTimes(2);
      expect(mockToolExecutor).toHaveBeenCalledWith('calculator', { expression: '2+2' });
      expect(result.response.personaId).toBe('technician');
      expect(result.toolInvocations).toHaveLength(1);
      expect(result.toolInvocations[0].toolName).toBe('calculator');
    });

    it('returns response immediately when no tools are used', async () => {
      const mockResponse = {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            personaId: 'optimist',
            situationReading: 'No tools needed',
            keyAssumptions: [],
            analysis: 'Test',
            recommendation: 'Test',
            uncertainties: [],
            sourceMemoryIds: [],
            confidence: 0.8,
            dissentFlag: false,
          }),
        }],
      };

      mockClient.messages.create.mockResolvedValue(mockResponse);

      const result = await agent.reasonWithTools('Simple question', [], [], vi.fn());

      expect(mockClient.messages.create).toHaveBeenCalledTimes(1);
      expect(result.response.personaId).toBe('optimist');
      expect(result.toolInvocations).toHaveLength(0);
    });

    it('throws error when max tool rounds exceeded', async () => {
      const mockToolResponse = {
        content: [
          {
            type: 'tool_use' as const,
            id: 'tool-1',
            name: 'calculator',
            input: { expression: '1+1' },
          },
        ],
      };

      mockClient.messages.create.mockResolvedValue(mockToolResponse);
      const mockToolExecutor = vi.fn().mockResolvedValue({
        toolName: 'calculator',
        output: '1+1 = 2',
        durationMs: 10,
      });

      await expect(
        agent.reasonWithTools('Test', [], [{
          name: 'calculator',
          description: 'Test',
          input_schema: { type: 'object', properties: {} },
        }] as any, mockToolExecutor, 0) // Max rounds = 0
      ).rejects.toThrow('Max tool rounds exceeded');
    });
  });

  describe('buildUserMessage() method', () => {
    it('builds message with context items', () => {
      const context: ContextItem[] = [
        {
          id: '1',
          type: 'memory',
          content: 'Test memory',
          source: 'user_input',
          relevanceScore: 0.9,
          createdAt: new Date().toISOString(),
        },
        {
          id: '2',
          type: 'goal',
          content: 'Test goal',
          source: 'system',
          relevanceScore: 0.7,
          createdAt: new Date().toISOString(),
        },
      ];

      // Access private method via any cast for testing
      const agentAny = agent as any;
      const message = agentAny.buildUserMessage('Test question', context);

      expect(message).toContain('Context');
      expect(message).toContain('Test memory');
      expect(message).toContain('Test goal');
      expect(message).toContain('[MEMORY]');
      expect(message).toContain('[GOAL]');
      expect(message).toContain('Question');
      expect(message).toContain('Test question');
    });

    it('handles empty context', () => {
      const agentAny = agent as any;
      const message = agentAny.buildUserMessage('Test question', []);

      expect(message).toContain('(No context available)');
      expect(message).toContain('Test question');
    });
  });
});
