import { useEffect, useState, useCallback } from 'react';
import type { OutcomeReviewNudge } from '@boardroom/shared';
import { getPendingReviews, skipReview } from '../../lib/api';
import { OutcomeReviewModal } from './OutcomeReviewModal';
import { Card, Badge, Button } from '../ui';

const MAX_VISIBLE = 2;

export function OutcomeReviewBanner() {
  const [nudges, setNudges] = useState<OutcomeReviewNudge[]>([]);
  const [activeNudge, setActiveNudge] = useState<OutcomeReviewNudge | null>(null);

  const fetchNudges = useCallback(async () => {
    try {
      const data = await getPendingReviews();
      setNudges(data.slice(0, MAX_VISIBLE));
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    fetchNudges();
  }, [fetchNudges]);

  async function handleSkip(nudgeId: string) {
    try {
      await skipReview(nudgeId);
      setNudges((prev) => prev.filter((n) => n.id !== nudgeId));
    } catch {
      // Silently fail
    }
  }

  function handleReviewComplete() {
    setActiveNudge(null);
    fetchNudges();
  }

  if (nudges.length === 0) return null;

  return (
    <>
      <div className="space-y-2">
        {nudges.map((nudge) => {
          const scheduledDate = new Date(nudge.scheduledFor);
          const daysAgo = Math.floor(
            (Date.now() - scheduledDate.getTime()) / (1000 * 60 * 60 * 24),
          );
          const nudgeLabel = nudge.nudgeType === '30_day' ? '30-day' : '90-day';

          return (
            <Card key={nudge.id} className="bg-accent-muted border-accent/30 flex items-start gap-3 p-3">
              <span className="mt-0.5 flex-shrink-0 text-accent animate-pulse">{'\u25CF'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary">
                  <Badge variant="accent" className="mr-2">{nudgeLabel} review</Badge>
                  {nudge.decisionTitle}
                </p>
                <p className="text-xs text-text-tertiary mt-0.5">
                  {daysAgo > 0
                    ? `Scheduled ${daysAgo} day${daysAgo === 1 ? '' : 's'} ago`
                    : 'Due today'}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button variant="ghost" size="sm" onClick={() => handleSkip(nudge.id)}>
                  Skip
                </Button>
                <Button variant="primary" size="sm" onClick={() => setActiveNudge(nudge)}>
                  Review
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {activeNudge && (
        <OutcomeReviewModal
          nudge={activeNudge}
          onComplete={handleReviewComplete}
          onClose={() => setActiveNudge(null)}
        />
      )}
    </>
  );
}
