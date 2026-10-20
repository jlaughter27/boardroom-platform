// Dashboard fixtures (viz lane): twelve weeks of realistic activity for every
// endpoint the dashboard cockpit and the Decision Lab calibration view call.
//
// All dates are generated relative to the real clock, because the dashboard
// buckets by "this week" in the browser. Seeded, so two shots agree.
//
// Loaded by mock-api.mjs like any other fixture; shoot-dashboard.mjs mounts
// these routes FIRST so they win over the shell defaults in auth.mjs.

const SEED = Number(process.env.VISUAL_PREVIEW_SEED ?? 11);
const DAY = 86_400_000;
const NOW = Date.now();
const USER_ID = 'u-josh';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rand = rng(SEED);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const weighted = (pairs) => { const r = rand() * pairs.reduce((a, [, w]) => a + w, 0); let acc = 0; for (const [v, w] of pairs) { acc += w; if (r <= acc) return v; } return pairs[pairs.length - 1][0]; };
const iso = (t) => new Date(t).toISOString();
const startOfUtcDay = (t) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const startOfUtcWeek = (t) => { const d = startOfUtcDay(t); const dow = (new Date(d).getUTCDay() + 6) % 7; return d - dow * DAY; };
const ok = (body) => ({ body });
const paged = (items) => ({ items, total: items.length, limit: items.length, offset: 0 });

// ── People ──────────────────────────────────────────────────────────────────
const PEOPLE = [
  ['p-ava', 'Ava Chen', 'Design partner'], ['p-ben', 'Ben Okafor', 'Advisor'], ['p-priya', 'Priya Natarajan', 'First customer'],
  ['p-marcus', 'Marcus Lee', 'Accountant'], ['p-dana', 'Dana Whitfield', 'Pastor'], ['p-sam', 'Sam Ortiz', 'Contractor'],
].map(([id, name, role], i) => ({
  id, userId: USER_ID, name, role, domains: [i === 4 ? 'ministry' : i === 3 ? 'personal' : 'business'], importance: 3 + (i % 3),
  relationshipToUser: role.toLowerCase(), lastContactAt: iso(NOW - (i + 1) * 3 * DAY), interactionFrequency: 'weekly',
  createdAt: iso(NOW - 200 * DAY), updatedAt: iso(NOW - DAY),
}));

// ── Memories: 12 weeks, weekday rhythm, a quiet week 8 and a busy run-up ─────
const WEEKS = 12;
const WEEK0 = startOfUtcWeek(NOW) - (WEEKS - 1) * 7 * DAY;
const DOW_WEIGHT = [1.0, 1.25, 1.1, 1.0, 0.85, 0.3, 0.15];
const TITLES = {
  business: ['Consultants pay for the memory, founders pay for the personas', 'Annual plans convert 2× when framed as a retainer', 'Product Hunt traffic converts poorly without onboarding', 'Partners want white-label exports', 'The newsletter drives most trial sign-ups', 'Priya wants the weekly memo emailed', 'Pricing page bounce is highest on mobile', 'Ben: raise only after 20 paying', 'Support load spikes after each cortex run'],
  personal: ['Mornings before 9 are the only deep-work window', 'Running three times a week keeps the evenings calm', 'Say no to Thursday calls', 'Marcus needs Q3 receipts by the 25th', 'Weekend screens off worked'],
  ministry: ['Youth group wants a Saturday slot', 'Dana prefers decisions by consensus', 'Benevolence fund review each quarter', 'Volunteer roster thin in November'],
};
const memories = [];
let mi = 0;
for (let w = 0; w < WEEKS; w++) {
  const ramp = 5 + w * 0.8;
  const base = w === 7 ? 2 : ramp;
  for (let d = 0; d < 7; d++) {
    const dayStart = WEEK0 + w * 7 * DAY + d * DAY;
    if (dayStart > NOW) continue;
    const expected = (base * DOW_WEIGHT[d]) / 4.65;
    let n = Math.floor(expected);
    if (rand() < expected - n) n += 1;
    if (w === WEEKS - 1 && d === (new Date(NOW).getUTCDay() + 6) % 7) n = Math.max(n, 3);
    for (let k = 0; k < n; k++) {
      const t = dayStart + (8 + rand() * 13) * 3_600_000;
      if (t > NOW) continue;
      const domain = weighted([['business', 0.6], ['personal', 0.28], ['ministry', 0.12]]);
      const memoryClass = weighted([['SEMANTIC', 0.4], ['EPISODIC', 0.3], ['WORKING', 0.18], ['DECISION', 0.12]]);
      memories.push({
        id: `mem-${String(++mi).padStart(3, '0')}`, userId: USER_ID,
        title: pick(TITLES[domain]), content: 'Captured during a BoardRoom session.',
        domain, sector: domain === 'business' ? 'saas' : domain, tags: [domain, memoryClass.toLowerCase()],
        memoryClass, importance: 3 + Math.floor(rand() * 7), confidence: pick(['HIGH', 'MEDIUM', 'MEDIUM', 'LOW']), status: 'CONFIRMED',
        validAt: iso(t), invalidAt: null, supersededBy: null,
        sourceType: pick(['BOARDROOM_SESSION', 'BOARDROOM_SESSION', 'MANUAL', 'MCP_AGENT']), sourceRef: null, sourceWeight: 1, version: 1,
        metadata: {}, createdAt: iso(t), updatedAt: iso(t), lastAccessedAt: null, agentId: 'boardroom-ai', tenantId: domain === 'ministry' ? 'tgfc-ministry' : domain === 'personal' ? 'josh-personal' : 'josh-business',
      });
    }
  }
}
memories.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

