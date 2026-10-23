import { useEffect, useMemo, useState } from 'react';
import { PERSONA_CONFIGS } from '@boardroom/shared';
import type { CalibrationBin, CalibrationReport } from '@boardroom/shared';
import * as api from '../../lib/api';
import { Card, Badge, Skeleton } from '../ui';
import { cn } from '../../lib/cn';
import { ReliabilityDiagram, binLabel, brierVerdict } from '../viz/ReliabilityDiagram';
import { ProgressRing } from '../viz/ProgressRing';
import { Legend } from '../viz/Legend';

// ---------------------------------------------------------------------------
// Series + colours
// ---------------------------------------------------------------------------

/** Core persona ids that have a `--color-persona-<id>` token (styles/tokens.css, both themes). */
const PERSONA_IDS = ['optimist', 'critic', 'alternate', 'technician', 'questionnaire', 'doer', 'ceo'] as const;
const PERSONA_TOKEN = new Set<string>(PERSONA_IDS);

/** Persona colour via the design-system token; unknown / custom personas fall back to muted. */
export function personaColor(personaId: string): string {
  return PERSONA_TOKEN.has(personaId) ? `var(--color-persona-${personaId})` : 'var(--color-muted-foreground)';
}

const USER_COLOR = 'var(--color-primary)';
/** Fixed series order so a filtered persona never repaints the survivors. */
const SERIES_ORDER = ['user', 'optimist', 'critic', 'alternate', 'technician', 'questionnaire', 'doer', 'ceo'];
const MIN_PERSONA_COUNT = 5;

export interface CalibrationSeries {
  id: string;
  label: string;
  color: string;
  brier: number | null;
  count: number;
  bins: CalibrationBin[];
}

/** Flatten the report into drawable series: user + personas with ≥ MIN_PERSONA_COUNT scored forecasts. */
export function buildSeries(report: CalibrationReport): CalibrationSeries[] {
  const out: CalibrationSeries[] = [{
    id: 'user',
    label: 'You',
    color: USER_COLOR,
    brier: report.user.brier,
    count: report.reviewedDecisions,
    bins: report.user.bins,
  }];
  for (const [pid, p] of Object.entries(report.personas)) {
    if (p.count < MIN_PERSONA_COUNT) continue;
    out.push({
      id: pid,
      label: PERSONA_CONFIGS[pid]?.name?.replace(/^The /, '') ?? pid,
      color: personaColor(pid),
      brier: p.brier,
      count: p.count,
      bins: p.bins,
    });
  }
  return out.sort((a, b) => {
    const ia = SERIES_ORDER.indexOf(a.id); const ib = SERIES_ORDER.indexOf(b.id);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.id.localeCompare(b.id);
  });
}

const pct = (v: number) => `${Math.round(v * 100)} %`;

// ---------------------------------------------------------------------------
// Table view + Brier table
// ---------------------------------------------------------------------------

