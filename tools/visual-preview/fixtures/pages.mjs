// Page fixtures for the polish lane (shoot-pages.mjs): a full user profile so
// Settings renders its sliders, and one finished decision session with six
// persona responses and a CEO synthesis for the decision-session shots.
//
// shoot-pages.mjs mounts these routes FIRST, ahead of dashboard.mjs and the
// shell defaults in auth.mjs, so they win where paths overlap (`/profile`).

import graphFixture from './graph.mjs';

const USER_ID = 'u-josh';
const NOW = Date.now();
const DAY = 86_400_000;
const iso = (t) => new Date(t).toISOString();
const ok = (body) => () => ({ body });

const profile = {
  id: 'up-1',
  userId: USER_ID,
  onboardingComplete: true,
  displayName: 'Josh',
  role: 'Founder & CEO',
  industry: 'B2B SaaS',
  decisionFrequency: 'Several times a week',
  timezone: 'America/New_York',
  businessContext: 'Solo founder building BoardRoom AI.',
  riskProfile: { financial: 0.35, technical: 0.7, people: 0.5, strategic: 0.62 },
  valueHierarchy: ['Customer trust', 'Sustainable pace', 'Craft'],
  goals: [],
  createdAt: '2026-01-05T00:00:00.000Z',
  updatedAt: iso(NOW - 3 * DAY),
};

const persona = (personaId, situationReading, analysis, recommendation, confidence, extra = {}) => ({
  personaId,
  situationReading,
  keyAssumptions: ['Usage-based pricing is understood by the ICP', 'Support load scales sub-linearly with seats'],
  analysis,
  recommendation,
  uncertainties: ['How many design-partner accounts convert at the new price', 'Whether annual prepay survives the change'],
  sourceMemoryIds: ['m-pricing-1', 'm-churn-2'],
  confidence,
  dissentFlag: false,
  ...extra,
});

export const personaResponses = {
  optimist: persona('optimist',
    'Three of five design partners asked for a per-seat plan unprompted. Demand is pulling you there.',
    'Per-seat pricing turns every new hire at a customer into revenue without a sales conversation. Current usage caps are the main reason trials stall in week two, and the seat model removes the cap conversation entirely. The expansion motion becomes automatic.',
    'Move to per-seat with a generous first tier and announce it to design partners this month.', 0.78),
  critic: persona('critic',
    'Two of your largest accounts have one power user and twenty viewers. Per-seat punishes exactly that shape.',
    'Seat pricing invites seat-sharing and viewer tiers you then have to police. The accounts most at risk are the ones that currently pay the most on usage. Churn risk concentrates where revenue concentrates, and the switching cost lands during the Q1 renewal window.',
    'Do not switch wholesale. Pilot a viewer/editor split with the two largest accounts before touching the public price page.', 0.71, { dissentFlag: true }),
  alternate: persona('alternate',
    'The real question is not seats versus usage; it is what the customer thinks they are buying.',
    'A hybrid — a platform fee plus usage above an included allowance — keeps the predictable line item finance teams want while preserving the expansion curve. It also sidesteps the viewer problem because viewers cost nothing to include.',
    'Price the platform, meter the analysis. Platform fee per workspace, included decisions per month, overage above that.', 0.66),
  technician: persona('technician',
    'Billing is on Stripe metered subscriptions today; seat counts need entitlement checks the app does not have.',
    'A seat model needs invite gating, seat reclamation and proration on every membership change — roughly three weeks of work plus a migration for 41 existing subscriptions. The hybrid model reuses the metered pipeline and adds one fixed line item, which is a day.',
    'If pricing changes, change it to something the metered pipeline already supports. Hybrid is cheap; pure per-seat is not.', 0.82),
  questionnaire: persona('questionnaire',
    'Nobody has asked the design partners what they would pay for the viewer tier.',
    'Which accounts expand by adding people versus by running more sessions? What is the current ratio of editors to viewers across all workspaces? Has any churned account cited price? Which answer would change the decision?',
    'Run the three-question survey with the five design partners before committing; the answers decide between seat and hybrid.', 0.6),
  doer: persona('doer',
    'Whatever the model, the renewal window closes in six weeks and the price page is the long pole.',
    'Week 1: survey and seat/viewer ratio pull. Week 2: decide model, draft price page. Week 3–4: billing changes (hybrid: one line item; seat: entitlements). Week 5: grandfather letters to existing accounts. Week 6: ship ahead of renewals.',
    'Commit to a model by end of week two and grandfather every existing account for twelve months.', 0.74),
};

