// RD-13 — meeting prep brief schemas. Matches types/meeting-brief.types.ts.

import { z } from 'zod';
import { MEETING_BRIEF_CONFIG } from '../constants/meeting-brief-config';

const count = () => z.number().int().min(0);

export const PersonBriefsRequestSchema = z.object({
  attendees: z.array(z.object({
    key: z.string().min(1).max(64),
    name: z.string().trim().min(1).max(120),
  })).max(MEETING_BRIEF_CONFIG.maxAttendees).default([]),
  events: z.array(z.object({
    key: z.string().min(1).max(64),
    titleTokens: z.array(z.string().min(1).max(40)).max(MEETING_BRIEF_CONFIG.maxTitleTokens),
    smallMeeting: z.boolean(),
  })).max(MEETING_BRIEF_CONFIG.maxEvents).default([]),
}).refine(b => b.attendees.length + b.events.length >= 1, 'attendees or events required');

export type PersonBriefsRequestInput = z.infer<typeof PersonBriefsRequestSchema>;

export const MeetingBriefMatchMethodSchema = z.enum(['exact', 'name_tokens', 'title_full', 'title_first_name']);

export const PersonBriefSchema = z.object({
  personId: z.string(),
  name: z.string(),
  role: z.string().nullable(),
  relationshipToUser: z.string().nullable(),
  headline: z.string(),
  lastInteractionAt: z.string().datetime().nullable(),
  capsule: z.object({ summary: z.string(), generatedAt: z.string().datetime(), stale: z.boolean() }).nullable(),
  recentMemories: z.array(z.object({ id: z.string(), title: z.string(), excerpt: z.string(), at: z.string().datetime() })),
  youOwe: z.array(z.object({ id: z.string(), description: z.string(), deadline: z.string().datetime().nullable(), overdue: z.boolean() })),
  theyOwe: z.array(z.object({ id: z.string(), title: z.string(), deadline: z.string().datetime().nullable(), status: z.string() })),
  decisions: z.array(z.object({ id: z.string(), title: z.string(), status: z.string(), at: z.string().datetime(), via: z.enum(['project', 'mention']) })),
  counts: z.object({ memories: count(), youOwe: count(), youOweOverdue: count(), theyOwe: count(), decisions: count() }),
});

export type PersonBriefInput = z.infer<typeof PersonBriefSchema>;

export const PersonBriefsResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  partial: z.boolean(),
  attendeeMatches: z.array(z.object({
    key: z.string(),
    personId: z.string().nullable(),
    ambiguous: z.boolean(),
    method: z.enum(['exact', 'name_tokens']).nullable(),
  })),
  titleMatches: z.array(z.object({
    key: z.string(),
    personId: z.string(),
    method: z.enum(['title_full', 'title_first_name']),
  })),
  briefs: z.record(z.string(), PersonBriefSchema),
});

export type PersonBriefsResponseInput = z.infer<typeof PersonBriefsResponseSchema>;

export const MeetingBriefsResponseSchema = z.object({
  calendar: z.enum(['connected', 'not_connected', 'not_configured', 'unavailable']),
  generatedAt: z.string().datetime(),
  windowEnd: z.string().datetime(),
  events: z.array(z.object({
    id: z.string(),
    title: z.string(),
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
    location: z.string().nullable(),
    attendeeCount: count(),
    knownPeople: z.array(z.object({
      personId: z.string(),
      displayName: z.string(),
      method: MeetingBriefMatchMethodSchema,
    })).max(MEETING_BRIEF_CONFIG.maxPeoplePerEvent),
    unknownAttendees: count(),
    ambiguousAttendees: count(),
    morePeople: count(),
  })),
  briefs: z.record(z.string(), PersonBriefSchema),
  omitted: z.object({ noKnownPeople: count(), overCap: count(), allDayOrDeclined: count() }),
  partial: z.boolean(),
});

export type MeetingBriefsResponseInput = z.infer<typeof MeetingBriefsResponseSchema>;
