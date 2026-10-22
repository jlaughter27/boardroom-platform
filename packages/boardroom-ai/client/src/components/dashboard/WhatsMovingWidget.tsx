import { useMemo } from 'react';
import type { Memory } from '@boardroom/shared';
import { useVizSlice, VIZ_WINDOW_WEEKS } from '../../stores/viz.store';
import { Card, Skeleton } from '../ui';
import { AreaChart, type AreaSeries } from '../viz/AreaChart';
import { useChartTheme } from '../viz/hooks';
import { countByWeekAndKey } from '../viz/aggregate';

/** Fixed order → fixed colour slot per memory class. */
export const CLASS_ORDER = ['WORKING', 'EPISODIC', 'SEMANTIC', 'DECISION'] as const;
export const CLASS_LABEL: Record<string, string> = { WORKING: 'Working', EPISODIC: 'Episodic', SEMANTIC: 'Semantic', DECISION: 'Decision', other: 'Other' };

export function memoryClassKey(m: Memory): string {
  const k = String(m.memoryClass || '').toUpperCase();
  return (CLASS_ORDER as readonly string[]).includes(k) ? k : 'other';
}

/** Build the stacked series (fixed slot per class) from the 12-week memory list. */
export function buildMovingSeries(memories: Memory[], palette: readonly string[], now: number = Date.now()): { series: AreaSeries[]; xLabels: string[]; partialLast: boolean } {
  const { buckets, keys, series } = countByWeekAndKey(memories, (m) => m.createdAt, memoryClassKey, VIZ_WINDOW_WEEKS, { now, keyOrder: [...CLASS_ORDER], maxKeys: 4 });
  const out: AreaSeries[] = keys.map((k) => {
    const slot = (CLASS_ORDER as readonly string[]).indexOf(k);
    return { id: k, label: CLASS_LABEL[k] ?? k, color: palette[slot === -1 ? palette.length - 1 : slot], values: series[k] };
  });
  return { series: out, xLabels: buckets.map((b) => b.label), partialLast: buckets[buckets.length - 1]?.partial ?? false };
}

/** "What's moving": memory writes per week, stacked by memory class. */
export function WhatsMovingWidget({ now }: { now?: number }) {
  const theme = useChartTheme();
  const slice = useVizSlice('memories');
  const t = now ?? Date.now();
  const { series, xLabels, partialLast } = useMemo(() => buildMovingSeries(slice.data ?? [], theme.series, t), [slice.data, theme.series, t]);
  const total = series.reduce((a, s) => a + s.values.reduce((x, y) => x + y, 0), 0);

  if (slice.data === null && slice.loading) {
    return (
      <Card data-testid="whats-moving" aria-busy>
        <Skeleton className="h-4 w-32 mb-3" />
        <Skeleton className="h-[200px] w-full" />
      </Card>
    );
  }

  const top = [...series].sort((a, b) => b.values.reduce((x, y) => x + y, 0) - a.values.reduce((x, y) => x + y, 0))[0];

  return (
    <Card data-testid="whats-moving">
      <div className="mb-2">
        <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">What&apos;s moving</h3>
        <p className="text-xs text-muted-foreground">
          {slice.error ? 'Memory history unavailable right now'
            : total === 0 ? `Memory writes by type, per week — nothing in the last ${VIZ_WINDOW_WEEKS} weeks yet.`
            : <>Memory writes by type · {VIZ_WINDOW_WEEKS} weeks · mostly <span className="text-foreground">{top?.label.toLowerCase()}</span></>}
        </p>
      </div>
      <AreaChart
        series={series.length > 0 ? series : [{ id: 'none', label: 'Memories', color: theme.deemphasis, values: xLabels.map(() => 0) }]}
        xLabels={xLabels}
        stacked
        partialLast={partialLast}
        partialNote="last bucket is this week (partial)"
        height={200}
        name={`Memory writes per week by type, last ${VIZ_WINDOW_WEEKS} weeks`}
        data-testid="whats-moving-chart"
      />
    </Card>
  );
}
