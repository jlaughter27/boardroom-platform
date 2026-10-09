/**
 * Canonical domain normalization — trim + lowercase.
 *
 * Every refusal gate that compares against `'ministry'` (OmniMind's
 * memory.service, the MCP memory_write / decision_log tools, audit
 * redaction) must see the same canonical value, otherwise a caller can
 * bypass the gate with `'Ministry '`. Pure function, no I/O.
 */
export function normalizeDomain(domain: string | null | undefined): string {
  return (domain ?? '').trim().toLowerCase();
}

/** True when the (normalized) domain is the ministry data-sovereignty domain. */
export function isMinistryDomain(domain: string | null | undefined): boolean {
  return normalizeDomain(domain) === 'ministry';
}
