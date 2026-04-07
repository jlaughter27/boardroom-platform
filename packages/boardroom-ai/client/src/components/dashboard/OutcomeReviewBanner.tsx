import { useEffect, useState, useCallback } from 'react';
import type { OutcomeReviewNudge } from '@boardroom/shared';
import { getPendingReviews, skipReview } from '../../lib/api';
import { OutcomeReviewModal } from './OutcomeReviewModal';

const MAX_VISIBLE = 2;

export function OutcomeReviewBanner() {
  const [nudges, setNudges] = useState<OutcomeReviewNudge[]>([]);
  const [activeNudge, setActiveNudge] = useState<OutcomeReviewNudge | null>(null);

  const fetchNudges = useCallback(async () => {
    try {
      const data = await getPendingReviews();
      setNudges(data.slice(0, MAX_VISIBLE));
    } catch {
      // Silently fail — dashboard still works without reviews
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
            <div
              key={nudge.id}
              className="flex items-start gap-3 rounded-lg border border-purple-800 bg-purple-950/50 p-3"
            >
              {/* Icon */}
              <span className="mt-0.5 flex-shrink-0 text-purple-400">
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>

              {/* Message */}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-200">
                  <span className="font-medium text-purple-300">{nudgeLabel} review:</span>{' '}
                  {nudge.decisionTitle}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {daysAgo > 0
                    ? `Scheduled ${daysAgo} day${daysAgo === 1 ? '' : 's'} ago`
                    : 'Due today'}
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleSkip(nudge.id)}
                  className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Skip
                </button>
                <button
                  onClick={() => setActiveNudge(nudge)}
                  className="text-xs px-2 py-1 rounded bg-purple-800 text-purple-200 hover:bg-purple-700 transition-colors"
                >
                  Review Now
                </button>
              </div>
            </div>
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
