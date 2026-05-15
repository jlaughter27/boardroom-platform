import { motion } from 'motion/react';
import { MODE_CONFIGS } from '@boardroom/shared';
import type { UserMode } from '@boardroom/shared';
import { Tooltip } from '../ui';
import { MODE_META } from '../../lib/persona-metadata';

const MODE_ICONS: Record<UserMode, string> = {
  'decide': '⚖️',
  'stress-test': '🔍',
  'plan': '📋',
  'clarify': '💡',
  'review': '🔄',
  'quick-take': '⚡',
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
        const tooltipBody = MODE_META[config.id]?.tooltip ?? config.description;
        return (
          <Tooltip key={config.id} content={tooltipBody} maxWidth="18rem" delay={250}>
            <button
              type="button"
              onClick={() => onSelect(config.id)}
              aria-pressed={isSelected}
              className={`relative flex w-full items-start gap-3 p-4 rounded-lg border text-left transition-all duration-fast ${
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
              <span className="text-2xl flex-shrink-0 mt-0.5">{MODE_ICONS[config.id]}</span>
              <div className="min-w-0">
                <div className="font-medium text-foreground text-sm">{config.label}</div>
                <div className="text-muted-foreground text-xs mt-0.5">{config.description}</div>
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
                  {'✓'}
                </motion.span>
              )}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
