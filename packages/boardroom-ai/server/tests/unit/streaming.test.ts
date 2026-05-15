import { describe, it, expect, vi } from 'vitest';
import { initSSE, sendSSE, streamClaudeResponse } from '../../src/agents/streaming';
import type { Response } from 'express';

describe('streaming', () => {
  describe('initSSE()', () => {
    it('sets SSE headers correctly', () => {
      const mockRes: Partial<Response> = {
        writeHead: vi.fn(),
      };

      initSSE(mockRes as Response);

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
    });
  });

  describe('sendSSE()', () => {
    it('writes formatted SSE event', () => {
      const mockRes: Partial<Response> = {
        write: vi.fn(),
      };

      const event = { type: 'test', data: 'test data' };
      sendSSE(mockRes as Response, event);

      expect(mockRes.write).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);
    });
  });

  describe('streamClaudeResponse()', () => {
    it('streams response and returns full text', async () => {
      const mockRes: Partial<Response> = {
        write: vi.fn(),
        end: vi.fn(),
      };

      const mockClient = {
        messages: {
          stream: vi.fn(async function* () {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } };
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'World!' } };
          }),
        },
      };

      vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await streamClaudeResponse(
        mockRes as Response,
        mockClient as any,
        {
          model: 'claude-haiku',
          maxTokens: 1000,
          system: 'Test system',
          userMessage: 'Test message',
        }
      );

      expect(mockClient.messages.stream).toHaveBeenCalledWith(
        {
          model: 'claude-haiku',
          max_tokens: 1000,
          system: 'Test system',
          messages: [{ role: 'user', content: 'Test message' }],
        },
        // AGT-04: second arg now carries an AbortSignal so client disconnects
        // cancel the upstream Anthropic stream.
        expect.objectContaining({ signal: expect.any(Object) }),
      );

      expect(mockRes.write).toHaveBeenCalledTimes(3); // 2 deltas + 1 done
      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('data: {"type":"delta","text":"Hello "}')
      );
      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('data: {"type":"delta","text":"World!"}')
      );
      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('data: {"type":"done"}')
      );
      expect(mockRes.end).toHaveBeenCalled();
      expect(result).toBe('Hello World!');
    });

    it('handles streaming errors gracefully', async () => {
      const mockRes: Partial<Response> = {
        write: vi.fn(),
        end: vi.fn(),
      };

      const mockClient = {
        messages: {
          stream: vi.fn().mockRejectedValue(new Error('Stream error')),
        },
      };

      const result = await streamClaudeResponse(
        mockRes as Response,
        mockClient as any,
        {
          model: 'claude-haiku',
          maxTokens: 1000,
          system: 'Test system',
          userMessage: 'Test message',
        }
      );

      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('data: {\"type\":\"error\",\"error\":\"Stream error\"}')
      );
      expect(mockRes.end).toHaveBeenCalled();
      expect(result).toBe('');
    });

    it('handles unknown errors', async () => {
      const mockRes: Partial<Response> = {
        write: vi.fn(),
        end: vi.fn(),
      };

      const mockClient = {
        messages: {
          stream: vi.fn().mockRejectedValue('Not an error object'),
        },
      };

      const result = await streamClaudeResponse(
        mockRes as Response,
        mockClient as any,
        {
          model: 'claude-haiku',
          maxTokens: 1000,
          system: 'Test system',
          userMessage: 'Test message',
        }
      );

      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('data: {\"type\":\"error\",\"error\":\"Unknown error occurred\"}')
      );
      expect(mockRes.end).toHaveBeenCalled();
      expect(result).toBe('');
    });
  });
});