const ceoSynthesis = {
  disagreementMap: 'Optimist and Doer favour a fast move to per-seat; Critic and Technician warn the largest accounts and the billing pipeline are not shaped for it; Alternate and Questionnaire reframe toward a platform-plus-usage hybrid pending two data points.',
  decisiveTradeoff: 'Expansion that happens by itself (per-seat) versus revenue that stays where it already is (usage). The hybrid keeps most of the first without risking the second.',
  recommendation: 'Adopt platform-plus-usage pricing: a workspace fee with included decisions per month and metered overage. Grandfather existing accounts for twelve months and ship before the Q1 renewal window.',
  nextActions: [
    'Pull editor/viewer ratios for all 41 workspaces this week.',
    'Survey the five design partners with the three questions the Questionnaire raised.',
    'Draft the new price page and the grandfathering letter.',
    'Add the platform line item to the metered Stripe pipeline (Technician estimate: one day).',
  ],
  topRisks: ['Largest two accounts read the change as a price rise', 'Included allowance set too low stalls trials again', 'Renewal window slips past Q1'],
  assumptionsToMonitor: [
    { assumption: 'Finance teams prefer a predictable platform fee over pure usage', reviewAt: iso(NOW + 45 * DAY), confidence: 'MEDIUM' },
    { assumption: 'Viewers cost nothing material to include', reviewAt: iso(NOW + 90 * DAY), confidence: 'HIGH' },
  ],
  sourceMemoryIds: ['m-pricing-1', 'm-churn-2', 'm-stripe-3'],
  ledgerResolutions: [
    { claim: 'Per-seat pricing will punish the two largest accounts.', resolution: 'Accepted — the hybrid keeps viewers free, which removes the seat-sharing incentive the Critic described.' },
  ],
  droppedConsiderations: ['m-annual-prepay'],
};

const session = {
  id: 's-visual',
  question: 'Should we move from usage-based to per-seat pricing before the Q1 renewals?',
  mode: 'decide',
  personaResponses,
  ceoSynthesis,
  sufficiencyScore: null,
  decisionId: null,
  createdAt: iso(NOW - 2 * DAY),
};

