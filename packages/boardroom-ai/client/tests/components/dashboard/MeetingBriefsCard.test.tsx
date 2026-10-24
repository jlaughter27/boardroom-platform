import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MeetingBriefsResponse, PersonBrief } from '@boardroom/shared';
import { MeetingBriefsResponseSchema } from '@boardroom/shared';
import * as api from '../../../src/lib/api';
import { MeetingBriefsCard } from '../../../src/components/dashboard/MeetingBriefsCard';
import { useUIStore } from '../../../src/stores/ui.store';

vi.mock('../../../src/lib/api', () => ({ getMeetingBriefs: vi.fn() }));

const zeros = { noKnownPeople: 0, overCap: 0, allDayOrDeclined: 0 };
const base = { generatedAt: '2026-10-24T08:00:00.000Z', windowEnd: '2026-10-25T08:00:00.000Z', briefs: {}, events: [], omitted: zeros, partial: false };

const avery: PersonBrief = {
  personId: 'p1', name: 'Avery Testperson', role: 'Elder', relationshipToUser: null,
  headline: 'You owe Avery 1 overdue · Avery owes you 2 · last touch 12d ago',
  lastInteractionAt: '2026-10-12T08:00:00.000Z',
  capsule: { summary: 'Leads the youth rota; asked about the budget twice.', generatedAt: '2026-10-20T02:00:00.000Z', stale: true },
  recentMemories: [],
  youOwe: [{ id: 'c1', description: 'Send the rota draft', deadline: '2026-10-20T00:00:00.000Z', overdue: true }],
  theyOwe: [{ id: 't1', title: 'Volunteer list', deadline: null, status: 'pending' }, { id: 't2', title: 'Room booking', deadline: null, status: 'in progress' }],
  decisions: [{ id: 'd1', title: 'Move the retreat to spring', status: 'DECIDED', at: '2026-10-01T00:00:00.000Z', via: 'project' }],
  counts: { memories: 0, youOwe: 1, youOweOverdue: 1, theyOwe: 4, decisions: 1 },
};
const bo: PersonBrief = { ...avery, personId: 'p2', name: 'Bo Lindqvist', role: null, headline: 'no recorded interaction', capsule: null, youOwe: [], theyOwe: [], decisions: [], counts: { memories: 0, youOwe: 0, youOweOverdue: 0, theyOwe: 0, decisions: 0 } };

const connected: MeetingBriefsResponse = {
  ...base,
  calendar: 'connected',
  events: [
    { id: 'g1', title: 'Lunch w/ Avery', startTime: '2026-10-24T11:30:00.000Z', endTime: '2026-10-24T12:30:00.000Z', location: null, attendeeCount: 1,
      knownPeople: [{ personId: 'p1', displayName: 'Avery Testperson', method: 'title_first_name' }], unknownAttendees: 0, ambiguousAttendees: 0, morePeople: 0 },
    { id: 'g2', title: 'Staff sync', startTime: '2026-10-24T14:00:00.000Z', endTime: '2026-10-24T15:00:00.000Z', location: 'Room 4', attendeeCount: 5,
      knownPeople: [{ personId: 'p2', displayName: 'Bo Lindqvist', method: 'exact' }], unknownAttendees: 2, ambiguousAttendees: 1, morePeople: 0 },
  ],
  briefs: { p1: avery, p2: bo },
};

const renderCard = () => render(<MemoryRouter><MeetingBriefsCard /></MemoryRouter>);

