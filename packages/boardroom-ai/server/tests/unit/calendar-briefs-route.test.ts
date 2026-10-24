/**
 * RD-13 — GET /calendar/briefs end to end inside BoardRoom (real route, real
 * google-calendar.service; googleapis, omnimind-client and the logger are
 * mocked), plus the attendee mapping, the unchanged /calendar/events shape,
 * the 5-minute event cache, the OmniMind contract check and the privacy of
 * payloads and logs. Synthetic names only.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { MeetingBriefsResponseSchema } from '@boardroom/shared';
import type { PersonBriefsResponse } from '@boardroom/shared';

vi.hoisted(() => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
});

const g = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('googleapis', () => {
  class OAuth2 {
    setCredentials() {}
    on() {}
    generateAuthUrl() { return 'https://accounts.example/auth'; }
  }
  return { google: { auth: { OAuth2 }, calendar: () => ({ events: { list: g.list } }) } };
});

vi.mock('../../src/services/omnimind-client', () => {
  class OmniMindContractError extends Error {}
  return {
    OmniMindContractError,
    omnimindClient: {
      getOAuthToken: vi.fn(),
      saveOAuthToken: vi.fn(),
      deleteOAuthToken: vi.fn(async () => ({ status: 'deleted' })),
      getPersonBriefs: vi.fn(),
    },
  };
});

vi.mock('../../src/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { omnimindClient, OmniMindContractError } from '../../src/services/omnimind-client';
import { logger } from '../../src/lib/logger';
import * as calendarService from '../../src/services/google-calendar.service';
import { calendarRouter } from '../../src/routes/calendar.routes';

const om = omnimindClient as unknown as Record<'getOAuthToken' | 'saveOAuthToken' | 'deleteOAuthToken' | 'getPersonBriefs', ReturnType<typeof vi.fn>>;

const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const googleEvent = (id: string, summary: string, startMin: number, attendees: Array<Record<string, unknown>>) => ({
  id, summary, description: 'Confidential agenda notes', location: 'Room 4',
  start: { dateTime: inMin(startMin) }, end: { dateTime: inMin(startMin + 30) }, attendees,
});
const EVENTS = [
  googleEvent('g1', 'Lunch w/ Avery', 60, [
    { email: 'me@example.org', displayName: 'Me Myself', self: true, responseStatus: 'accepted' },
    { email: 'avery.testperson@example.org', responseStatus: 'needsAction' },
  ]),
  googleEvent('g2', 'Staff sync', 180, [
    { email: 'me@example.org', self: true, organizer: true, responseStatus: 'accepted' },
    { email: 'dana@example.org', displayName: 'Dana Holt', responseStatus: 'tentative' },
    { email: 'room@c_9.resource.calendar.google.com', displayName: 'Room 4', resource: true },
  ]),
];

const brief = (personId: string, name: string) => ({
  personId, name, role: null, relationshipToUser: null, headline: `You owe ${name.split(' ')[0]} 1 · last touch today`,
  lastInteractionAt: new Date().toISOString(), capsule: null, recentMemories: [],
  youOwe: [{ id: 'c1', description: 'Send the plan', deadline: null, overdue: false }], theyOwe: [], decisions: [],
  counts: { memories: 0, youOwe: 1, youOweOverdue: 0, theyOwe: 0, decisions: 0 },
});
const omniResponse = (): PersonBriefsResponse => ({
  generatedAt: new Date().toISOString(), partial: false,
  attendeeMatches: [
    { key: '0:0', personId: 'p1', ambiguous: false, method: 'exact' },
    { key: '1:0', personId: null, ambiguous: false, method: null },
  ],
  titleMatches: [{ key: 'e0', personId: 'p1', method: 'title_first_name' }],
  briefs: { p1: brief('p1', 'Avery Testperson') },
});

function appWith(router: express.Router) {
  const app = express();
  app.use((req, _res, next) => { (req as any).auth = { userId: 'user-1', email: 'u@b.co', teamId: 't1' }; next(); });
  app.use('/calendar', router);
  app.use((err: any, _req: any, res: any, _next: any) => { res.status(500).json({ error: 'internal_error', message: err.message }); });
  return app;
}

let server: Server;
let base = '';
beforeAll(async () => {
  await new Promise<void>((resolve) => { server = appWith(calendarRouter).listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server?.close(() => resolve())); });

beforeEach(() => {
  vi.clearAllMocks();
  calendarService.__resetEventCacheForTest();
  om.getOAuthToken.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', expiresAt: null, scope: null, calendarId: 'primary' });
  g.list.mockResolvedValue({ data: { items: EVENTS } });
  om.getPersonBriefs.mockResolvedValue(omniResponse());
});
afterEach(() => { vi.useRealTimers(); });

const getBriefs = async (qs = '') => {
  const res = await fetch(`${base}/calendar/briefs${qs}`);
  return { status: res.status, body: await res.json() };
};

describe('google-calendar mapping (RD-13)', () => {
  it('mapGoogleEvent maps attendees', () => {
    const e = calendarService.mapGoogleEvent(EVENTS[1] as any);
    expect(e.attendees).toEqual([
      { email: 'me@example.org', displayName: null, self: true, organizer: true, resource: false, responseStatus: 'accepted' },
      { email: 'dana@example.org', displayName: 'Dana Holt', self: false, organizer: false, resource: false, responseStatus: 'tentative' },
      { email: 'room@c_9.resource.calendar.google.com', displayName: 'Room 4', self: false, organizer: false, resource: true, responseStatus: null },
    ]);
  });

  it('GET /calendar/events keeps its shape (no attendees key) and still returns [] when Google throws', async () => {
    let res = await fetch(`${base}/calendar/events`);
    const events = await res.json();
    expect(res.status).toBe(200);
    expect(events).toHaveLength(2);
    for (const e of events) expect(Object.keys(e).sort()).toEqual(['allDay', 'description', 'endTime', 'externalId', 'id', 'location', 'source', 'startTime', 'title']);
    g.list.mockRejectedValueOnce(new Error('invalid_grant'));
    res = await fetch(`${base}/calendar/events`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe('GET /calendar/briefs (RD-13)', () => {
  it('not configured → not_configured; neither Google nor OmniMind is called', async () => {
    vi.resetModules();
    const prevId = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;
    try {
      const { calendarRouter: fresh } = await import('../../src/routes/calendar.routes');
      const s: Server = await new Promise((resolve) => { const srv = appWith(fresh).listen(0, '127.0.0.1', () => resolve(srv)); });
      const res = await fetch(`http://127.0.0.1:${(s.address() as { port: number }).port}/calendar/briefs`);
      const body = await res.json();
      await new Promise<void>((resolve) => s.close(() => resolve()));
      expect(res.status).toBe(200);
      expect(body).toMatchObject({ calendar: 'not_configured', events: [], briefs: {}, partial: false });
      expect(MeetingBriefsResponseSchema.safeParse(body).success).toBe(true);
      expect(om.getOAuthToken).not.toHaveBeenCalled();
      expect(g.list).not.toHaveBeenCalled();
      expect(om.getPersonBriefs).not.toHaveBeenCalled();
    } finally {
      process.env.GOOGLE_CLIENT_ID = prevId;
    }
  });

  it('no token → not_connected, no OmniMind brief call', async () => {
    om.getOAuthToken.mockResolvedValue(null);
    const { status, body } = await getBriefs();
    expect(status).toBe(200);
    expect(body.calendar).toBe('not_connected');
    expect(om.getPersonBriefs).not.toHaveBeenCalled();
  });

  it('Google throws → HTTP 200 unavailable', async () => {
    g.list.mockRejectedValue(new Error('Request had insufficient authentication scopes'));
    const { status, body } = await getBriefs();
    expect(status).toBe(200);
    expect(body.calendar).toBe('unavailable');
    expect(om.getPersonBriefs).not.toHaveBeenCalled();
  });

  it('OmniMind rejects → 200 unavailable', async () => {
    om.getPersonBriefs.mockRejectedValue(Object.assign(new Error('OmniMind POST /people/briefs: 503'), { status: 503 }));
    const { status, body } = await getBriefs();
    expect(status).toBe(200);
    expect(body.calendar).toBe('unavailable');
    expect(MeetingBriefsResponseSchema.safeParse(body).success).toBe(true);
  });

  it('OmniMind contract mismatch → 200 unavailable', async () => {
    om.getPersonBriefs.mockRejectedValue(new OmniMindContractError('POST /people/briefs'));
    const { status, body } = await getBriefs();
    expect(status).toBe(200);
    expect(body.calendar).toBe('unavailable');
  });

  it('happy path: schema-valid body; only names + title tokens reach OmniMind; logs carry no emails or titles', async () => {
    const { status, body } = await getBriefs();
    expect(status).toBe(200);
    expect(MeetingBriefsResponseSchema.safeParse(body).success).toBe(true);
    expect(body.calendar).toBe('connected');
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({ id: 'g1', title: 'Lunch w/ Avery', location: 'Room 4', knownPeople: [{ personId: 'p1', method: 'exact' }] });
    expect(body.omitted.noKnownPeople).toBe(1);
    expect(Object.keys(body.briefs)).toEqual(['p1']);

    const sent = om.getPersonBriefs.mock.calls[0][1];
    expect(sent.attendees).toEqual([{ key: '0:0', name: 'avery testperson' }, { key: '1:0', name: 'Dana Holt' }]);
    expect(sent.events).toEqual([
      { key: 'e0', titleTokens: ['lunch', 'avery'], smallMeeting: true },
      { key: 'e1', titleTokens: ['staff', 'sync'], smallMeeting: true },
    ]);
    const wire = JSON.stringify(sent);
    expect(wire).not.toContain('@');
    expect(wire).not.toContain('Lunch w/ Avery');
    expect(wire).not.toContain('Confidential');

    const logs = JSON.stringify([...(logger.info as any).mock.calls, ...(logger.warn as any).mock.calls, ...(logger.error as any).mock.calls]);
    expect(logs).not.toMatch(/@example\.org|Lunch w\/ Avery|Staff sync|Avery|Dana/);
  });

  it('logs no event data on failures either', async () => {
    om.getPersonBriefs.mockRejectedValue(new Error('upstream said: Lunch w/ Avery avery.testperson@example.org'));
    await getBriefs();
    g.list.mockRejectedValue(new Error('google said Staff sync dana@example.org'));
    await getBriefs('?refresh=1');
    const logs = JSON.stringify([...(logger.info as any).mock.calls, ...(logger.warn as any).mock.calls, ...(logger.error as any).mock.calls]);
    expect(logs).not.toMatch(/@example\.org|Lunch|Staff sync/);
  });

  it.each(['49', '0', 'abc'])('hours=%s → 400', async (h) => {
    const { status, body } = await getBriefs(`?hours=${h}`);
    expect(status).toBe(400);
    expect(body.error).toBe('validation_failed');
  });
});

describe('event-list cache (RD-13)', () => {
  it('two calls within 5 minutes → one Google call; refresh=1 → a second; briefs are recomputed every time', async () => {
    await getBriefs();
    await getBriefs();
    expect(g.list).toHaveBeenCalledTimes(1);
    expect(om.getPersonBriefs).toHaveBeenCalledTimes(2);
    await getBriefs('?refresh=1');
    expect(g.list).toHaveBeenCalledTimes(2);
  });

  it('refetches after 5 minutes and when the requested window is not covered', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-10-24T09:00:00.000Z');
    vi.setSystemTime(t0);
    const start = new Date(t0.getTime() - 15 * 60_000);
    const end = new Date(t0.getTime() + 24 * 3_600_000);
    await calendarService.getEventsCached('user-1', start, end);
    await calendarService.getEventsCached('user-1', start, end);
    expect(g.list).toHaveBeenCalledTimes(1);
    await calendarService.getEventsCached('user-1', start, new Date(end.getTime() + 3_600_000));
    expect(g.list).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date(t0.getTime() + 5 * 60_000 + 1));
    await calendarService.getEventsCached('user-1', start, end);
    expect(g.list).toHaveBeenCalledTimes(3);
  });

  it('disconnect(userId) clears the cached entry', async () => {
    await getBriefs();
    await calendarService.disconnect('user-1');
    await getBriefs();
    expect(g.list).toHaveBeenCalledTimes(2);
  });
});