function listMemories(_req, url) {
  const p = url.searchParams;
  const limit = Math.min(100, Number(p.get('limit') ?? 20)); const offset = Number(p.get('offset') ?? 0);
  let rows = memories;
  if (p.get('since')) { const s = Date.parse(p.get('since')); rows = rows.filter((m) => Date.parse(m.createdAt) >= s); }
  if (p.get('domain')) rows = rows.filter((m) => m.domain === p.get('domain'));
  if (p.get('memoryClass')) rows = rows.filter((m) => m.memoryClass === p.get('memoryClass'));
  const q = (p.get('q') ?? '').toLowerCase();
  if (q) rows = rows.filter((m) => m.title.toLowerCase().includes(q));
  if (p.get('sortOrder') === 'asc') rows = [...rows].reverse();
  return ok({ items: rows.slice(offset, offset + limit), total: rows.length, offset, limit });
}

// ── Commitments: a 14-day horizon with a few overdue and a few beyond ────────
const COMMITMENTS = [
  ['Send Priya the revised retainer proposal', 'p-priya', -9], ['Return Ben\'s call about the bridge round', 'p-ben', -3], ['Submit Q3 receipts', 'p-marcus', -1],
  ['Ship the memo e-mail digest', 'p-priya', 0], ['Review Ava\'s onboarding redesign', 'p-ava', 0], ['Confirm Saturday youth slot', 'p-dana', 1],
  ['Draft white-label export spec', 'p-ava', 2], ['Pay Sam for the deck install', 'p-sam', 3], ['Pricing page mobile fix live', 'p-ava', 5],
  ['Board update to Ben', 'p-ben', 6], ['Benevolence fund quarterly review', 'p-dana', 8], ['Call three churned trials', null, 9],
  ['Newsletter: cortex launch issue', 'p-priya', 11], ['Volunteer roster for November', 'p-dana', 13],
  ['Renew the design-partner agreement', 'p-ava', 20], ['Annual plan experiment read-out', 'p-ben', 34],
  ['Intro Priya to Marcus', 'p-priya', -12, 'COMPLETED'], ['Send Dana the slides', 'p-dana', -6, 'COMPLETED'],
];
const commitments = COMMITMENTS.map(([description, stakeholderId, offset, status = 'OPEN'], i) => {
  const deadline = startOfUtcDay(NOW) + offset * DAY + 17 * 3_600_000;
  return {
    id: `c-${i + 1}`, userId: USER_ID, description, stakeholderId, deadline: iso(deadline), status,
    sourceSessionId: null, linkedProjectId: null, createdAt: iso(deadline - (10 + i) * DAY), completedAt: status === 'COMPLETED' ? iso(deadline - DAY) : null,
  };
});
const openWithin = (lo, hi) => commitments.filter((c) => c.status === 'OPEN' && (Date.parse(c.deadline) - startOfUtcDay(NOW)) / DAY >= lo && (Date.parse(c.deadline) - startOfUtcDay(NOW)) / DAY < hi);
const nudges = { overdue: openWithin(-999, 0), dueSoon: openWithin(0, 4) };

