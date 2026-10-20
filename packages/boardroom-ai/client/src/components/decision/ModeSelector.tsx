import { useId, type ComponentType } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Lightbulb, ListChecks, RotateCcw, Scale, ShieldAlert, TriangleAlert, Zap, type LucideProps } from 'lucide-react';
import { CLIENT_MODE_LIST, type ClientUserMode } from '../../types/debate';
import { Tabs } from '../ui/Tabs';
import { DURATION, EASE_OUT, useReducedMotion } from '../../lib/motion';

/** One Lucide glyph per mode, 16 px inline, 1.75 stroke (UI-FOUNDATION §6). */
const MODE_ICONS: Record<ClientUserMode, ComponentType<LucideProps>> = {
  'decide': Scale,
  'stress-test': ShieldAlert,
  'plan': ListChecks,
  'clarify': Lightbulb,
  'review': RotateCcw,
  'quick-take': Zap,
  'premortem': TriangleAlert,
};

/** Helper copy shown under the control; falls back to the shared description. */
const MODE_HELPER: Partial<Record<ClientUserMode, string>> = {
  premortem: 'Assume it failed. Find out why.',
};

const MODES = CLIENT_MODE_LIST;

interface ModeSelectorProps {
  selectedMode: ClientUserMode;
  onSelect: (mode: ClientUserMode) => void;
}

/**
 * Analysis mode as a capsule segmented control (ui/Tabs, `segmented`): the
 * raised pill slides between modes on `springs.snappy`, instantly from the
 * keyboard. One helper line underneath describes the selected mode and who
 * sits at the table, cross-fading in 120 ms when the selection changes.
 */
export function ModeSelector({ selectedMode, onSelect }: ModeSelectorProps) {
  const helperId = useId();
  const reducedMotion = useReducedMotion();
  const current = MODES.find((m) => m.id === selectedMode) ?? MODES[0];
  const table = current.personas.length > 0
    ? `${current.personas.length} personas${current.includesCEO ? ' + CEO synthesis' : ''}`
    : 'CEO only';

  return (
    <div className="space-y-2.5" data-testid="mode-selector">
      <Tabs
        variant="segmented"
        aria-label="Analysis mode"
        value={selectedMode}
        onChange={(id) => onSelect(id as ClientUserMode)}
        tabs={MODES.map((config) => {
          const Icon = MODE_ICONS[config.id];
          return {
            id: config.id,
            label: config.label,
            title: MODE_HELPER[config.id] ?? config.description,
            icon: Icon ? <Icon size={16} strokeWidth={1.75} aria-hidden="true" /> : undefined,
          };
        })}
      />
      <div id={helperId} className="relative min-h-[2.5rem] px-1 text-sm" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={current.id}
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reducedMotion ? undefined : { opacity: 0 }}
            transition={{ duration: DURATION.fast, ease: EASE_OUT }}
            className="text-muted-foreground"
          >
            <span className="text-foreground">{MODE_HELPER[current.id] ?? current.description}</span>
            <span className="mx-1.5 text-hairline-strong" aria-hidden="true">·</span>
            <span className="tnum">{table}</span>
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}
