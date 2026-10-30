import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { useMeasure } from './hooks';

export interface DataTableSpec {
  caption: string;
  columns: string[];
  rows: Array<Array<string | number>>;
}

/**
 * The WCAG twin of every chart: an off-screen table with the same values.
 * Tooltips enhance, never gate — this is what a screen reader (and a reader
 * who cannot see the fill) gets.
 *
 * The visually-hidden box is a 1 px clipped `<div>`, not the `<table>`: a
 * table ignores `width: 1px` and `overflow: hidden` (it sizes to its content),
 * so an `sr-only` table stays 200–400 px wide and widens whatever scroll pane
 * it sits in. The wrapper clips it, so it can never affect layout.
 */
export function DataTable({ caption, columns, rows, className }: DataTableSpec & { className?: string }) {
  return (
    <div className="sr-only" data-viz-table-wrap>
      <table className={className} data-viz-table>
        <caption>{caption}</caption>
        <thead>
          <tr>{columns.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j}>{cell}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface ChartFrameProps {
  /** Table twin for the chart. Pass `null` to opt out (e.g. a bare stat tile). */
  table: DataTableSpec | null;
  /** Width before the first measurement, and under test. */
  fallbackWidth?: number;
  className?: string;
  'data-testid'?: string;
  children: (width: number) => ReactNode;
}

/**
 * Measures its container (ResizeObserver) and hands the width to the chart,
 * which draws into a viewBox of that width so text never stretches.
 */
export function ChartFrame({ table, fallbackWidth = 600, className, children, ...rest }: ChartFrameProps) {
  const [ref, width] = useMeasure<HTMLDivElement>(fallbackWidth);
  return (
    <div ref={ref} className={cn('relative w-full min-w-0', className)} data-testid={rest['data-testid']}>
      {children(width)}
      {table && <DataTable {...table} />}
    </div>
  );
}
