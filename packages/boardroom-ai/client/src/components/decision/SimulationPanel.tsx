import { useState } from 'react';
import type { SimulationResult, RiskLevel } from '@boardroom/shared';

interface SimulationPanelProps {
  result: SimulationResult;
}

function riskColor(risk: RiskLevel): string {
  switch (risk) {
    case 'low': return 'text-green-400 bg-green-900/30 border-green-800';
    case 'medium': return 'text-amber-400 bg-amber-900/30 border-amber-800';
    case 'high': return 'text-red-400 bg-red-900/30 border-red-800';
  }
}

function riskBadgeColor(risk: RiskLevel): string {
  switch (risk) {
    case 'low': return 'bg-green-900/50 text-green-400 border-green-700';
    case 'medium': return 'bg-amber-900/50 text-amber-400 border-amber-700';
    case 'high': return 'bg-red-900/50 text-red-400 border-red-700';
  }
}

function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.7 ? 'bg-green-500' : value >= 0.4 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500">{pct}%</span>
    </div>
  );
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
        className="flex items-center gap-1.5 text-sm font-medium text-purple-300 hover:text-purple-200 transition-colors"
      >
        <span className={`transition-transform text-xs ${open ? 'rotate-90' : ''}`}>{'\u25B6'}</span>
        {title}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

export function SimulationPanel({ result }: SimulationPanelProps) {
  return (
    <div className="bg-purple-950/20 border border-purple-800 rounded-lg p-6">
      {/* Header + Overall Risk */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-lg font-semibold text-white">Decision Simulation</span>
        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider border ${riskBadgeColor(result.overallRisk)}`}>
          {result.overallRisk} risk
        </span>
      </div>

      {/* Resource Impact */}
      <CollapsibleSection title="Resource Impact">
        <div className="space-y-3 p-3 bg-gray-900/50 rounded-lg border border-gray-800">
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Budget Required</div>
            <p className="text-sm text-gray-300">{result.resourceImpact.budgetRequired}</p>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">People Required</div>
            <p className="text-sm text-gray-300">{result.resourceImpact.peopleRequired}</p>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Gap Analysis</div>
            <p className="text-sm text-gray-300">{result.resourceImpact.gapAnalysis}</p>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Confidence</div>
            <ConfidenceMeter value={result.resourceImpact.confidence} />
          </div>
        </div>
      </CollapsibleSection>

      {/* Timeline Impact */}
      <CollapsibleSection title="Timeline">
        <div className="space-y-3 p-3 bg-gray-900/50 rounded-lg border border-gray-800">
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Estimated Duration</div>
            <p className="text-sm text-white font-medium">{result.timelineImpact.estimatedDuration}</p>
          </div>

          {/* Milestones as vertical timeline */}
          {result.timelineImpact.milestones.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Milestones</div>
              <div className="relative pl-4 space-y-3">
                {/* Vertical line */}
                <div className="absolute left-[5px] top-1 bottom-1 w-px bg-gray-700" />
                {result.timelineImpact.milestones.map((ms, i) => (
                  <div key={i} className="relative flex items-start gap-3">
                    {/* Dot */}
                    <div className={`absolute -left-4 top-1.5 w-2.5 h-2.5 rounded-full border ${
                      ms.risk === 'low' ? 'bg-green-500 border-green-400' :
                      ms.risk === 'medium' ? 'bg-amber-500 border-amber-400' :
                      'bg-red-500 border-red-400'
                    }`} />
                    <div className="flex-1 ml-1">
                      <div className="text-sm text-gray-200">{ms.name}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-500">{ms.date}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded border ${riskColor(ms.risk)}`}>
                          {ms.risk}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.timelineImpact.historicalComparison && (
            <div>
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Historical Comparison</div>
              <p className="text-sm text-gray-400 italic">{result.timelineImpact.historicalComparison}</p>
            </div>
          )}

          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Confidence</div>
            <ConfidenceMeter value={result.timelineImpact.confidence} />
          </div>
        </div>
      </CollapsibleSection>

      {/* Stakeholder Impact */}
      <CollapsibleSection title="Stakeholder Impact">
        <div className="space-y-3 p-3 bg-gray-900/50 rounded-lg border border-gray-800">
          {/* Impacted people as cards */}
          {result.stakeholderImpact.impactedPeople.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Impacted People</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {result.stakeholderImpact.impactedPeople.map((p, i) => (
                  <div key={i} className="p-2.5 bg-gray-800/50 border border-gray-700 rounded-lg">
                    <div className="text-sm font-medium text-white">{p.name}</div>
                    <div className="text-xs text-gray-400 mt-1">{p.impact}</div>
                    <div className="text-xs text-purple-400 mt-1">Action: {p.action}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ripple Effects */}
          {result.stakeholderImpact.rippleEffects.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Ripple Effects</div>
              <ul className="space-y-1">
                {result.stakeholderImpact.rippleEffects.map((effect, i) => (
                  <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                    <span className="flex-shrink-0 mt-1 text-gray-600">{'\u2022'}</span>
                    <span>{effect}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Communication Needed */}
          {result.stakeholderImpact.communicationNeeded.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Communication Needed</div>
              <ul className="space-y-1">
                {result.stakeholderImpact.communicationNeeded.map((item, i) => (
                  <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                    <span className="flex-shrink-0 mt-1 text-purple-600">{'\u2022'}</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
}
