import { useState } from 'react';
import type { SynthesisReport } from '@boardroom/shared';

interface SynthesisPanelProps {
  report?: SynthesisReport;
  streamingText?: string;
  isStreaming: boolean;
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-sm font-medium text-blue-300 hover:text-blue-200 transition-colors"
      >
        <span className={`transition-transform text-xs ${open ? 'rotate-90' : ''}`}>{'\u25B6'}</span>
        {title}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

export function SynthesisPanel({ report, streamingText, isStreaming }: SynthesisPanelProps) {
  // Streaming state
  if (isStreaming && !report) {
    return (
      <div className="bg-blue-950/30 border border-blue-800 rounded-lg p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg">CEO Synthesis</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-900/50 text-blue-400 border border-blue-800">
            sonnet
          </span>
        </div>
        <div className="text-sm text-gray-300 whitespace-pre-wrap">
          {streamingText}
          <span className="inline-block w-2 h-4 bg-blue-500 animate-pulse ml-0.5 align-text-bottom" />
        </div>
      </div>
    );
  }

  if (!report) return null;

  return (
    <div className="bg-blue-950/30 border border-blue-800 rounded-lg p-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg font-semibold text-white">CEO Synthesis</span>
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-900/50 text-blue-400 border border-blue-800">
          sonnet
        </span>
      </div>

      {/* Disagreement Map */}
      <CollapsibleSection title="Disagreement Map" defaultOpen={false}>
        <p className="text-sm text-gray-300 whitespace-pre-wrap">{report.disagreementMap}</p>
      </CollapsibleSection>

      {/* Decisive Tradeoff */}
      <CollapsibleSection title="Decisive Tradeoff">
        <div className="p-3 bg-blue-900/30 border border-blue-800/50 rounded text-sm text-blue-100">
          {report.decisiveTradeoff}
        </div>
      </CollapsibleSection>

      {/* Recommendation */}
      <div className="mt-4 p-4 bg-blue-900/40 border border-blue-700 rounded-lg">
        <div className="text-xs font-medium text-blue-400 mb-2 uppercase tracking-wider">Recommendation</div>
        <p className="text-base text-white font-medium">{report.recommendation}</p>
      </div>

      {/* Next 3 Actions */}
      <CollapsibleSection title="Next Actions">
        <ol className="space-y-2">
          {report.nextActions.map((action, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
              <span className="flex-shrink-0 w-5 h-5 rounded bg-gray-800 text-gray-400 text-xs flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <span>{action}</span>
            </li>
          ))}
        </ol>
      </CollapsibleSection>

      {/* Top Risks */}
      {report.topRisks.length > 0 && (
        <CollapsibleSection title="Top Risks">
          <ul className="space-y-1">
            {report.topRisks.map((risk, i) => (
              <li key={i} className="text-sm text-amber-400 flex items-start gap-2">
                <span className="flex-shrink-0 mt-1">{'\u2022'}</span>
                <span>{risk}</span>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {/* Assumptions to Monitor */}
      {report.assumptionsToMonitor.length > 0 && (
        <CollapsibleSection title="Assumptions to Monitor" defaultOpen={false}>
          <ul className="space-y-2">
            {report.assumptionsToMonitor.map((item, i) => (
              <li key={i} className="text-sm text-gray-300 flex items-start justify-between gap-4">
                <span>{item.assumption}</span>
                <span className="text-gray-500 text-xs flex-shrink-0">
                  Review: {new Date(item.reviewAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {/* Sources */}
      {report.sourceMemoryIds.length > 0 && (
        <div className="mt-4 text-xs text-gray-600">
          Sources: {report.sourceMemoryIds.join(', ')}
        </div>
      )}
    </div>
  );
}
