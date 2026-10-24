import type { ScoredResult } from './structured-filter';
import type { PersonaId, ContextPackage } from '@boardroom/shared';
import { RETRIEVAL_CONFIG } from '@boardroom/shared';
import { estimateTokens } from '@boardroom/shared';
import type { RetrievalLayer } from './forgetting-curve';

export type { ContextPackage };

/**
 * F-204: the packaged context carries a `degraded` flag when any retrieval
 * layer errored (and returned []) so callers can tell "no matches" from
 * "a layer is broken". Declared locally as an optional extension of the
 * shared ContextPackage so it stays compatible whether or not the shared type
 * grows the field.
 */
export interface RetrievalContextPackage extends ContextPackage {
  retrievalMetadata: ContextPackage['retrievalMetadata'] & {
    degraded?: boolean;
    degradedLayers?: RetrievalLayer[];
  };
}

export interface PackageOptions {
  /** Layers that threw during retrieval (F-204). */
  degradedLayers?: RetrievalLayer[];
  /** R-O-06: cap on ranked items (callers reserve slots for prepended items). Never raises the persona default. */
  maxItems?: number;
  /** R-O-06: token budget for ranked items (callers subtract prepended tokens). Never raises the persona default. */
  tokenBudget?: number;
}

/** Persona-level limits from RETRIEVAL_CONFIG (CLAUDE.md rule 7). */
export function personaLimits(persona: PersonaId): { maxItems: number; tokenBudget: number } {
  const isCEO = persona === 'ceo';
  return {
    maxItems: isCEO ? RETRIEVAL_CONFIG.maxItemsCEO : RETRIEVAL_CONFIG.maxItemsPerPersona,
    tokenBudget: isCEO ? RETRIEVAL_CONFIG.tokenBudgetCEO : RETRIEVAL_CONFIG.tokenBudgetPerPersona,
  };
}

const PERSONA_TAG_BOOSTS: Record<string, string[]> = {
  optimist: ['success', 'opportunity', 'resource', 'strength', 'win'],
  critic: ['risk', 'failure', 'constraint', 'blocker', 'concern'],
  alternate: ['alternative', 'competitor', 'unexplored', 'pivot', 'option'],
  technician: ['technical', 'implementation', 'timeline', 'architecture', 'stack'],
  ceo: [], // No tag filtering for CEO
  questionnaire: [],
  doer: ['task', 'action', 'deadline', 'commitment'],
};

const TAG_BOOST_AMOUNT = 0.15;

/**
 * Smallest excerpt worth sending (≈ 600 characters). Below this, an item that
 * does not fit is skipped rather than cut to a fragment.
 */
export const MIN_EXCERPT_TOKENS = 150;

/**
 * The opening of `content` that fits in `maxTokens`, cut at a paragraph or line
 * break when one is reasonably close, with a marker saying it is an excerpt.
 * Found by the 2026-10-23 real-vault e2e: notes of 20k+ characters ranked first
 * and the packager stopped at the first item over budget, so the persona got
 * no context at all for exactly the topics with the most material.
 */
export function excerptToBudget(content: string, maxTokens: number): string {
  const marker = `\n\n[… excerpt: first part of a ${content.length.toLocaleString('en-US')}-character note]`;
  const room = Math.max(0, maxTokens * 4 - marker.length);
  let cut = content.slice(0, room);
  const boundary = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('\n'));
  if (boundary >= room * 0.6) cut = cut.slice(0, boundary);
  return cut.trimEnd() + marker;
}

export function packageForPersona(
  results: ScoredResult[],
  persona: PersonaId,
  totalCandidates: number,
  layersUsed: string[],
  options: PackageOptions = {}
): RetrievalContextPackage {
  const limits = personaLimits(persona);
  const maxItems = Math.max(0, Math.min(limits.maxItems, options.maxItems ?? limits.maxItems));
  const tokenBudget = Math.max(0, Math.min(limits.tokenBudget, options.tokenBudget ?? limits.tokenBudget));

  // Apply persona-specific tag boosts
  const boostTags = PERSONA_TAG_BOOSTS[persona] ?? [];
  const boosted = results.map(r => {
    let score = r.relevanceScore;
    if (boostTags.length > 0 && r.tags) {
      const hasBoostTag = r.tags.some(t => boostTags.includes(t.toLowerCase()));
      if (hasBoostTag) score += TAG_BOOST_AMOUNT;
    }
    return { ...r, relevanceScore: Math.min(score, 1.0) };
  });

  // Re-sort after boosting
  boosted.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Take top N within token budget. An item that does not fit is excerpted to
  // the remaining budget (if that leaves a useful excerpt) or skipped, and the
  // scan continues — a long top hit must not leave the persona with nothing.
  const selected: typeof boosted = [];
  let totalTokens = 0;

  for (const item of boosted) {
    if (selected.length >= maxItems) break;
    const remaining = tokenBudget - totalTokens;
    if (remaining <= 0) break;
    const itemTokens = estimateTokens(item.content);
    if (itemTokens <= remaining) {
      selected.push(item);
      totalTokens += itemTokens;
    } else if (remaining >= MIN_EXCERPT_TOKENS) {
      const content = excerptToBudget(item.content, remaining);
      selected.push({ ...item, content });
      totalTokens += estimateTokens(content);
    }
  }

  const degradedLayers = options.degradedLayers ?? [];

  return {
    items: selected.map(({ tags, importance, lastAccessedAt, title, ...rest }) => rest),
    tokenEstimate: totalTokens,
    retrievalMetadata: {
      totalCandidates,
      layersUsed,
      ...(degradedLayers.length > 0 ? { degraded: true, degradedLayers } : {}),
    },
  };
}
