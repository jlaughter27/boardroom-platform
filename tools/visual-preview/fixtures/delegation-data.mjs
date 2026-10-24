// RD-12 delegation fixtures (helper module: exports no `routes`, so mock-api.mjs
// skips it; fixtures/pages.mjs mounts `delegationRoutes` first so they win over
// dashboard.mjs). Invented names only.
//
//   /?state=delegations          → the nudges widget also shows "Waiting on others"
//   /decisions/s-delegate        → a committed decision: Next Actions carry Delegate
//   /decisions/s-visual          → uncommitted: "Commit the decision to delegate its actions."
//
// Every other page keeps the dashboard's own nudges / decisions unchanged.

import { fixtureData } from './dashboard.mjs';

const DAY = 86_400_000;
const NOW = Date.now();
const USER_ID = 'u-josh';
const iso = (t) => new Date(t).toISOString();
/** End of the UTC day `offset` days from today — how BoardRoom stores a picked date. */
const endOfUtcDayFromNow = (offset) => { const d = new Date(NOW + offset * DAY); return `${d.toISOString().slice(0, 10)}T23:59:59.999Z`; };
const paged = (items) => ({ items, total: items.length, limit: items.length, offset: 0 });
const refererHas = (req, s) => String(req.headers?.referer ?? '').includes(s);

const delegation = (id, description, personId, personName, offset) => ({
  id, userId: USER_ID, description, stakeholderId: personId, deadline: endOfUtcDayFromNow(offset), status: 'OPEN',
  sourceSessionId: null, linkedProjectId: null, createdAt: iso(NOW - 6 * DAY), completedAt: null,
  owedBy: 'STAKEHOLDER', stakeholderName: personName,
});

export const delegations = {
  overdue: [
    delegation('del-1', 'Send the volunteer rota for the harvest fair', 'p-sam', 'Sam Ortiz', -2),
    delegation('del-2', 'Signed contractor quote for the deck repair', 'p-ben', 'Ben Okafor', -1),
  ],
  dueSoon: [
    delegation('del-3', 'Draft the onboarding e-mail copy', 'p-ava', 'Ava Chen', 0),
    delegation('del-4', 'Book the community hall for March', 'p-priya', 'Priya Natarajan', 2),
  ],
};

const withOwedBy = (rows) => rows.map((c) => ({ owedBy: 'USER', stakeholderName: fixtureData.people.find((p) => p.id === c.stakeholderId)?.name ?? null, ...c }));
const baseNudges = () => ({ overdue: withOwedBy(fixtureData.nudges.overdue), dueSoon: withOwedBy(fixtureData.nudges.dueSoon) });

export const committedDecision = {
  id: 'd-delegate', userId: USER_ID, title: 'Harvest fair format', question: 'Should the harvest fair move to a single Saturday in March?',
  options: [], chosenPath: 'One Saturday in March, outdoors, with a rain plan', rationale: 'More volunteers are free in March and the outdoor space doubles capacity.',
  assumptions: [], constraints: [], status: 'DECIDED', reviewAt: iso(NOW + 30 * DAY), outcome: null, outcomeRating: null, sessionId: 's-delegate',
  probabilitySuccess: 0.7, expectedOutcome: '80 families attend and no one waits more than 10 minutes at check-in.', personaForecasts: [],
  decidedAt: iso(NOW - DAY), mode: 'decide', version: 1, createdAt: iso(NOW - DAY), updatedAt: iso(NOW - DAY),
};

/** A committed copy of the s-visual session, with fair-themed Next Actions. */
export function delegateSession(base) {
  return {
    ...base,
    id: 's-delegate',
    question: committedDecision.question,
    decisionId: committedDecision.id,
    ceoSynthesis: {
      ...base.ceoSynthesis,
      recommendation: 'Run the fair on one Saturday in March, outdoors, with the hall booked as the rain plan.',
      nextActions: [
        'Send the volunteer rota to every team lead',
        'Book the community hall as the rain plan',
        'Ask the youth group to run check-in',
      ],
    },
  };
}

export function delegationRoutes(baseSession) {
  const session = delegateSession(baseSession);
  return [
    { method: 'GET', path: '/commitments/nudges', handler: (req) => {
      const n = baseNudges();
      return { body: refererHas(req, 'state=delegations') ? { overdue: [...delegations.overdue, ...n.overdue], dueSoon: [...delegations.dueSoon, ...n.dueSoon] } : n };
    } },
    { method: 'POST', path: '/commitments', handler: (req) => ({ status: 201, body: { id: 'c-new', userId: USER_ID, status: 'OPEN', createdAt: iso(NOW), completedAt: null, sourceSessionId: null, ...(req.json ?? {}) } }) },
    { method: 'POST', path: '/people', handler: (req) => ({ status: 201, body: { id: 'p-new', userId: USER_ID, role: null, domains: [], ...(req.json ?? {}) } }) },
    { method: 'GET', path: '/sessions/s-delegate', handler: () => ({ body: session }) },
    { method: 'GET', path: '/decisions', handler: (req) => ({ body: paged(refererHas(req, 's-delegate') ? [committedDecision, ...fixtureData.decisions] : fixtureData.decisions) }) },
  ];
}
