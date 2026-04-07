import { useEffect } from 'react';
import { useCortexStore } from '../../stores/cortex.store';
import type { ThinkingPattern } from '@boardroom/shared';

const TYPE_BADGE: Record<string, { label: string; color: string }> = {
  BIAS: { label: 'Bias', color: 'bg-red-900/60 text-red-300' },
  STRENGTH: { label: 'Strength', color: 'bg-emerald-900/60 text-emerald-300' },
  BEHAVIORAL_CYCLE: { label: 'Cycle', color: 'bg-blue-900/60 text-blue-300' },
  DECISION_STYLE: { label: 'Style', color: 'bg-purple-900/60 text-purple-300' },
};

function TrendArrow({ trend }: { trend: string | null }) {
  if (trend === 'improving') {
    return <span className="text-emerald-400 text-xs">{'\u2191'}</span>;
  }
  if (trend === 'worsening') {
    return <span className="text-red-400 text-xs">{'\u2193'}</span>;
  }
  return <span className="text-gray-500 text-xs">{'\u2192'}</span>;
}

function PatternRow({ pattern }: { pattern: ThinkingPattern }) {
  const badge = TYPE_BADGE[pattern.patternType] ?? {
    label: pattern.patternType,
    color: 'bg-gray-700 text-gray-300',
  };

  return (
    <div className="flex items-start gap-2 py-2 border-b border-gray-800 last:border-0">
      <TrendArrow trend={pattern.trend} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-200 truncate">{pattern.pattern}</p>
        <div className="flex items-center gap-2 mt-1">
          <span
            className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${badge.color}`}
          >
            {badge.label}
          </span>
          <span className="text-[10px] text-gray-500">
            {(pattern.confidence * 100).toFixed(0)}% confidence
          </span>
        </div>
      </div>
    </div>
  );
}

export function CortexInsightsPanel() {
  const { patterns, isLoadingPatterns, fetchPatterns } = useCortexStore();
  const { latestMemo } = useCortexStore();

  useEffect(() => {
    fetchPatterns();
  }, []);

  const contradictionCount = latestMemo?.activeContradictions?.length ?? 0;

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-white mb-3">Cortex Insights</h3>

      {isLoadingPatterns ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-4 bg-gray-800 rounded w-full" />
          <div className="h-4 bg-gray-800 rounded w-3/4" />
          <div className="h-4 bg-gray-800 rounded w-5/6" />
        </div>
      ) : patterns.length === 0 ? (
        <p className="text-xs text-gray-500">
          No patterns detected yet. Keep using BoardRoom to build your thinking profile.
        </p>
      ) : (
        <>
          <div className="mb-3">
            <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
              Thinking Patterns
            </h4>
            {patterns.slice(0, 3).map((p) => (
              <PatternRow key={p.id} pattern={p} />
            ))}
          </div>
        </>
      )}

      {contradictionCount > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-800">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-xs text-gray-300">
              {contradictionCount} active contradiction{contradictionCount !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
