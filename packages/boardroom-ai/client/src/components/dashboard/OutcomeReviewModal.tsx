import { useEffect, useMemo, useState } from 'react';
import type { Decision, OutcomeReviewNudge } from '@boardroom/shared';
import { Modal } from '../shared/Modal';
import { completeReview } from '../../lib/api';
import { useEntitiesStore } from '../../stores/entities.store';

interface OutcomeReviewModalProps {
  nudge: OutcomeReviewNudge;
  /** Optional: pass the decision directly; otherwise it is looked up by `nudge.decisionId` in the entities store. */
  decision?: Decision | null;
  onComplete: () => void;
  onClose: () => void;
}

/**
 * The forecast captured at commit time (Phase 6). Shown ABOVE the rating so
 * the user judges the outcome against what they predicted, not against how
 * they feel about it now.
 */
export function ForecastRecap({ expectedOutcome, probabilitySuccess }: { expectedOutcome: string | null; probabilitySuccess: number | null }) {
  if (!expectedOutcome && probabilitySuccess === null) return null;
  const pct = probabilitySuccess !== null ? Math.round(probabilitySuccess * 100) : null;
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 space-y-1" data-testid="forecast-recap">
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Your forecast at the time</p>
      {expectedOutcome && <p className="text-sm text-foreground">{expectedOutcome}</p>}
      {pct !== null && (
        <p className="text-sm text-muted-foreground">
          You forecast <span className="font-medium text-foreground tabular-nums">{pct} %</span> chance of success.
        </p>
      )}
    </div>
  );
}

export function OutcomeReviewModal({ nudge, decision: decisionProp, onComplete, onClose }: OutcomeReviewModalProps) {
  const { decisions, fetchDecisions } = useEntitiesStore();
  useEffect(() => {
    if (!decisionProp && decisions.length === 0) void fetchDecisions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const decision = useMemo(
    () => decisionProp ?? decisions.find((d) => d.id === nudge.decisionId) ?? null,
    [decisionProp, decisions, nudge.decisionId],
  );

  const [outcome, setOutcome] = useState('');
  const [rating, setRating] = useState(3);
  const [wouldDecideSame, setWouldDecideSame] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nudgeLabel = nudge.nudgeType === '30_day' ? '30-Day Review' : '90-Day Review';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!outcome.trim()) {
      setError('Please describe what happened.');
      return;
    }
    if (wouldDecideSame === null) {
      setError('Please indicate whether you would make the same decision.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await completeReview(nudge.id, {
        outcome: outcome.trim(),
        outcomeRating: rating,
        wouldDecideSame,
      });
      onComplete();
    } catch {
      setError('Failed to submit review. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={nudgeLabel}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Decision context */}
        <div className="rounded-lg bg-card px-4 py-3">
          <p className="text-sm text-muted-foreground">Decision</p>
          <p className="text-sm font-medium text-foreground">{nudge.decisionTitle}</p>
          {decision?.chosenPath && (
            <p className="text-xs text-muted-foreground mt-1">Chosen path: {decision.chosenPath}</p>
          )}
        </div>

        {/* Original prediction — before the rating, so the review scores the forecast */}
        {decision && (
          <ForecastRecap expectedOutcome={decision.expectedOutcome ?? null} probabilitySuccess={decision.probabilitySuccess ?? null} />
        )}

        {/* Outcome description */}
        <div>
          <label htmlFor="outcome" className="block text-sm font-medium text-muted-foreground mb-1">
            What happened?
          </label>
          <textarea
            id="outcome"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Describe the outcome of this decision..."
          />
        </div>

        {/* Rating */}
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-2">
            Rate the outcome (1-5)
          </label>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                className={`w-10 h-10 rounded-lg border text-sm font-medium transition-colors ${
                  rating === n
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground hover:border-border-strong'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Would decide same */}
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-2">
            Would you make the same decision?
          </label>
          <div className="flex gap-2">
            {([
              { value: true, label: 'Yes' },
              { value: false, label: 'No' },
            ] as const).map(({ value, label }) => (
              <button
                key={label}
                type="button"
                onClick={() => setWouldDecideSame(value)}
                className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  wouldDecideSame === value
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground hover:border-border-strong'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Submitting...' : 'Submit Review'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
