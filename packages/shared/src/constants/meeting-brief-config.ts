// RD-13 — meeting prep briefs (dashboard card, deterministic, no LLM).
// BoardRoom reads the next `windowHours` of Google events and asks OmniMind's
// `POST /people/briefs` for per-person briefs; only the Google event list is
// cached (`eventCacheMs`), briefs never are.

export const MEETING_BRIEF_CONFIG = {
  /** Default look-ahead window for `GET /calendar/briefs`. */
  windowHours: 24,
  /** Largest `hours` the route accepts (400 above it). */
  maxWindowHours: 48,
  /** An event that started up to this many minutes ago still gets a brief. */
  inProgressGraceMin: 15,
  /** Events briefed per request; the rest count as `omitted.overCap`. */
  maxEvents: 8,
  /** Unique attendee name candidates sent to OmniMind per request. */
  maxAttendees: 40,
  /** Person chips shown per event; the rest are `morePeople`. */
  maxPeoplePerEvent: 6,
  /** Normalized title tokens sent per event. */
  maxTitleTokens: 16,
  /** Items returned per brief section (counts are pre-cap). */
  caps: { memories: 3, youOwe: 3, theyOwe: 3, decisions: 3 },
  /** Decisions-by-mention look back this many days. */
  decisionLookbackDays: 180,
  /** Scan caps for the JS-side matching passes. */
  scanTake: { tasks: 300, decisions: 200, linkedMemories: 200 },
  capsuleMaxChars: 280,
  excerptMaxChars: 160,
  /** Per-user Google event-list cache lifetime. */
  eventCacheMs: 300_000,
  eventCacheMaxUsers: 500,
  /** `refresh=1` is ignored while the cached entry is younger than this (Google quota guard). */
  refreshMinIntervalMs: 30_000,
  /** Task.status values (trimmed, lowercased) that mean "not owed any more". */
  closedTaskStatuses: ['done', 'completed', 'complete', 'cancelled', 'canceled', 'archived'],
} as const;
