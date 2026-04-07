import { describe, it, expect, beforeAll } from 'vitest';
import { BOARDROOM_URL, waitForServices, registerTestUser, authedFetch } from '../setup';

describe('Memory Create → Store → Search → Archive', () => {
  let cookie: string;
  let memoryId: string;
  const uniqueKeyword = `e2e-memory-${Date.now()}`;

  beforeAll(async () => {
    await waitForServices();
    const user = await registerTestUser();
    cookie = user.cookie;
  });

  it('creates a memory', async () => {
    const res = await authedFetch(`${BOARDROOM_URL}/memories`, cookie, {
      method: 'POST',
      body: JSON.stringify({
        content: `${uniqueKeyword}: Our Q2 revenue target is $5M, up from $3.2M last quarter.`,
        domain: 'business',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string };
    expect(body.id).toBeDefined();
    memoryId = body.id;
  });

  it('lists memories including the new one', async () => {
    const res = await authedFetch(`${BOARDROOM_URL}/memories`, cookie);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.some(m => m.id === memoryId)).toBe(true);
  });

  it('searches for the memory by keyword', async () => {
    const res = await authedFetch(
      `${BOARDROOM_URL}/memories?q=${encodeURIComponent(uniqueKeyword)}`,
      cookie
    );
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    expect(body.some(m => m.id === memoryId)).toBe(true);
  });

  it('archives the memory', async () => {
    const res = await authedFetch(`${BOARDROOM_URL}/memories/${memoryId}/archive`, cookie, {
      method: 'POST',
    });
    expect([200, 204]).toContain(res.status);
  });

  it('no longer shows archived memory in list', async () => {
    const res = await authedFetch(`${BOARDROOM_URL}/memories`, cookie);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    expect(body.some(m => m.id === memoryId)).toBe(false);
  });
});