// ── Connected AI tools (Settings) ────────────────────────────────────────────
// "token-created-long-url" (M1-D3): when the page was opened with
// `?state=token-created-long-url` (the browser sends it as the Referer), the
// connect-info carries a very long MCP URL and the minted token is long too, so
// the one-time reveal holds the longest unbreakable lines the page can show.
// Every other page keeps the default "URL not configured" connect-info.
const LONG_URL_STATE = 'token-created-long-url';
const isLongUrlState = (req) => String(req.headers?.referer ?? '').includes(LONG_URL_STATE);
const LONG_MCP_URL = 'https://omnimind-mcp-production-eu-west-2.up.railway.app/mcp/v1/tenants/josh-business-strategy-and-architecture/streamable-http?session_hint=long-url-overflow-check';
const mcpOptions = {
  tenants: [{ id: 'josh-business', name: 'Business' }, { id: 'josh-personal', name: 'Personal' }],
  scopes: [
    { id: 'memory:read', description: 'Search and read memory', write: false },
    { id: 'memory:write', description: 'Write memories', write: true },
    { id: 'decision:write', description: 'Log decisions', write: true },
    { id: 'task:write', description: 'Create and update tasks', write: true },
  ],
};
// ── Vault-imported memories (RD-1) ───────────────────────────────────────────
// Synthetic notes shaped like an Obsidian import (markdown body, metadata.vault,
// wikilink link rows) for the Memory Detail markdown shots. Searching
// "pricing playbook" in Memory Explorer returns the three listed notes; every
// other query falls through to the graph fixture's hybrid search.
//   [[pricing/Annual prepay terms]] → resolves through a `wikilink` link row; the target is NOT in the list (fetched by id)
//   [[Design partners|our design partners]] → labelled; resolves by title among listed memories
//   [[Competitor teardown]] → never imported: muted "Not imported"
//   Q3 pricing retro links to the playbook → the playbook's "Linked from"
const vaultMemory = (id, title, path, content, extra = {}) => ({
  id, userId: USER_ID, title, content, domain: 'business', sector: null, memoryClass: 'SEMANTIC', confidence: 'HIGH', status: 'CONFIRMED',
  importance: 0.7, sourceType: 'API_IMPORT', sourceRef: `vault:${path}`, sourceWeight: 1, version: 1, validAt: iso(NOW - 30 * DAY), invalidAt: null,
  supersededBy: null, tags: ['vault', 'vault:note', 'pricing'], createdAt: iso(NOW - 30 * DAY), updatedAt: iso(NOW - 2 * DAY), lastAccessedAt: null,
  metadata: { vault: { path, type: 'note', status: 'active', aliases: [], links: [] } },
  ...extra,
});
const VAULT_PLAYBOOK = vaultMemory('m-vault-playbook', 'Pricing playbook', 'pricing/Pricing playbook.md', [
  '# Pricing playbook',
  '',
  'How we price **BoardRoom** for solo founders. Owner: _Josh_ — reviewed after the Q3 retro.',
  '',
  '## Principles',
  '',
  '- Lead with **annual prepay**; the terms live in [[pricing/Annual prepay terms]].',
  '- Pilot every change with [[Design partners|our design partners]] before the public page.',
  '- Never undercut on price — [[Competitor teardown]] has the numbers.',
  '',
  '## Tiers',
  '',
  '| Tier | Monthly | Annual (per month) | Seats | Decisions / month | Support | Notes |',
  '|------|--------:|-------------------:|:-----:|------------------:|---------|-------|',
  '| Starter | $29 | $24 | 1 | 40 | Email, 2 business days | Default for solo founders |',
  '| Team | $99 | $82 | 5 | 250 | Email + chat, same day | Where most design partners land |',
  '| Studio | $249 | $207 | 15 | Unlimited | Named contact | Annual only; invoice billing |',
  '',
  '> Keep the price page to three tiers. Every extra tier costs a week of support questions.',
  '',
  '### Rollout checklist',
  '',
  '1. Update `PRICE_IDS` in the billing config.',
  '2. Email design partners a week ahead.',
  '3. Flip the page.',
  '',
  '- [x] Draft the announcement',
  '- [ ] Confirm proration with Stripe',
].join('\n'), { importance: 0.9 });
const VAULT_PARTNERS = vaultMemory('m-vault-partners', 'Design partners', 'customers/Design partners.md',
  'Five accounts on the **Team** tier who see pricing changes first.\n\n- Two agencies\n- Three solo consultants');
const VAULT_RETRO = vaultMemory('m-vault-retro', 'Q3 pricing retro', 'retros/Q3 pricing retro.md',
  '## What changed\n\nAnnual prepay converted at **31%**. Folded the lessons into [[Pricing playbook]].');
const VAULT_PREPAY = vaultMemory('m-vault-prepay', 'Annual prepay terms', 'pricing/Annual prepay terms.md',
  '# Annual prepay terms\n\nTwo months free on annual plans. Refunds are **pro-rated** in the first 30 days.\n\n| Plan | Discount |\n|---|---:|\n| Team | 17% |\n| Studio | 17% |\n\nBack to [[Pricing playbook]].');
