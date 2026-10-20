import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CalibrationBin, CalibrationReport, Decision, Project } from '@boardroom/shared';
import * as api from '../../../src/lib/api';
import { useEntitiesStore } from '../../../src/stores/entities.store';
import { CalibrationPanel } from '../../../src/components/decision/CalibrationPanel';
import { WhatChangedCard, buildChangeEvents, TIMELINE_MAX } from '../../../src/components/decision/WhatChangedCard';
import type { DecisionChangesResponse } from '../../../src/types/debate';

vi.mock('../../../src/lib/api', () => ({
  getCalibration: vi.fn(),
  getDecisions: vi.fn(),
  getCapsules: vi.fn(),
  listSessions: vi.fn(),
  getDecisionChanges: vi.fn(),
}));

const bins = (counts: number[]): CalibrationBin[] => counts.map((count, i) => ({ lower: i * 0.2, upper: (i + 1) * 0.2, count, meanForecast: i * 0.2 + 0.1, observedRate: Math.min(1, i * 0.2 + 0.1) }));
const report = (reviewed: number): CalibrationReport => ({
  reviewedDecisions: reviewed, minimumForSignal: 20, successThreshold: 4,
  user: { brier: 0.19, bins: bins([2, 4, 8, 4, 2]) },
  personas: { critic: { brier: 0.3, count: 12, bins: bins([1, 3, 4, 3, 1]) }, doer: { brier: 0.2, count: 2, bins: bins([0, 0, 1, 1, 0]) } },
});

describe('<CalibrationPanel />', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('gates behind a progress ring until 20 reviews exist', async () => {
    vi.mocked(api.getCalibration).mockResolvedValue(report(12));
    render(<CalibrationPanel />);
    await waitFor(() => expect(screen.getByTestId('calibration-gate')).toBeInTheDocument());
    const ring = document.querySelector('[data-viz="progress-ring"]')!;
    expect(ring).toHaveAttribute('data-value', '0.600');
    expect(ring.textContent).toContain('12/20');
    expect(screen.getByText('Needs 8 more reviewed decisions')).toBeInTheDocument();
    expect(document.querySelector('[data-viz="reliability"]')).toBeNull();
  });

  it('renders the reliability diagram with a Brier badge, legend values, and a table toggle', async () => {
    vi.mocked(api.getCalibration).mockResolvedValue(report(24));
    render(<CalibrationPanel />);
    await waitFor(() => expect(screen.getByTestId('calibration-panel')).toBeInTheDocument());
    expect(screen.getByTestId('reliability-diagram')).toBeInTheDocument();
    expect(document.querySelector('[data-viz="brier-badge"]')!.textContent).toContain('0.190');
    // Doer has only 2 forecasts → excluded; You + Critic remain
    const legend = screen.getByRole('list', { name: 'Series' });
    expect(legend.textContent).toContain('You');
    expect(legend.textContent).toContain('Critic');
    expect(legend.textContent).not.toContain('Doer');
    expect(legend.textContent).toContain('0.19');
    expect(screen.getByText('well calibrated')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Table view' }));
    expect(screen.queryByTestId('reliability-diagram')).toBeNull();
    expect(screen.getByText('Observed success rate per forecast bin, by series')).toBeInTheDocument();
  });

  it('stays out of the way when the endpoint fails', async () => {
    vi.mocked(api.getCalibration).mockRejectedValue(new Error('404'));
    const { container } = render(<CalibrationPanel />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

describe('buildChangeEvents', () => {
  const data: DecisionChangesResponse = {
    since: '2026-09-01T00:00:00.000Z',
    memories: [
      { id: 'm1', title: 'Kept', createdAt: '2026-09-10T00:00:00.000Z', invalidAt: null, memoryClass: 'SEMANTIC' },
      { id: 'm2', title: 'Gone', createdAt: '2026-08-01T00:00:00.000Z', invalidAt: '2026-09-20T00:00:00.000Z', memoryClass: 'WORKING' },
    ] as never,
    decisions: [{ id: 'd1', title: 'Pause Atlas', chosenPath: 'Pause', decidedAt: '2026-09-15T00:00:00.000Z', createdAt: '2026-09-14T00:00:00.000Z', sessionId: 's1' } as unknown as Decision],
    commitments: [{ id: 'c1', description: 'Call Ben', deadline: '2026-10-01T00:00:00.000Z', status: 'OPEN', createdAt: '2026-09-05T00:00:00.000Z', completedAt: null } as never],
    capsule: null,
  };
  it('flattens newest-first and reads invalidations as removals', () => {
    const ev = buildChangeEvents(data);
    expect(ev.map((e) => e.id)).toEqual(['memory:m2', 'decision:d1', 'memory:m1', 'commitment:c1']);
    expect(ev[0]).toMatchObject({ sign: '−', meta: 'invalidated', kind: 'memory' });
    expect(ev[1]).toMatchObject({ sign: '+', meta: '→ Pause', href: '/decisions/s1' });
    expect(ev[2].meta).toBe('semantic');
    expect(ev[3].meta).toMatch(/^due /);
    expect(ev[3].href).toBeNull();
  });
  it('sorts undated events last', () => {
    const ev = buildChangeEvents({ ...data, commitments: [{ id: 'c2', description: 'x', deadline: null, status: 'OPEN', createdAt: 'nope', completedAt: null } as never] });
    expect(ev[ev.length - 1].id).toBe('commitment:c2');
  });
});

describe('<WhatChangedCard /> timeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEntitiesStore.setState({
      goals: [], people: [], projects: [{ id: 'p1', title: 'Atlas migration' } as Project],
      fetchGoals: vi.fn(async () => {}), fetchProjects: vi.fn(async () => {}), fetchPeople: vi.fn(async () => {}),
    });
    vi.mocked(api.getDecisions).mockResolvedValue([{ id: 'd0', title: 'Pause Atlas?', question: '', decidedAt: new Date('2026-09-01T00:00:00Z'), sessionId: 's0' } as unknown as Decision]);
  });

  it('renders a diff-style timeline with entity glyphs and caps the list', async () => {
    const many = Array.from({ length: TIMELINE_MAX + 2 }, (_, i) => ({ id: `m${i}`, title: `Memory ${i}`, createdAt: `2026-09-${String(10 + i).padStart(2, '0')}T00:00:00.000Z`, invalidAt: i === 0 ? '2026-09-30T00:00:00.000Z' : null }));
    vi.mocked(api.getDecisionChanges).mockResolvedValue({ since: '2026-09-01T00:00:00.000Z', memories: many as never, decisions: [], commitments: [], capsule: null });
    render(<MemoryRouter><WhatChangedCard question="Should we pause the Atlas migration?" currentSessionId="s1" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('change-timeline')).toBeInTheDocument());
    const items = screen.getByTestId('change-timeline').querySelectorAll('li[data-kind]');
    expect(items).toHaveLength(TIMELINE_MAX);
    expect(screen.getByText('+2 more')).toBeInTheDocument();
    expect(items[0]).toHaveAttribute('data-sign', '−'); // the invalidation is the newest event
    expect(items[0].querySelector('[data-glyph="memory"]')).toBeInTheDocument();
    expect(items[0].querySelector('a')).toHaveClass('line-through');
    expect(screen.getByText('10 memories')).toBeInTheDocument();
  });
});
