import type { SufficiencyScore } from '@boardroom/shared';

interface SufficiencyBannerProps {
  score: SufficiencyScore;
  onProceed: () => void;
}

function getScoreColor(score: number): string {
  if (score < 0.3) return 'bg-green-500';
  if (score <= 0.6) return 'bg-yellow-500';
  return 'bg-red-500';
}

function getScoreLabel(score: number): string {
  if (score < 0.3) return 'Clear';
  if (score <= 0.6) return 'Some ambiguity';
  return 'Needs clarification';
}

export function SufficiencyBanner({ score, onProceed }: SufficiencyBannerProps) {
  const barColor = getScoreColor(score.score);
  const label = getScoreLabel(score.score);
  const pct = Math.round(score.score * 100);

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-4">
      {/* Score meter */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-medium text-gray-300">Ambiguity Score</span>
          <span className="text-sm text-gray-400">
            {pct}% &mdash; {label}
          </span>
        </div>
        <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Inferred intent */}
      <div>
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
          Inferred Intent
        </div>
        <p className="text-sm text-gray-300">{score.inferredIntent}</p>
      </div>

      {/* Missing dimensions */}
      {score.missingDimensions.length > 0 && (
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
            Missing Dimensions
          </div>
          <ul className="space-y-1">
            {score.missingDimensions.map((d, i) => (
              <li key={i} className="text-sm text-amber-400 flex items-start gap-2">
                <span className="flex-shrink-0 mt-1">{'\u2022'}</span>
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Suggested questions */}
      {score.suggestedQuestions.length > 0 && score.score > 0.6 && (
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
            Consider Clarifying
          </div>
          <ul className="space-y-1">
            {score.suggestedQuestions.map((q, i) => (
              <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                <span className="flex-shrink-0 text-blue-400">{'\u2753'}</span>
                <span>{q}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Proceed button */}
      <button
        type="button"
        onClick={onProceed}
        className="w-full px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700"
      >
        {score.canProceed ? 'Proceed with analysis' : 'Proceed anyway'}
      </button>
    </div>
  );
}
