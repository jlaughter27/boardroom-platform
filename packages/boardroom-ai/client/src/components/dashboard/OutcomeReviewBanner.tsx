import { useState } from 'react';
import type { OutcomeReviewNudge } from '@boardroom/shared';
import { skipReview } from '../../lib/api';
import { useVizSlice, useVizStore } from '../../stores/viz.store';
import { OutcomeReviewModal } from './OutcomeReviewModal';
import { Card, Badge, Button } from '../ui';

const MAX_VISIBLE = 2;

/** Drop one nudge from the shared slice (the cockpit count reads it too). */
function dropNudge(id: string) {
  useVizStore.setState((s) => ({
    pendingReviews: { ...s.pendingReviews, data: (s.pendingReviews.data ?? []).filter((n) => n.id !== id) },
  }));
}

export function OutcomeReviewBanner() {
  // Shared with the cockpit tile and the notification aggregator: one
  // GET /outcome-reviews/pending per dashboard load (M2-C1).
  const pending = useVizSlice('pendingReviews');
  const nudges = (pending.data ?? []).slice(0, MAX_VISIBLE);
  const [activeNudge, setActiveNudge] = useState<OutcomeReviewNudge | null>(null);

  async function handleSkip(nudgeId: string) {
    try {
      await skipReview(nudgeId);
      dropNudge(nudgeId);
    } catch {
      // Silently fail
    }
  }

  function handleReviewComplete() {
    setActiveNudge(null);
    void useVizStore.getState().load('pendingReviews', true);
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
            <Card key={nudge.id} className="bg-primary/10 border-primary/30 flex items-start gap-3 p-3">
              <span className="mt-0.5 flex-shrink-0 text-primary animate-pulse">{'\u25CF'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground">
                  <Badge variant="accent" className="mr-2">{nudgeLabel} review</Badge>
                  {nudge.decisionTitle}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
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
