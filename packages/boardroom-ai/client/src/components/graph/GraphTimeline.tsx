import { useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgeGraphNode } from '@boardroom/shared';
import { cn } from '../../lib/cn';
import {
  DAY_MS, areaPath, clampWindow, easedWindowEnd, formatDay, isFullWindow, playbackDuration, playbackStep, stepWindow, timeExtent, weekHistogram,
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

  // The window is always read clamped to the CURRENT extent: filters / local
  // focus move the extent under a narrowed window, and an unclamped one would
  // push the highlight outside the track and could hide every node.
  const effective: TimeWindow | null = extent ? (win ? clampWindow(win, extent) : { start: extent.min, end: extent.max }) : null;
  const winRef = useRef(effective);
  winRef.current = effective;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Persist the clamp upstream whenever the extent (or an externally set
  // window) leaves `win` out of range; a window that now spans the whole
  // extent collapses to null (= no filter).
  useEffect(() => {
    if (!extent || !win) return;
    const c = clampWindow(win, extent);
    if (c.start !== win.start || c.end !== win.end) onChangeRef.current(isFullWindow(c, extent) ? null : c);
  }, [extent, win]);

  // ── Playback loop ─────────────────────────────────────────────────────────
  // Smooth mode eases the window end from where it is to the extent's max over
  // playbackDuration(speed) (ease-out: it decelerates into the newest nodes).
  // Reduced motion steps a whole week per tick instead of sweeping.
  useEffect(() => {
    if (!playing || !extent) return;
    const start0: TimeWindow = winRef.current ?? { start: extent.min, end: extent.max };
    if (reducedMotion) {
      const step = playbackStep(extent, speed, true);
      let cur = start0;
      const id = globalThis.setInterval(() => {
        const { window: next, done } = stepWindow(cur, extent, step);
        cur = next;
        onChangeRef.current(done && next.start <= extent.min ? null : next);
        if (done) setPlaying(false);
      }, 700);
      return () => globalThis.clearInterval(id);
    }
    const from = start0.end;
    const duration = playbackDuration(speed) * Math.max(0.05, (extent.max - from) / Math.max(1, extent.max - extent.min));
    const t0 = performance.now();
    const id = globalThis.setInterval(() => {
      const p = Math.min(1, (performance.now() - t0) / Math.max(1, duration));
      const end = easedWindowEnd(p, from, extent);
      const next: TimeWindow = { start: start0.start, end };
      const done = p >= 1;
      onChangeRef.current(done && next.start <= extent.min ? null : next);
      if (done) setPlaying(false);
    }, 40);
    return () => globalThis.clearInterval(id);
  }, [playing, speed, extent, reducedMotion]);

  useEffect(() => { if (!extent) setPlaying(false); }, [extent]);

  if (!extent || !effective) return null;

  const span = Math.max(1, extent.max - extent.min);
  const full = isFullWindow(effective, extent);
  const maxCount = buckets.reduce((m, b) => Math.max(m, b.count), 0) || 1;
  const pct = (ms: number) => ((ms - extent.min) / span) * 100;
  // Sparkline geometry: a 1000 × 100 viewBox stretched to the track; the
  // active window is a clip over the same path so the highlight is exact.
  const SPARK_W = 1000; const SPARK_H = 100;
  const spark = areaPath(buckets, SPARK_W, SPARK_H, maxCount);
  const clipX = (pct(effective.start) / 100) * SPARK_W;
  const clipW = Math.max(2, ((pct(effective.end) - pct(effective.start)) / 100) * SPARK_W);
  // The thumbs step a whole day from `min`, so `max` is only reachable when the
  // span is a whole number of days. Let the slider run to the next day boundary
  // and clamp the value back to the extent, so the newest node can be reached.
  const rangeMax = extent.min + Math.ceil(span / DAY_MS) * DAY_MS;

  const emit = (next: TimeWindow) => onChange(isFullWindow(next, extent) ? null : next);
  const setStart = (v: number) => emit({ start: Math.max(extent.min, Math.min(v, effective.end)), end: effective.end });
  const setEnd = (v: number) => emit({ start: effective.start, end: Math.min(extent.max, Math.max(v, effective.start)) });

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
        <span className="tabular-nums text-foreground" style={{ fontVariantNumeric: 'tabular-nums' }} data-testid="timeline-range-label">
          {formatDay(effective.start)} – {formatDay(effective.end)}
        </span>
        {inWindow !== undefined && (
          <span className="text-muted-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>· <span className="tabular-nums">{inWindow}</span> of {nodes.length} in window</span>
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

      {/* Area sparkline over ISO weeks; the active window is drawn vivid over a muted base */}
      <div className="relative h-9" aria-hidden="true" data-testid="timeline-histogram">
        <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}>
          <defs>
            <linearGradient id="graph-tl-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--color-primary)" stopOpacity="0.55" />
              <stop offset="1" stopColor="var(--color-primary)" stopOpacity="0.06" />
            </linearGradient>
            <clipPath id="graph-tl-window"><rect x={clipX} y={0} width={clipW} height={SPARK_H} /></clipPath>
          </defs>
          {/* base: whole extent, muted */}
          <path d={spark.area} fill="var(--color-muted-foreground)" opacity={0.14} data-testid="timeline-area" />
          <path d={spark.line} fill="none" stroke="var(--color-muted-foreground)" strokeOpacity={0.35} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          {/* active window: vivid gradient fill + line */}
          <g clipPath="url(#graph-tl-window)">
            <path d={spark.area} fill="url(#graph-tl-fill)" />
            <path d={spark.line} fill="none" stroke="var(--color-primary)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </g>
          {/* week ticks along the baseline (also the per-bucket data hooks) */}
          {buckets.map((b, i) => (
            <rect key={b.start} x={Math.max(0, (i / Math.max(1, buckets.length - 1)) * SPARK_W - 1)} y={SPARK_H - 3} width={2} height={3} fill="var(--color-muted-foreground)" opacity={0.35} data-count={b.count} />
          ))}
        </svg>
        {!full && (
          <div
            className="pointer-events-none absolute inset-y-0 border-x border-primary/70"
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
            max={rangeMax}
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
