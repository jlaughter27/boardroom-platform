import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PERSONA_CONFIGS } from '@boardroom/shared';
import type { Decision, PersonaResponse } from '@boardroom/shared';
import type { DecideSessionRequest, ExtendedSynthesisReport } from '../../types/debate';
import { Card, Badge, Button } from '../ui';
import { ErrorBanner } from '../shared/ErrorBanner';

interface DecisionCommitCardProps {
  report: ExtendedSynthesisReport;
  personaResponses: Record<string, PersonaResponse>;
  committed: Decision | null;
  isCommitting: boolean;
  error?: string | null;
  onCommit: (input: DecideSessionRequest) => Promise<Decision | null>;
  onClearError?: () => void;
}

type PathChoice = { key: string; label: string; text: string };

const CUSTOM_KEY = '__custom__';
const DEFAULT_REVIEW_DAYS = 30;

function plusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Probability wording that reads like a forecast, not a slider value. */
export function probabilityLabel(pct: number): string {
  return `I'd give this a ${pct} % chance`;
}

/**
 * Decision journal commit step (Phase 6): captures the chosen path, the
 * expected outcome in the user's words and a numeric forecast so the outcome
 * review can score calibration later. `POST /sessions/:id/decide`.
 */
export function DecisionCommitCard({
  report, personaResponses, committed, isCommitting, error, onCommit, onClearError,
}: DecisionCommitCardProps) {
  const choices = useMemo<PathChoice[]>(() => {
    const list: PathChoice[] = [{ key: 'report', label: 'CEO recommendation', text: report.recommendation }];
    const seen = new Set<string>([report.recommendation.trim().toLowerCase()]);
    for (const [pid, r] of Object.entries(personaResponses)) {
      const text = r.recommendation?.trim();
      if (!text) continue;
      const norm = text.toLowerCase();
      if (seen.has(norm)) continue;
      seen.add(norm);
      list.push({ key: pid, label: PERSONA_CONFIGS[pid]?.name ?? pid, text });
    }
    return list;
  }, [report.recommendation, personaResponses]);

  const [choice, setChoice] = useState<string>('report');
  const [customPath, setCustomPath] = useState('');
  const [expectedOutcome, setExpectedOutcome] = useState('');
  const [rationale, setRationale] = useState('');
  const [probability, setProbability] = useState(70);
  const [reviewDate, setReviewDate] = useState(() => plusDays(DEFAULT_REVIEW_DAYS));
  const [touched, setTouched] = useState(false);

  const chosenPath = choice === CUSTOM_KEY
    ? customPath.trim()
    : (choices.find((c) => c.key === choice)?.text ?? '');
  const outcomeMissing = expectedOutcome.trim().length === 0;
  const pathMissing = chosenPath.length === 0;
  const canSubmit = !outcomeMissing && !pathMissing && !isCommitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    const reviewAt = reviewDate ? new Date(`${reviewDate}T09:00:00`).toISOString() : undefined;
    await onCommit({
      chosenPath,
      rationale: rationale.trim() || undefined,
      expectedOutcome: expectedOutcome.trim(),
      probabilitySuccess: probability / 100,
      reviewAt,
    });
  }

  if (committed) {
    const pct = committed.probabilitySuccess !== null ? Math.round(committed.probabilitySuccess * 100) : null;
    return (
      <Card className="border-t-2 border-success p-6" data-testid="decision-committed">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg font-semibold text-foreground">Decision committed</span>
          <Badge variant="success">{committed.status}</Badge>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Chosen path</dt>
          <dd className="text-foreground">{committed.chosenPath ?? chosenPath}</dd>
          <dt className="text-muted-foreground">Expected outcome</dt>
          <dd className="text-foreground">{committed.expectedOutcome ?? expectedOutcome}</dd>
          <dt className="text-muted-foreground">Forecast</dt>
          <dd className="text-foreground tabular-nums">{pct !== null ? `${pct} % chance of success` : '—'}</dd>
          <dt className="text-muted-foreground">Review</dt>
          <dd className="text-foreground">
            {committed.reviewAt ? new Date(committed.reviewAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'not scheduled'}
          </dd>
        </dl>
        <div className="mt-4 flex items-center gap-3">
          <Link to="/decisions" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
            Open Decisions
          </Link>
          <span className="text-xs text-muted-foreground">You will be nudged to review it and score the forecast.</span>
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-t-2 border-primary p-6" data-testid="decision-commit-card">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-foreground">Commit the decision</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Write down what you chose, what you expect, and how sure you are. Separating the decision from the outcome is what makes the review honest.
        </p>
      </div>

      {error && <div className="mb-4"><ErrorBanner message={error} onDismiss={onClearError} /></div>}

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {/* Chosen path */}
        <fieldset>
          <legend className="text-sm font-medium text-muted-foreground mb-2">Chosen path</legend>
          <div className="space-y-2">
            {choices.map((c) => (
              <label
                key={c.key}
                className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                  choice === c.key ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-muted'
                }`}
              >
                <input
                  type="radio"
                  name="chosen-path"
                  value={c.key}
                  checked={choice === c.key}
                  onChange={() => setChoice(c.key)}
                  className="mt-1 accent-[var(--color-primary)]"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-muted-foreground uppercase tracking-wide">{c.label}</span>
                  <span className="block text-sm text-foreground">{c.text}</span>
                </span>
              </label>
            ))}
            <label
              className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                choice === CUSTOM_KEY ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-muted'
              }`}
            >
              <input
                type="radio"
                name="chosen-path"
                value={CUSTOM_KEY}
                checked={choice === CUSTOM_KEY}
                onChange={() => setChoice(CUSTOM_KEY)}
                className="mt-1 accent-[var(--color-primary)]"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-muted-foreground uppercase tracking-wide">Custom</span>
                <input
                  type="text"
                  value={customPath}
                  onChange={(e) => { setCustomPath(e.target.value); setChoice(CUSTOM_KEY); }}
                  onFocus={() => setChoice(CUSTOM_KEY)}
                  placeholder="Describe the path you are actually taking"
                  aria-label="Custom chosen path"
                  className="mt-1 w-full bg-background border border-border rounded-md px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:ring-1 focus:ring-ring/30 outline-none"
                />
              </span>
            </label>
          </div>
          {touched && pathMissing && <p className="mt-1 text-xs text-destructive">Choose or describe a path.</p>}
        </fieldset>

        {/* Expected outcome */}
        <div>
          <label htmlFor="expected-outcome" className="block text-sm font-medium text-muted-foreground mb-1">
            Expected outcome <span className="text-destructive" aria-hidden>*</span>
          </label>
          <textarea
            id="expected-outcome"
            required
            value={expectedOutcome}
            onChange={(e) => setExpectedOutcome(e.target.value)}
            rows={3}
            placeholder="In 30 days I expect… (be concrete: numbers, dates, who says yes)"
            aria-invalid={touched && outcomeMissing}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:ring-1 focus:ring-ring/30 outline-none resize-y"
          />
          {touched && outcomeMissing && <p className="mt-1 text-xs text-destructive">Say what you expect to happen — the review compares reality against this.</p>}
        </div>

        {/* Probability */}
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <label htmlFor="probability-success" className="text-sm font-medium text-muted-foreground">
              Probability of success
            </label>
            <span className="text-sm text-foreground" aria-live="polite" data-testid="probability-label">
              {probabilityLabel(probability)}
            </span>
          </div>
          <input
            id="probability-success"
            type="range"
            min={5}
            max={95}
            step={5}
            value={probability}
            onChange={(e) => setProbability(Number(e.target.value))}
            className="w-full accent-[var(--color-primary)]"
            aria-valuetext={`${probability} percent`}
          />
          <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums mt-0.5">
            <span>5 %</span><span>50 %</span><span>95 %</span>
          </div>
        </div>

        {/* Rationale (optional) + review date */}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4">
          <div>
            <label htmlFor="decision-rationale" className="block text-sm font-medium text-muted-foreground mb-1">
              Rationale <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <input
              id="decision-rationale"
              type="text"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Why this path, in one line"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:ring-1 focus:ring-ring/30 outline-none"
            />
          </div>
          <div>
            <label htmlFor="review-date" className="block text-sm font-medium text-muted-foreground mb-1">
              Review on
            </label>
            <input
              id="review-date"
              type="date"
              value={reviewDate}
              min={plusDays(1)}
              onChange={(e) => setReviewDate(e.target.value)}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:border-primary/40 focus:ring-1 focus:ring-ring/30 outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {isCommitting ? 'Committing…' : 'Commit decision'}
          </Button>
          <span className="text-xs text-muted-foreground">Creates a Decision linked to this session.</span>
        </div>
      </form>
    </Card>
  );
}
