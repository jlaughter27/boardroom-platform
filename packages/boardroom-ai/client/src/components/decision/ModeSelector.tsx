import { motion } from 'motion/react';
import { CLIENT_MODE_LIST, type ClientUserMode } from '../../types/debate';

const MODE_ICONS: Record<ClientUserMode, string> = {
  'decide': '\u2696\uFE0F',
  'stress-test': '\uD83D\uDD0D',
  'plan': '\uD83D\uDCCB',
  'clarify': '\uD83D\uDCA1',
  'review': '\uD83D\uDD04',
  'quick-take': '\u26A1',
  'premortem': '\uD83E\uDEA6',
};

/** Helper copy shown under the label; falls back to the shared description. */
const MODE_HELPER: Partial<Record<ClientUserMode, string>> = {
  premortem: 'Assume it failed. Find out why.',
};

const MODES = CLIENT_MODE_LIST;

interface ModeSelectorProps {
  selectedMode: ClientUserMode;
  onSelect: (mode: ClientUserMode) => void;
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
                ? 'border-primary bg-primary/10 ring-1 ring-primary'
                : 'border-border bg-card hover:border-border hover:bg-muted'
            }`}
          >
            {isSelected && (
              <motion.div
                layoutId="mode-selector"
                className="absolute inset-0 rounded-lg border-2 border-primary pointer-events-none"
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            )}
            <span className="text-2xl flex-shrink-0 mt-0.5">{MODE_ICONS[config.id] ?? '\u2022'}</span>
            <div className="min-w-0">
              <div className="font-medium text-foreground text-sm">{config.label}</div>
              <div className="text-muted-foreground text-xs mt-0.5">{MODE_HELPER[config.id] ?? config.description}</div>
              <div className="text-muted-foreground text-xs mt-1">
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
                className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary text-white flex items-center justify-center text-xs"
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
