import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useCognitiveLoad, type CognitiveLoadWarning } from '../../hooks/useCognitiveLoad';
import { Button } from '../ui';

function WarningBanner({ warning, onDismiss }: { warning: CognitiveLoadWarning; onDismiss: () => void }) {
  const isCritical = warning.severity === 'critical';

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className={`flex items-center justify-between px-4 py-3 rounded-lg border-l-2 ${
        isCritical
          ? 'bg-danger-muted border-l-danger text-danger'
          : 'bg-warning-muted border-l-warning text-warning'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className={`text-lg ${isCritical ? 'animate-pulse' : ''}`}>
          {isCritical ? '\u26A0' : '\u26A1'}
        </span>
        <p className="text-sm text-text-primary">{warning.message}</p>
      </div>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        Dismiss
      </Button>
    </motion.div>
  );
}

export function CognitiveLoadBanner() {
  const warnings = useCognitiveLoad();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = warnings
    .filter((w) => !dismissed.has(w.type))
    .slice(0, 2);

  if (visible.length === 0) return null;

  return (
    <div className="space-y-2">
      <AnimatePresence>
        {visible.map((w) => (
          <WarningBanner
            key={w.type}
            warning={w}
            onDismiss={() => setDismissed((prev) => new Set(prev).add(w.type))}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
