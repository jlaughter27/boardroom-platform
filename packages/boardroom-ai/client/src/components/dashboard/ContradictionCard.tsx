import { useState } from 'react';
import type { ContradictionAlert } from '@boardroom/shared';

interface ContradictionCardProps {
  contradiction: ContradictionAlert;
  onResolve: (id: string, resolution: string) => void;
  onDismiss: (id: string) => void;
  onAcceptTension: (id: string) => void;
}

const SEVERITY_STYLES: Record<string, string> = {
  high: 'bg-red-900/60 text-red-300',
  medium: 'bg-amber-900/60 text-amber-300',
  low: 'bg-gray-700 text-gray-300',
};

export function ContradictionCard({ contradiction, onResolve, onDismiss, onAcceptTension }: ContradictionCardProps) {
  const [showResolve, setShowResolve] = useState(false);
  const [resolution, setResolution] = useState('');

  const severityStyle = SEVERITY_STYLES[contradiction.severity] ?? SEVERITY_STYLES.low;
  const entityA = contradiction.entityA as { type: string; id: string; title: string };
  const entityB = contradiction.entityB as { type: string; id: string; title: string };

  const handleResolve = () => {
    if (resolution.trim()) {
      onResolve(contradiction.id, resolution.trim());
      setShowResolve(false);
      setResolution('');
    }
  };

  return (
    <div className="py-3 border-b border-gray-800 last:border-0">
      <div className="flex items-start gap-2 mb-2">
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${severityStyle}`}>
          {contradiction.severity}
        </span>
        <p className="text-sm text-gray-200">{contradiction.description}</p>
      </div>

      <div className="flex items-center gap-1 text-[11px] text-gray-500 mb-2 ml-1">
        <span className="text-gray-400">{entityA.title}</span>
        <span>vs</span>
        <span className="text-gray-400">{entityB.title}</span>
      </div>

      {showResolve ? (
        <div className="ml-1 space-y-2">
          <textarea
            value={resolution}
            onChange={e => setResolution(e.target.value)}
            placeholder="How was this resolved?"
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-500 resize-none"
            rows={2}
          />
          <div className="flex gap-2">
            <button
              onClick={handleResolve}
              className="text-[11px] px-2 py-1 rounded bg-emerald-900/60 text-emerald-300 hover:bg-emerald-900/80"
            >
              Submit
            </button>
            <button
              onClick={() => { setShowResolve(false); setResolution(''); }}
              className="text-[11px] px-2 py-1 rounded text-gray-400 hover:text-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 ml-1">
          <button
            onClick={() => setShowResolve(true)}
            className="text-[11px] px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700"
          >
            Resolve
          </button>
          <button
            onClick={() => onAcceptTension(contradiction.id)}
            className="text-[11px] px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700"
          >
            Accept Tension
          </button>
          <button
            onClick={() => onDismiss(contradiction.id)}
            className="text-[11px] px-2 py-1 rounded text-gray-500 hover:text-gray-400"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