// ── Decisions, sessions, outcome reviews ────────────────────────────────────
const DECISION_TITLES = ['Pause the Atlas migration', 'Raise prices for new sign-ups', 'Hire a part-time designer', 'Drop the free tier', 'Move the newsletter to Tuesday', 'Open-source the MCP server', 'Sponsor the local founders meetup', 'Switch accountants', 'Run a premortem on the annual plan', 'Cut the white-label scope', 'Offer a consultants cohort', 'Decline the agency partnership'];
const decisions = [];
const sessions = [];
for (let i = 0; i < 22; i++) {
  const t = NOW - Math.floor(rand() * 82) * DAY - rand() * 12 * 3_600_000;
  const title = DECISION_TITLES[i % DECISION_TITLES.length];
  const sessionId = `s-${i + 1}`;
  decisions.push({
    id: `d-${i + 1}`, userId: USER_ID, title, question: `Should we ${title.toLowerCase()}?`, options: [], chosenPath: pick(['Yes, this quarter', 'Not yet', 'Yes, scoped down']),
    rationale: 'Synthesis from the board.', assumptions: [], constraints: [], status: 'DECIDED', reviewAt: iso(t + 30 * DAY), outcome: null, outcomeRating: null,
    sessionId, probabilitySuccess: 0.55 + rand() * 0.35, expectedOutcome: 'Retention holds while ARPU rises.', personaForecasts: [], decidedAt: iso(t), mode: pick(['decide', 'decide', 'premortem', 'plan']),
    version: 1, createdAt: iso(t - 3_600_000), updatedAt: iso(t),
  });
  sessions.push({ id: sessionId, question: `Should we ${title.toLowerCase()}?`, mode: 'decide', personaCount: 7, hasSynthesis: true, createdAt: iso(t - 3_600_000) });
}
decisions.sort((a, b) => Date.parse(b.decidedAt) - Date.parse(a.decidedAt));
sessions.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

const pendingReviews = [
  { id: 'n-1', userId: USER_ID, decisionId: 'd-9', decisionTitle: 'Raise prices for new sign-ups', nudgeType: '30_day', scheduledFor: iso(NOW - 12 * DAY), sentAt: iso(NOW - 12 * DAY), completedAt: null, status: 'sent' },
  { id: 'n-2', userId: USER_ID, decisionId: 'd-4', decisionTitle: 'Drop the free tier', nudgeType: '90_day', scheduledFor: iso(NOW - 2 * DAY), sentAt: iso(NOW - 2 * DAY), completedAt: null, status: 'sent' },
  { id: 'n-3', userId: USER_ID, decisionId: 'd-2', decisionTitle: 'Pause the Atlas migration', nudgeType: '30_day', scheduledFor: iso(NOW), sentAt: null, completedAt: null, status: 'pending' },
];

