// RD-13 — meeting prep briefs. Wire shapes (ISO-string timestamps) for
// OmniMind `POST /people/briefs` and BoardRoom `GET /calendar/briefs`.
// Companion Zod schemas: validation/meeting-brief.schema.ts.

export type MeetingBriefMatchMethod = 'exact' | 'name_tokens' | 'title_full' | 'title_first_name';
export type MeetingBriefCalendarState = 'connected' | 'not_connected' | 'not_configured' | 'unavailable';

export interface PersonBriefsAttendeeInput {
  /** Opaque BoardRoom key (`<eventIndex>:<attendeeIndex>`). */
  key: string;
  /** Name candidate — never an e-mail. */
  name: string;
}

export interface PersonBriefsEventInput {
  /** Opaque BoardRoom key (`e<eventIndex>`). */
  key: string;
  /** Normalized title tokens — never the raw title. */
  titleTokens: string[];
  /** At most one other attendee — enables first-name title matching. */
  smallMeeting: boolean;
}

export interface PersonBriefsRequest {
  attendees: PersonBriefsAttendeeInput[];
  events: PersonBriefsEventInput[];
}

export interface PersonBriefCapsule {
  summary: string;
  generatedAt: string;
  stale: boolean;
}

export interface PersonBriefMemory {
  id: string;
  title: string;
  excerpt: string;
  at: string;
}

export interface PersonBriefYouOwe {
  id: string;
  description: string;
  deadline: string | null;
  overdue: boolean;
}

export interface PersonBriefTheyOwe {
  id: string;
  title: string;
  deadline: string | null;
  status: string;
}

export interface PersonBriefDecision {
  id: string;
  title: string;
  status: string;
  at: string;
  via: 'project' | 'mention';
}

export interface PersonBriefCounts {
  memories: number;
  youOwe: number;
  youOweOverdue: number;
  theyOwe: number;
  decisions: number;
}

export interface PersonBrief {
  personId: string;
  name: string;
  role: string | null;
  relationshipToUser: string | null;
  headline: string;
  lastInteractionAt: string | null;
  capsule: PersonBriefCapsule | null;
  recentMemories: PersonBriefMemory[];
  youOwe: PersonBriefYouOwe[];
  theyOwe: PersonBriefTheyOwe[];
  decisions: PersonBriefDecision[];
  counts: PersonBriefCounts;
}

export interface PersonBriefsAttendeeMatch {
  key: string;
  personId: string | null;
  ambiguous: boolean;
  method: 'exact' | 'name_tokens' | null;
}

export interface PersonBriefsTitleMatch {
  key: string;
  personId: string;
  method: 'title_full' | 'title_first_name';
}

export interface PersonBriefsResponse {
  generatedAt: string;
  partial: boolean;
  attendeeMatches: PersonBriefsAttendeeMatch[];
  titleMatches: PersonBriefsTitleMatch[];
  briefs: Record<string, PersonBrief>;
}

export interface MeetingBriefKnownPerson {
  personId: string;
  displayName: string;
  method: MeetingBriefMatchMethod;
}

export interface MeetingBriefEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  location: string | null;
  attendeeCount: number;
  knownPeople: MeetingBriefKnownPerson[];
  unknownAttendees: number;
  ambiguousAttendees: number;
  morePeople: number;
}

export interface MeetingBriefsOmitted {
  noKnownPeople: number;
  overCap: number;
  allDayOrDeclined: number;
}

export interface MeetingBriefsResponse {
  calendar: MeetingBriefCalendarState;
  generatedAt: string;
  windowEnd: string;
  events: MeetingBriefEvent[];
  briefs: Record<string, PersonBrief>;
  omitted: MeetingBriefsOmitted;
  partial: boolean;
}
