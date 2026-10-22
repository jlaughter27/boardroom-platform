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
    const bars = screen.getByTestId('timeline-histogram').querySelectorAll('rect[data-count]');
    expect(bars).toHaveLength(5); // 5 ISO weeks from 3 Aug to 1 Sep
    expect(bars[0]).toHaveAttribute('data-count', '2');
    // the area sparkline is drawn over the same buckets
    expect(screen.getByTestId('timeline-area').getAttribute('d')).toMatch(/^M0(\.00)? /);
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
    // Widening back to the whole extent is reported as null (= no filter), so Reset / isFullWindow agree.
    fireEvent.change(screen.getByLabelText('Window start'), { target: { value: String(min) } });
    expect(onChange).toHaveBeenLastCalledWith(null);
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

  it('clamps the window to the current extent when the extent moves under it (M8)', () => {
    const onChange = vi.fn();
    const win = { start: min, end: min + 10 * DAY_MS }; // 3 Aug – 13 Aug
    const { rerender } = render(<GraphTimeline nodes={nodes} window={win} onChange={onChange} hideOutside={false} onHideOutsideChange={vi.fn()} />);
    expect(onChange).not.toHaveBeenCalled();
    // A filter / local focus leaves only the two newest nodes: extent is now 20 Aug – 1 Sep.
    rerender(<GraphTimeline nodes={nodes.slice(2)} window={win} onChange={onChange} hideOutside={false} onHideOutsideChange={vi.fn()} />);
    const aug20 = at('2026-08-20T00:00:00.000Z');
    expect(onChange).toHaveBeenLastCalledWith({ start: aug20, end: aug20 });
    // Rendering never waits for the parent: the label and highlight already use the clamped window.
    expect(screen.getByTestId('timeline-range-label')).toHaveTextContent('20 Aug 2026 – 20 Aug 2026');
    const highlight = screen.getByTestId('timeline-histogram').querySelector('div') as HTMLDivElement;
    expect(parseFloat(highlight.style.left)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(highlight.style.left) + parseFloat(highlight.style.width)).toBeLessThanOrEqual(100.5);
    // A window that now covers the whole extent collapses to null (no filter).
    onChange.mockClear();
    rerender(<GraphTimeline nodes={nodes.slice(2)} window={{ start: min, end: max + DAY_MS }} onChange={onChange} hideOutside={false} onHideOutsideChange={vi.fn()} />);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('the end thumb can reach the newest node even when the span is not a whole number of days (L2)', () => {
    const odd = [node('a', { createdAt: '2026-08-03T00:00:00.000Z' }), node('d', { createdAt: '2026-09-01T12:00:00.000Z' })];
    const oddMax = at('2026-09-01T12:00:00.000Z');
    const onChange = vi.fn();
    render(<GraphTimeline nodes={odd} window={{ start: min, end: min + 5 * DAY_MS }} onChange={onChange} hideOutside={false} onHideOutsideChange={vi.fn()} />);
    const end = screen.getByLabelText('Window end') as HTMLInputElement;
    // The slider runs to the next day boundary past max (min + 30 d), so the last step lands past max…
    expect(Number(end.max)).toBe(min + 30 * DAY_MS);
    expect((Number(end.max) - Number(end.min)) % DAY_MS).toBe(0);
    // …and the value is clamped back to max — which is the full window, reported as null.
    fireEvent.change(end, { target: { value: end.max } });
    expect(onChange).toHaveBeenLastCalledWith(null);
    // One step short of the end is an ordinary narrowed window ending before the newest node.
    fireEvent.change(end, { target: { value: String(min + 29 * DAY_MS) } });
    expect(onChange).toHaveBeenLastCalledWith({ start: min, end: min + 29 * DAY_MS });
    expect(min + 29 * DAY_MS).toBeLessThan(oddMax);
  });

  it('renders nothing for undated graphs', () => {
    const { container } = render(<GraphTimeline nodes={[node('x', { createdAt: '' })]} window={null} onChange={vi.fn()} hideOutside={false} onHideOutsideChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