// ── Calibration: 27 reviewed, slightly over-confident at the top end ────────
const bin = (lower, count, meanForecast, observedRate) => ({ lower, upper: lower + 0.2, count, meanForecast, observedRate });
const calibration = {
  reviewedDecisions: 27, minimumForSignal: 20, successThreshold: 4,
  user: { brier: 0.182, bins: [bin(0, 2, 0.12, 0.0), bin(0.2, 4, 0.31, 0.25), bin(0.4, 8, 0.52, 0.5), bin(0.6, 8, 0.69, 0.5), bin(0.8, 5, 0.88, 0.6)] },
  personas: {
    critic: { brier: 0.21, count: 24, bins: [bin(0, 5, 0.14, 0.2), bin(0.2, 8, 0.3, 0.38), bin(0.4, 7, 0.49, 0.57), bin(0.6, 3, 0.66, 0.67), bin(0.8, 1, 0.82, 1)] },
    optimist: { brier: 0.27, count: 22, bins: [bin(0, 0, 0, 0), bin(0.2, 1, 0.38, 0), bin(0.4, 3, 0.55, 0.33), bin(0.6, 8, 0.71, 0.5), bin(0.8, 10, 0.9, 0.6)] },
    technician: { brier: 0.16, count: 9, bins: [bin(0, 1, 0.1, 0), bin(0.2, 2, 0.3, 0.5), bin(0.4, 3, 0.5, 0.33), bin(0.6, 2, 0.7, 1), bin(0.8, 1, 0.85, 1)] },
    doer: { brier: 0.2, count: 3, bins: [bin(0, 0, 0, 0), bin(0.2, 0, 0, 0), bin(0.4, 1, 0.5, 1), bin(0.6, 2, 0.7, 0.5), bin(0.8, 0, 0, 0)] },
  },
};

// ── LLM usage (admin) ───────────────────────────────────────────────────────
function usageSummary(_req, url) {
  const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days') ?? 7)));
  const byDay = [];
  let total = 0; let calls = 0;
  for (let i = days - 1; i >= 0; i--) {
    const t = startOfUtcDay(NOW) - i * DAY;
    const dayRand = rng(SEED * 1000 + Math.floor(t / DAY)); // same day → same numbers, whatever the window
    const dow = (new Date(t).getUTCDay() + 6) % 7;
    const c = Math.round((6 + Math.floor(dayRand() * 9)) * DOW_WEIGHT[dow] * (1 + ((days - i) / days) * 0.6));
    const usd = +(c * (0.09 + dayRand() * 0.16)).toFixed(3);
    total += usd; calls += c;
    byDay.push({ date: new Date(t).toISOString().slice(0, 10), usd, calls });
  }
  const share = (f) => +(total * f).toFixed(3);
  return ok({
    days, totalUsd: +total.toFixed(3), byDay,
    byPurpose: [
      { purpose: 'persona.dispatch', usd: share(0.46), calls: Math.round(calls * 0.42), cacheHitRate: 0.71 },
      { purpose: 'ceo.synthesis', usd: share(0.22), calls: Math.round(calls * 0.09), cacheHitRate: 0.64 },
      { purpose: 'memory.extract', usd: share(0.17), calls: Math.round(calls * 0.3), cacheHitRate: 0.38 },
      { purpose: 'cortex.memo', usd: share(0.09), calls: Math.round(calls * 0.05), cacheHitRate: 0.52 },
      { purpose: 'sufficiency.check', usd: share(0.06), calls: Math.round(calls * 0.14), cacheHitRate: 0.8 },
    ],
    byModel: [
      { model: 'claude-sonnet-5-5', usd: share(0.79), calls: Math.round(calls * 0.56), inputTokens: Math.round(calls * 5200), outputTokens: Math.round(calls * 900) },
      { model: 'claude-haiku-4-5', usd: share(0.21), calls: Math.round(calls * 0.44), inputTokens: Math.round(calls * 3100), outputTokens: Math.round(calls * 400) },
    ],
  });
}

// ── Weekly memo + cortex ────────────────────────────────────────────────────
const weekStart = startOfUtcWeek(NOW) - 7 * DAY;
const memo = {
  id: 'memo-1', userId: USER_ID, weekStart: iso(weekStart), weekEnd: iso(weekStart + 6 * DAY),
  decisionsMade: 3, decisionsByCategory: { pricing: 2, hiring: 1 },
  patternsNoticed: ['You anchor on the first number Ben mentions', 'Pricing decisions get revisited within 10 days'],
  activeContradictions: ['"No new scope this quarter" vs. the white-label export spec'],
  upcomingPressurePoints: ['review: Raise prices for new sign-ups', 'Q3 receipts are due in 5 days'],
  thinkingQualityScore: 7.4, scoreChange: 0.6,
  recommendedFocus: ['Close the pricing decision before the cohort launch', 'Hand the youth-slot call to Dana'],
  fullMemoText: 'Three decisions this week, two about pricing. The board disagreed most on the free tier; the CEO synthesis leaned on the Critic. Your forecasts ran hot again at the top end.',
  generatedAt: iso(NOW - 2 * 3_600_000), itemStates: {},
};

