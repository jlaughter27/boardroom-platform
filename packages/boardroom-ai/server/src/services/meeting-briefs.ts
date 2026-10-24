import {
  MEETING_BRIEF_CONFIG,
  nameCandidate,
  normalizeName,
  titleTokens,
} from '@boardroom/shared';
import type {
  CalendarEvent,
  MeetingBriefEvent,
  MeetingBriefKnownPerson,
  MeetingBriefsOmitted,
  PersonBrief,
  PersonBriefsAttendeeInput,
  PersonBriefsEventInput,
  PersonBriefsResponse,
} from '@boardroom/shared';

/**
 * RD-13 — pure helpers behind `GET /calendar/briefs`.
 *
 * `selectBriefableEvents` turns the next hours of Google events into the
 * OmniMind `POST /people/briefs` payload: attendee NAME candidates (never
 * e-mails) and normalized title tokens (never raw titles). `joinBriefs` maps
 * OmniMind's matches back onto the events. No I/O here.
 */

const CFG = MEETING_BRIEF_CONFIG;
const RESOURCE_DOMAIN = 'resource.calendar.google.com';

export interface SelectedEvent {
  /** Position in the start-sorted, capped list (event key = `e<index>`). */
  index: number;
  event: CalendarEvent;
  eventKey: string;
  /** Canonical attendee keys sent for this event (deduped). */
  attendeeKeys: string[];
  /** Other attendees with no usable name candidate (not sent). */
  unknownAttendees: number;
  /** Other (non-self, non-resource) attendees. */
  attendeeCount: number;
}

export interface BriefableSelection {
  selected: SelectedEvent[];
  attendeesPayload: PersonBriefsAttendeeInput[];
  eventsPayload: PersonBriefsEventInput[];
  /** `<eventIndex>:<attendeeIndex>` → canonical key actually sent. */
  keyIndex: Record<string, string>;
  omitted: MeetingBriefsOmitted;
}

function isResourceEmail(email: string | null): boolean {
  return (email ?? '').trim().toLowerCase().endsWith(RESOURCE_DOMAIN);
}

export function selectBriefableEvents(events: CalendarEvent[], now: Date, hours: number): BriefableSelection {
  const nowMs = now.getTime();
  const windowEnd = nowMs + hours * 3_600_000;
  const graceStart = nowMs - CFG.inProgressGraceMin * 60_000;
  const omitted: MeetingBriefsOmitted = { noKnownPeople: 0, overCap: 0, allDayOrDeclined: 0 };

  // 1. time window (not counted)
  const inWindow = events.filter(e => {
    const s = new Date(e.startTime).getTime();
    const end = new Date(e.endTime).getTime();
    return end > nowMs && s < windowEnd && s >= graceStart;
  });

  // 2. all-day / self-declined (counted)
  const live = inWindow.filter(e => {
    const declined = (e.attendees ?? []).some(a => a.self && a.responseStatus === 'declined');
    if (e.allDay || declined) { omitted.allDayOrDeclined += 1; return false; }
    return true;
  });

  // 3. order + cap
  live.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  const kept = live.slice(0, CFG.maxEvents);
  omitted.overCap += live.length - kept.length;

  const selected: SelectedEvent[] = [];
  const attendeesPayload: PersonBriefsAttendeeInput[] = [];
  const eventsPayload: PersonBriefsEventInput[] = [];
  const keyIndex: Record<string, string> = {};
  const keyByNorm = new Map<string, string>();

  kept.forEach((event, i) => {
    // 4. other humans only
    const others = (event.attendees ?? []).filter(a => !a.self && !a.resource && !isResourceEmail(a.email));

    // 5. attendee keys — tentative, so an event that cannot fit under the
    //    unique-attendee cap is moved to overCap without leaving half its keys.
    const newKeys: PersonBriefsAttendeeInput[] = [];
    const newNorms = new Map<string, string>();
    const localIndex: Record<string, string> = {};
    const eventKeys: string[] = [];
    let unknown = 0;
    let fits = true;
    others.forEach((a, j) => {
      if (!fits) return;
      const cand = nameCandidate(a.displayName, a.email);
      // Defense in depth: nothing address-shaped is ever sent to OmniMind.
      if (!cand || cand.includes('@')) { unknown += 1; return; }
      const norm = normalizeName(cand);
      if (!norm) { unknown += 1; return; }
      let key = keyByNorm.get(norm) ?? newNorms.get(norm);
      if (!key) {
        if (attendeesPayload.length + newKeys.length >= CFG.maxAttendees) { fits = false; return; }
        key = `${i}:${j}`;
        newNorms.set(norm, key);
        newKeys.push({ key, name: cand.trim().slice(0, 120) });
      }
      localIndex[`${i}:${j}`] = key;
      if (!eventKeys.includes(key)) eventKeys.push(key);
    });
    if (!fits) { omitted.overCap += 1; return; }

    attendeesPayload.push(...newKeys);
    for (const [norm, key] of newNorms) keyByNorm.set(norm, key);
    Object.assign(keyIndex, localIndex);

    // 6. title tokens (never the raw title)
    const eventKey = `e${i}`;
    const tokens = titleTokens(event.title).map(t => t.slice(0, 40));
    if (tokens.length > 0) eventsPayload.push({ key: eventKey, titleTokens: tokens, smallMeeting: others.length <= 1 });

    selected.push({ index: i, event, eventKey, attendeeKeys: eventKeys, unknownAttendees: unknown, attendeeCount: others.length });
  });

  return { selected, attendeesPayload, eventsPayload, keyIndex, omitted };
}

