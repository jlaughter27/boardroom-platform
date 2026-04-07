import { google } from 'googleapis';
import type { CalendarEvent, CalendarSyncStatus } from '@boardroom/shared';
import { omnimindClient } from './omnimind-client';

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
    state: userId,
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

export async function getEvents(userId: string, start: Date, end: Date): Promise<CalendarEvent[]> {
  if (!isConfigured()) return [];

  const tokenData = await omnimindClient.getOAuthToken(userId, 'google') as Record<string, unknown> | null;
  if (!tokenData) return [];

  const client = createOAuth2Client();
  client.setCredentials({
    access_token: tokenData.accessToken as string,
    refresh_token: tokenData.refreshToken as string | undefined,
    expiry_date: tokenData.expiresAt ? new Date(tokenData.expiresAt as string).getTime() : undefined,
  });

  // Handle token refresh
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

  try {
    const calendar = google.calendar({ version: 'v3', auth: client });
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 50,
    });

    return (response.data.items ?? []).map((event): CalendarEvent => ({
      id: event.id ?? '',
      title: event.summary ?? 'Untitled',
      startTime: new Date(event.start?.dateTime ?? event.start?.date ?? ''),
      endTime: new Date(event.end?.dateTime ?? event.end?.date ?? ''),
      allDay: !!event.start?.date && !event.start?.dateTime,
      source: 'google',
      externalId: event.id ?? null,
      description: event.description ?? null,
      location: event.location ?? null,
    }));
  } catch (_err) {
    // Token expired or revoked — return empty
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
  await omnimindClient.deleteOAuthToken(userId, 'google');
}

export { isConfigured };
