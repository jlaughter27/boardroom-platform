// Knowledge graph constants (RD-6).
// GET /graph returns every entity but only the top-N memories by importance;
// N is the `memoryLimit` query param. The UI starts at DEFAULT and raises it in
// STEP increments ("Show more") up to MAX — enough for a ~1,000-note vault while
// the force layout stays responsive.

export const KNOWLEDGE_GRAPH_MEMORY_LIMIT = {
  /** Memories returned when the caller does not ask for a number. */
  DEFAULT: 200,
  /** Hard ceiling the API accepts (422 above it). */
  MAX: 1000,
  /** How many more memories one "Show more" asks for. */
  STEP: 200,
} as const;
