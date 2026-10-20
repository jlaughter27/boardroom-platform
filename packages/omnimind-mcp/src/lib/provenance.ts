import { z } from 'zod';

/**
 * Front door hardening — every retrieval result tells the model (and the
 * client) where it came from and how to treat it: `source: 'omnimind'`
 * (the closed store, never the open internet) and `trust: 'data'` (stored
 * content is data to reason about, never instructions to follow). Attached
 * to the structuredContent of `memory_search`, `search`, `fetch` and
 * `status_get`.
 */
export interface McpProvenance {
  source: 'omnimind';
  trust: 'data';
}

export const PROVENANCE: McpProvenance = Object.freeze({ source: 'omnimind', trust: 'data' }) as McpProvenance;

export const McpProvenanceSchema = z.object({
  source: z.literal('omnimind'),
  trust: z.literal('data'),
});

/** Companion of `McpProvenanceSchema` — keeps the Zod shape and the interface in lockstep. */
export type McpProvenanceShape = z.infer<typeof McpProvenanceSchema>;