const VAULT = new Map([VAULT_PLAYBOOK, VAULT_PARTNERS, VAULT_RETRO, VAULT_PREPAY].map((m) => [m.id, m]));
const VAULT_LINKS = {
  'm-vault-playbook': [{ id: 'vl-1', memoryId: 'm-vault-playbook', entityType: 'memory', entityId: 'm-vault-prepay', linkType: 'wikilink' }],
  'm-vault-retro': [{ id: 'vl-2', memoryId: 'm-vault-retro', entityType: 'memory', entityId: 'm-vault-playbook', linkType: 'wikilink' }],
  'm-vault-prepay': [{ id: 'vl-3', memoryId: 'm-vault-prepay', entityType: 'memory', entityId: 'm-vault-playbook', linkType: 'wikilink' }],
};
const backlinksOf = (id) => Object.values(VAULT_LINKS).flat().filter((l) => l.entityId === id).map((l) => {
  const m = VAULT.get(l.memoryId);
  return { memoryId: m.id, title: m.title, domain: m.domain, status: m.status, linkTypes: [l.linkType] };
}).sort((a, b) => a.title.localeCompare(b.title));
const graphSearch = graphFixture.routes.find((r) => r.method === 'POST' && r.path === '/memories/search').handler;
const vaultSearch = (req, url, m) => {
  if (!/pricing playbook/i.test(String(req.json?.query ?? ''))) return graphSearch(req, url, m);
  const rows = [VAULT_PLAYBOOK, VAULT_PARTNERS, VAULT_RETRO].map((r, i) => ({ ...r, score: [0.94, 0.61, 0.58][i], layers: i === 0 ? ['fulltext', 'trigram'] : ['fulltext'] }));
  return { body: { items: rows, nextCursor: null } };
};

const mintedToken = (req) => ({
  token: `omt_${'9f3c2a7be14d58a0c6b2e91f47d3a8c5'.repeat(3)}`,
  record: {
    id: 'tok_visual_long', userId: USER_ID, tenantId: req.json?.tenantId ?? 'josh-business', name: req.json?.name ?? 'Claude Code',
    agentName: 'mcp-token:claude-code-on-the-studio-mac-mini-tok_visual_long', prefix: 'omt_9f3c2a7b', scopes: req.json?.scopes ?? ['memory:read'],
    sourceWeight: 1, createdAt: iso(NOW), lastUsedAt: null, expiresAt: iso(NOW + 365 * DAY), revokedAt: null,
  },
});

export default {
  routes: [
    { method: 'GET', path: '/mcp/tokens/options', handler: ok(mcpOptions) },
    {
      method: 'GET', path: '/mcp/tokens/connect-info',
      handler: (req) => ({ body: isLongUrlState(req) ? { mcpUrl: LONG_MCP_URL, appUrl: 'https://boardroom-ai-production-1092.up.railway.app', oauthEnabled: false } : { mcpUrl: null, appUrl: null, oauthEnabled: false } }),
    },
    { method: 'POST', path: '/mcp/tokens', handler: (req) => ({ status: 201, body: mintedToken(req) }) },
    // `?state=profile-unavailable` (M1-D3): the profile read fails the way an open OmniMind breaker does —
    // the shell must still render, with the retry banner, instead of redirecting to onboarding.
    { method: 'GET', path: '/profile', handler: (req) => (String(req.headers?.referer ?? '').includes('profile-unavailable') ? { status: 503, body: { error: 'upstream_unavailable', message: 'OmniMind circuit breaker OPEN' } } : { body: profile }) },
    { method: 'PATCH', path: '/profile', handler: (req) => ({ body: { ...profile, ...(req.json ?? {}) } }) },
    { method: 'GET', path: '/sessions/s-visual', handler: ok(session) },
    // RD-1 vault notes — ahead of the generic `m-*` stub below.
    { method: 'POST', path: '/memories/search', handler: vaultSearch },
    { method: 'GET', path: /^\/memories\/(m-vault-[^/]+)$/, handler: (_req, _url, m) => (VAULT.has(m[1]) ? { body: VAULT.get(m[1]) } : { status: 404, body: { message: 'Memory not found' } }) },
    { method: 'GET', path: /^\/memories\/(m-vault-[^/]+)\/links$/, handler: (_req, _url, m) => ({ body: VAULT_LINKS[m[1]] ?? [] }) },
    { method: 'GET', path: /^\/memories\/([^/]+)\/backlinks$/, handler: (_req, _url, m) => ({ body: { items: backlinksOf(m[1]), truncated: false } }) },
    { method: 'GET', path: /^\/memories\/m-[^/]+$/, handler: (req, url, m) => ({ body: { id: m[0].slice('/memories/'.length), title: 'Annual prepay discussion with Priya', content: '', tags: ['pricing'], createdAt: iso(NOW - 20 * DAY) } }) },
  ],
};
