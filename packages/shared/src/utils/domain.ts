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
  // Lane F (2026-10-30) — residual lookalikes: Cherokee small letters (input is
  // lowercased first, so capital Cherokee arrives as U+AB70–ABBF), Armenian,
  // more Greek / Cyrillic / Latin.
  '\uAB87': 'm', '\uABA7': 'm', '\u0574': 'm', // Cherokee LU, DI; Armenian men
  '\uAB75': 'i', '\u01C0': 'i', // Cherokee V; Latin dental click
  '\u0578': 'n', '\u057C': 'n', '\u03B7': 'n', '\u043F': 'n', // Armenian vo, ra; Greek eta; Cyrillic pe
  '\uABAA': 's', '\u0282': 's', // Cherokee DU; ʂ
  '\uAB72': 't', // Cherokee I
  '\uAB71': 'r', '\uAB81': 'r', // Cherokee E, SMALL LETTER HU
  '\uAB79': 'y', '\u10E7': 'y', // Cherokee GI; Georgian qar
  '\uAB7C': 'e', // Cherokee GV
};

/**
 * Lane F — digit / symbol / letter substitutions folded only inside the
 * letters-only skeleton (`minlstry`, `mini5try`, `m1n1stry`, `MINI$TRY`).
 */
const SKELETON_FOLD: Readonly<Record<string, string>> = {
  '1': 'i', 'l': 'i', '|': 'i', '!': 'i', '¡': 'i',
  '5': 's', '$': 's',
  '0': 'o', '3': 'e', '7': 't', '+': 't',
};

/**
 * Lane F — `ministry` / `ministries` anywhere in the letters-only skeleton:
 * run-together (`ministrycare`, `tgfcministry`) and split (`min-istry`,
 * `mini stry`, `m.i.n.i.s.t.r.y`) spellings. `administration`, `minister`,
 * `ministerial`, `administrivia` never contain these. Fail-closed by design:
 * a made-up word that contains them (`administry`) is ministry too.
 */
const MINISTRY_SKELETON_RE = /ministr(?:y|ie)/;

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

/** Letters-only skeleton: fold digit / symbol substitutions, drop every non-letter, `rn` → `m`. */
function lettersSkeleton(skeleton: string): string {
  let out = '';
  for (const ch of skeleton) out += SKELETON_FOLD[ch] ?? ch;
  return out.replace(/[^a-z]/g, '').replace(/rn/g, 'm');
}

function isMinistryLike(base: string): boolean {
  if (base.length === 0) return false;
  const skeleton = ministrySkeleton(base);
  return MINISTRY_TOKEN_RE.test(skeleton) || MINISTRY_SKELETON_RE.test(lettersSkeleton(skeleton));
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
