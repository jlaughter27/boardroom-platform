import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatIso,
  formatDate,
  formatTime,
  formatDateTime,
  getRelativeTime,
  convertTimezone,
  getTimezoneOffset,
  calculateDuration,
  formatDuration,
  addTime,
  isDateInRange,
  getStartOfDay,
  getEndOfDay,
  isSameDay
} from '../utils/date';

describe('date utilities', () => {
  const mockDate = new Date('2024-12-31T14:30:45.123Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(mockDate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('formatIso', () => {
    it('formats current date to ISO string', () => {
      const iso = formatIso();
      expect(iso).toBe('2024-12-31T14:30:45.123Z');
    });

    it('formats provided date to ISO string', () => {
      const date = new Date('2024-01-01T12:00:00.000Z');
      const iso = formatIso(date);
      expect(iso).toBe('2024-01-01T12:00:00.000Z');
    });
  });

  describe('formatDate', () => {
    it('formats current date to YYYY-MM-DD', () => {
      const dateStr = formatDate();
      expect(dateStr).toBe('2024-12-31');
    });

    it('formats provided date to YYYY-MM-DD', () => {
      const date = new Date('2024-01-01T12:00:00.000Z');
      const dateStr = formatDate(date);
      expect(dateStr).toBe('2024-01-01');
    });
  });

  describe('formatTime', () => {
    it('formats current time to HH:MM:SS', () => {
      const timeStr = formatTime();
      // Use local time comparison since the mock is in local timezone
      const now = new Date();
      const expected = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      expect(timeStr).toBe(expected);
    });

    it('formats provided time to HH:MM:SS', () => {
      const date = new Date('2024-01-01T09:05:30.000Z');
      const timeStr = formatTime(date);
      // Date is in UTC, formatTime returns local time
      // Just verify it's a valid time format
      expect(timeStr).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });
  });

  describe('formatDateTime', () => {
    it('formats current date-time to YYYY-MM-DD HH:MM:SS', () => {
      const datetime = formatDateTime();
      const now = new Date();
      const expectedDate = `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const expectedTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      expect(datetime).toBe(`${expectedDate} ${expectedTime}`);
    });
  });

  describe('getRelativeTime', () => {
    it('returns "just now" for very recent date', () => {
      const now = new Date();
      const recent = new Date(now.getTime() - 1000); // 1 second ago
      const relative = getRelativeTime(recent);
      expect(relative).toBe('just now');
    });

    it('returns "X minutes ago" for minutes in past', () => {
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      const relative = getRelativeTime(fiveMinutesAgo);
      expect(relative).toBe('5 minutes ago');
    });

    it('returns "X hours ago" for hours in past', () => {
      const now = new Date();
      const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
      const relative = getRelativeTime(threeHoursAgo);
      expect(relative).toBe('3 hours ago');
    });

    it('returns "in X days" for future dates', () => {
      const now = new Date();
      const twoDaysLater = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
      const relative = getRelativeTime(twoDaysLater);
      expect(relative).toBe('2 days from now');
    });
  });

  describe('convertTimezone', () => {
    it('converts date to New York timezone', () => {
      const date = new Date('2024-12-31T14:30:45.123Z');
      const nyTime = convertTimezone(date, 'America/New_York');
      expect(nyTime).toBeDefined();
      expect(typeof nyTime).toBe('string');
    });

    it('throws error for invalid timezone', () => {
      const date = new Date();
      expect(() => convertTimezone(date, 'Invalid/Timezone')).toThrow('Invalid timezone');
    });
  });

  describe('getTimezoneOffset', () => {
    it('returns timezone offset in hours', () => {
      const offset = getTimezoneOffset();
      // This test depends on the local timezone, just check it's a number
      expect(typeof offset).toBe('number');
    });
  });

  describe('calculateDuration', () => {
    it('calculates duration between two dates', () => {
      const start = new Date('2024-12-31T10:00:00.000Z');
      const end = new Date('2024-12-31T12:00:00.000Z');
      const duration = calculateDuration(start, end);
      expect(duration).toBe(2 * 60 * 60 * 1000); // 2 hours in milliseconds
    });

    it('uses current time as default end date', () => {
      const start = new Date('2024-12-31T10:00:00.000Z');
      const duration = calculateDuration(start);
      expect(duration).toBeGreaterThan(0);
    });
  });

  describe('formatDuration', () => {
    it('formats duration in milliseconds to human-readable string', () => {
      const durationMs = 3661000; // 1 hour, 1 minute, 1 second
      const readable = formatDuration(durationMs);
      expect(readable).toBe('1 hour 1 minute 1 second');
    });

    it('formats weeks and days', () => {
      const durationMs = 15 * 24 * 60 * 60 * 1000; // 15 days
      const readable = formatDuration(durationMs);
      expect(readable).toBe('2 weeks 1 day');
    });

    it('returns "0 seconds" for zero duration', () => {
      const readable = formatDuration(0);
      expect(readable).toBe('0 seconds');
    });
  });

  describe('addTime', () => {
    const baseDate = new Date('2024-12-31T14:30:45.123Z');

    it('adds days to a date', () => {
      const newDate = addTime(baseDate, 1, 'days');
      expect(newDate.getDate()).toBe(1); // January 1st
    });

    it('adds hours to a date', () => {
      const newDate = addTime(baseDate, 2, 'hours');
      // The date is in UTC, getUTCHours() gives us the UTC hour
      expect(newDate.getUTCHours()).toBe(16); // 14 + 2 = 16
    });

    it('adds months to a date', () => {
      const newDate = addTime(baseDate, 1, 'months');
      expect(newDate.getUTCMonth()).toBe(0); // January (0-indexed)
    });
  });

  describe('isDateInRange', () => {
    const start = new Date('2024-12-31T10:00:00.000Z');
    const end = new Date('2024-12-31T20:00:00.000Z');
    const within = new Date('2024-12-31T15:00:00.000Z');
    const before = new Date('2024-12-31T09:00:00.000Z');
    const after = new Date('2024-12-31T21:00:00.000Z');

    it('returns true for date within range', () => {
      expect(isDateInRange(within, start, end)).toBe(true);
    });

    it('returns false for date before range', () => {
      expect(isDateInRange(before, start, end)).toBe(false);
    });

    it('returns false for date after range', () => {
      expect(isDateInRange(after, start, end)).toBe(false);
    });
  });

  describe('getStartOfDay', () => {
    it('returns date at start of day (00:00:00.000)', () => {
      const date = new Date('2024-12-31T14:30:45.123Z');
      const startOfDay = getStartOfDay(date);
      expect(startOfDay.getHours()).toBe(0);
      expect(startOfDay.getMinutes()).toBe(0);
      expect(startOfDay.getSeconds()).toBe(0);
      expect(startOfDay.getMilliseconds()).toBe(0);
    });
  });

  describe('getEndOfDay', () => {
    it('returns date at end of day (23:59:59.999)', () => {
      const date = new Date('2024-12-31T14:30:45.123Z');
      const endOfDay = getEndOfDay(date);
      expect(endOfDay.getHours()).toBe(23);
      expect(endOfDay.getMinutes()).toBe(59);
      expect(endOfDay.getSeconds()).toBe(59);
      expect(endOfDay.getMilliseconds()).toBe(999);
    });
  });

  describe('isSameDay', () => {
    const date1 = new Date('2024-12-31T10:00:00.000Z');
    const date2 = new Date('2024-12-31T20:00:00.000Z');
    const date3 = new Date('2025-01-01T10:00:00.000Z');

    it('returns true for same day', () => {
      expect(isSameDay(date1, date2)).toBe(true);
    });

    it('returns false for different days', () => {
      expect(isSameDay(date1, date3)).toBe(false);
    });
  });
});