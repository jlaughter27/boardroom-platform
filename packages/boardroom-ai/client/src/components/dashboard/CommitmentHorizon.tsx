import { useId, useMemo, useState } from 'react';
import type { Commitment } from '@boardroom/shared';
import { isDelegation } from '@boardroom/shared';
import { useChartTheme } from '../viz/hooks';
import { horizon, startOfUtcDay, DAY_MS, type HorizonItem } from '../viz/aggregate';
import { ChartFrame } from '../viz/ChartFrame';
import { ChartTooltip, TooltipRow, TooltipTitle } from '../viz/Tooltip';
import { Legend } from '../viz/Legend';
import { relativeDue } from './CommitmentNudgesWidget';

export const HORIZON_DAYS = 14;
const MAX_PEOPLE = 5;

/** Open and owed BY the user — delegations (RD-12) are someone else's load, not on the user's horizon. */
export const isOpenCommitment = (c: Commitment) => c.status === 'OPEN' && !isDelegation(c);

/** People → categorical slot in a stable order (most commitments first, then name); the tail folds into "Others". */
export function personSlots(items: Commitment[], nameById: Map<string, string>, palette: readonly string[]): { order: string[]; color: Record<string, string>; label: Record<string, string> } {
  const counts = new Map<string, number>();
  for (const c of items) { const k = c.stakeholderId ?? 'none'; counts.set(k, (counts.get(k) ?? 0) + 1); }
  const label: Record<string, string> = { none: 'Unassigned', other: 'Others' };
  for (const k of counts.keys()) if (k !== 'none') label[k] = nameById.get(k) ?? 'Someone';
  const ranked = [...counts.keys()].filter((k) => k !== 'none').sort((a, b) => (counts.get(b)! - counts.get(a)!) || label[a].localeCompare(label[b]));
  const keep = ranked.slice(0, MAX_PEOPLE);
  const order = [...keep, ...(ranked.length > MAX_PEOPLE ? ['other'] : []), ...(counts.has('none') ? ['none'] : [])];
  const color: Record<string, string> = {};
  keep.forEach((k, i) => { color[k] = palette[i] ?? palette[palette.length - 1]; });
  return { order, color, label };
}

interface Props {
  commitments: Commitment[];
  nameById: Map<string, string>;
  now?: number;
  className?: string;
}

interface Dot { item: HorizonItem<Commitment>; x: number; y: number; color: string; personKey: string }

const TOP = 22; const BOTTOM = 22; const LEFT = 8; const RIGHT = 8;
const OVERDUE_W = 64; const DOT = 5; const ROW = 13;

/**
 * Compact 14-day horizon: one column per day from today, a commitment is a
 * dot coloured by person; overdue ones gather in a danger-toned shelf on the
 * left. Hover / focus a dot for the description and due date.
 */
