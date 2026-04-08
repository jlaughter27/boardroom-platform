import { motion } from 'motion/react';
import { MODE_CONFIGS } from '@boardroom/shared';
import type { UserMode } from '@boardroom/shared';
import { Card } from '../ui';

const MODE_ICONS: Record<UserMode, string> = {
  'decide': '\u2696\uFE0F',
  'stress-test': '\uD83D\uDD0D',
  'plan': '\uD83D\uDCCB',
  'clarify': '\uD83D\uDCA1',
  'review': '\uD83D\uDD04',
  'quick-take': '\u26A1',
};

const MODES = Object.values(MODE_CONFIGS);

interface ModeSelectorProps {
  selectedMode: UserMode;
  onSelect: (mode: UserMode) => void;
}

export function ModeSelector({ selectedMode, onSelect }: ModeSelectorProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {MODES.map((config) => {
        const isSelected = config.id === selectedMode;
        return (
          <button
            key={config.id}
            type="button"
            onClick={() => onSelect(config.id)}
            className={`relative flex items-start gap-3 p-4 rounded-lg border text-left transition-all duration-fast ${
              isSelected
                ? 'border-accent bg-accent-muted ring-1 ring-accent'
                : 'border-line bg-bg-surface hover:border-line-strong hover:bg-bg-hover'
            }`}
          >
            {isSelected && (
              <motion.div
                layoutId="mode-selector"
                className="absolute inset-0 rounded-lg border-2 border-accent pointer-events-none"
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            )}
            <span className="text-2xl flex-shrink-0 mt-0.5">{MODE_ICONS[config.id]}</span>
            <div className="min-w-0">
              <div className="font-medium text-text-primary text-sm">{config.label}</div>
              <div className="text-text-secondary text-xs mt-0.5">{config.description}</div>
              <div className="text-text-tertiary text-xs mt-1">
                {config.personas.length > 0
                  ? `${config.personas.length} personas`
                  : 'CEO only'}
                {config.includesCEO && config.personas.length > 0 && ' + CEO synthesis'}
              </div>
            </div>
            {isSelected && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute top-2 right-2 w-5 h-5 rounded-full bg-accent text-white flex items-center justify-center text-xs"
              >
                {'\u2713'}
              </motion.span>
            )}
          </button>
        );
      })}
    </div>
  );
}
