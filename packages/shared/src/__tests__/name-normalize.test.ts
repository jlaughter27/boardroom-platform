import { describe, it, expect } from 'vitest';
import { normalizeName, nameTokens, nameCandidate, titleTokens } from '../utils/name-normalize';
import {
  PersonBriefsRequestSchema,
  CalendarEventSchema,
  MEETING_BRIEF_CONFIG,
} from '../index';

describe('RD-13 name normalization', () => {
  it('normalizeName strips diacritics and case, keeps apostrophes and hyphens', () => {
    expect(normalizeName('José Núñez')).toBe('jose nunez');
    expect(normalizeName("  O'Brien-Smith,  Jr. ")).toBe("o'brien-smith jr");
    expect(normalizeName('AVERY\tTestperson')).toBe('avery testperson');
    expect(normalizeName('R2-D2')).toBe('r -d');
  });

  it('nameTokens splits the normalized form', () => {
    expect(nameTokens(' Sarah  Ann JONES ')).toEqual(['sarah', 'ann', 'jones']);
    expect(nameTokens('')).toEqual([]);
  });

  it('nameCandidate prefers a display name of 3+ characters', () => {
    expect(nameCandidate('Avery Testperson', 'whatever@example.com')).toBe('Avery Testperson');
    expect(nameCandidate('  Bo  ', 'bo.lindqvist@example.com')).toBe('bo lindqvist');
  });

  it('nameCandidate derives two letter-only tokens from the e-mail local part', () => {
    expect(nameCandidate(null, 'sarah.jones@x.com')).toBe('sarah jones');
    expect(nameCandidate(null, 'mary_ann-lee@x.com')).toBe('mary ann lee');
    expect(nameCandidate(null, 'pastorjohn77@gmail.com')).toBeNull();
    expect(nameCandidate(null, 'sj1984@x')).toBeNull();
    expect(nameCandidate(null, 'j.smith@x.com')).toBeNull();
    expect(nameCandidate(null, null)).toBeNull();
  });

  it('nameCandidate refuses room/resource calendars', () => {
    expect(nameCandidate(null, 'board.room@c_123.resource.calendar.google.com')).toBeNull();
    expect(nameCandidate('Board Room 2', 'c_abc@resource.calendar.google.com')).toBeNull();
  });

  it('titleTokens normalizes, drops 1-char tokens, dedupes and caps at 16', () => {
    expect(titleTokens('Lunch w/ Sarah!')).toEqual(['lunch', 'sarah']);
    expect(titleTokens('Sync sync SYNC with Avery')).toEqual(['sync', 'with', 'avery']);
    const many = Array.from({ length: 30 }, (_, i) => `word${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`).join(' ');
    expect(titleTokens(many)).toHaveLength(16);
    expect(titleTokens(null)).toEqual([]);
  });
});

describe('RD-13 schemas', () => {
  it('PersonBriefsRequestSchema requires attendees or events and enforces caps', () => {
    expect(PersonBriefsRequestSchema.safeParse({}).success).toBe(false);
    expect(PersonBriefsRequestSchema.safeParse({ attendees: [{ key: '0:0', name: 'Avery' }] }).success).toBe(true);
    const tooMany = Array.from({ length: MEETING_BRIEF_CONFIG.maxAttendees + 1 }, (_, i) => ({ key: `0:${i}`, name: `Person ${i}` }));
    expect(PersonBriefsRequestSchema.safeParse({ attendees: tooMany }).success).toBe(false);
    expect(PersonBriefsRequestSchema.safeParse({ attendees: [{ key: '0:0', name: '   ' }] }).success).toBe(false);
  });

  it('CalendarEventSchema accepts optional attendees', () => {
    const base = { id: 'e1', title: 'x', startTime: '2026-10-24T10:00:00Z', endTime: '2026-10-24T11:00:00Z', allDay: false, source: 'google', externalId: null, description: null, location: null };
    expect(CalendarEventSchema.safeParse(base).success).toBe(true);
    expect(CalendarEventSchema.safeParse({ ...base, attendees: [{ email: null, displayName: 'A', self: false, organizer: false, resource: false, responseStatus: 'accepted' }] }).success).toBe(true);
    expect(CalendarEventSchema.safeParse({ ...base, attendees: [{ email: null, displayName: 'A', self: false, organizer: false, resource: false, responseStatus: 'maybe' }] }).success).toBe(false);
  });
});
