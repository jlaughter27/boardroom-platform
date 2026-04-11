// Date and time utilities
// Provides ISO formatting, relative time, timezone conversion, and duration calculation

/**
 * Format a date to ISO 8601 string (YYYY-MM-DDTHH:mm:ss.sssZ).
 * @param date - Date to format (defaults to current date/time)
 * @returns ISO 8601 formatted string
 * @example
 * ```ts
 * const iso = formatIso(); // Current time in ISO format
 * const iso = formatIso(new Date('2024-01-01'));
 * ```
 */
export const formatIso = (date: Date = new Date()): string => {
  return date.toISOString();
};

/**
 * Format a date to a human-readable date string (YYYY-MM-DD).
 * @param date - Date to format (defaults to current date)
 * @returns Date string in YYYY-MM-DD format
 * @example
 * ```ts
 * const dateStr = formatDate(); // '2024-12-31'
 * ```
 */
export const formatDate = (date: Date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Format a date to a human-readable time string (HH:MM:SS).
 * @param date - Date to format (defaults to current time)
 * @returns Time string in HH:MM:SS format (24-hour)
 * @example
 * ```ts
 * const timeStr = formatTime(); // '14:30:45'
 * ```
 */
export const formatTime = (date: Date = new Date()): string => {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
};

/**
 * Format a date to a human-readable date-time string (YYYY-MM-DD HH:MM:SS).
 * @param date - Date to format (defaults to current date/time)
 * @returns Date-time string in YYYY-MM-DD HH:MM:SS format
 * @example
 * ```ts
 * const datetime = formatDateTime(); // '2024-12-31 14:30:45'
 * ```
 */
export const formatDateTime = (date: Date = new Date()): string => {
  return `${formatDate(date)} ${formatTime(date)}`;
};

/**
 * Get relative time string (e.g., "2 hours ago", "in 3 days").
 * @param date - Date to calculate relative time for
 * @returns Human-readable relative time string
 * @example
 * ```ts
 * const relative = getRelativeTime(new Date(Date.now() - 3600000)); // '1 hour ago'
 * ```
 */
export const getRelativeTime = (date: Date): string => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(Math.abs(diffMs) / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  const isFuture = diffMs < 0;
  const suffix = isFuture ? 'from now' : 'ago';

  if (diffSeconds < 60) {
    return diffSeconds === 1 ? 'just now' : `${diffSeconds} seconds ${suffix}`;
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ${suffix}`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ${suffix}`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ${suffix}`;
  } else if (diffWeeks < 4) {
    return `${diffWeeks} week${diffWeeks === 1 ? '' : 's'} ${suffix}`;
  } else if (diffMonths < 12) {
    return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ${suffix}`;
  } else {
    return `${diffYears} year${diffYears === 1 ? '' : 's'} ${suffix}`;
  }
};

/**
 * Convert a date to a specific timezone (returns ISO string in that timezone).
 * Note: This doesn't change the actual Date object (which is always UTC).
 * @param date - Date to convert
 * @param timezone - IANA timezone identifier (e.g., 'America/New_York')
 * @returns ISO string representing the date in the target timezone
 * @example
 * ```ts
 * const nyTime = convertTimezone(new Date(), 'America/New_York');
 * ```
 */
export const convertTimezone = (date: Date, timezone: string): string => {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  } catch (error) {
    throw new Error(`Invalid timezone: ${timezone}. ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Get the current timezone offset in hours.
 * @param date - Date to check offset for (defaults to current date)
 * @returns Timezone offset in hours (e.g., -5 for EST)
 * @example
 * ```ts
 * const offset = getTimezoneOffset(); // -5 (for EST)
 * ```
 */
export const getTimezoneOffset = (date: Date = new Date()): number => {
  return date.getTimezoneOffset() / -60; // Convert minutes to hours, invert sign
};

/**
 * Calculate duration between two dates in milliseconds.
 * @param start - Start date
 * @param end - End date (defaults to current time)
 * @returns Duration in milliseconds
 * @example
 * ```ts
 * const duration = calculateDuration(startDate, endDate);
 * ```
 */
export const calculateDuration = (start: Date, end: Date = new Date()): number => {
  return Math.abs(end.getTime() - start.getTime());
};

/**
 * Format a duration in milliseconds to a human-readable string.
 * @param durationMs - Duration in milliseconds
 * @returns Human-readable duration string
 * @example
 * ```ts
 * const readable = formatDuration(3661000); // '1 hour 1 minute 1 second'
 * ```
 */
export const formatDuration = (durationMs: number): string => {
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);

  const remainingSeconds = seconds % 60;
  const remainingMinutes = minutes % 60;
  const remainingHours = hours % 24;
  const remainingDays = days % 7;

  const parts: string[] = [];

  if (weeks > 0) parts.push(`${weeks} week${weeks === 1 ? '' : 's'}`);
  if (remainingDays > 0) parts.push(`${remainingDays} day${remainingDays === 1 ? '' : 's'}`);
  if (remainingHours > 0) parts.push(`${remainingHours} hour${remainingHours === 1 ? '' : 's'}`);
  if (remainingMinutes > 0) parts.push(`${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`);
  if (remainingSeconds > 0) parts.push(`${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'}`);

  return parts.length > 0 ? parts.join(' ') : '0 seconds';
};

/**
 * Add time to a date.
 * @param date - Base date
 * @param amount - Amount to add
 * @param unit - Unit of time to add ('milliseconds', 'seconds', 'minutes', 'hours', 'days', 'weeks', 'months', 'years')
 * @returns New date with time added
 * @example
 * ```ts
 * const tomorrow = addTime(new Date(), 1, 'days');
 * ```
 */
export const addTime = (
  date: Date,
  amount: number,
  unit: 'milliseconds' | 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years'
): Date => {
  const newDate = new Date(date);

  switch (unit) {
    case 'milliseconds':
      newDate.setMilliseconds(newDate.getMilliseconds() + amount);
      break;
    case 'seconds':
      newDate.setSeconds(newDate.getSeconds() + amount);
      break;
    case 'minutes':
      newDate.setMinutes(newDate.getMinutes() + amount);
      break;
    case 'hours':
      newDate.setHours(newDate.getHours() + amount);
      break;
    case 'days':
      newDate.setDate(newDate.getDate() + amount);
      break;
    case 'weeks':
      newDate.setDate(newDate.getDate() + (amount * 7));
      break;
    case 'months':
      newDate.setMonth(newDate.getMonth() + amount);
      break;
    case 'years':
      newDate.setFullYear(newDate.getFullYear() + amount);
      break;
  }

  return newDate;
};

/**
 * Check if a date is within a date range (inclusive).
 * @param date - Date to check
 * @param start - Start of range
 * @param end - End of range
 * @returns True if date is within range
 * @example
 * ```ts
 * const isInRange = isDateInRange(checkDate, startDate, endDate);
 * ```
 */
export const isDateInRange = (date: Date, start: Date, end: Date): boolean => {
  const time = date.getTime();
  return time >= start.getTime() && time <= end.getTime();
};

/**
 * Get the start of the day (00:00:00.000) for a given date.
 * @param date - Date to get start of day for
 * @returns Date at start of day
 * @example
 * ```ts
 * const startOfDay = getStartOfDay(new Date());
 * ```
 */
export const getStartOfDay = (date: Date): Date => {
  const newDate = new Date(date);
  newDate.setHours(0, 0, 0, 0);
  return newDate;
};

/**
 * Get the end of the day (23:59:59.999) for a given date.
 * @param date - Date to get end of day for
 * @returns Date at end of day
 * @example
 * ```ts
 * const endOfDay = getEndOfDay(new Date());
 * ```
 */
export const getEndOfDay = (date: Date): Date => {
  const newDate = new Date(date);
  newDate.setHours(23, 59, 59, 999);
  return newDate;
};

/**
 * Check if two dates are the same day (ignoring time).
 * @param date1 - First date
 * @param date2 - Second date
 * @returns True if dates are the same day
 * @example
 * ```ts
 * const sameDay = isSameDay(date1, date2);
 * ```
 */
export const isSameDay = (date1: Date, date2: Date): boolean => {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
};