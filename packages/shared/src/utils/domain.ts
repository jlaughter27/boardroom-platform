/**
 * Canonical domain normalization + the ministry data-sovereignty test.
 *
 * Every refusal gate that compares against `'ministry'` (OmniMind's
 * memory.service, the MCP memory_write / decision_log tools, audit
 * redaction, retrieval post-filters) must see the same canonical value,
 * otherwise a caller can bypass the gate with `'Ministry '`,
 * `'ministry​'`, a Cyrillic `і`, `'ministry/pastoral'` or
 * `'tgfc-ministry'` (H2, adversarial e2e 2026-10-30). Pure functions, no I/O.
 */

/** Default tenant id of the ministry tenant (OmniMind reads `OMNIMIND_MINISTRY_TENANT_ID`). */
export const MINISTRY_TENANT_ID_DEFAULT = 'tgfc-ministry';

/** Invisible format characters (zero-width space/joiners, BOM, soft hyphen, bidi marks, …). */
const INVISIBLE_RE = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;
const COMBINING_MARK_RE = /\p{M}/gu;

/**
 * Cyrillic / Greek / small-capital lookalikes for the letters of
 * "ministry" / "ministries" (lowercase forms — input is lowercased first).
 */
const CONFUSABLES: Readonly<Record<string, string>> = {
  'м': 'm', 'μ': 'm', 'ᴍ': 'm', // м μ ᴍ
  'і': 'i', 'ı': 'i', 'ι': 'i', 'ӏ': 'i', 'ɩ': 'i', 'ɪ': 'i', // і ı ι ӏ ɩ ɪ
  'ν': 'n', 'ɴ': 'n', // ν ɴ
  'ѕ': 's', 'ꜱ': 's', // ѕ ꜱ
  'т': 't', 'τ': 't', 'ᴛ': 't', // т τ ᴛ
  'г': 'r', 'ʀ': 'r', 'ᴦ': 'r', // г ʀ ᴦ
  'у': 'y', 'ү': 'y', 'γ': 'y', 'υ': 'y', 'ʏ': 'y', // у ү γ υ ʏ
  'е': 'e', 'ε': 'e', 'ᴇ': 'e', // е ε ᴇ
};

/**
 * "ministry" / "ministries" as a whole token anywhere in the domain:
 * `ministry`, `ministries`, `ministry/pastoral`, `ministry-care`,
 * `tgfc-ministry`, `church ministry`. Not `administration` / `minister`.
 */
const MINISTRY_TOKEN_RE = /(?:^|[^a-z])ministr(?:y|ies)(?:[^a-z]|$)/;

/** NFKC → strip invisible format characters → trim → lowercase. */
function baseNormalize(domain: string | null | undefined): string {
  return (domain ?? '').normalize('NFKC').replace(INVISIBLE_RE, '').trim().toLowerCase();
}

/** Skeleton used only for the ministry test: drop combining marks, fold lookalikes. */
function ministrySkeleton(base: string): string {
  const unmarked = base.normalize('NFD').replace(COMBINING_MARK_RE, '');
  let out = '';
  for (const ch of unmarked) out += CONFUSABLES[ch] ?? ch;
  return out;
}

function isMinistryLike(base: string): boolean {
  return base.length > 0 && MINISTRY_TOKEN_RE.test(ministrySkeleton(base));
}

/**
 * Canonical domain: NFKC, invisible characters stripped, trimmed, lowercased.
 * Every ministry-like spelling (see `isMinistryDomain`) collapses to exactly
 * `'ministry'`, so every `=== 'ministry'` gate sees it. Other domains keep
 * their (normalized) spelling; lookalike folding is never applied to them.
 */
export function normalizeDomain(domain: string | null | undefined): string {
  const base = baseNormalize(domain);
  return isMinistryLike(base) ? 'ministry' : base;
}

/**
 * True for the ministry data-sovereignty domain in any spelling: case,
 * padding, zero-width / format characters, full-width forms, accents,
 * Cyrillic / Greek lookalikes, plurals (`ministries`), sub-domains
 * (`ministry/pastoral`, `ministry-care`) and the tenant id (`tgfc-ministry`).
 */
export function isMinistryDomain(domain: string | null | undefined): boolean {
  return isMinistryLike(baseNormalize(domain));
}

/**
 * True when a tenant id names the ministry tenant: the configured id (default
 * `tgfc-ministry`) or any ministry-like tenant id. Writes in such a tenant are
 * ministry writes regardless of their `domain` field.
 */
export function isMinistryTenant(
  tenantId: string | null | undefined,
  ministryTenantId: string = MINISTRY_TENANT_ID_DEFAULT
): boolean {
  const t = baseNormalize(tenantId);
  if (!t) return false;
  return t === baseNormalize(ministryTenantId) || isMinistryLike(t);
}
