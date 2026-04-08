import type { SufficiencyScore } from '@boardroom/shared';
import { Card, Button, Badge, Progress } from '../ui';

interface SufficiencyBannerProps {
  score: SufficiencyScore;
  onProceed: () => void;
}

function getScoreVariant(score: number): 'success' | 'warning' | 'danger' {
  if (score < 0.3) return 'success';
  if (score <= 0.6) return 'warning';
  return 'danger';
}

function getScoreLabel(score: number): string {
  if (score < 0.3) return 'Clear';
  if (score <= 0.6) return 'Some ambiguity';
  return 'Needs clarification';
}

export function SufficiencyBanner({ score, onProceed }: SufficiencyBannerProps) {
  const variant = getScoreVariant(score.score);
  const label = getScoreLabel(score.score);
  const pct = Math.round(score.score * 100);

  return (
    <Card className="bg-info-muted border-info/30 space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-medium text-text-primary">Ambiguity Score</span>
          <Badge variant={variant}>{pct}% — {label}</Badge>
        </div>
        <Progress value={pct} />
      </div>

      <div>
        <div className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-1">
          Inferred Intent
        </div>
        <p className="text-sm text-text-secondary">{score.inferredIntent}</p>
      </div>

      {score.missingDimensions.length > 0 && (
        <div>
          <div className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-1">
            Missing Dimensions
          </div>
          <ul className="space-y-1">
            {score.missingDimensions.map((d, i) => (
              <li key={i} className="text-sm text-warning flex items-start gap-2">
                <span className="flex-shrink-0 mt-1">{'\u2022'}</span>
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {score.suggestedQuestions.length > 0 && score.score > 0.6 && (
        <div>
          <div className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-1">
            Consider Clarifying
          </div>
          <ul className="space-y-1">
            {score.suggestedQuestions.map((q, i) => (
              <li key={i} className="text-sm text-text-secondary flex items-start gap-2">
                <span className="flex-shrink-0 text-info">{'\u2753'}</span>
                <span>{q}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button variant="secondary" onClick={onProceed} className="w-full">
        {score.canProceed ? 'Proceed with analysis' : 'Proceed anyway'}
      </Button>
    </Card>
  );
}
