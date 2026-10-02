// Phase 6 — shared request-shape helpers for every Anthropic call in BoardRoom.
//
// Sonnet 5.5 / Haiku 4.5 rules (docs/contracts/PHASE-6-CONTRACTS.md):
//   * model ids only via MODEL_IDS
//   * system = cached text blocks `[core context, persona prompt(, premortem prompt)]`
//   * effort via output_config (low for personas/extractors, medium for CEO)
//   * never: temperature, thinking:{type:'disabled'}, forced tool_choice, assistant prefill

import type Anthropic from '@anthropic-ai/sdk';

export type Effort = 'low' | 'medium';

export const EFFORT = {
  persona: 'low',
  extractor: 'low',
  ceo: 'medium',
} as const satisfies Record<string, Effort>;

export interface SystemBlockParts {
  /** Shared, deterministic core context (identical bytes for every persona in a dispatch). */
  coreContext?: string | null;
  /** The persona / task system prompt. */
  prompt: string;
  /** Optional trailing blocks (e.g. the pre-mortem framing). */
  extra?: Array<string | null | undefined>;
}

/**
 * Build the cached system blocks. Every non-empty block carries
 * `cache_control: {type:'ephemeral'}` (≤4 breakpoints: core, prompt, ≤2 extra).
 * Empty / whitespace-only parts are dropped so a failed core-context fetch
 * degrades to `[prompt]` rather than inserting an empty breakpoint.
 */
export function buildSystemBlocks(parts: SystemBlockParts): Anthropic.TextBlockParam[] {
  const ordered: Array<string | null | undefined> = [parts.coreContext, parts.prompt, ...(parts.extra ?? [])];
  const blocks: Anthropic.TextBlockParam[] = [];
  for (const text of ordered) {
    if (typeof text !== 'string' || text.trim().length === 0) continue;
    blocks.push({ type: 'text', text, cache_control: { type: 'ephemeral' } });
  }
  if (blocks.length > 4) {
    // Only the last 4 may be breakpoints — merge the overflow into the first block.
    const overflow = blocks.length - 4;
    const head = blocks.slice(0, overflow + 1).map(b => b.text).join('\n\n');
    return [{ type: 'text', text: head, cache_control: { type: 'ephemeral' } }, ...blocks.slice(overflow + 1)];
  }
  return blocks;
}

/** Strip optional ```json fences and surrounding whitespace before JSON.parse. */
export function stripJsonFences(text: string): string {
  return text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
}

/** First text block of a (non-streaming) response, or null. */
export function firstText(response: { content: Array<{ type: string; text?: string }> }): string | null {
  const block = response.content.find(b => b.type === 'text');
  return block && typeof block.text === 'string' ? block.text : null;
}
