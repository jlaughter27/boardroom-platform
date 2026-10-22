import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { Commitment, Memory } from '@boardroom/shared';
import * as api from '../../../src/lib/api';
import { useVizStore } from '../../../src/stores/viz.store';
import { useEntitiesStore } from '../../../src/stores/entities.store';
import { MemoryPulseWidget, domainColors, memoryDomain } from '../../../src/components/dashboard/MemoryPulseWidget';
import { WhatsMovingWidget, buildMovingSeries, memoryClassKey } from '../../../src/components/dashboard/WhatsMovingWidget';
import { CommitmentHorizon, personSlots } from '../../../src/components/dashboard/CommitmentHorizon';
import { CommitmentNudgesWidget } from '../../../src/components/dashboard/CommitmentNudgesWidget';
import { modelShareRow, modelLabel, modelSlot } from '../../../src/components/dashboard/LlmCostWidget';
import { LIGHT_THEME } from '../../../src/components/viz/theme';

vi.mock('../../../src/lib/api', () => ({
  listMemoriesSince: vi.fn(),
  getCommitments: vi.fn(),
  getDecisions: vi.fn(),
  getPendingReviews: vi.fn(),
  getLlmUsageSummary: vi.fn(),
  getCommitmentNudges: vi.fn(),
  updateCommitment: vi.fn(),
  getPeople: vi.fn(),
}));

const NOW = Date.parse('2026-10-20T12:00:00.000Z');
const mem = (iso: string, domain = 'business', memoryClass = 'SEMANTIC') => ({ id: `${iso}-${domain}-${memoryClass}`, createdAt: iso, domain, memoryClass } as unknown as Memory);
const com = (id: string, deadline: string | null, stakeholderId: string | null = null, status = 'OPEN') => ({ id, deadline, stakeholderId, status, description: `Do ${id}` } as unknown as Commitment);

describe('aggregation helpers', () => {
  it('domainColors pins business/personal/ministry to slots 1-3 and folds extras after', () => {
    const c = domainColors(LIGHT_THEME.series, ['personal', 'zeta', 'alpha']);
    expect(c.business).toBe(LIGHT_THEME.series[0]);
    expect(c.personal).toBe(LIGHT_THEME.series[1]);
    expect(c.ministry).toBe(LIGHT_THEME.series[2]);
    expect(c.alpha).toBe(LIGHT_THEME.series[3]);
    expect(c.zeta).toBe(LIGHT_THEME.series[4]);
    expect(memoryDomain({ domain: 'Business' } as Memory)).toBe('business');
    expect(memoryDomain({ domain: '' } as Memory)).toBe('other');
  });
  it('buildMovingSeries keeps a fixed slot per memory class regardless of volume', () => {
    const memories = [mem('2026-10-19T01:00:00Z', 'business', 'DECISION'), mem('2026-10-19T02:00:00Z', 'business', 'DECISION'), mem('2026-10-13T01:00:00Z', 'business', 'WORKING'), mem('2026-10-13T01:00:00Z', 'business', 'weird')];
    const { series, xLabels } = buildMovingSeries(memories, LIGHT_THEME.series, NOW);
    expect(xLabels).toHaveLength(12);
    expect(series.map((s) => s.id)).toEqual(['WORKING', 'DECISION', 'other']);
    expect(buildMovingSeries(memories, LIGHT_THEME.series, NOW).partialLast).toBe(true);
    expect(series[0].color).toBe(LIGHT_THEME.series[0]);
    expect(series[1].color).toBe(LIGHT_THEME.series[3]);
    expect(series[1].values[11]).toBe(2);
    expect(memoryClassKey({ memoryClass: 'episodic' } as unknown as Memory)).toBe('EPISODIC');
  });
  it('personSlots ranks people by commitment count, caps at five, folds the rest', () => {
    const names = new Map([['p1', 'Ava'], ['p2', 'Ben'], ['p3', 'Cy'], ['p4', 'Di'], ['p5', 'Ed'], ['p6', 'Flo']]);
    const items = [com('a', null, 'p1'), com('b', null, 'p1'), com('c', null, 'p2'), com('d', null, 'p3'), com('e', null, 'p4'), com('f', null, 'p5'), com('g', null, 'p6'), com('h', null, null)];
    const s = personSlots(items, names, LIGHT_THEME.series);
    expect(s.order).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'other', 'none']);
    expect(s.color.p1).toBe(LIGHT_THEME.series[0]);
    expect(s.label.p1).toBe('Ava');
    expect(s.label.none).toBe('Unassigned');
  });
  it('modelShareRow: fixed slots (Sonnet 1, Haiku 2), labels, cache note', () => {
    expect(modelLabel('claude-sonnet-5-5')).toBe('Sonnet 5.5');
    expect(modelLabel('claude-haiku-4-5')).toBe('Haiku 4.5');
    expect(modelLabel('gpt-x')).toBe('gpt-x');
    expect(modelSlot('claude-haiku-4-5')).toBe(1);
    const row = modelShareRow([
      { model: 'claude-haiku-4-5', usd: 9, calls: 900, inputTokens: 1000, outputTokens: 500 },
      { model: 'claude-sonnet-5-5', usd: 1, calls: 10, inputTokens: 100, outputTokens: 50 },
    ], LIGHT_THEME.series, 0.42)!;
    expect(row.segments.map((s) => s.label)).toEqual(['Sonnet 5.5', 'Haiku 4.5']);
    expect(row.segments[1].color).toBe(LIGHT_THEME.series[1]);
    expect(row.note).toBe('· 42 % cache reads');
    expect(modelShareRow([], LIGHT_THEME.series, null)).toBeNull();
  });
});

