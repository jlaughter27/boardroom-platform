import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SynthesisPanel, SynthesisSheet } from '../../../src/components/decision/SynthesisPanel';
import type { ExtendedSynthesisReport } from '../../../src/types/debate';

/** RD-12 — Delegate on each Next Action, only when the page passes onDelegate. */

vi.mock('../../../src/lib/api', () => ({ getMemory: vi.fn() }));

const report = {
  disagreementMap: 'Split on timing.',
  decisiveTradeoff: 'Speed vs. volunteer load.',
  recommendation: 'Host the fair in March.',
  nextActions: ['Book the hall', 'Send the volunteer rota'],
  topRisks: [],
  assumptionsToMonitor: [],
  sourceMemoryIds: [],
} as unknown as ExtendedSynthesisReport;

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('SynthesisPanel / SynthesisSheet — Delegate', () => {
  it('panel: no Delegate buttons without onDelegate; the disabled reason renders as one muted line', () => {
    wrap(<SynthesisPanel report={report} isStreaming={false} delegateDisabledReason="Commit the decision to delegate its actions." />);
    expect(screen.queryByRole('button', { name: /^Delegate:/ })).toBeNull();
    expect(screen.getByTestId('delegate-disabled-reason')).toHaveTextContent('Commit the decision to delegate its actions.');
  });

  it('panel: one Delegate button per action, calling onDelegate with the action', () => {
    const onDelegate = vi.fn();
    wrap(<SynthesisPanel report={report} isStreaming={false} onDelegate={onDelegate} delegateDisabledReason="ignored" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delegate: Send the volunteer rota' }));
    expect(onDelegate).toHaveBeenCalledWith('Send the volunteer rota');
    expect(screen.getAllByRole('button', { name: /^Delegate:/ })).toHaveLength(2);
    expect(screen.queryByTestId('delegate-disabled-reason')).toBeNull();
  });

  it('sheet: forwards onDelegate / the disabled reason the same way', () => {
    const onDelegate = vi.fn();
    const { unmount } = wrap(<SynthesisSheet report={report} isOpen onClose={vi.fn()} onDelegate={onDelegate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delegate: Book the hall' }));
    expect(onDelegate).toHaveBeenCalledWith('Book the hall');
    unmount();
    wrap(<SynthesisSheet report={report} isOpen onClose={vi.fn()} delegateDisabledReason="Commit the decision to delegate its actions." />);
    expect(screen.queryByRole('button', { name: /^Delegate:/ })).toBeNull();
    expect(screen.getByTestId('delegate-disabled-reason')).toBeInTheDocument();
  });
});
