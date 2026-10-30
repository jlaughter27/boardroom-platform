// Commitment direction helpers (RD-12). Pure.

/**
 * True when the commitment is a delegation: someone else owes the user
 * (`owedBy === 'STAKEHOLDER'`). A missing `owedBy` means USER.
 */
export const isDelegation = (c: { owedBy?: string | null }): boolean =>
  c.owedBy === 'STAKEHOLDER';