export function CommitmentHorizon({ commitments, nameById, now, className }: Props) {
  const theme = useChartTheme();
  const id = useId();
  const [active, setActive] = useState<Dot | null>(null);
  const t = now ?? Date.now();
  const h = useMemo(() => horizon(commitments, (c) => c.deadline, isOpenCommitment, HORIZON_DAYS, t), [commitments, t]);
  const all = useMemo(() => [...h.overdue, ...h.upcoming].map((x) => x.item), [h]);
  const slots = useMemo(() => personSlots(all, nameById, theme.series), [all, nameById, theme.series]);
  const keyOf = (c: Commitment) => (c.stakeholderId ? (slots.color[c.stakeholderId] ? c.stakeholderId : 'other') : 'none');
  const colorOf = (k: string) => (k === 'none' ? theme.deemphasis : k === 'other' ? theme.textMuted : slots.color[k]);

  const perDay = useMemo(() => {
    const m = new Map<number, HorizonItem<Commitment>[]>();
    for (const u of h.upcoming) { const list = m.get(u.dayOffset) ?? []; list.push(u); m.set(u.dayOffset, list); }
    return m;
  }, [h.upcoming]);
  const maxStack = Math.max(1, h.overdue.length, ...[...perDay.values()].map((l) => l.length));
  const height = TOP + Math.min(5, maxStack) * ROW + BOTTOM;

  const table = {
    caption: `Open commitments on the next ${HORIZON_DAYS} days`,
    columns: ['Commitment', 'To', 'Due'],
    rows: [...h.overdue, ...h.upcoming].map((x) => [x.item.description, slots.label[keyOf(x.item)] ?? 'Someone', relativeDue(x.item.deadline, t)]),
  };

  if (all.length === 0) return null;

  return (
    <div className={className} id="commitment-horizon" data-testid="commitment-horizon">
      <ChartFrame table={table} fallbackWidth={560}>
        {(width) => {
          const W = Math.max(320, width);
          const hasOverdue = h.overdue.length > 0;
          const x0 = LEFT + (hasOverdue ? OVERDUE_W + 10 : 0);
          const dayW = (W - x0 - RIGHT) / HORIZON_DAYS;
          const dots: Dot[] = [];
          h.overdue.slice(0, 5).forEach((item, i) => {
            const k = keyOf(item.item);
            dots.push({ item, x: LEFT + 10 + (i % 3) * 16, y: TOP + Math.floor(i / 3) * ROW + 6, color: theme.danger, personKey: k });
          });
          for (const [day, list] of perDay) {
            list.slice(0, 5).forEach((item, i) => {
              const k = keyOf(item.item);
              dots.push({ item, x: x0 + day * dayW + dayW / 2, y: TOP + i * ROW + 6, color: colorOf(k), personKey: k });
            });
          }
          const today = startOfUtcDay(t);
          const dayLabel = (i: number) => {
            const d = new Date(today.getTime() + i * DAY_MS);
            return i === 0 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'narrow', timeZone: 'UTC' });
          };
          const dateLabel = (i: number) => new Date(today.getTime() + i * DAY_MS).getUTCDate();

          return (
            <>
              <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} role="img" aria-labelledby={id} onMouseLeave={() => setActive(null)} style={{ fontFamily: theme.font, overflow: 'visible' }}>
                <title id={id}>Commitment horizon: {h.upcoming.length} due in the next {HORIZON_DAYS} days{hasOverdue ? `, ${h.overdue.length} overdue` : ''}{h.beyond ? `, ${h.beyond} later` : ''}</title>
                {hasOverdue && (
                  <g>
                    <rect x={LEFT} y={TOP - 8} width={OVERDUE_W} height={height - TOP - BOTTOM + 16} rx={6} fill={theme.danger} fillOpacity={0.08} />
                    <text x={LEFT + OVERDUE_W / 2} y={height - 8} textAnchor="middle" fontSize={10} fontWeight={600} fill={theme.danger}>{h.overdue.length} overdue</text>
                  </g>
                )}
                {/* Day columns: hairline baseline + weekend wash */}
                <line x1={x0} x2={W - RIGHT} y1={height - BOTTOM + 2} y2={height - BOTTOM + 2} stroke={theme.grid} strokeWidth={1} />
                {Array.from({ length: HORIZON_DAYS }, (_, i) => {
                  const d = new Date(today.getTime() + i * DAY_MS).getUTCDay();
                  const weekend = d === 0 || d === 6;
                  return (
                    <g key={i}>
                      {weekend && <rect x={x0 + i * dayW} y={TOP - 8} width={dayW} height={height - TOP - BOTTOM + 10} fill={theme.text} fillOpacity={0.03} />}
                      {i === 0 && <line x1={x0 + dayW / 2} x2={x0 + dayW / 2} y1={TOP - 8} y2={height - BOTTOM + 2} stroke={theme.accent} strokeWidth={1} strokeOpacity={0.7} />}
                      <text x={x0 + i * dayW + dayW / 2} y={height - 9} textAnchor="middle" fontSize={9} fill={i === 0 ? theme.text : theme.textMuted} fontWeight={i === 0 ? 600 : 400}>{dayLabel(i)}</text>
                      {(i === 0 || dateLabel(i) === 1 || i % 7 === 0) && i !== 0 && (
                        <text x={x0 + i * dayW + dayW / 2} y={10} textAnchor="middle" fontSize={9} fill={theme.textMuted}>{dateLabel(i)}</text>
                      )}
                    </g>
                  );
                })}
                {dots.map((d, i) => {
                  const isActive = active?.item.item.id === d.item.item.id;
                  return (
                    <g
                      key={`${d.item.item.id}-${i}`}
                      tabIndex={0}
                      role="img"
                      aria-label={`${d.item.item.description} — ${slots.label[d.personKey] ?? ''} — ${relativeDue(d.item.item.deadline, t)}`}
                      onMouseEnter={() => setActive(d)}
                      onFocus={() => setActive(d)}
                      onBlur={() => setActive(null)}
                      style={{ outline: 'none' }}
                      data-overdue={d.item.overdue || undefined}
                    >
                      <circle cx={d.x} cy={d.y} r={12} fill="transparent" />
                      <circle cx={d.x} cy={d.y} r={isActive ? DOT + 1.5 : DOT} fill={d.color} stroke={theme.surface} strokeWidth={2} />
                    </g>
                  );
                })}
              </svg>
              {active && (
                <ChartTooltip fx={active.x / W} fy={active.y / height}>
                  <TooltipTitle>{relativeDue(active.item.item.deadline, t)}</TooltipTitle>
                  <div className="max-w-[220px] whitespace-normal text-foreground">{active.item.item.description}</div>
                  <TooltipRow color={active.color} shape="dot" value={slots.label[active.personKey] ?? 'Someone'} label={active.item.overdue ? 'overdue' : ''} />
                </ChartTooltip>
              )}
            </>
          );
        }}
      </ChartFrame>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <Legend
          aria-label="People"
          items={slots.order.map((k) => ({ id: k, label: slots.label[k] ?? k, color: colorOf(k), shape: 'dot' }))}
        />
        {h.beyond > 0 && <span className="text-[11px] text-muted-foreground">+{h.beyond} later</span>}
      </div>
    </div>
  );
}
