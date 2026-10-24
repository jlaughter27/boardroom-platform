// Calendar Zod schemas — matches packages/shared/src/types/calendar.types.ts

import { z } from 'zod';

// ── Calendar Attendee Schema (RD-13) ──

export const CalendarAttendeeSchema = z.object({
  email: z.string().nullable().describe('Attendee e-mail (never sent to OmniMind)'),
  displayName: z.string().nullable().describe('Attendee display name'),
  self: z.boolean().describe('Whether this attendee is the calendar owner'),
  organizer: z.boolean().describe('Whether this attendee organizes the event'),
  resource: z.boolean().describe('Whether this attendee is a room/resource'),
  responseStatus: z.enum(['needsAction', 'declined', 'tentative', 'accepted']).nullable().describe('RSVP status'),
});

export type CalendarAttendeeInput = z.infer<typeof CalendarAttendeeSchema>;

// ── Calendar Event Schema ──

export const CalendarEventSchema = z.object({
  id: z.string().describe('Unique event identifier (cuid)'),
  title: z.string().describe('Event title'),
  startTime: z.coerce.date().describe('Event start time'),
  endTime: z.coerce.date().describe('Event end time'),
  allDay: z.boolean().describe('Whether this is an all-day event'),
  source: z.enum(['google', 'manual']).describe('Event source'),
  externalId: z.string().nullable().describe('External calendar system ID'),
  description: z.string().nullable().describe('Event description'),
  location: z.string().nullable().describe('Event location'),
  attendees: z.array(CalendarAttendeeSchema).optional().describe('RD-13 — attendees (server-internal)'),
});

export type CalendarEventInput = z.infer<typeof CalendarEventSchema>;

// ── Calendar Sync Status Schema ──

export const CalendarSyncStatusSchema = z.object({
  connected: z.boolean().describe('Whether calendar is connected'),
  lastSyncAt: z.coerce.date().nullable().describe('Last successful sync timestamp'),
  calendarId: z.string().nullable().describe('Connected calendar identifier'),
  error: z.string().nullable().describe('Last sync error message'),
});

export type CalendarSyncStatusInput = z.infer<typeof CalendarSyncStatusSchema>;

// ── OAuth Token Schema ──

export const OAuthTokenSchema = z.object({
  id: z.string().describe('Unique token identifier (cuid)'),
  userId: z.string().describe('Owner user identifier'),
  provider: z.string().describe('OAuth provider name'),
  accessToken: z.string().describe('OAuth access token'),
  refreshToken: z.string().nullable().describe('OAuth refresh token'),
  expiresAt: z.coerce.date().nullable().describe('Token expiration timestamp'),
  scope: z.string().nullable().describe('OAuth scope'),
  calendarId: z.string().nullable().describe('Associated calendar identifier'),
  createdAt: z.coerce.date().describe('Creation timestamp'),
  updatedAt: z.coerce.date().describe('Last update timestamp'),
});

export type OAuthTokenInput = z.infer<typeof OAuthTokenSchema>;
