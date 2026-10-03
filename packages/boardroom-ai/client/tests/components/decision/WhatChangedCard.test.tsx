import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Decision, Project } from '@boardroom/shared';
import * as api from '../../../src/lib/api';
import { useEntitiesStore } from '../../../src/stores/entities.store';
import { WhatChangedCard, pickDecisionSince, resolveSince } from '../../../src/components/decision/WhatChangedCard';

vi.mock('../../../src/lib/api', () => ({
  getDecisions: vi.fn(),
  getCapsules: vi.fn(),
  listSessions: vi.fn(),
  getDecisionChanges: vi.fn(),
}));

const project = (id: string, title: string) => ({ id, title } as Project);
const decision = (p: Partial<Decision>) => ({ sessionId: null, decidedAt: null, ...p } as Decision);
const atlas = { type: 'project' as const, id: 'p1', title: 'Atlas migration', overlap: 1 };

describe('pickDecisionSince', () => {
  it('returns the newest related decision date (decidedAt ?? createdAt), skipping the current session', () => {
    const since = pickDecisionSince([
      decision({ id: 'd1', title: 'Pause Atlas?', question: '', decidedAt: new Date('2026-09-01T00:00:00Z'), createdAt: new Date('2026-08-01T00:00:00Z') }),
      decision({ id: 'd2', title: 'Atlas vendor', question: '', createdAt: new Date('2026-09-10T00:00:00Z') }),
      decision({ id: 'd3', title: 'Atlas again', question: '', createdAt: new Date('2026-09-20T00:00:00Z'), sessionId: 'current' }),
      decision({ id: 'd4', title: 'Hiring plan', question: 'Should we hire?', createdAt: new Date('2026-09-30T00:00:00Z') }),
    ], atlas, 'current');
    expect(since).toBe('2026-09-10T00:00:00.000Z');
  });

  it('returns null when nothing matches', () => {
    expect(pickDecisionSince([decision({ id: 'd', title: 'Hiring', question: '', createdAt: new Date() })], atlas)).toBeNull();
  });
});

describe('resolveSince', () => {
  it('falls back decision → capsule → old session, and null otherwise', async () => {
    const now = Date.parse('2026-10-03T12:00:00Z');
    const deps = {
      getDecisions: vi.fn().mockResolvedValue([]),
      getCapsules: vi.fn().mockResolvedValue({ items: [] }),
      listSessions: vi.fn().mockResolvedValue({ items: [{ id: 's1', createdAt: new Date(now).toISOString() }, { id: 's0', createdAt: new Date(now - 60_000).toISOString() }] }),
    } as unknown as NonNullable<Parameters<typeof resolveSince>[2]>;
    // Sessions stamped "now" are not a baseline
    expect(await resolveSince(atlas, 's1', deps, now)).toBeNull();

    (deps.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue({ items: [{ id: 's0', createdAt: new Date(now - 11 * 60_000).toISOString() }] });
    expect(await resolveSince(atlas, 's1', deps, now)).toBe(new Date(now - 11 * 60_000).toISOString());

    (deps.getCapsules as ReturnType<typeof vi.fn>).mockResolvedValue({ items: [{ entityType: 'project', entityId: 'p1', generatedAt: '2026-09-15T00:00:00.000Z' }] });
    expect(await resolveSince(atlas, 's1', deps, now)).toBe('2026-09-15T00:00:00.000Z');

    (deps.getDecisions as ReturnType<typeof vi.fn>).mockResolvedValue([decision({ id: 'd', title: 'Atlas', question: '', decidedAt: new Date('2026-09-20T00:00:00Z') })]);
    expect(await resolveSince(atlas, 's1', deps, now)).toBe('2026-09-20T00:00:00.000Z');
  });
});

describe('<WhatChangedCard />', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEntitiesStore.setState({
      goals: [], people: [], projects: [project('p1', 'Atlas migration')],
      fetchGoals: vi.fn(async () => {}), fetchProjects: vi.fn(async () => {}), fetchPeople: vi.fn(async () => {}),
    });
    vi.mocked(api.getDecisions).mockResolvedValue([]);
    vi.mocked(api.getCapsules).mockResolvedValue({ items: [] });
    vi.mocked(api.listSessions).mockResolvedValue({ items: [{ id: 's0', createdAt: new Date().toISOString() }], total: 1, limit: 10, offset: 0 } as never);
  });

  it('stays hidden (and never fetches changes) when no baseline date can be resolved', async () => {
    const { container } = render(
      <MemoryRouter><WhatChangedCard question="Should we pause the Atlas migration?" currentSessionId="s1" /></MemoryRouter>,
    );
    await waitFor(() => expect(api.listSessions).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(api.getDecisionChanges).not.toHaveBeenCalled();
    expect(screen.queryByText(/Nothing new on this/)).not.toBeInTheDocument();
  });

  it('renders once a persisted baseline exists', async () => {
    vi.mocked(api.getDecisions).mockResolvedValue([
      decision({ id: 'd1', title: 'Pause Atlas?', question: '', decidedAt: new Date('2026-09-01T00:00:00Z'), sessionId: 's0' }),
    ]);
    vi.mocked(api.getDecisionChanges).mockResolvedValue({ since: '2026-09-01T00:00:00.000Z', memories: [], decisions: [], commitments: [], capsule: null });
    render(<MemoryRouter><WhatChangedCard question="Should we pause the Atlas migration?" currentSessionId="s1" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('what-changed-card')).toBeInTheDocument());
    expect(api.getDecisionChanges).toHaveBeenCalledWith('project:p1', '2026-09-01T00:00:00.000Z');
    expect(api.listSessions).not.toHaveBeenCalled();
  });
});
