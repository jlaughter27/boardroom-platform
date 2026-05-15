// Ported from boardroom-ai/server/src/advisor.ts SSE streaming pattern (April 2026)
// Centralized SSE helper for streaming Claude responses to the client

import type { Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import type { BoardRoomSSEEvent } from '@boardroom/shared';

/**
 * Send a typed SSE event to the client.
 */
export const sendSSE = (res: Response, event: BoardRoomSSEEvent): void => {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
};

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
 * Wire a client-disconnect handler that aborts an Anthropic stream when the
 * user closes the tab / cancels the request.
 *
 * Without this, the Anthropic stream keeps producing tokens (and we keep
 * being billed) until the message completes — even though no one is
 * listening (AGT-04).
 *
 * Returns the AbortController so callers can pass `controller.signal` to
 * `client.messages.stream(..., { signal })`.
 */
export const abortOnClose = (res: Response): AbortController => {
  const controller = new AbortController();
  // Some test doubles for Response lack `.on` — guard so unit tests don't
  // need to mock EventEmitter just to exercise streaming.
  if (typeof (res as { on?: unknown }).on === 'function') {
    res.on('close', () => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    });
  }
  return controller;
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
  const controller = abortOnClose(res);

  try {
    const stream = await client.messages.stream(
      {
        model: params.model,
        max_tokens: params.maxTokens,
        system: params.system,
        messages: [{ role: 'user', content: params.userMessage }],
      },
      // Cast: the SDK's RequestOptions accepts a standard AbortSignal but
      // the type narrowing collides with Node's enhanced AbortSignal.
      { signal: controller.signal } as Parameters<typeof client.messages.stream>[1],
    );

    for await (const event of stream) {
      // If the client disconnected mid-stream, stop iterating — the abort
      // signal will also tear down the upstream Anthropic connection.
      if (controller.signal.aborted) break;
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        fullResponse += event.delta.text;
        sendSSE(res, { type: 'delta', text: event.delta.text });
      }
    }

    if (!controller.signal.aborted) {
      sendSSE(res, { type: 'done' });
      res.end();
    }
  } catch (error) {
    if (controller.signal.aborted) {
      // Client went away — no point writing an error event.
      return fullResponse;
    }
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    sendSSE(res, { type: 'error', error: message });
    res.end();
  }

  return fullResponse;
};
