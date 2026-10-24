/**
 * RD-11 — "What this displaces" in the CEO synthesis (inline card + sheet).
 * Invented titles only.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ExtendedSynthesisReport } from '../../../src/types/debate';
import { SynthesisPanel, SynthesisSheet, STOP_ACTION_LABEL } from '../../../src/components/decision/SynthesisPanel';

vi.mock('../../../src/lib/api', () => ({ getMemory: vi.fn() }));

const base: ExtendedSynthesisReport = {
  disagreementMap: 'Optimist and Critic split on timing.',
  decisiveTradeoff: 'Speed of launch vs focus on the core offer.',
  recommendation: 'Run the paid pilot, but only after pausing one project.',
  nextActions: ['Draft the pilot offer', 'Email three prospects'],
  topRisks: [],
  assumptionsToMonitor: [],
  sourceMemoryIds: [],
};

const withDisplacement = (displacement: ExtendedSynthesisReport['displacement']): ExtendedSynthesisReport => ({ ...base, displacement });

const renderPanel = (report: ExtendedSynthesisReport) =>
  render(
    <MemoryRouter>
      <SynthesisPanel report={report} isStreaming={false} />
    </MemoryRouter>,
  );

describe('SynthesisPanel — What this displaces (RD-11)', () => {
  it('renders the answer and "<Action> — <title>" rows', () => {
    renderPanel(withDisplacement({
      answer: 'This adds a weekly commitment while you are over capacity.',
      stops: [{ title: 'Podcast relaunch', action: 'pause' }, { title: 'Weekly vendor sync', action: 'delegate' }],
      netNew: false,
    }));
    expect(screen.getByRole('button', { name: /What this displaces/ })).toBeInTheDocument();
    const section = screen.getByTestId('synthesis-displacement');
    expect(within(section).getByText('This adds a weekly commitment while you are over capacity.')).toBeInTheDocument();
    const rows = within(section).getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toEqual(['Pause — Podcast relaunch', 'Delegate — Weekly vendor sync']);
    expect(within(section).queryByText('Net new: nothing named to stop.')).not.toBeInTheDocument();
  });

  it('renders nothing when displacement is undefined (review mode / pre-RD-11 report)', () => {
    renderPanel(base);
    expect(screen.queryByText('What this displaces')).not.toBeInTheDocument();
    expect(screen.queryByTestId('synthesis-displacement')).not.toBeInTheDocument();
    expect(screen.getByText('Next Actions')).toBeInTheDocument();
  });

  it('shows "Net new: nothing named to stop." only when netNew is true and stops is empty', () => {
    const { unmount } = renderPanel(withDisplacement({ answer: 'You have room for this.', stops: [], netNew: true }));
    expect(screen.getByText('Net new: nothing named to stop.')).toBeInTheDocument();
    expect(within(screen.getByTestId('synthesis-displacement')).queryAllByRole('listitem')).toHaveLength(0);
    unmount();

    const second = renderPanel(withDisplacement({ answer: 'Room, but defer one item.', stops: [{ title: 'Site refresh', action: 'defer' }], netNew: true }));
    expect(screen.queryByText('Net new: nothing named to stop.')).not.toBeInTheDocument();
    second.unmount();

    renderPanel(withDisplacement({ answer: 'Check your calendar before committing.', stops: [], netNew: false }));
    expect(screen.queryByText('Net new: nothing named to stop.')).not.toBeInTheDocument();
  });

  it('sits after the Recommendation and before Next Actions', () => {
    renderPanel(withDisplacement({ answer: 'Pause one project.', stops: [{ title: 'Podcast relaunch', action: 'pause' }], netNew: false }));
    const recommendation = screen.getByText(base.recommendation);
    const displaces = screen.getByRole('button', { name: /What this displaces/ });
    const next = screen.getByRole('button', { name: /Next Actions/ });
    expect(recommendation.compareDocumentPosition(displaces) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(displaces.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('SynthesisSheet shows the same section', () => {
    render(
      <MemoryRouter>
        <SynthesisSheet
          report={withDisplacement({ answer: 'Renegotiate the deadline first.', stops: [{ title: 'Client proposal', action: 'renegotiate' }], netNew: false })}
          isOpen
          onClose={() => {}}
          question="Should I take on the pilot?"
        />
      </MemoryRouter>,
    );
    const sheet = screen.getByTestId('synthesis-sheet-body');
    const section = within(sheet).getByTestId('synthesis-displacement');
    expect(within(section).getByText('Renegotiate the deadline first.')).toBeInTheDocument();
    expect(within(section).getByRole('listitem').textContent).toBe('Renegotiate — Client proposal');
  });

  it('labels every StopAction', () => {
    expect(STOP_ACTION_LABEL).toEqual({ stop: 'Stop', pause: 'Pause', delegate: 'Delegate', renegotiate: 'Renegotiate', defer: 'Defer' });
  });
});
