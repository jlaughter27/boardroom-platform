/**
 * OmniMind ↔ caller HTTP conventions shared by omnimind-api (sender) and the
 * BoardRoom client (receiver). Constants only.
 */

/**
 * Response header OmniMind sets (value `'1'`) on a DELIBERATE application-level
 * refusal answered with a 5xx — e.g. 503 `MINISTRY_DEFERRED` (ministry writes
 * are deferred by policy) or 503 `admin_disabled` (admin key not configured).
 * Such a response means OmniMind is healthy and answered on purpose: callers
 * must neither retry it nor count it toward a circuit breaker. Infra failures
 * (DB down, proxy 502/503/504, timeouts) never carry it.
 */
export const OMNIMIND_REFUSAL_HEADER = 'x-omnimind-refusal' as const;

/**
 * Error codes (`code` or `error` in the JSON body) that are always deliberate
 * refusals — the fallback when a response lacks `OMNIMIND_REFUSAL_HEADER`
 * (an OmniMind build older than the header). Never add an infra code here.
 */
export const OMNIMIND_REFUSAL_CODES: readonly string[] = ['MINISTRY_DEFERRED', 'admin_disabled'];