// Cortex lists — the stores read `items`/`total` (auth.mjs's `patterns:`/`alerts:` keys leave them undefined).
const patterns = [
  { id: 'pat-1', userId: USER_ID, pattern: 'You anchor on the first number Ben mentions', patternType: 'BIAS', evidenceCount: 6, confidence: 0.78, firstDetected: iso(NOW - 40 * DAY), lastDetected: iso(NOW - 3 * DAY), trend: 'stable', createdAt: iso(NOW - 40 * DAY), updatedAt: iso(NOW - 3 * DAY) },
  { id: 'pat-2', userId: USER_ID, pattern: 'Pricing decisions get revisited within 10 days', patternType: 'BEHAVIORAL_CYCLE', evidenceCount: 4, confidence: 0.66, firstDetected: iso(NOW - 25 * DAY), lastDetected: iso(NOW - 6 * DAY), trend: 'improving', createdAt: iso(NOW - 25 * DAY), updatedAt: iso(NOW - 6 * DAY) },
];
const contradictions = [
  { id: 'con-1', userId: USER_ID, description: '"No new scope this quarter" vs. the white-label export spec', entityA: { type: 'decision', id: 'd-10', title: 'Cut the white-label scope' }, entityB: { type: 'commitment', id: 'c-7', title: 'Draft white-label export spec' }, severity: 'medium', status: 'ACTIVE', detectedAt: iso(NOW - 2 * DAY), resolvedAt: null, resolution: null },
];
const listOf = (items) => (_req, url) => { const limit = Number(url.searchParams.get('limit') ?? 20); const offset = Number(url.searchParams.get('offset') ?? 0); return ok({ items: items.slice(offset, offset + limit), total: items.length, offset, limit }); };

const user = { id: USER_ID, email: 'josh@example.com', name: 'Josh', isAdmin: true, createdAt: '2026-01-05T00:00:00.000Z' };

export const fixtureData = { memories, commitments, nudges, decisions, sessions, pendingReviews, calibration, memo, people: PEOPLE };

export default {
  routes: [
    { method: 'GET', path: '/auth/me', handler: () => ok(user) },
    { method: 'GET', path: '/memories', handler: listMemories },
    { method: 'GET', path: '/people', handler: () => ok(paged(PEOPLE)) },
    { method: 'GET', path: '/commitments', handler: () => ok(paged(commitments)) },
    { method: 'GET', path: '/commitments/nudges', handler: () => ok(nudges) },
    { method: 'PATCH', path: /^\/commitments\/([^/]+)$/, handler: (req, _url, m) => { const c = commitments.find((x) => x.id === m[1]); if (c) Object.assign(c, req.json ?? {}); return ok(c ?? {}); } },
    { method: 'GET', path: '/decisions', handler: () => ok(paged(decisions)) },
    { method: 'GET', path: /^\/decisions\/calibration/, handler: () => ok(calibration) },
    { method: 'GET', path: '/outcome-reviews/pending', handler: () => ok(pendingReviews) },
    { method: 'GET', path: /^\/sessions(\?.*)?$/, handler: () => ok({ items: sessions, total: sessions.length, limit: 50, offset: 0 }) },
    { method: 'GET', path: /^\/usage\/llm\/summary/, handler: usageSummary },
    { method: 'GET', path: '/cortex/memo/latest', handler: () => ok(memo) },
    { method: 'GET', path: /^\/cortex\/patterns/, handler: listOf(patterns) },
    { method: 'GET', path: /^\/cortex\/contradictions/, handler: listOf(contradictions) },
    { method: 'GET', path: /^\/calendar\/events/, handler: () => ok([]) },
  ],
};