function CalibrationTable({ series }: { series: CalibrationSeries[] }) {
  const bins = series[0]?.bins ?? [];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <caption className="sr-only">Observed success rate per forecast bin, by series</caption>
        <thead>
          <tr className="text-left text-muted-foreground">
            <th scope="col" className="py-1.5 pr-3 font-medium">Forecast bin</th>
            {series.map((s) => (
              <th key={s.id} scope="col" className="py-1.5 px-2 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} aria-hidden />
                  {s.label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bins.map((b, i) => (
            <tr key={b.lower} className="border-t border-border">
              <th scope="row" className="py-1.5 pr-3 text-left font-normal text-foreground tabular-nums">{binLabel(b)}</th>
              {series.map((s) => {
                const sb = s.bins[i];
                return (
                  <td key={s.id} className="py-1.5 px-2 text-foreground tabular-nums">
                    {sb && sb.count > 0 ? <>{pct(sb.observedRate)} <span className="text-muted-foreground">(n={sb.count})</span></> : <span className="text-muted-foreground">—</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BrierTable({ series }: { series: CalibrationSeries[] }) {
  return (
    <table className="w-full text-xs">
      <caption className="sr-only">Brier scores (lower is better)</caption>
      <thead>
        <tr className="text-left text-muted-foreground">
          <th scope="col" className="py-1.5 pr-3 font-medium">Forecaster</th>
          <th scope="col" className="py-1.5 px-2 font-medium text-right">Brier</th>
          <th scope="col" className="py-1.5 pl-2 font-medium text-right">n</th>
          <th scope="col" className="py-1.5 pl-2 font-medium">Read</th>
        </tr>
      </thead>
      <tbody>
        {series.map((s) => (
          <tr key={s.id} className="border-t border-border">
            <th scope="row" className="py-1.5 pr-3 text-left font-normal text-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} aria-hidden />
                {s.label}
              </span>
            </th>
            <td className="py-1.5 px-2 text-right text-foreground tabular-nums">{s.brier === null ? '—' : s.brier.toFixed(3)}</td>
            <td className="py-1.5 pl-2 text-right text-muted-foreground tabular-nums">{s.count}</td>
            <td className="py-1.5 pl-2 text-muted-foreground">{brierVerdict(s.brier)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

/**
 * Calibration section for the Decisions page. Gated behind a progress ring
 * until `reviewedDecisions >= minimumForSignal`; then a reliability diagram
 * (one series per forecaster, bubbles sized by bin count, Brier badge), a
 * Brier table and a table-view toggle.
 */
export function CalibrationPanel() {
  const [report, setReport] = useState<CalibrationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [emphasis, setEmphasis] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getCalibration()
      .then((r) => { if (!cancelled) setReport(r); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const series = useMemo(() => (report ? buildSeries(report) : []), [report]);

  if (failed) return null; // endpoint not available yet — stay out of the way
  if (loading || !report) {
    return (
      <Card className="p-4">
        <Skeleton className="h-4 w-40 mb-2" />
        <Skeleton className="h-3 w-64" />
      </Card>
    );
  }

  const ready = report.reviewedDecisions >= report.minimumForSignal;
  const remaining = Math.max(0, report.minimumForSignal - report.reviewedDecisions);

  if (!ready) {
    return (
      <Card className="p-4" data-testid="calibration-gate">
        <div className="flex items-center gap-4">
          <ProgressRing
            value={report.minimumForSignal > 0 ? report.reviewedDecisions / report.minimumForSignal : 0}
            size={72}
            label={`${report.reviewedDecisions}/${report.minimumForSignal}`}
            name={`${report.reviewedDecisions} of ${report.minimumForSignal} reviewed decisions`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Calibration</h2>
              <Badge variant="default">Needs {remaining} more reviewed decision{remaining === 1 ? '' : 's'}</Badge>
            </div>
            <p className="text-sm text-foreground tabular-nums">
              {report.reviewedDecisions} of {report.minimumForSignal} reviewed decisions
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Commit decisions with a forecast, then review them when nudged. Once {report.minimumForSignal} are scored you will see how well you — and each advisor — are calibrated.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4" data-testid="calibration-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Calibration</h2>
          <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
            {report.reviewedDecisions} reviewed decisions · success = rating ≥ {report.successThreshold}
          </p>
        </div>
        <div className="flex rounded-md border border-border p-0.5" role="tablist" aria-label="Calibration view">
          {(['chart', 'table'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn('h-7 rounded px-2.5 text-xs transition-colors', view === v ? 'bg-primary/10 text-primary-text font-medium' : 'text-muted-foreground hover:text-foreground')}
            >
              {v === 'chart' ? 'Chart' : 'Table view'}
            </button>
          ))}
        </div>
      </div>

      {/* Legend — always present for ≥ 2 series; hovering a series emphasises it in the diagram */}
      <Legend
        className="mb-3"
        items={series.map((s) => ({ id: s.id, label: s.label, color: s.color, shape: 'dot', value: s.brier === null ? undefined : s.brier.toFixed(2), muted: emphasis !== null && emphasis !== s.id }))}
        onHover={setEmphasis}
      />

      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,360px)_1fr] gap-6 items-start">
        <div>
          {view === 'chart'
            ? <ReliabilityDiagram series={series} emphasis={emphasis} data-testid="reliability-diagram" />
            : <CalibrationTable series={series} />}
        </div>
        <div>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Brier score</h3>
          <BrierTable series={series} />
          <p className="text-xs text-muted-foreground mt-2">
            Mean squared gap between forecast and outcome. 0 is perfect; 0.25 is coin-flip. Bubble size is how many decisions sit in the bin. Points above the diagonal are under-confident, below it over-confident.
          </p>
        </div>
      </div>
    </Card>
  );
}
