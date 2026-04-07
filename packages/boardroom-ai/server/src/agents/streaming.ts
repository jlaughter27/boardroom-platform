// Ported from boardroom-ai/server/src/advisor.ts SSE streaming pattern (April 2026)
// Centralized SSE helper for streaming Claude responses to the client

import type { Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Initialize an SSE response with proper headers.
 */
export const initSSE = (res: Response): void => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
};

/**
 * Stream a Claude message response to the client via SSE.
 * Sends { type: 'delta', text } for each chunk, { type: 'done' } at end.
 */
export const streamClaudeResponse = async (
  res: Response,
  client: Anthropic,
  params: {
    model: string;
    maxTokens: number;
    system: string;
    userMessage: string;
  }
): Promise<string> => {
  let fullResponse = '';

  try {
    const stream = await client.messages.stream({
      model: params.model,
      max_tokens: params.maxTokens,
      system: params.system,
      messages: [{ role: 'user', content: params.userMessage }],
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        fullResponse += event.delta.text;
        res.write(`data: ${JSON.stringify({ type: 'delta', text: event.delta.text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    res.write(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`);
    res.end();
  }

  return fullResponse;
};
