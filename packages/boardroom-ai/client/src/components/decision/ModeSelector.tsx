import { MODE_CONFIGS } from '@boardroom/shared';
import type { UserMode } from '@boardroom/shared';

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
      {MODES.map(config => {
        const isSelected = config.id === selectedMode;
        return (
          <button
            key={config.id}
            type="button"
            onClick={() => onSelect(config.id)}
            className={`flex items-start gap-3 p-4 rounded-lg border text-left transition-colors ${
              isSelected
                ? 'bg-gray-800 border-blue-500 ring-2 ring-blue-500'
                : 'bg-gray-900 border-gray-800 hover:bg-gray-800'
            }`}
          >
            <span className="text-2xl flex-shrink-0 mt-0.5">{MODE_ICONS[config.id]}</span>
            <div className="min-w-0">
              <div className="font-medium text-white text-sm">{config.label}</div>
              <div className="text-gray-400 text-xs mt-0.5">{config.description}</div>
              <div className="text-gray-600 text-xs mt-1">
                {config.personas.length > 0
                  ? `${config.personas.length} personas`
                  : 'CEO only'}
                {config.includesCEO && config.personas.length > 0 && ' + CEO synthesis'}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
