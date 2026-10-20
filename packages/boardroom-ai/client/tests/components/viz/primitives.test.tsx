import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { CalibrationBin } from '@boardroom/shared';
import { Sparkline } from '../../../src/components/viz/Sparkline';
import { StatTile, deltaText } from '../../../src/components/viz/StatTile';
import { ProgressRing } from '../../../src/components/viz/ProgressRing';
import { Legend } from '../../../src/components/viz/Legend';
import { Glyph, shapePath } from '../../../src/components/viz/Glyph';
import { AreaChart, pickXLabelIndices } from '../../../src/components/viz/AreaChart';
import { BarChart } from '../../../src/components/viz/BarChart';
import { Heatmap } from '../../../src/components/viz/Heatmap';
import { ReliabilityDiagram, brierVerdict } from '../../../src/components/viz/ReliabilityDiagram';
import { dayGrid } from '../../../src/components/viz/aggregate';
import { TYPE_SHAPE } from '../../../src/components/graph/graph-theme';

const NOW = Date.parse('2026-10-20T12:00:00.000Z');

describe('<Sparkline />', () => {
  it('renders an accessible svg, a table twin and the current-period dot', () => {
    const { container } = render(<Sparkline values={[1, 3, 2, 5]} labels={['a', 'b', 'c', 'd']} name="Memories by week" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('role', 'img');
    expect(svg.querySelector('title')!.textContent).toContain('Memories by week');
    expect(svg.querySelector('title')!.textContent).toContain('latest 5');
    const table = container.querySelector('table[data-viz-table]')!;
    expect(within(table as HTMLElement).getByText('Memories by week')).toBeInTheDocument();
    expect(table.querySelectorAll('tbody tr')).toHaveLength(4);
    expect(svg.querySelectorAll('circle')).toHaveLength(1);
    expect(svg.querySelectorAll('path').length).toBeGreaterThanOrEqual(2);
  });
  it('renders nothing visible for an empty series', () => {
    const { container } = render(<Sparkline values={[]} name="Empty" />);
    expect(container.querySelector('[data-viz="sparkline-empty"]')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
  });
  it('shows a tooltip on focus (keyboard) with the latest value', () => {
    const { container } = render(<Sparkline values={[1, 2, 7]} labels={['w1', 'w2', 'w3']} name="S" />);
    fireEvent.focus(container.querySelector('svg')!);
    const tip = container.querySelector('[data-viz-tooltip]')!;
    expect(tip).toHaveAttribute('role', 'status');
    expect(tip.textContent).toContain('7');
    expect(tip.textContent).toContain('w3');
    fireEvent.blur(container.querySelector('svg')!);
    expect(container.querySelector('[data-viz-tooltip]')).toBeNull();
  });
});

describe('<StatTile />', () => {
  it('formats deltas by unit and direction', () => {
    expect(deltaText({ value: 0.123, unit: 'ratio', vs: 'x' })).toBe('+12 %');
    expect(deltaText({ value: -3, unit: 'count', vs: 'x' })).toBe('−3');
    expect(deltaText({ value: 12.345, unit: 'usd', vs: 'x' })).toBe('+$12.3');
    expect(deltaText({ value: 0, unit: 'usd', vs: 'x' })).toBe('$0');
  });
  it('colours the delta by direction × whether up is good', () => {
    const { rerender } = render(<StatTile label="Spend" value="$4" delta={{ value: 2, unit: 'usd', vs: 'vs last month', upIsGood: false }} />);
    expect(screen.getByText('+$2.00').parentElement).toHaveClass('text-danger');
    expect(screen.getByText(', worsening')).toBeInTheDocument();
    rerender(<StatTile label="Memories" value="12" delta={{ value: 2, unit: 'count', vs: 'vs last week' }} trend={[1, 2, 3]} />);
    expect(screen.getByText('+2').parentElement).toHaveClass('text-success');
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(document.querySelector('[data-viz="sparkline"]')).toBeInTheDocument();
  });
  it('is a button when clickable and shows the loading state', () => {
    render(<StatTile label="X" value="1" onClick={() => {}} loading data-testid="t" />);
    const el = screen.getByTestId('t');
    expect(el.tagName).toBe('BUTTON');
    expect(el).toHaveAttribute('aria-busy', 'true');
  });
});

describe('<ProgressRing />', () => {
  it('clamps the value and names itself', () => {
    const { container } = render(<ProgressRing value={1.5} name="12 of 20" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('data-value', '1.000');
    expect(svg.querySelector('title')!.textContent).toBe('12 of 20: 100 %');
    expect(svg.textContent).toContain('100%');
  });
});

describe('<Legend /> and <Glyph />', () => {
  it('lists every series with a swatch and forwards hover', () => {
    const hovered: Array<string | null> = [];
    render(<Legend items={[{ id: 'a', label: 'Alpha', color: '#000', value: '3' }, { id: 'b', label: 'Beta', color: '#111', muted: true }]} onHover={(id) => hovered.push(id)} />);
    const list = screen.getByRole('list', { name: 'Series' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    fireEvent.mouseEnter(screen.getByText('Alpha').closest('li')!);
    fireEvent.mouseLeave(screen.getByText('Alpha').closest('li')!);
    expect(hovered).toEqual(['a', null]);
    expect(screen.getByText('Beta').closest('li')).toHaveClass('opacity-50');
  });
  it('renders nothing for no items', () => {
    const { container } = render(<Legend items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('glyph shapes follow the graph encoding and the hollow mode strokes only', () => {
    expect(shapePath('diamond', 4)).toMatch(/^M0,-5/);
    expect(shapePath('square', 4)).toMatch(/^M-3\.8,-3\.8/);
    expect(shapePath('circle', 4)).toContain('a4,4');
    const { container } = render(<><Glyph type="goal" color="#b5890a" /><Glyph type="memory" color="#888" mode="hollow" /><Glyph type="decision" color="#000" /></>);
    const [goal, memory, decision] = Array.from(container.querySelectorAll('svg'));
    expect(goal).toHaveAttribute('data-glyph', 'goal');
    expect(TYPE_SHAPE.goal).toBe('diamond');
    expect(goal.querySelector('path')!.getAttribute('fill')).toBe('#b5890a');
    expect(memory.querySelector('path')!.getAttribute('fill')).toBe('none');
    // decisions are rings in the graph → outline only
    expect(decision.querySelector('path')!.getAttribute('fill')).toBe('none');
  });
});

describe('<AreaChart />', () => {
  const series = [
    { id: 'w', label: 'Working', color: '#2a78d6', values: [1, 2, 3, 4] },
    { id: 'e', label: 'Episodic', color: '#1baf7a', values: [0, 1, 0, 2] },
  ];
  const x = ['Sep 28', 'Oct 5', 'Oct 12', 'Oct 19'];

  it('picks at most ~6 x labels including first and last', () => {
    expect(pickXLabelIndices(4)).toEqual([0, 1, 2, 3]);
    const idx = pickXLabelIndices(12);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(11);
    expect(idx.length).toBeLessThanOrEqual(7);
  });
  it('renders legend, table twin with totals and the latest-total direct label when stacked', () => {
    const { container } = render(<AreaChart series={series} xLabels={x} stacked name="Writes by type" data-testid="area" />);
    expect(screen.getByRole('list', { name: 'Series' })).toBeInTheDocument();
    const table = container.querySelector('table[data-viz-table]')!;
    expect(table.querySelector('thead')!.textContent).toContain('Total');
    const rows = table.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(4);
    expect(rows[3].textContent).toBe('Oct 19426');
    const svg = container.querySelector('svg')!;
    expect(svg.querySelector('title')!.textContent).toContain('(stacked)');
    const texts = Array.from(svg.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toContain('6'); // latest total, direct-labelled
  });
  it('shows a designed empty state when every value is zero', () => {
    const { container } = render(<AreaChart series={[{ id: 'a', label: 'A', color: '#000', values: [0, 0] }]} xLabels={['a', 'b']} name="Empty" />);
    expect(container.querySelector('svg')!.textContent).toContain('No activity in this window yet');
    expect(screen.queryByRole('list', { name: 'Series' })).toBeNull(); // single series → no legend box
  });
  it('keyboard focus opens the crosshair tooltip listing every series', () => {
    const { container } = render(<AreaChart series={series} xLabels={x} stacked name="Writes" />);
    const svg = container.querySelector('svg')!;
    fireEvent.focus(svg);
    const tip = container.querySelector('[data-viz-tooltip]')!;
    expect(tip.textContent).toContain('Oct 19');
    expect(tip.textContent).toContain('Working');
    expect(tip.textContent).toContain('Episodic');
    expect(tip.textContent).toContain('6');
    fireEvent.keyDown(svg, { key: 'ArrowLeft' });
    expect(container.querySelector('[data-viz-tooltip]')!.textContent).toContain('Oct 12');
  });
});

describe('<AreaChart /> partial last bucket', () => {
  const series = [{ id: 'w', label: 'Working', color: '#2a78d6', values: [4, 6, 8, 1] }, { id: 'e', label: 'Episodic', color: '#1baf7a', values: [1, 1, 2, 0] }];
  const x = ['Sep 28', 'Oct 5', 'Oct 12', 'Oct 19'];
  it('washes the in-progress band, notes it, labels the last complete total and says so in the tooltip', () => {
    const { container } = render(<AreaChart series={series} xLabels={x} stacked partialLast name="Writes" />);
    expect(container.querySelector('[data-viz="partial-band"]')).toBeInTheDocument();
    expect(container.querySelector('[data-viz="partial-note"]')!.textContent).toBe('last bucket is this week (partial)');
    const label = container.querySelector('[data-viz="end-label"]')!;
    expect(label.textContent).toBe('10'); // Oct 12 total, not the partial 1
    expect(label).toHaveAttribute('text-anchor', 'middle');
    fireEvent.focus(container.querySelector('svg')!);
    expect(container.querySelector('[data-viz-tooltip]')!.textContent).toContain('Oct 19 · this week (partial)');
  });
  it('without the flag the end label is the last bucket, inside the plot edge', () => {
    const { container } = render(<AreaChart series={series} xLabels={x} stacked name="Writes" />);
    expect(container.querySelector('[data-viz="partial-band"]')).toBeNull();
    const label = container.querySelector('[data-viz="end-label"]')!;
    expect(label.textContent).toBe('1');
    expect(label).toHaveAttribute('text-anchor', 'end');
  });
});

describe('<Sparkline /> partial last point', () => {
  it('dashes the final segment, hollows the dot and marks the table / tooltip row', () => {
    const { container } = render(<Sparkline values={[2, 5, 1]} labels={['w1', 'w2', 'w3']} name="S" partialLast />);
    expect(container.querySelector('[data-viz="partial-segment"]')).toHaveAttribute('stroke-dasharray', '3 3');
    const rows = container.querySelectorAll('table tbody tr');
    expect(rows[2].textContent).toBe('w3 (partial)1');
    expect(rows[1].textContent).toBe('w25');
    fireEvent.focus(container.querySelector('svg')!);
    expect(container.querySelector('[data-viz-tooltip]')!.textContent).toContain('w3 (partial)');
  });
});

describe('<BarChart />', () => {
  const rows = [
    { id: 'r1', label: 'Sonnet', segments: [{ id: 's', label: 'Sonnet 5.5', value: 30, color: '#2a78d6' }, { id: 'h', label: 'Haiku 4.5', value: 10, color: '#1baf7a', note: '400 calls' }], note: '· 42 % cache reads' },
  ];
  it('renders segments with hit targets, a legend for ≥ 2 segment ids and a table with totals', () => {
    const { container } = render(<BarChart rows={rows} name="Spend by model" valueFormat={(v) => `$${v}`} />);
    expect(screen.getByRole('list', { name: 'Series' })).toBeInTheDocument();
    const segs = container.querySelectorAll('svg g[role="img"]');
    expect(segs).toHaveLength(2);
    expect(segs[1]).toHaveAttribute('aria-label', 'Sonnet — Haiku 4.5: $10, 400 calls');
    const table = container.querySelector('table[data-viz-table]')!;
    expect(table.querySelector('tbody tr')!.textContent).toBe('Sonnet$30$10$40');
    expect(container.querySelector('svg')!.textContent).toContain('$40');
    expect(container.querySelector('svg')!.textContent).toContain('42 % cache reads');
  });
  it('shows the segment tooltip on focus', () => {
    const { container } = render(<BarChart rows={rows} name="Spend" valueFormat={(v) => `$${v}`} />);
    fireEvent.focus(container.querySelectorAll('svg g[role="img"]')[1]);
    const tip = container.querySelector('[data-viz-tooltip]')!;
    expect(tip.textContent).toContain('Haiku 4.5');
    expect(tip.textContent).toContain('400 calls');
    expect(tip.textContent).toContain('$40');
  });
  it('has an empty state', () => {
    const { container } = render(<BarChart rows={[]} name="Nothing" />);
    expect(container.querySelector('[data-viz="bar-empty"]')).toBeInTheDocument();
  });
});

describe('<Heatmap />', () => {
  it('renders weeks × 7 cells with ramp levels, future cells unfocusable and a weekly table', () => {
    const items = [{ at: '2026-10-20T01:00:00Z', d: 'business' }, { at: '2026-10-20T02:00:00Z', d: 'personal' }, { at: '2026-10-19T02:00:00Z', d: 'business' }];
    const g = dayGrid(items, (i) => i.at, 3, { now: NOW, getKey: (i) => i.d });
    const { container } = render(<Heatmap cells={g.cells} buckets={g.buckets} max={g.max} name="Pulse" unit="memories" keyLabels={{ business: 'Business' }} />);
    const cells = container.querySelectorAll('svg g[role="img"]');
    expect(cells).toHaveLength(21);
    const today = container.querySelector('g[data-key="2026-10-20"]')!;
    expect(today).toHaveAttribute('data-level', '4');
    expect(container.querySelector('g[data-key="2026-10-19"]')).toHaveAttribute('data-level', '2');
    expect(container.querySelector('g[data-key="2026-10-18"]')).toHaveAttribute('data-level', '0');
    expect(container.querySelector('g[data-key="2026-10-21"]')).toHaveAttribute('tabindex', '-1');
    const table = container.querySelector('table[data-viz-table]')!;
    expect(table.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(table.querySelectorAll('tbody tr')[2].textContent).toBe('Week of Oct 1912000003');
    fireEvent.focus(today);
    const tip = container.querySelector('[data-viz-tooltip]')!;
    expect(tip.textContent).toContain('2');
    expect(tip.textContent).toContain('Business');
    expect(tip.textContent).toContain('personal');
  });
});

describe('<ReliabilityDiagram />', () => {
  const bins = (counts: number[]): CalibrationBin[] => counts.map((count, i) => ({ lower: i * 0.2, upper: (i + 1) * 0.2, count, meanForecast: i * 0.2 + 0.1, observedRate: Math.min(1, i * 0.2 + 0.15) }));
  const series = [
    { id: 'user', label: 'You', color: '#b5890a', brier: 0.182, count: 24, bins: bins([2, 4, 8, 6, 4]) },
    { id: 'critic', label: 'Critic', color: '#ef4444', brier: 0.31, count: 12, bins: bins([0, 3, 3, 3, 3]) },
  ];
  it('verdicts the Brier score', () => {
    expect(brierVerdict(null)).toBe('no score yet');
    expect(brierVerdict(0.05)).toBe('sharp');
    expect(brierVerdict(0.18)).toBe('well calibrated');
    expect(brierVerdict(0.24)).toBe('near coin-flip');
    expect(brierVerdict(0.4)).toBe('worse than chance');
  });
  it('draws one bubble per non-empty bin, sized by count, with a Brier badge and table twin', () => {
    const { container } = render(<ReliabilityDiagram series={series} data-testid="rd" />);
    const marks = container.querySelectorAll('g[data-series]');
    expect(marks).toHaveLength(9); // 5 + 4 (critic's first bin is empty)
    const r = (sel: string) => Number(container.querySelector(`${sel} circle:last-of-type`)!.getAttribute('r'));
    expect(r('g[data-series="user"][data-bin="0.4"]')).toBeGreaterThan(r('g[data-series="user"][data-bin="0"]'));
    expect(r('g[data-series="user"][data-bin="0.4"]')).toBe(13);
    const badge = container.querySelector('[data-viz="brier-badge"]')!;
    expect(badge.textContent).toContain('0.182');
    expect(badge.textContent).toContain('well calibrated');
    const table = container.querySelector('table[data-viz-table]')!;
    expect(table.querySelectorAll('tbody tr')).toHaveLength(5);
    expect(table.querySelectorAll('tbody tr')[0].textContent).toBe('0–20 %15 %—20');
    expect(container.querySelector('svg title')!.textContent).toContain('perfect-calibration diagonal');
  });
  it('focus shows the bin tooltip and fades the other series', () => {
    const { container } = render(<ReliabilityDiagram series={series} />);
    const mark = container.querySelector('g[data-series="critic"][data-bin="0.2"]') as SVGGElement;
    fireEvent.focus(mark);
    const tip = container.querySelector('[data-viz-tooltip]')!;
    expect(tip.textContent).toContain('Critic · bin 20–40 %');
    expect(tip.textContent).toContain('3');
    const userMark = container.querySelector('g[data-series="user"][data-bin="0.2"]') as SVGGElement;
    expect(userMark.style.opacity).toBe('0.25');
  });
});
