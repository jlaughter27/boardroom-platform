import { useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgeGraphNode } from '@boardroom/shared';
import { cn } from '../../lib/cn';
import {
  DAY_MS, formatDay, isFullWindow, playbackStep, stepWindow, timeExtent, weekHistogram,
  type TimeWindow,
} from './graph-timeline';

interface Props {
  /** Nodes currently loaded (the extent + histogram come from these). */
  nodes: readonly KnowledgeGraphNode[];
  /** null = whole extent */
  window: TimeWindow | null;
  onChange(window: TimeWindow | null): void;
  hideOutside: boolean;
  onHideOutsideChange(hide: boolean): void;
  /** Nodes inside the window (for the caption). */
  inWindow?: number;
  reducedMotion?: boolean;
  className?: string;
}

const SPEEDS = [1, 2, 4] as const;

/**
 * Bottom timeline: a week histogram over `createdAt` / `validAt`, a two-thumb
 * range over the extent, and play / pause that grows the window end forward
 * (Obsidian's "animate" time-lapse). Positions are never touched — the view
 * fades or skips nodes, so scrubbing never relayouts.
 */
export function GraphTimeline({ nodes, window: win, onChange, hideOutside, onHideOutsideChange, inWindow, reducedMotion = false, className }: Props) {
  const extent = useMemo(() => timeExtent(nodes), [nodes]);
  const buckets = useMemo(() => weekHistogram(nodes, extent), [nodes, extent]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);

  const effective: TimeWindow | null = extent ? (win ?? { start: extent.min, end: extent.max }) : null;
  const winRef = useRef(effective);
  winRef.current = effective;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // ── Playback loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing || !extent) return;
    const tickMs = reducedMotion ? 700 : 80;
    const step = playbackStep(extent, speed, reducedMotion);
    // Advance from a local cursor so ticks never depend on a render having
    // happened in between (scrubbing stops playback, which restarts the loop).
    let cur: TimeWindow = winRef.current ?? { start: extent.min, end: extent.max };
    const id = globalThis.setInterval(() => {
      const { window: next, done } = stepWindow(cur, extent, step);
      cur = next;
      onChangeRef.current(done && next.start <= extent.min ? null : next);
      if (done) setPlaying(false);
    }, tickMs);
    return () => globalThis.clearInterval(id);
  }, [playing, speed, extent, reducedMotion]);

  useEffect(() => { if (!extent) setPlaying(false); }, [extent]);

  if (!extent || !effective) return null;

  const span = Math.max(1, extent.max - extent.min);
  const full = isFullWindow(win, extent);
  const maxCount = buckets.reduce((m, b) => Math.max(m, b.count), 0) || 1;
  const pct = (ms: number) => ((ms - extent.min) / span) * 100;

  const setStart = (v: number) => onChange({ start: Math.min(v, effective.end), end: effective.end });
  const setEnd = (v: number) => onChange({ start: effective.start, end: Math.max(v, effective.start) });

  const togglePlay = () => {
    if (playing) { setPlaying(false); return; }
    // Restart from the window start when already at the end
    if (effective.end >= extent.max) onChange({ start: effective.start, end: Math.min(extent.max, effective.start + DAY_MS) });
    setPlaying(true);
  };

  const single = extent.max === extent.min;

  return (
    <div className={cn('flex flex-col gap-1 rounded-md border border-border bg-card px-3 py-2', className)} data-testid="graph-timeline" aria-label="Timeline">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={togglePlay}
          disabled={single}
          aria-pressed={playing}
          aria-label={playing ? 'Pause timeline' : 'Play timeline'}
          className="h-7 w-7 rounded-md border border-border bg-card text-foreground hover:bg-muted disabled:opacity-40"
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <label className="flex items-center gap-1 text-muted-foreground">
          <span className="sr-only">Playback speed</span>
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value) as (typeof SPEEDS)[number])}
            aria-label="Playback speed"
            className="h-7 rounded-md border border-border bg-card px-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
        <span className="tabular-nums text-foreground" data-testid="timeline-range-label">
          {formatDay(effective.start)} – {formatDay(effective.end)}
        </span>
        {inWindow !== undefined && (
          <span className="text-muted-foreground">· <span className="tabular-nums">{inWindow}</span> of {nodes.length} in window</span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onHideOutsideChange(!hideOutside)}
            aria-pressed={hideOutside}
            className={cn('h-7 rounded-md border px-2.5', hideOutside ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border bg-card text-muted-foreground hover:text-foreground')}
            title="Hide nodes outside the window instead of fading them"
          >
            Hide outside
          </button>
          <button
            type="button"
            onClick={() => { setPlaying(false); onChange(null); }}
            disabled={full}
            className="h-7 rounded-md border border-border bg-card px-2.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            Reset
          </button>
        </span>
      </div>

      {/* Histogram: one bar per ISO week; bars inside the window are vivid */}
      <div className="relative h-8" aria-hidden="true" data-testid="timeline-histogram">
        <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox={`0 0 ${Math.max(1, buckets.length)} 10`}>
          {buckets.map((b, i) => {
            const h = (b.count / maxCount) * 10;
            const inside = b.end > effective.start && b.start <= effective.end;
            return (
              <rect
                key={b.start}
                x={i + 0.1}
                y={10 - h}
                width={0.8}
                height={h}
                fill="var(--color-primary)"
                opacity={inside ? 0.85 : 0.25}
                data-count={b.count}
              />
            );
          })}
        </svg>
        {!full && (
          <div
            className="pointer-events-none absolute inset-y-0 border-x border-primary/60 bg-primary/10"
            style={{ left: `${pct(effective.start)}%`, width: `${Math.max(0.5, pct(effective.end) - pct(effective.start))}%` }}
          />
        )}
      </div>

      {/* Two native ranges stacked: only the thumbs take pointer events */}
      <div className="relative h-5">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary/60"
          style={{ left: `${pct(effective.start)}%`, width: `${Math.max(0, pct(effective.end) - pct(effective.start))}%` }}
        />
        {([
          { key: 'start', value: effective.start, set: setStart, label: 'Window start' },
          { key: 'end', value: effective.end, set: setEnd, label: 'Window end' },
        ] as const).map((r) => (
          <input
            key={r.key}
            type="range"
            min={extent.min}
            max={extent.max}
            step={DAY_MS}
            value={r.value}
            disabled={single}
            onChange={(e) => { setPlaying(false); r.set(Number(e.target.value)); }}
            aria-label={r.label}
            aria-valuetext={formatDay(r.value)}
            className={cn(
              'pointer-events-none absolute inset-0 h-5 w-full appearance-none bg-transparent accent-[var(--color-primary)]',
              '[&::-webkit-slider-thumb]:pointer-events-auto [&::-moz-range-thumb]:pointer-events-auto',
              '[&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--color-card)] [&::-webkit-slider-thumb]:bg-[var(--color-primary)]',
              '[&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-track]:bg-transparent',
              !reducedMotion && 'transition-opacity',
            )}
          />
        ))}
      </div>
    </div>
  );
}
