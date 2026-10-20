import { useMemo } from 'react';
import type { Memory } from '@boardroom/shared';
import { useVizSlice, VIZ_WINDOW_WEEKS } from '../../stores/viz.store';
import { Card, Skeleton } from '../ui';
import { Heatmap } from '../viz/Heatmap';
import { Legend } from '../viz/Legend';
import { useChartTheme } from '../viz/hooks';
import { dayGrid } from '../viz/aggregate';

/** Fixed slot order for domains so a domain keeps its colour across widgets and sessions. */
export const DOMAIN_ORDER = ['business', 'personal', 'ministry'] as const;
export const DOMAIN_LABEL: Record<string, string> = { business: 'Business', personal: 'Personal', ministry: 'Ministry', other: 'Other' };

/** Domain → categorical slot (fixed order; anything else folds into the last slot). */
export function domainColors(series: readonly string[], domains: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const extras = domains.filter((d) => !(DOMAIN_ORDER as readonly string[]).includes(d)).sort();
  DOMAIN_ORDER.forEach((d, i) => { out[d] = series[i] ?? series[series.length - 1]; });
  extras.forEach((d, i) => { out[d] = series[Math.min(series.length - 1, DOMAIN_ORDER.length + i)]; });
  return out;
}

export function memoryDomain(m: Memory): string {
  return (m.domain || 'other').toLowerCase();
}

/** Memory pulse: last 12 weeks × 7 days, intensity = memories written, domain split on hover. */
export function MemoryPulseWidget({ now }: { now?: number }) {
  const theme = useChartTheme();
  const slice = useVizSlice('memories');
  const grid = useMemo(() => dayGrid(slice.data ?? [], (m) => m.createdAt, VIZ_WINDOW_WEEKS, { now: now ?? Date.now(), getKey: memoryDomain }), [slice.data, now]);
  const domains = useMemo(() => {
    const seen = new Map<string, number>();
    for (const c of grid.cells) for (const [k, v] of Object.entries(c.byKey)) seen.set(k, (seen.get(k) ?? 0) + v);
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  }, [grid.cells]);
  const colors = useMemo(() => domainColors(theme.series, domains.map(([d]) => d)), [theme.series, domains]);
  const total = grid.cells.reduce((a, c) => a + c.total, 0);
  const activeDays = grid.cells.filter((c) => c.total > 0).length;

  if (slice.data === null && slice.loading) {
    return (
      <Card data-testid="memory-pulse" aria-busy>
        <Skeleton className="h-4 w-32 mb-3" />
        <Skeleton className="h-[140px] w-full" />
      </Card>
    );
  }

  return (
    <Card data-testid="memory-pulse">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Memory pulse</h3>
          <p className="text-xs text-muted-foreground">
            {slice.error ? 'Memory history unavailable right now' : total === 0
              ? `No memories in the last ${VIZ_WINDOW_WEEKS} weeks — the first decision session starts the pulse.`
              : <><span className="font-medium text-foreground tabular-nums">{total}</span> memories on <span className="tabular-nums">{activeDays}</span> days · busiest day {grid.max}</>}
          </p>
        </div>
        {domains.length > 0 && (
          <Legend aria-label="Domains" items={domains.map(([d, n]) => ({ id: d, label: DOMAIN_LABEL[d] ?? d, color: colors[d], shape: 'dot', value: String(n) }))} />
        )}
      </div>
      <Heatmap
        cells={grid.cells}
        buckets={grid.buckets}
        max={grid.max}
        name={`Memories written per day, last ${VIZ_WINDOW_WEEKS} weeks`}
        unit="memories"
        keyLabels={DOMAIN_LABEL}
        keyColors={colors}
        data-testid="memory-pulse-heatmap"
      />
    </Card>
  );
}
