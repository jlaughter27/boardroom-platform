/**
 * RD-13 — pure helpers behind GET /calendar/briefs: which events get briefed,
 * what goes to OmniMind (names + title tokens only), and how matches join
 * back onto events. Synthetic names only.
 */
import { describe, it, expect } from 'vitest';
import type { CalendarAttendee, CalendarEvent, PersonBrief, PersonBriefsResponse } from '@boardroom/shared';
import { selectBriefableEvents, joinBriefs } from '../../src/services/meeting-briefs';

const NOW = new Date('2026-10-24T09:00:00.000Z');
const MIN = 60_000;
const at = (minutes: number) => new Date(NOW.getTime() + minutes * MIN);

let seq = 0;
function ev(startMin: number, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  seq += 1;
  return {
    id: `ev${seq}`, title: `Planning ${seq}`, startTime: at(startMin), endTime: at(startMin + 30), allDay: false,
    source: 'google', externalId: null, description: 'private agenda text', location: null, attendees: [], ...extra,
  };
}
const person = (displayName: string | null, email: string | null, extra: Partial<CalendarAttendee> = {}): CalendarAttendee => ({
  email, displayName, self: false, organizer: false, resource: false, responseStatus: 'accepted', ...extra,
});
const me = (extra: Partial<CalendarAttendee> = {}) => person('Me Myself', 'me@example.com', { self: true, ...extra });

describe('selectBriefableEvents', () => {
  it('counts all-day and self-declined events; drops past events silently', () => {
    const s = selectBriefableEvents([
      ev(60, { allDay: true }),
      ev(120, { attendees: [me({ responseStatus: 'declined' }), person('Avery Testperson', null)] }),
      ev(-120),
    ], NOW, 24);
    expect(s.omitted).toEqual({ noKnownPeople: 0, overCap: 0, allDayOrDeclined: 2 });
    expect(s.selected).toHaveLength(0);
  });

  it('keeps an event that started 10 minutes ago, drops one that started 20 minutes ago and one past the window', () => {
    const s = selectBriefableEvents([ev(-10), ev(-20), ev(24 * 60 + 5)], NOW, 24);
    expect(s.selected.map(x => x.event.startTime)).toEqual([at(-10)]);
  });

  it('excludes self and resource attendees; smallMeeting = at most one other attendee', () => {
    const s = selectBriefableEvents([
      ev(30, { title: 'Lunch w/ Avery', attendees: [me(), person('Board Room', 'c_1@resource.calendar.google.com'), person('Projector', null, { resource: true }), person('Avery Testperson', null)] }),
      ev(90, { attendees: [person('Bo Lindqvist', null), person('Cy Marlow', null)] }),
    ], NOW, 24);
    expect(s.attendeesPayload.map(a => a.name)).toEqual(['Avery Testperson', 'Bo Lindqvist', 'Cy Marlow']);
    expect(s.selected[0].attendeeCount).toBe(1);
    expect(s.eventsPayload).toEqual([
      { key: 'e0', titleTokens: ['lunch', 'avery'], smallMeeting: true },
      { key: 'e1', titleTokens: expect.any(Array), smallMeeting: false },
    ]);
  });

  it('a 9th event goes to overCap', () => {
    const s = selectBriefableEvents(Array.from({ length: 9 }, (_, i) => ev(30 + i * 60)), NOW, 24);
    expect(s.selected).toHaveLength(8);
    expect(s.omitted.overCap).toBe(1);
  });

  it('the 40 unique-attendee cap pushes a later event into overCap without leaking its keys', () => {
    const crowd = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => person(`${prefix} Person${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`, null));
    const s = selectBriefableEvents([
      ev(30, { attendees: crowd(38, 'Alpha') }),
      ev(60, { attendees: crowd(3, 'Beta') }),
      ev(90, { attendees: [person('Alpha Personaa', null)] }), // reuses a key → still fits
    ], NOW, 24);
    expect(s.attendeesPayload).toHaveLength(38);
    expect(s.omitted.overCap).toBe(1);
    expect(s.selected.map(x => x.index)).toEqual([0, 2]);
    expect(s.selected[1].attendeeKeys).toEqual(['0:0']);
  });

  it('an attendee without a name candidate is counted as unknown and not sent; the same person on two events is sent once', () => {
    const s = selectBriefableEvents([
      ev(30, { attendees: [person(null, 'pastorjohn77@example.org'), person('Avery Testperson', 'avery@example.org')] }),
      ev(90, { attendees: [person('avery  TESTPERSON', null)] }),
    ], NOW, 24);
    expect(s.attendeesPayload).toEqual([{ key: '0:1', name: 'Avery Testperson' }]);
    expect(s.selected[0].unknownAttendees).toBe(1);
    expect(s.selected[1].attendeeKeys).toEqual(['0:1']);
    expect(s.keyIndex).toEqual({ '0:1': '0:1', '1:0': '0:1' });
  });

  it('sends no e-mail address and no raw title — only names and normalized tokens', () => {
    const s = selectBriefableEvents([
      ev(30, { title: 'Confidential: Budget Review w/ Avery!!', attendees: [person(null, 'dana.holt@example.org'), person('Avery Testperson', 'avery@example.org')] }),
    ], NOW, 24);
    const payload = JSON.stringify({ attendees: s.attendeesPayload, events: s.eventsPayload });
    expect(payload).not.toContain('@');
    expect(payload).not.toContain('Confidential: Budget Review');
    expect(payload).not.toContain('private agenda');
    expect(s.attendeesPayload.map(a => a.name)).toEqual(['dana holt', 'Avery Testperson']);
    expect(s.eventsPayload[0].titleTokens).toEqual(['confidential', 'budget', 'review', 'avery']);
  });

  it('sends no e-mail address when the display name is an address or "Name <address>"', () => {
    const s = selectBriefableEvents([
      ev(30, { attendees: [
        person('avery.testperson@example.com', 'avery.testperson@example.com'),
        person('Rowan Example <rowan@example.com>', 'rowan@example.com'),
        person('"Quinn" <quinn.sample@example.net>', null),
        person('pastorjohn77@example.org', null),
      ] }),
    ], NOW, 24);
    const payload = JSON.stringify({ attendees: s.attendeesPayload, events: s.eventsPayload });
    expect(payload).not.toContain('@');
    expect(s.attendeesPayload.map(a => a.name)).toEqual(['avery testperson', 'Rowan Example', 'Quinn']);
    expect(s.selected[0].unknownAttendees).toBe(1);
  });
});

