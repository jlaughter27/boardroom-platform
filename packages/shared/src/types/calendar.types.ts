// Calendar types — Phase 3 (Claude)
// Calendar events, sync status, OAuth tokens

export interface CalendarEvent {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  allDay: boolean;
  source: 'google' | 'manual';
  externalId: string | null;
  description: string | null;
  location: string | null;
}

export interface CalendarSyncStatus {
  connected: boolean;
  lastSyncAt: Date | null;
  calendarId: string | null;
  error: string | null;
}

export interface OAuthToken {
  id: string;
  userId: string;
  provider: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
  calendarId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
