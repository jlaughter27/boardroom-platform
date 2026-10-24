/**
 * RD-13 — deterministic name normalization for meeting prep briefs.
 *
 * Pure functions, no I/O. BoardRoom turns calendar attendees into name
 * candidates and event titles into normalized word tokens with these helpers,
 * so attendee e-mails and raw titles never leave BoardRoom; OmniMind matches
 * the same normalized forms against `Person.name`.
 */

const RESOURCE_CALENDAR_DOMAIN = 'resource.calendar.google.com';
const MAX_TITLE_TOKENS = 16;

/** NFKD → strip combining marks → lowercase → non-letters (except ' and -) to spaces → collapse. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whitespace tokens of `normalizeName(s)`. */
export function nameTokens(s: string): string[] {
  return normalizeName(s).split(' ').filter(Boolean);
}

/**
 * A name to match on for one calendar attendee: the display name when it has
 * 3+ characters, else two or more letter-only tokens from the e-mail local
 * part (`sarah.jones@x` → `sarah jones`). Room/resource calendars and
 * local parts like `pastorjohn77` give `null`.
 */
export function nameCandidate(displayName: string | null | undefined, email: string | null | undefined): string | null {
  const domain = (email ?? '').split('@')[1]?.trim().toLowerCase() ?? '';
  if (domain.endsWith(RESOURCE_CALENDAR_DOMAIN)) return null;

  const display = (displayName ?? '').trim();
  if (display.length >= 3) return display;

  const local = (email ?? '').split('@')[0] ?? '';
  const tokens = local
    .split(/[._-]/)
    .filter(t => t.length > 0 && !/\d/.test(t))
    .filter(t => /^\p{L}{2,}$/u.test(t));
  return tokens.length >= 2 ? tokens.join(' ') : null;
}

/** Normalized title tokens: 2+ characters, deduped in first-seen order, capped at 16. */
export function titleTokens(title: string | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of nameTokens(title ?? '')) {
    if (t.length < 2 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_TITLE_TOKENS) break;
  }
  return out;
}