export interface JoinedBriefs {
  events: MeetingBriefEvent[];
  briefs: Record<string, PersonBrief>;
  noKnownPeople: number;
}

function openItems(b: PersonBrief | undefined): number {
  return b ? b.counts.youOweOverdue + b.counts.youOwe + b.counts.theyOwe : 0;
}

export function joinBriefs(selected: SelectedEvent[], _keyIndex: Record<string, string>, response: PersonBriefsResponse): JoinedBriefs {
  const byKey = new Map(response.attendeeMatches.map(m => [m.key, m]));
  const titleByEvent = new Map<string, PersonBriefsResponse['titleMatches']>();
  for (const t of response.titleMatches) titleByEvent.set(t.key, [...(titleByEvent.get(t.key) ?? []), t]);

  const events: MeetingBriefEvent[] = [];
  const referenced = new Set<string>();
  let noKnownPeople = 0;

  for (const s of selected) {
    const people = new Map<string, MeetingBriefKnownPerson['method']>();
    let ambiguous = 0;
    let unknown = s.unknownAttendees;
    for (const key of s.attendeeKeys) {
      const m = byKey.get(key);
      if (m?.personId && response.briefs[m.personId]) {
        if (!people.has(m.personId)) people.set(m.personId, m.method ?? 'exact');
      } else if (m?.ambiguous) {
        ambiguous += 1;
      } else {
        unknown += 1;
      }
    }
    for (const t of titleByEvent.get(s.eventKey) ?? []) {
      if (!people.has(t.personId) && response.briefs[t.personId]) people.set(t.personId, t.method);
    }

    if (people.size === 0) { noKnownPeople += 1; continue; }

    const ranked = [...people.entries()]
      .map(([personId, method]) => ({ personId, method, brief: response.briefs[personId] }))
      .sort((a, b) => openItems(b.brief) - openItems(a.brief) || a.brief.name.localeCompare(b.brief.name));
    const shown = ranked.slice(0, CFG.maxPeoplePerEvent);
    for (const p of shown) referenced.add(p.personId);

    events.push({
      id: s.event.id,
      title: s.event.title,
      startTime: new Date(s.event.startTime).toISOString(),
      endTime: new Date(s.event.endTime).toISOString(),
      location: s.event.location ?? null,
      attendeeCount: s.attendeeCount,
      knownPeople: shown.map(p => ({ personId: p.personId, displayName: p.brief.name, method: p.method })),
      unknownAttendees: unknown,
      ambiguousAttendees: ambiguous,
      morePeople: ranked.length - shown.length,
    });
  }

  const briefs: Record<string, PersonBrief> = {};
  for (const id of referenced) briefs[id] = response.briefs[id];
  return { events, briefs, noKnownPeople };
}