describe('<MemoryPulseWidget /> and <WhatsMovingWidget />', () => {
  beforeEach(() => {
    useVizStore.getState().reset();
  });
  it('render the heatmap and stacked area from the shared memory slice (one fetch)', async () => {
    vi.mocked(api.listMemoriesSince).mockResolvedValue([mem(new Date(NOW).toISOString(), 'business', 'WORKING'), mem(new Date(NOW - 86_400_000).toISOString(), 'ministry', 'DECISION')]);
    render(<><MemoryPulseWidget now={NOW} /><WhatsMovingWidget now={NOW} /></>);
    await waitFor(() => expect(screen.getByTestId('memory-pulse-heatmap')).toBeInTheDocument());
    expect(api.listMemoriesSince).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('memory-pulse').textContent).toContain('2');
    expect(screen.getByRole('list', { name: 'Domains' }).textContent).toContain('Ministry');
    expect(screen.getByTestId('whats-moving-chart')).toBeInTheDocument();
    expect(screen.getByTestId('whats-moving').textContent).toContain('What\'s moving');
    expect(screen.getByRole('list', { name: 'Series' }).textContent).toContain('Working');
  });
  it('still look designed when there is nothing', async () => {
    vi.mocked(api.listMemoriesSince).mockResolvedValue([]);
    render(<><MemoryPulseWidget now={NOW} /><WhatsMovingWidget now={NOW} /></>);
    await waitFor(() => expect(screen.getByTestId('memory-pulse-heatmap')).toBeInTheDocument());
    expect(screen.getByTestId('memory-pulse').textContent).toContain('starts the pulse');
    expect(screen.getByTestId('memory-pulse-heatmap').querySelectorAll('svg g[role="img"]')).toHaveLength(84);
    expect(screen.getByTestId('whats-moving').textContent).toContain('No activity in this window yet');
  });
  it('report an unavailable history instead of crashing', async () => {
    vi.mocked(api.listMemoriesSince).mockRejectedValue(new Error('boom'));
    render(<MemoryPulseWidget now={NOW} />);
    await waitFor(() => expect(screen.getByTestId('memory-pulse').textContent).toContain('unavailable'));
  });
});

describe('<CommitmentHorizon />', () => {
  const names = new Map([['p1', 'Ava'], ['p2', 'Ben']]);
  it('places a dot per commitment, overdue in the danger shelf, with a people legend and table', () => {
    const items = [com('late', '2026-10-15T00:00:00Z', 'p1'), com('soon', '2026-10-22T00:00:00Z', 'p2'), com('far', '2026-12-01T00:00:00Z', 'p1'), com('done', '2026-10-21T00:00:00Z', 'p1', 'COMPLETED')];
    const { container } = render(<CommitmentHorizon commitments={items} nameById={names} now={NOW} />);
    const dots = container.querySelectorAll('svg g[role="img"]');
    expect(dots).toHaveLength(2);
    expect(container.querySelectorAll('g[data-overdue="true"]')).toHaveLength(1);
    expect(container.querySelector('svg title')!.textContent).toContain('1 due in the next 14 days, 1 overdue, 1 later');
    expect(screen.getByRole('list', { name: 'People' }).textContent).toContain('Ava');
    expect(screen.getByText('+1 later')).toBeInTheDocument();
    const table = container.querySelector('table[data-viz-table]')!;
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
    fireEvent.focus(dots[1]);
    expect(container.querySelector('[data-viz-tooltip]')!.textContent).toContain('Do soon');
    expect(container.querySelector('[data-viz-tooltip]')!.textContent).toContain('Ben');
  });
  it('renders nothing when no open commitment has a deadline on the horizon', () => {
    const { container } = render(<CommitmentHorizon commitments={[com('x', null, 'p1')]} nameById={names} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('<CommitmentNudgesWidget /> keeps Mark done working above the horizon', () => {
  beforeEach(() => {
    useVizStore.getState().reset();
    useEntitiesStore.setState({ people: [{ id: 'p1', name: 'Ava' }] as never, fetchPeople: vi.fn(async () => {}) });
  });
  it('shows the horizon, the nudge list, and removes a completed commitment from both', async () => {
    const soon = com('soon', new Date(Date.now() + 86_400_000).toISOString(), 'p1');
    const later = com('later', new Date(Date.now() + 9 * 86_400_000).toISOString(), 'p1');
    vi.mocked(api.getCommitmentNudges).mockResolvedValue({ overdue: [], dueSoon: [soon] });
    // The server list reflects the completion on the refetch that follows Mark done.
    vi.mocked(api.getCommitments).mockResolvedValueOnce([soon, later]).mockResolvedValue([later]);
    vi.mocked(api.updateCommitment).mockResolvedValue(soon);
    render(<CommitmentNudgesWidget />);
    await waitFor(() => expect(screen.getByTestId('commitment-horizon')).toBeInTheDocument());
    expect(screen.getByTestId('commitment-nudges').querySelectorAll('svg g[role="img"]')).toHaveLength(2);
    expect(screen.getByText('2 in 14 d')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(api.updateCommitment).toHaveBeenCalledWith('soon', expect.objectContaining({ status: 'COMPLETED' })));
    await waitFor(() => expect(screen.getByTestId('commitment-horizon').querySelectorAll('svg g[role="img"]')).toHaveLength(1));
    expect(screen.queryByText('Do soon')).toBeNull();
  });
  it('still disappears when there is nothing at all', async () => {
    vi.mocked(api.getCommitmentNudges).mockResolvedValue({ overdue: [], dueSoon: [] });
    vi.mocked(api.getCommitments).mockResolvedValue([]);
    const { container } = render(<CommitmentNudgesWidget />);
    await waitFor(() => expect(api.getCommitments).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
