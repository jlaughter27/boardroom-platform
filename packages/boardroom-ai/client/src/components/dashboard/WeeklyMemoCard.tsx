import { useEffect, useState } from 'react';
import { useCortexStore } from '../../stores/cortex.store';

function ScoreMeter({ score, change }: { score: number; change: number }) {
  // Color: 0-3 red, 4-6 yellow, 7-10 green
  const color =
    score <= 3 ? 'bg-red-500' : score <= 6 ? 'bg-yellow-500' : 'bg-emerald-500';
  const pct = Math.min(100, Math.max(0, score * 10));

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-2xl font-bold text-white">{score.toFixed(1)}</span>
          <span className="text-sm text-gray-400">/10</span>
          {change !== 0 && (
            <span
              className={`text-sm font-medium ${
                change > 0 ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {change > 0 ? '\u2191' : '\u2193'} {Math.abs(change).toFixed(1)}
            </span>
          )}
        </div>
        <div className="h-2 rounded-full bg-gray-700 overflow-hidden">
          <div
            className={`h-full rounded-full ${color} transition-all duration-500`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export function WeeklyMemoCard() {
  const { latestMemo, isLoadingMemo, isGeneratingMemo, fetchLatestMemo, generateMemo } =
    useCortexStore();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchLatestMemo();
  }, []);

  if (isLoadingMemo) {
    return (
      <div className="bg-indigo-950/30 border border-indigo-800 rounded-lg p-6 animate-pulse">
        <div className="h-6 bg-indigo-900/50 rounded w-48 mb-4" />
        <div className="h-4 bg-indigo-900/50 rounded w-full mb-2" />
        <div className="h-4 bg-indigo-900/50 rounded w-3/4" />
      </div>
    );
  }

  if (!latestMemo) {
    return (
      <div className="bg-indigo-950/30 border border-indigo-800 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-white mb-2">Weekly Thinking Memo</h3>
        <p className="text-gray-400 text-sm">
          Keep making decisions! Weekly insights start after 5 sessions.
        </p>
      </div>
    );
  }

  const weekLabel = `${new Date(latestMemo.weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${new Date(latestMemo.weekEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  return (
    <div className="bg-indigo-950/30 border border-indigo-800 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-white">Weekly Thinking Memo</h3>
          <p className="text-xs text-gray-500">{weekLabel}</p>
        </div>
        <button
          onClick={() => generateMemo()}
          disabled={isGeneratingMemo}
          className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
        >
          {isGeneratingMemo ? 'Generating...' : 'Regenerate'}
        </button>
      </div>

      <ScoreMeter
        score={latestMemo.thinkingQualityScore}
        change={latestMemo.scoreChange}
      />

      {latestMemo.recommendedFocus.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
            Recommended Focus
          </h4>
          <ul className="space-y-1">
            {latestMemo.recommendedFocus.slice(0, 3).map((focus, i) => (
              <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                <span className="text-indigo-400 mt-0.5">&#8226;</span>
                {focus}
              </li>
            ))}
          </ul>
        </div>
      )}

      {latestMemo.fullMemoText && (
        <div className="mt-4">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-indigo-400 hover:text-indigo-300"
          >
            {expanded ? 'Hide Full Memo' : 'View Full Memo'}
          </button>
          {expanded && (
            <div className="mt-3 p-3 bg-gray-900/50 rounded text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
              {latestMemo.fullMemoText}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
