import { describe, it, expect, beforeAll } from 'vitest';
import { BOARDROOM_URL, waitForServices, registerTestUser, authedFetch } from '../setup';

describe('Decision Session Lifecycle', () => {
  let cookie: string;
  let sessionId: string;

  beforeAll(async () => {
    await waitForServices();
    const user = await registerTestUser();
    cookie = user.cookie;
  });

  it('creates a decision session', async () => {
    const res = await authedFetch(`${BOARDROOM_URL}/sessions`, cookie, {
      method: 'POST',
      body: JSON.stringify({
        question: 'Should we expand into the European market this quarter?',
        mode: 'Decide',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { sessionId: string; question: string; mode: string };
    expect(body.sessionId).toBeDefined();
    expect(body.question).toContain('European market');
    expect(body.mode).toBe('Decide');
    sessionId = body.sessionId;
  });

  it('retrieves the created session', async () => {
    const res = await authedFetch(`${BOARDROOM_URL}/sessions/${sessionId}`, cookie);
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; question: string };
    expect(body.id).toBe(sessionId);
    expect(body.question).toContain('European market');
  });

  it('lists sessions including the new one', async () => {
    const res = await authedFetch(`${BOARDROOM_URL}/sessions`, cookie);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.some(s => s.id === sessionId)).toBe(true);
  });
});
