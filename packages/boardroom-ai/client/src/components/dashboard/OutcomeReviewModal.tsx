import { useState } from 'react';
import type { OutcomeReviewNudge } from '@boardroom/shared';
import { Modal } from '../shared/Modal';
import { completeReview } from '../../lib/api';

interface OutcomeReviewModalProps {
  nudge: OutcomeReviewNudge;
  onComplete: () => void;
  onClose: () => void;
}

export function OutcomeReviewModal({ nudge, onComplete, onClose }: OutcomeReviewModalProps) {
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
        </div>

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
