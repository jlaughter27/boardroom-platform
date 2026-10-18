import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { GraphTimeline } from '../../../src/components/graph/GraphTimeline';
import { DAY_MS, WEEK_MS, type TimeWindow } from '../../../src/components/graph/graph-timeline';
import { node } from './fixtures';

const at = (iso: string) => Date.parse(iso);
const nodes = [
  node('a', { createdAt: '2026-08-03T00:00:00.000Z' }),
  node('b', { createdAt: '2026-08-04T00:00:00.000Z' }),
  node('c', { createdAt: '2026-08-20T00:00:00.000Z' }),
  node('d', { createdAt: '2026-09-01T00:00:00.000Z' }),
];
const min = at('2026-08-03T00:00:00.000Z');
const max = at('2026-09-01T00:00:00.000Z');

describe('GraphTimeline', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('renders the histogram, the full-range label and the hide toggle', () => {
    const onHide = vi.fn();
    render(<GraphTimeline nodes={nodes} window={null} onChange={vi.fn()} hideOutside={false} onHideOutsideChange={onHide} inWindow={4} />);
    expect(screen.getByTestId('timeline-range-label')).toHaveTextContent('3 Aug 2026 – 1 Sep 2026');
    const bars = screen.getByTestId('timeline-histogram').querySelectorAll('rect');
    expect(bars).toHaveLength(5); // 5 ISO weeks from 3 Aug to 1 Sep
    expect(bars[0]).toHaveAttribute('data-count', '2');
    fireEvent.click(screen.getByRole('button', { name: 'Hide outside' }));
    expect(onHide).toHaveBeenCalledWith(true);
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();
  });

  it('dragging the end thumb narrows the window and never crosses the start', () => {
    const onChange = vi.fn();
    render(<GraphTimeline nodes={nodes} window={{ start: min + 5 * DAY_MS, end: max }} onChange={onChange} hideOutside={false} onHideOutsideChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Window end'), { target: { value: String(min + 10 * DAY_MS) } });
    expect(onChange).toHaveBeenLastCalledWith({ start: min + 5 * DAY_MS, end: min + 10 * DAY_MS });
    fireEvent.change(screen.getByLabelText('Window end'), { target: { value: String(min + 2 * DAY_MS) } });
    expect(onChange).toHaveBeenLastCalledWith({ start: min + 5 * DAY_MS, end: min + 5 * DAY_MS });
    fireEvent.change(screen.getByLabelText('Window start'), { target: { value: String(min) } });
    expect(onChange).toHaveBeenLastCalledWith({ start: min, end: max });
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('play grows the window end over time and stops at the extent max', () => {
    vi.useFakeTimers();
    const calls: Array<TimeWindow | null> = [];
    function Harness() {
      const [w, setW] = useState<TimeWindow | null>({ start: min, end: min });
      return <GraphTimeline nodes={nodes} window={w} onChange={(n) => { calls.push(n); setW(n); }} hideOutside={false} onHideOutsideChange={vi.fn()} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Play timeline' }));
    expect(screen.getByRole('button', { name: 'Pause timeline' })).toHaveAttribute('aria-pressed', 'true');
    act(() => { vi.advanceTimersByTime(80 * 3); });
    expect(calls.length).toBeGreaterThanOrEqual(3);
    const ends = calls.map((c) => c!.end);
    for (let i = 1; i < ends.length; i++) expect(ends[i]).toBeGreaterThan(ends[i - 1]);
    expect(calls.every((c) => c!.start === min)).toBe(true);
    act(() => { vi.advanceTimersByTime(80 * 400); });
    // finished: last call reaches the max and playback stopped
    expect(calls[calls.length - 1]).toBeNull(); // full window → null (no filter)
    expect(screen.getByRole('button', { name: 'Play timeline' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reduced motion steps a whole week per (slower) tick', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<GraphTimeline nodes={nodes} window={{ start: min, end: min }} onChange={onChange} hideOutside={false} onHideOutsideChange={vi.fn()} reducedMotion />);
    fireEvent.click(screen.getByRole('button', { name: 'Play timeline' }));
    act(() => { vi.advanceTimersByTime(80 * 3); });
    expect(onChange).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(700); });
    expect(onChange).toHaveBeenCalledWith({ start: min, end: min + WEEK_MS });
  });

  it('renders nothing for undated graphs', () => {
    const { container } = render(<GraphTimeline nodes={[node('x', { createdAt: '' })]} window={null} onChange={vi.fn()} hideOutside={false} onHideOutsideChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
