import { google } from 'googleapis';
import type { calendar_v3 } from 'googleapis';
import crypto from 'crypto';
import type { CalendarAttendee, CalendarEvent, CalendarSyncStatus } from '@boardroom/shared';
import { MEETING_BRIEF_CONFIG } from '@boardroom/shared';
import { omnimindClient } from './omnimind-client';

const STATE_SECRET = process.env.JWT_SECRET || 'fallback-dev-secret';
// B-118 — OAuth state carries a timestamp + random nonce and is HMAC-signed.
// Rejected when older than STATE_MAX_AGE_MS (10 minutes).
export const STATE_MAX_AGE_MS = 10 * 60 * 1000;

export function signState(userId: string, provider: string, now: number = Date.now()): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = `${provider}:${userId}:${now}:${nonce}`;
  const hmac = crypto.createHmac('sha256', STATE_SECRET).update(payload).digest('hex');
  return `${payload}:${hmac}`;
}

export function verifyState(state: string | undefined, provider: string, now: number = Date.now()): string | null {
  if (!state) return null;
  const parts = state.split(':');
  // provider : userId : issuedAt : nonce : hmac  (userId itself never contains ':')
  if (parts.length < 5) return null;
  const hmac = parts.pop()!;
  const payload = parts.join(':');
  const expected = crypto.createHmac('sha256', STATE_SECRET).update(payload).digest('hex');
  const hmacBuf = Buffer.from(hmac);
  const expectedBuf = Buffer.from(expected);
  if (hmacBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(hmacBuf, expectedBuf)) return null;
  if (!payload.startsWith(`${provider}:`)) return null;
  const nonce = parts.pop()!;
  const issuedAtRaw = parts.pop()!;
  const issuedAt = Number(issuedAtRaw);
  if (!nonce || !Number.isFinite(issuedAt)) return null;
  if (now - issuedAt > STATE_MAX_AGE_MS || issuedAt - now > 60_000) return null; // expired (or clock skew > 1 min)
  const userId = parts.slice(1).join(':');
  return userId || null;
}

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3001/calendar/callback';

function isConfigured(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

function createOAuth2Client() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

export function getAuthUrl(userId: string): string | null {
  if (!isConfigured()) return null;
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar.readonly'],
    state: signState(userId, 'calendar'),
    prompt: 'consent',
  });
}

export async function handleCallback(userId: string, code: string): Promise<void> {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);

  // Store tokens via OmniMind
  await omnimindClient.saveOAuthToken(userId, {
    provider: 'google',
    accessToken: tokens.access_token ?? '',
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    scope: tokens.scope ?? null,
    calendarId: 'primary',
  });
}

// ── RD-13 — attendee-aware strict fetch + per-user event-list cache ─────────

/** `fetchEventsStrict` when GOOGLE_CLIENT_ID / _SECRET are not set. */
export class CalendarNotConfiguredError extends Error {
  constructor() { super('Google Calendar not configured'); this.name = 'CalendarNotConfiguredError'; }
}

/** `fetchEventsStrict` when the user has no stored Google token. */
export class CalendarNotConnectedError extends Error {
  constructor() { super('Google Calendar not connected'); this.name = 'CalendarNotConnectedError'; }
}

/** Pure Google → CalendarEvent mapping, attendees included (server-internal). */
export function mapGoogleEvent(event: calendar_v3.Schema$Event): CalendarEvent {
  return {
    id: event.id ?? '',
    title: event.summary ?? 'Untitled',
    startTime: new Date(event.start?.dateTime ?? event.start?.date ?? ''),
    endTime: new Date(event.end?.dateTime ?? event.end?.date ?? ''),
    allDay: !!event.start?.date && !event.start?.dateTime,
    source: 'google',
    externalId: event.id ?? null,
    description: event.description ?? null,
    location: event.location ?? null,
    attendees: (event.attendees ?? []).map((a): CalendarAttendee => ({
      email: a.email ?? null,
      displayName: a.displayName ?? null,
      self: !!a.self,
      organizer: !!a.organizer,
      resource: !!a.resource,
      responseStatus: (['needsAction', 'declined', 'tentative', 'accepted'] as const).find(s => s === a.responseStatus) ?? null,
    })),
  };
}

/**
 * The Google read behind `getEvents`, without its catch: throws
 * CalendarNotConfiguredError / CalendarNotConnectedError, rethrows Google
 * errors, and keeps attendees. Used by `GET /calendar/briefs`.
 */
