import { describe, it, expect, afterEach } from 'vitest';
import type { CommitmentNudgeItem } from '@boardroom/shared';
import {
  addDaysYmd,
  composeBrief,
  composeCheckIn,
  dateLabel,
  defaultDeadlineYmd,
  delegationDueLabel,
  firstName,
  isPickableYmd,
  localYmd,
  partitionNudges,
} from '../../src/lib/delegation';

/** RD-12 — pure brief / check-in / label helpers. Invented names only. */

const DEADLINE = '2026-11-07T23:59:59.999Z';
const ORIGINAL_TZ = process.env.TZ;
afterEach(() => { process.env.TZ = ORIGINAL_TZ; });

describe('firstName / dates', () => {
  it('firstName trims and takes the first word', () => {
    expect(firstName('  Sam   Rivera ')).toBe('Sam');
    expect(firstName('Lee')).toBe('Lee');
  });

  it('addDaysYmd does calendar arithmetic across month ends', () => {
    expect(addDaysYmd('2026-10-28', 7)).toBe('2026-11-04');
    expect(addDaysYmd('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('localYmd formats the local calendar date', () => {
    expect(localYmd(new Date(2026, 10, 7, 23, 30))).toBe('2026-11-07');
  });

  it('dateLabel uses UTC: the same picked date in Chicago and Tokyo', () => {
    // 23:59:59.999Z is already Nov 8 in Tokyo; dateLabel pins timeZone UTC so it never shifts.
    for (const tz of ['America/Chicago', 'Asia/Tokyo']) {
      process.env.TZ = tz;
      expect(dateLabel(DEADLINE)).toBe('Saturday, Nov 7');
    }
  });
});

describe('composeBrief', () => {
  it('(a) no why / context — exact text', () => {
    expect(composeBrief({
      name: 'Sam Rivera',
      what: 'Send the volunteer rota',
      why: [],
      deadline: DEADLINE,
      doneWhen: ["It's finished and you've let me know"],
      context: [],
    })).toBe([
      'Hi Sam,',
      '',
      'Could you take this on?',
      '',
      'What: Send the volunteer rota',
      `By: ${dateLabel(DEADLINE)}`,
      'Done when:',
      "- It's finished and you've let me know",
      '',
      "Reply to confirm you've got it, or tell me what's in the way.",
    ].join('\n'));
  });

  it('(b) two why items plus context — exact text; empty strings are filtered', () => {
    expect(composeBrief({
      name: 'Sam Rivera',
      what: 'Book the hall',
      why: ['We decided: Host it in March', '', 'Part of Harvest fair'],
      deadline: DEADLINE,
      doneWhen: ['Hall confirmed in writing', '  ', 'Deposit paid'],
      context: ['Expected outcome: 80 families attend', ''],
    })).toBe([
      'Hi Sam,',
      '',
      'Could you take this on?',
      '',
      'What: Book the hall',
      'Why: We decided: Host it in March; Part of Harvest fair',
      `By: ${dateLabel(DEADLINE)}`,
      'Done when:',
      '- Hall confirmed in writing',
      '- Deposit paid',
      'Context:',
      '- Expected outcome: 80 families attend',
      '',
      "Reply to confirm you've got it, or tell me what's in the way.",
    ].join('\n'));
  });

  it('rationale never appears unless passed in why', () => {
    const brief = composeBrief({ name: 'Sam', what: 'x', why: [], deadline: DEADLINE, doneWhen: ['y'], context: [] });
    expect(brief).not.toContain('Reasoning');
    expect(brief).not.toContain('Why:');
  });
});

describe('composeCheckIn', () => {
  it('overdue and due-soon variants', () => {
    expect(composeCheckIn({ name: 'Sam Rivera', description: 'Send the volunteer rota', deadline: DEADLINE }, Date.parse('2026-11-08T10:00:00Z')))
      .toBe(`Hi Sam, checking in on "Send the volunteer rota". It was due ${dateLabel(DEADLINE)}. Where are things? If it's stuck, tell me what you need.`);
    expect(composeCheckIn({ name: 'Sam Rivera', description: 'Send the volunteer rota', deadline: DEADLINE }, Date.parse('2026-11-06T10:00:00Z')))
      .toBe(`Hi Sam, quick check on "Send the volunteer rota". It's due ${dateLabel(DEADLINE)}. Still on track?`);
  });
});

describe('defaultDeadlineYmd', () => {
  const now = new Date(2026, 10, 1, 9, 0); // local 2026-11-01
  it('uses a future task deadline (≥ 1 day away)', () => {
    expect(defaultDeadlineYmd('2026-11-20T23:59:59.999Z', now)).toBe('2026-11-20');
  });
  it('a past or less-than-a-day-away task deadline gives local today + 7', () => {
    expect(defaultDeadlineYmd('2026-10-01T00:00:00.000Z', now)).toBe('2026-11-08');
    expect(defaultDeadlineYmd(new Date(now.getTime() + 3_600_000), now)).toBe('2026-11-08');
  });
  it('no deadline gives local today + 7', () => {
    expect(defaultDeadlineYmd(null, now)).toBe('2026-11-08');
  });
});

describe('delegationDueLabel', () => {
  it('overdue / today / tomorrow / N days', () => {
    expect(delegationDueLabel(DEADLINE, Date.parse('2026-11-08T10:00:00Z'))).toBe('1 day overdue');
    expect(delegationDueLabel(DEADLINE, Date.parse('2026-11-10T10:00:00Z'))).toBe('3 days overdue');
    expect(delegationDueLabel(DEADLINE, Date.parse('2026-11-07T15:00:00Z'))).toBe('due today');
    expect(delegationDueLabel(DEADLINE, Date.parse('2026-11-06T15:00:00Z'))).toBe('due tomorrow');
    expect(delegationDueLabel(DEADLINE, Date.parse('2026-11-04T15:00:00Z'))).toBe('due in 3 days');
    expect(delegationDueLabel(null, Date.parse('2026-11-04T15:00:00Z'))).toBe('no deadline');
  });
});

describe('partitionNudges', () => {
  it('splits by owedBy (missing = mine)', () => {
    const row = (id: string, owedBy?: 'USER' | 'STAKEHOLDER') => ({ id, owedBy, stakeholderName: null } as unknown as CommitmentNudgeItem);
    const res = partitionNudges({ overdue: [row('a', 'USER'), row('b', 'STAKEHOLDER')], dueSoon: [row('c'), row('d', 'STAKEHOLDER')] });
    expect(res.mine.overdue.map((c) => c.id)).toEqual(['a']);
    expect(res.mine.dueSoon.map((c) => c.id)).toEqual(['c']);
    expect(res.waiting.overdue.map((c) => c.id)).toEqual(['b']);
    expect(res.waiting.dueSoon.map((c) => c.id)).toEqual(['d']);
    expect(res.waiting.later).toEqual([]);
  });

  it('waitingLater delegations land in waiting.later (an older server without the field → [])', () => {
    const row = (id: string, owedBy?: 'USER' | 'STAKEHOLDER') => ({ id, owedBy, stakeholderName: null } as unknown as CommitmentNudgeItem);
    const res = partitionNudges({ overdue: [], dueSoon: [], waitingLater: [row('e', 'STAKEHOLDER')] });
    expect(res.waiting.later.map((c) => c.id)).toEqual(['e']);
    expect(res.mine.overdue).toEqual([]);
  });
});

describe('isPickableYmd', () => {
  it('accepts a real date on or after the minimum', () => {
    expect(isPickableYmd('2027-12-25', '2026-10-25')).toBe(true);
    expect(isPickableYmd('2026-10-25', '2026-10-25')).toBe(true);
  });
  it('rejects a partly typed year, a past date, an impossible date and junk', () => {
    expect(isPickableYmd('0002-12-25', '2026-10-25')).toBe(false);
    expect(isPickableYmd('0202-12-25', '2026-10-25')).toBe(false);
    expect(isPickableYmd('2026-01-31', '2026-10-25')).toBe(false);
    expect(isPickableYmd('2027-02-30', '2026-10-25')).toBe(false);
    expect(isPickableYmd('', '2026-10-25')).toBe(false);
    expect(isPickableYmd('20271-01-01', '2026-10-25')).toBe(false);
  });
});
