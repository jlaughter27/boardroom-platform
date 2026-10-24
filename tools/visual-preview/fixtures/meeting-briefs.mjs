// RD-13 — `GET /calendar/briefs` fixture for the "Meeting prep · next 24 h"
// card. Synthetic names only; times are relative to the real clock so the
// meetings always fall inside the next 24 h.
//
// The state comes from the `rd13-briefs` cookie (shoot-meeting-briefs.mjs sets
// it per shot): connected | empty | not_connected | unavailable. Without the
// cookie the route answers `not_configured`, so the card renders nothing and
// every other lane's dashboard shots stay exactly as they were.

const NOW = Date.now();
const DAY = 86_400_000;
const HOUR = 3_600_000;
const iso = (t) => new Date(t).toISOString();
/** Next quarter-hour + offset, so the shot shows tidy times. */
const slot = (hours) => { const q = 15 * 60_000; return Math.ceil(NOW / q) * q + hours * HOUR; };

const zeros = { noKnownPeople: 0, overCap: 0, allDayOrDeclined: 0 };
const base = () => ({ generatedAt: iso(NOW), windowEnd: iso(NOW + 24 * HOUR), events: [], briefs: {}, omitted: zeros, partial: false });

const brief = (personId, name, role, headline, extra = {}) => ({
  personId, name, role, relationshipToUser: null, headline, lastInteractionAt: iso(NOW - 12 * DAY), capsule: null,
  recentMemories: [], youOwe: [], theyOwe: [], decisions: [],
  counts: { memories: 0, youOwe: 0, youOweOverdue: 0, theyOwe: 0, decisions: 0 },
  ...extra,
});

const BRIEFS = {
  'p-avery': brief('p-avery', 'Avery Testperson', 'House manager', 'You owe Avery 1 overdue · Avery owes you 2 · last touch 12d ago', {
    capsule: { summary: 'Runs the north house rota; asked twice about the van budget and wants the volunteer handbook before the spring retreat.', generatedAt: iso(NOW - 9 * DAY), stale: false },
    recentMemories: [
      { id: 'm-1', title: 'Rota call', excerpt: 'Talked through weekend cover, the van keys and who picks up the Thursday groceries.', at: iso(NOW - 12 * DAY) },
      { id: 'm-2', title: 'Budget question', excerpt: 'Avery wants a fixed monthly van allowance instead of receipts.', at: iso(NOW - 20 * DAY) },
    ],
    youOwe: [
      { id: 'c-1', description: 'Send the updated rota draft', deadline: iso(NOW - 2 * DAY), overdue: true },
      { id: 'c-2', description: 'Confirm the van allowance', deadline: iso(NOW + 3 * DAY), overdue: false },
    ],
    theyOwe: [
      { id: 't-1', title: 'Volunteer contact list', deadline: iso(NOW + 1 * DAY), status: 'in progress' },
      { id: 't-2', title: 'Room inventory', deadline: null, status: 'pending' },
    ],
    decisions: [{ id: 'd-1', title: 'Move the retreat to April', status: 'DECIDED', at: iso(NOW - 15 * DAY), via: 'project' }],
    counts: { memories: 4, youOwe: 2, youOweOverdue: 1, theyOwe: 2, decisions: 1 },
  }),
  'p-rowan': brief('p-rowan', 'Rowan Example', 'Elder', 'You owe Rowan 1 · last touch 3d ago', {
    lastInteractionAt: iso(NOW - 3 * DAY),
    youOwe: [{ id: 'c-3', description: 'Share the Q4 giving summary', deadline: null, overdue: false }],
    decisions: [{ id: 'd-2', title: 'Hire a part-time bookkeeper', status: 'OPEN', at: iso(NOW - 5 * DAY), via: 'mention' }],
    capsule: { summary: 'Prefers decisions written down before the meeting.', generatedAt: iso(NOW - 30 * DAY), stale: true },
    counts: { memories: 0, youOwe: 1, youOweOverdue: 0, theyOwe: 0, decisions: 1 },
  }),
  'p-jules': brief('p-jules', 'Jules Sample', null, 'Jules owes you 1 · no recorded interaction', {
    lastInteractionAt: null,
    theyOwe: [{ id: 't-3', title: 'Draft the newsletter', deadline: iso(NOW + 4 * DAY), status: 'pending' }],
    counts: { memories: 0, youOwe: 0, youOweOverdue: 0, theyOwe: 1, decisions: 0 },
  }),
};

const connected = () => ({
  ...base(),
  calendar: 'connected',
  events: [
    { id: 'g-1', title: 'Lunch w/ Avery', startTime: iso(slot(1)), endTime: iso(slot(2)), location: 'Corner café', attendeeCount: 1,
      knownPeople: [{ personId: 'p-avery', displayName: 'Avery Testperson', method: 'title_first_name' }], unknownAttendees: 0, ambiguousAttendees: 0, morePeople: 0 },
    { id: 'g-2', title: 'Elders & staff weekly sync', startTime: iso(slot(3.5)), endTime: iso(slot(4.5)), location: 'Room 4', attendeeCount: 7,
      knownPeople: [
        { personId: 'p-rowan', displayName: 'Rowan Example', method: 'exact' },
        { personId: 'p-jules', displayName: 'Jules Sample', method: 'name_tokens' },
      ], unknownAttendees: 3, ambiguousAttendees: 1, morePeople: 0 },
  ],
  briefs: BRIEFS,
  omitted: { noKnownPeople: 1, overCap: 0, allDayOrDeclined: 1 },
});

function stateOf(req) {
  const m = /(?:^|;\s*)rd13-briefs=([a-z_]+)/.exec(req.headers.cookie ?? '');
  return m ? m[1] : 'not_configured';
}

export default {
  routes: [
    {
      method: 'GET',
      path: '/calendar/briefs',
      handler: (req) => {
        const state = stateOf(req);
        if (state === 'connected') return { body: connected() };
        if (state === 'empty') return { body: { ...base(), calendar: 'connected' } };
        if (state === 'not_connected' || state === 'unavailable') return { body: { ...base(), calendar: state } };
        return { body: { ...base(), calendar: 'not_configured' } };
      },
    },
  ],
};