export async function fetchEventsStrict(userId: string, start: Date, end: Date): Promise<CalendarEvent[]> {
  if (!isConfigured()) throw new CalendarNotConfiguredError();

  const tokenData = await omnimindClient.getOAuthToken(userId, 'google') as Record<string, unknown> | null;
  if (!tokenData) throw new CalendarNotConnectedError();

  const client = createOAuth2Client();
  client.setCredentials({
    access_token: tokenData.accessToken as string,
    refresh_token: tokenData.refreshToken as string | undefined,
    expiry_date: tokenData.expiresAt ? new Date(tokenData.expiresAt as string).getTime() : undefined,
  });

  // Handle token refresh (same as the legacy path; a concurrent refresh from
  // the week strip is benign — both upsert a valid token and keep the refresh token).
  client.on('tokens', async (newTokens) => {
    if (newTokens.access_token) {
      await omnimindClient.saveOAuthToken(userId, {
        provider: 'google',
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token ?? (tokenData.refreshToken as string | null),
        expiresAt: newTokens.expiry_date ? new Date(newTokens.expiry_date).toISOString() : null,
        scope: tokenData.scope as string | null,
        calendarId: tokenData.calendarId as string | null,
      });
    }
  });

  const calendar = google.calendar({ version: 'v3', auth: client });
  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 100,
  });
  return (response.data.items ?? []).map(mapGoogleEvent);
}

interface CachedEvents { start: number; end: number; events: CalendarEvent[]; fetchedAt: number }
const eventCache = new Map<string, CachedEvents>();

/** Test helper. */
export function __resetEventCacheForTest(): void {
  eventCache.clear();
}

/**
 * `fetchEventsStrict` behind a 5-minute per-user cache (at most 500 users,
 * oldest evicted). A hit needs the cached window to cover the requested one;
 * `refresh` bypasses it. Only the briefs route uses this — `getEvents` is not
 * cached (behaviour preserved).
 */
export async function getEventsCached(
  userId: string,
  start: Date,
  end: Date,
  opts: { refresh?: boolean } = {},
): Promise<CalendarEvent[]> {
  const now = Date.now();
  const cached = eventCache.get(userId);
  if (
    cached && !opts.refresh
    && now - cached.fetchedAt < MEETING_BRIEF_CONFIG.eventCacheMs
    && cached.start <= start.getTime() && cached.end >= end.getTime()
  ) {
    return cached.events.filter(e => e.endTime.getTime() > start.getTime() && e.startTime.getTime() < end.getTime());
  }
  // Callers ask for a window relative to "now" (`now + hours`), so the next
  // request's end is always a little later. Fetch one cache lifetime past the
  // requested end so every request inside the 5 minutes is still covered.
  const fetchEnd = new Date(end.getTime() + MEETING_BRIEF_CONFIG.eventCacheMs);
  const events = await fetchEventsStrict(userId, start, fetchEnd);
  eventCache.delete(userId);
  eventCache.set(userId, { start: start.getTime(), end: fetchEnd.getTime(), events, fetchedAt: now });
  while (eventCache.size > MEETING_BRIEF_CONFIG.eventCacheMaxUsers) {
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [k, v] of eventCache) if (v.fetchedAt < oldestAt) { oldestAt = v.fetchedAt; oldestKey = k; }
    if (oldestKey === null) break;
    eventCache.delete(oldestKey);
  }
  return events.filter(e => e.endTime.getTime() > start.getTime() && e.startTime.getTime() < end.getTime());
}

export async function getEvents(userId: string, start: Date, end: Date): Promise<CalendarEvent[]> {
  try {
    // `/calendar/events` keeps its response shape: no attendees key.
    return (await fetchEventsStrict(userId, start, end)).map(({ attendees: _attendees, ...e }) => e);
  } catch (_err) {
    // Not configured, not connected, token expired or revoked — return empty
    return [];
  }
}

export async function getStatus(userId: string): Promise<CalendarSyncStatus> {
  if (!isConfigured()) {
    return { connected: false, lastSyncAt: null, calendarId: null, error: 'Google Calendar not configured' };
  }

  const tokenData = await omnimindClient.getOAuthToken(userId, 'google') as Record<string, unknown> | null;
  if (!tokenData) {
    return { connected: false, lastSyncAt: null, calendarId: null, error: null };
  }

  return {
    connected: true,
    lastSyncAt: tokenData.updatedAt ? new Date(tokenData.updatedAt as string) : null,
    calendarId: (tokenData.calendarId as string) ?? 'primary',
    error: null,
  };
}

export async function disconnect(userId: string): Promise<void> {
  eventCache.delete(userId); // RD-13
  await omnimindClient.deleteOAuthToken(userId, 'google');
}

export { isConfigured };