describe('<MeetingBriefsCard /> (RD-13)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUIStore.setState({ dismissedQuestions: new Set() });
  });

  it('fixture payload is contract-valid', () => {
    expect(MeetingBriefsResponseSchema.safeParse(connected).success).toBe(true);
  });

  it('not_configured renders nothing', async () => {
    vi.mocked(api.getMeetingBriefs).mockResolvedValue({ ...base, calendar: 'not_configured' });
    const { container } = renderCard();
    await waitFor(() => expect(api.getMeetingBriefs).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('a malformed payload (null) renders nothing', async () => {
    vi.mocked(api.getMeetingBriefs).mockResolvedValue(null);
    const { container } = renderCard();
    await waitFor(() => expect(api.getMeetingBriefs).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('not_connected renders the dismissible calendar nudge', async () => {
    vi.mocked(api.getMeetingBriefs).mockResolvedValue({ ...base, calendar: 'not_connected' });
    renderCard();
    expect(await screen.findByText('Connect your calendar for meeting prep')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss nudge' }));
    expect(useUIStore.getState().dismissedQuestions.has('nudge-calendar-briefs')).toBe(true);
  });

  it('unavailable renders Retry, which refetches with refresh', async () => {
    vi.mocked(api.getMeetingBriefs).mockResolvedValue({ ...base, calendar: 'unavailable' });
    renderCard();
    expect(await screen.findByText('Calendar unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.getMeetingBriefs).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.getMeetingBriefs).mock.calls[1][0]).toEqual({ refresh: true });
  });

  it('connected with no events renders one muted line and no button', async () => {
    vi.mocked(api.getMeetingBriefs).mockResolvedValue({ ...base, calendar: 'connected' });
    renderCard();
    expect(await screen.findByText(/No meetings with people you track/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('connected with events: collapsed rows with headlines, ~ chip, +N; exactly one fetch', async () => {
    vi.mocked(api.getMeetingBriefs).mockResolvedValue(connected);
    renderCard();
    expect(await screen.findByText('Meeting prep · next 24 h')).toBeInTheDocument();
    const rows = screen.getAllByTestId('meeting-brief-row');
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(within(r).getAllByRole('button')[0]).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByTestId('meeting-brief-headline').map((n) => n.textContent)).toEqual([avery.headline, bo.headline]);
    const chip = within(rows[0]).getByTestId('meeting-brief-chip');
    expect(chip).toHaveAttribute('title', 'matched from event title');
    // The "~" is visual only; keyboard / touch / screen-reader users get the words.
    expect(within(chip).getByText('~')).toHaveAttribute('aria-hidden', 'true');
    expect(within(chip).getByText('(matched from event title)')).toHaveClass('sr-only');
    expect(within(rows[1]).getByTestId('meeting-brief-chip').textContent).toBe('Bo Lindqvist');
    // aria-controls only points at the panel while it exists.
    for (const r of rows) expect(within(r).getAllByRole('button')[0]).not.toHaveAttribute('aria-controls');
    expect(within(rows[1]).getByText('+3')).toBeInTheDocument();
    expect(screen.queryByText('Send the rota draft')).toBeNull();
    expect(api.getMeetingBriefs).toHaveBeenCalledTimes(1);
  });

  it('expanding a row shows the sections in order and hides empty ones', async () => {
    vi.mocked(api.getMeetingBriefs).mockResolvedValue(connected);
    renderCard();
    const rows = await screen.findAllByTestId('meeting-brief-row');
    const toggle = within(rows[0]).getAllByRole('button')[0];
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panelId = toggle.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId!)).toContainElement(screen.getByTestId('brief-p1'));
    const detail = screen.getByTestId('brief-p1');
    const order = [...detail.querySelectorAll('[data-section]')].map((n) => n.getAttribute('data-section'));
    expect(order).toEqual(['You owe', 'They owe you', 'Decisions', 'capsule']); // no "Recent": empty
    expect(within(detail).getByText('Send the rota draft')).toBeInTheDocument();
    expect(within(detail).getByText('+2 more')).toBeInTheDocument();
    expect(within(detail).getByRole('link', { name: 'Move the retreat to spring' })).toHaveAttribute('href', '/decisions/d1');
    expect(within(detail).getByText(/\(stale\)/)).toBeInTheDocument();

    fireEvent.click(within(rows[1]).getAllByRole('button')[0]);
    const boDetail = screen.getByTestId('brief-p2');
    expect(boDetail.querySelectorAll('[data-section]')).toHaveLength(0);
  });
});
