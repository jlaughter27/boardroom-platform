// Auth + app-shell fixtures: whatever the client needs to get past the login
// wall and render the layout without a real server. Everything here is
// generic shell state; graph / memory data lives in graph.mjs.

const user = { id: 'u-josh', email: 'josh@example.com', name: 'Josh', isAdmin: false, createdAt: '2026-01-05T00:00:00.000Z' };

const profile = {
  id: 'up-1', userId: user.id, onboardingComplete: true,
  displayName: 'Josh', timezone: 'America/New_York', businessContext: 'Solo founder building BoardRoom AI.',
  goals: [], createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
};

const ok = (body) => () => ({ body });

export default {
  routes: [
    { method: 'GET', path: '/auth/me', handler: ok(user) },
    { method: 'POST', path: '/auth/login', handler: ok({ user }) },
    { method: 'POST', path: '/auth/logout', handler: () => ({ status: 204 }) },
    { method: 'GET', path: '/profile', handler: ok(profile) },
    { method: 'GET', path: '/subscription', handler: ok({ status: 'active', plan: 'pro', trialEndsAt: null, currentPeriodEnd: '2027-01-01T00:00:00.000Z' }) },
    { method: 'GET', path: /^\/sessions$/, handler: ok({ items: [], total: 0, offset: 0, limit: 20 }) },
    { method: 'GET', path: '/outcome-reviews/pending', handler: ok([]) },
    { method: 'GET', path: '/commitments/nudges', handler: ok({ dueSoon: [], overdue: [] }) },
    { method: 'GET', path: '/cortex/memo/latest', handler: ok(null) },
    { method: 'GET', path: /^\/cortex\/patterns/, handler: ok({ patterns: [], total: 0 }) },
    { method: 'GET', path: /^\/cortex\/contradictions/, handler: ok({ alerts: [], total: 0 }) },
    { method: 'GET', path: '/custom-personas', handler: ok([]) },
    { method: 'GET', path: '/calendar/status', handler: ok({ connected: false }) },
    { method: 'GET', path: '/integrations', handler: ok([]) },
    { method: 'GET', path: /^\/usage\/llm\/summary/, handler: ok({ days: 7, totalCostUsd: 0, calls: 0, byModel: [] }) },
    { method: 'GET', path: '/mcp/tokens', handler: ok({ tokens: [] }) },
    { method: 'GET', path: '/mcp/tokens/connect-info', handler: ok({ mcpUrl: null, appUrl: null, oauthEnabled: false }) },
    { method: 'GET', path: '/context/core', handler: ok({ block: '', generatedAt: new Date().toISOString() }) },
  ],
};
