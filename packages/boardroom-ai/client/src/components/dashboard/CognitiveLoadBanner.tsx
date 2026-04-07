import { useState } from 'react';
import { useCognitiveLoad, type CognitiveLoadWarning } from '../../hooks/useCognitiveLoad';

function WarningBanner({ warning, onDismiss }: { warning: CognitiveLoadWarning; onDismiss: () => void }) {
  const isCritical = warning.severity === 'critical';

  return (
    <div
      className={`flex items-center justify-between px-4 py-3 rounded-lg border ${
        isCritical
          ? 'bg-red-950/50 border-red-800 text-red-200'
          : 'bg-amber-950/50 border-amber-800 text-amber-200'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className={`text-lg ${isCritical ? 'text-red-400' : 'text-amber-400'}`}>
          {isCritical ? '\u26A0' : '\u26A1'}
        </span>
        <p className="text-sm">{warning.message}</p>
      </div>
      <button
        onClick={onDismiss}
        className={`ml-4 text-xs px-2 py-1 rounded hover:opacity-80 ${
          isCritical
            ? 'text-red-400 hover:text-red-300'
            : 'text-amber-400 hover:text-amber-300'
        }`}
        aria-label="Dismiss warning"
      >
        Dismiss
      </button>
    </div>
  );
}

export function CognitiveLoadBanner() {
  const warnings = useCognitiveLoad();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = warnings
    .filter(w => !dismissed.has(w.type))
    .slice(0, 2);

  if (visible.length === 0) return null;

  return (
    <div className="space-y-2">
      {visible.map(w => (
        <WarningBanner
          key={w.type}
          warning={w}
          onDismiss={() => setDismissed(prev => new Set(prev).add(w.type))}
        />
      ))}
    </div>
  );
}
