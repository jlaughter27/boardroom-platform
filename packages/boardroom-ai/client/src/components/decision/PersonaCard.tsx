import { useState } from 'react';
import { PERSONA_CONFIGS } from '@boardroom/shared';
import type { PersonaId, PersonaResponse } from '@boardroom/shared';

const PERSONA_COLORS: Record<string, string> = {
  optimist: 'border-l-green-500',
  critic: 'border-l-red-500',
  alternate: 'border-l-purple-500',
  technician: 'border-l-cyan-500',
  questionnaire: 'border-l-yellow-500',
  doer: 'border-l-orange-500',
  ceo: 'border-l-blue-500',
};

interface PersonaCardProps {
  personaId: PersonaId;
  response?: PersonaResponse;
  streamingText?: string;
  isStreaming: boolean;
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-gray-300 transition-colors"
      >
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>{'\u25B6'}</span>
        {title}
      </button>
      {open && <div className="mt-1.5 text-sm text-gray-300">{children}</div>}
    </div>
  );
}

export function PersonaCard({ personaId, response, streamingText, isStreaming }: PersonaCardProps) {
  const config = PERSONA_CONFIGS[personaId];
  const colorClass = PERSONA_COLORS[personaId] ?? 'border-l-gray-500';

  // Waiting state
  if (!response && !isStreaming) {
    return (
      <div className={`bg-gray-900 rounded-lg border border-gray-800 border-l-4 ${colorClass} p-4`}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-gray-600 animate-pulse" />
          <span className="text-gray-500 text-sm">Waiting for {config?.name ?? personaId}...</span>
        </div>
      </div>
    );
  }

  // Streaming state
  if (isStreaming && !response) {
    return (
      <div className={`bg-gray-900 rounded-lg border border-gray-800 border-l-4 ${colorClass} p-4`}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium text-white text-sm">{config?.name ?? personaId}</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-800 text-gray-400 border border-gray-700">
            {config?.model ?? 'haiku'}
          </span>
        </div>
        <div className="text-sm text-gray-300 whitespace-pre-wrap">
          {streamingText}
          <span className="inline-block w-2 h-4 bg-blue-500 animate-pulse ml-0.5 align-text-bottom" />
        </div>
      </div>
    );
  }

  // Complete state
  if (response) {
    return (
      <div className={`bg-gray-900 rounded-lg border border-gray-800 border-l-4 ${colorClass} p-4`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="font-medium text-white text-sm">{config?.name ?? personaId}</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-800 text-gray-400 border border-gray-700">
              {config?.model ?? 'haiku'}
            </span>
            {response.dissentFlag && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-900/50 text-amber-400 border border-amber-800">
                DISSENTS
              </span>
            )}
          </div>
          <span className="text-xs text-gray-500">
            Confidence: {Math.round(response.confidence * 100)}%
          </span>
        </div>

        {/* Situation Reading */}
        <CollapsibleSection title="Situation Reading">
          <p>{response.situationReading}</p>
        </CollapsibleSection>

        {/* Key Assumptions */}
        {response.keyAssumptions.length > 0 && (
          <CollapsibleSection title="Key Assumptions">
            <ul className="list-disc list-inside space-y-1">
              {response.keyAssumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </CollapsibleSection>
        )}

        {/* Analysis (always visible) */}
        <div className="mt-3">
          <div className="text-xs font-medium text-gray-400 mb-1">Analysis</div>
          <p className="text-sm text-gray-300 whitespace-pre-wrap">{response.analysis}</p>
        </div>

        {/* Recommendation */}
        <div className="mt-3 p-3 bg-gray-800/50 border border-gray-700 rounded">
          <div className="text-xs font-medium text-gray-400 mb-1">Recommendation</div>
          <p className="text-sm text-white">{response.recommendation}</p>
        </div>

        {/* Uncertainties */}
        {response.uncertainties.length > 0 && (
          <CollapsibleSection title="Uncertainties">
            <ul className="list-disc list-inside space-y-1">
              {response.uncertainties.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          </CollapsibleSection>
        )}

        {/* Sources */}
        {response.sourceMemoryIds.length > 0 && (
          <div className="mt-3">
            <div className="text-xs text-gray-600">
              Sources: {response.sourceMemoryIds.join(', ')}
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}