function brief(personId: string, name: string, open = 0): PersonBrief {
  return {
    personId, name, role: null, relationshipToUser: null, headline: `h ${name}`, lastInteractionAt: null, capsule: null,
    recentMemories: [], youOwe: [], theyOwe: [], decisions: [],
    counts: { memories: 0, youOwe: open, youOweOverdue: 0, theyOwe: 0, decisions: 0 },
  };
}

describe('joinBriefs', () => {
  it('merges attendee and title matches (attendee method wins), counts ambiguous/unknown, prunes briefs', () => {
    const s = selectBriefableEvents([
      ev(30, { title: 'Coffee with Avery', attendees: [person('Avery Testperson', null), person('Sam Twin', null), person('Nobody Known', null), person(null, 'x1@example.org')] }),
      ev(90, { title: 'Solo focus', attendees: [person('Stranger Danger', null)] }),
    ], NOW, 24);
    const response: PersonBriefsResponse = {
      generatedAt: NOW.toISOString(), partial: false,
      attendeeMatches: [
        { key: '0:0', personId: 'p1', ambiguous: false, method: 'exact' },
        { key: '0:1', personId: null, ambiguous: true, method: null },
        { key: '0:2', personId: null, ambiguous: false, method: null },
        { key: '1:0', personId: null, ambiguous: false, method: null },
      ],
      titleMatches: [{ key: 'e0', personId: 'p1', method: 'title_first_name' }],
      briefs: { p1: brief('p1', 'Avery Testperson'), p9: brief('p9', 'Unreferenced Person') },
    };
    const j = joinBriefs(s.selected, s.keyIndex, response);
    expect(j.events).toHaveLength(1);
    expect(j.events[0]).toMatchObject({
      knownPeople: [{ personId: 'p1', displayName: 'Avery Testperson', method: 'exact' }],
      ambiguousAttendees: 1, unknownAttendees: 2, morePeople: 0, attendeeCount: 4,
    });
    expect(j.noKnownPeople).toBe(1);
    expect(Object.keys(j.briefs)).toEqual(['p1']);
  });

  it('caps knownPeople at 6 ordered by open items then name; morePeople is the remainder', () => {
    const names = ['Gia', 'Fay', 'Eli', 'Dov', 'Cal', 'Bea', 'Ada', 'Hal'];
    const s = selectBriefableEvents([ev(30, { attendees: names.map(n => person(`${n} Example`, null)) })], NOW, 24);
    const briefs: Record<string, PersonBrief> = {};
    names.forEach((n, i) => { briefs[`p${i}`] = brief(`p${i}`, `${n} Example`, n === 'Hal' ? 5 : 0); });
    const response: PersonBriefsResponse = {
      generatedAt: NOW.toISOString(), partial: false, titleMatches: [], briefs,
      attendeeMatches: names.map((_, i) => ({ key: `0:${i}`, personId: `p${i}`, ambiguous: false, method: 'exact' as const })),
    };
    const j = joinBriefs(s.selected, s.keyIndex, response);
    expect(j.events[0].knownPeople.map(p => p.displayName.split(' ')[0])).toEqual(['Hal', 'Ada', 'Bea', 'Cal', 'Dov', 'Eli']);
    expect(j.events[0].morePeople).toBe(2);
    expect(Object.keys(j.briefs)).toHaveLength(6);
  });
});
