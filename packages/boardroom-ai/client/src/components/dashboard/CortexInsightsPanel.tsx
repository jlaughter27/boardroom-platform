import { useEffect } from 'react';
import { useCortexStore } from '../../stores/cortex.store';
import type { ThinkingPattern } from '@boardroom/shared';
import { ContradictionCard } from './ContradictionCard';
import { Card, Badge, Button, Progress, Skeleton } from '../ui';

const TYPE_BADGE: Record<string, { label: string; variant: 'danger' | 'success' | 'info' | 'accent' | 'default' }> = {
  BIAS: { label: 'Bias', variant: 'danger' },
  STRENGTH: { label: 'Strength', variant: 'success' },
  BEHAVIORAL_CYCLE: { label: 'Cycle', variant: 'info' },
  DECISION_STYLE: { label: 'Style', variant: 'accent' },
};

function TrendArrow({ trend }: { trend: string | null }) {
  if (trend === 'improving') return <span className="text-success text-xs">{'\u2191'}</span>;
  if (trend === 'worsening') return <span className="text-destructive text-xs">{'\u2193'}</span>;
  return <span className="text-muted-foreground text-xs">{'\u2192'}</span>;
}

function PatternRow({ pattern }: { pattern: ThinkingPattern }) {
  const badge = TYPE_BADGE[pattern.patternType] ?? { label: pattern.patternType, variant: 'default' as const };

  return (
    <div className="flex items-start gap-2 py-2 border-b border-border last:border-0">
      <TrendArrow trend={pattern.trend} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{pattern.pattern}</p>
        <div className="flex items-center gap-2 mt-1">
          <Badge variant={badge.variant}>{badge.label}</Badge>
          <Progress value={pattern.confidence * 100} className="flex-1 h-1.5" />
          <span className="text-xs text-muted-foreground">
            {(pattern.confidence * 100).toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  );
}

export function CortexInsightsPanel() {
  const {
    patterns, isLoadingPatterns, fetchPatterns,
    contradictions, contradictionsTotal, isLoadingContradictions, isScanningContradictions,
    fetchContradictions, scanContradictions,
    resolveContradiction, dismissContradiction, acceptTension,
  } = useCortexStore();

  useEffect(() => {
    fetchPatterns();
    fetchContradictions();
  }, []);

  return (
    <Card className="p-4">
      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
        Cortex Insights
      </h3>

      {isLoadingPatterns ? (
        <div className="space-y-3">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10 w-5/6" />
        </div>
      ) : patterns.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No patterns detected yet. Keep using BoardRoom to build your thinking profile.
        </p>
      ) : (
        <div className="mb-3">
          {patterns.slice(0, 3).map((p) => (
            <PatternRow key={p.id} pattern={p} />
          ))}
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-border">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Active Contradictions
            </h4>
            {contradictionsTotal > 0 && (
              <Badge variant="warning">{contradictionsTotal}</Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => scanContradictions()}
            disabled={isScanningContradictions}
          >
            {isScanningContradictions ? 'Scanning...' : 'Scan Now'}
          </Button>
        </div>

        {isLoadingContradictions ? (
          <Skeleton className="h-10" />
        ) : contradictions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No active contradictions detected.</p>
        ) : (
          contradictions.slice(0, 3).map((c) => (
            <ContradictionCard
              key={c.id}
              contradiction={c}
              onResolve={resolveContradiction}
              onDismiss={dismissContradiction}
              onAcceptTension={acceptTension}
            />
          ))
        )}
      </div>
    </Card>
  );
}
