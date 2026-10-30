/**
 * RD-12 — delegation briefs + follow-through, pure helpers.
 *
 * The brief is built ONLY from fields the user typed or ticked; nothing here
 * calls the network or an LLM, and the brief text is never stored. Deadlines
 * are end-of-UTC-day instants (`endOfUtcDay`), so every label formats with
 * `timeZone: 'UTC'` and prints the calendar date the user picked.
 */
import { daysOverdue, daysUntil, isDelegation } from '@boardroom/shared';
import type { CommitmentNudgeItem, CommitmentNudgesResponse } from '@boardroom/shared';

/** Default "By" when the source has no usable deadline: a week from today. */
export const DELEGATION_DEFAULT_DAYS = 7;
/** What is stored as the commitment description — keep it short (and pastoral detail out). */
export const DELEGATION_WHAT_MAX = 200;
export const DELEGATION_DONE_WHEN_MAX = 140;
export const DELEGATION_DONE_WHEN_LINES = 5;
export const DELEGATION_DEFAULT_DONE_WHEN = "It's finished and you've let me know";

/** "  Sam   Rivera " → "Sam". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name.trim();
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date `YYYY-MM-DD`. */
export function localYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Calendar arithmetic on a `YYYY-MM-DD` string (timezone-free). */
export function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/**
 * A `YYYY-MM-DD` the user may save as a delegation date: a real calendar date
 * no earlier than `minYmd` (local tomorrow). An HTML `min` is only advisory,
 * and a date input that is still being typed reports values like `0002-12-25`
 * (the first year digit), so every save path checks this first.
 */
export function isPickableYmd(ymd: string, minYmd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d);
  if (t.toISOString().slice(0, 10) !== ymd) return false; // 2027-02-30 and friends
  return ymd >= minYmd;
}

/** The task's own deadline when it is at least a day away, else local today + 7. */
export function defaultDeadlineYmd(taskDeadline: Date | string | null, now: Date): string {
  if (taskDeadline) {
    const t = new Date(taskDeadline);
    if (!Number.isNaN(t.getTime()) && daysUntil(t, now) >= 1) return t.toISOString().slice(0, 10);
  }
  return addDaysYmd(localYmd(now), DELEGATION_DEFAULT_DAYS);
}

/** "Saturday, Nov 7" — UTC, so the picked date never shifts a day. */
export function dateLabel(deadline: Date | string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(deadline));
}

export interface BriefFields {
  name: string;
  what: string;
  why: string[];
  deadline: Date | string;
  doneWhen: string[];
  context: string[];
}

const clean = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean);

/** The brief, exactly. Bracketed sections in the spec are omitted when empty. */
export function composeBrief({ name, what, why, deadline, doneWhen, context }: BriefFields): string {
  const whyItems = clean(why);
  const doneItems = clean(doneWhen);
  const contextItems = clean(context);
  const lines: string[] = [
    `Hi ${firstName(name)},`,
    '',
    'Could you take this on?',
    '',
    `What: ${what.trim()}`,
  ];
  if (whyItems.length) lines.push(`Why: ${whyItems.join('; ')}`);
  lines.push(`By: ${dateLabel(deadline)}`);
  lines.push('Done when:');
  for (const d of doneItems) lines.push(`- ${d}`);
  if (contextItems.length) {
    lines.push('Context:');
    for (const c of contextItems) lines.push(`- ${c}`);
  }
  lines.push('', "Reply to confirm you've got it, or tell me what's in the way.");
  return lines.join('\n');
}

/** A short check-in message for an open delegation. */
export function composeCheckIn({ name, description, deadline }: { name: string; description: string; deadline: Date | string }, now: Date | number): string {
  const who = firstName(name);
  if (daysOverdue(deadline, now) > 0) {
    return `Hi ${who}, checking in on "${description}". It was due ${dateLabel(deadline)}. Where are things? If it's stuck, tell me what you need.`;
  }
  return `Hi ${who}, quick check on "${description}". It's due ${dateLabel(deadline)}. Still on track?`;
}

/** "1 day overdue" / "due today" / "due tomorrow" / "due in 3 days" — shared day helpers. */
export function delegationDueLabel(deadline: Date | string | null, now: Date | number): string {
  if (!deadline) return 'no deadline';
  const over = daysOverdue(deadline, now);
  if (over > 0) return `${over} day${over === 1 ? '' : 's'} overdue`;
  const until = daysUntil(deadline, now);
  if (until <= 0) return 'due today';
  if (until === 1) return 'due tomorrow';
  return `due in ${until} days`;
}

export interface NudgePartition {
  mine: { overdue: CommitmentNudgeItem[]; dueSoon: CommitmentNudgeItem[] };
  waiting: { overdue: CommitmentNudgeItem[]; dueSoon: CommitmentNudgeItem[] };
}

/** What the user owes vs what others owe the user, from one nudges response. */
export function partitionNudges(res: CommitmentNudgesResponse): NudgePartition {
  const mine = (c: CommitmentNudgeItem) => !isDelegation(c);
  return {
    mine: { overdue: res.overdue.filter(mine), dueSoon: res.dueSoon.filter(mine) },
    waiting: { overdue: res.overdue.filter(isDelegation), dueSoon: res.dueSoon.filter(isDelegation) },
  };
}

/** Event the dialog fires after recording; the nudges widget reloads on it. */
export const COMMITMENTS_CHANGED_EVENT = 'boardroom:commitments-changed';
