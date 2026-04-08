import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useCortexStore } from '../../stores/cortex.store';
import { Card, Button, Skeleton, Progress, Badge } from '../ui';

export function WeeklyMemoCard() {
  const { latestMemo, isLoadingMemo, isGeneratingMemo, fetchLatestMemo, generateMemo } =
    useCortexStore();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchLatestMemo();
  }, []);

  if (isLoadingMemo) {
    return (
      <Card className="border-t-2 border-t-accent">
        <div className="space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </Card>
    );
  }

  if (!latestMemo) {
    return (
      <Card className="border-t-2 border-t-accent">
        <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wide mb-2">
          Weekly Thinking Memo
        </h3>
        <p className="text-text-tertiary text-sm">
          Keep making decisions! Weekly insights start after 5 sessions.
        </p>
        <Button variant="secondary" size="sm" onClick={() => generateMemo()} className="mt-3">
          {'\u2728'} Generate Memo
        </Button>
      </Card>
    );
  }

  const score = latestMemo.thinkingQualityScore;
  const scoreColor = score <= 3 ? 'danger' : score <= 6 ? 'warning' : 'success';
  const weekLabel = `${new Date(latestMemo.weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${new Date(latestMemo.weekEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  return (
    <Card className="border-t-2 border-t-transparent" style={{ borderImage: 'linear-gradient(to right, var(--color-accent-primary), var(--color-accent-secondary)) 1' }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wide">
            Weekly Thinking Memo
          </h3>
          <p className="text-xs text-text-tertiary">{weekLabel}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => generateMemo()}
          disabled={isGeneratingMemo}
        >
          {isGeneratingMemo ? 'Generating...' : '\u2728 Generate'}
        </Button>
      </div>

      {/* Score */}
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-2xl font-bold text-text-primary">{score.toFixed(1)}</span>
        <span className="text-sm text-text-tertiary">/10</span>
        {latestMemo.scoreChange !== 0 && (
          <Badge variant={latestMemo.scoreChange > 0 ? 'success' : 'danger'}>
            {latestMemo.scoreChange > 0 ? '\u2191' : '\u2193'} {Math.abs(latestMemo.scoreChange).toFixed(1)}
          </Badge>
        )}
      </div>
      <Progress value={score * 10} className="mb-4" />

      {latestMemo.recommendedFocus.length > 0 && (
        <div className="mb-3">
          <h4 className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-2">
            Recommended Focus
          </h4>
          <ul className="space-y-1">
            {latestMemo.recommendedFocus.slice(0, 3).map((focus, i) => (
              <li key={i} className="text-sm text-text-primary flex items-start gap-2 leading-relaxed">
                <span className="text-accent mt-0.5">{'\u2022'}</span>
                {focus}
              </li>
            ))}
          </ul>
        </div>
      )}

      {latestMemo.fullMemoText && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Hide Full Memo' : 'View Full Memo'}
          </Button>
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-3 p-3 bg-bg-base rounded-md text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
                  {latestMemo.fullMemoText}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </Card>
  );
}
