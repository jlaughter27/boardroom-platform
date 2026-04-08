import { useState, memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PERSONA_CONFIGS } from '@boardroom/shared';
import type { PersonaId, PersonaResponse } from '@boardroom/shared';
import { Card, Badge, Progress } from '../ui';

const PERSONA_COLORS: Record<string, string> = {
  optimist: 'border-t-persona-optimist',
  critic: 'border-t-persona-critic',
  alternate: 'border-t-persona-alternate',
  technician: 'border-t-persona-technician',
  questionnaire: 'border-t-persona-questionnaire',
  doer: 'border-t-persona-doer',
  ceo: 'border-t-persona-ceo',
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
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs font-medium text-text-tertiary hover:text-text-secondary transition-colors"
      >
        <span className={`transition-transform duration-fast ${open ? 'rotate-90' : ''}`}>{'\u25B6'}</span>
        {title}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="mt-1.5 text-sm text-text-secondary">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const PersonaCard = memo(function PersonaCard({ personaId, response, streamingText, isStreaming }: PersonaCardProps) {
  const config = PERSONA_CONFIGS[personaId];
  const colorClass = PERSONA_COLORS[personaId] ?? 'border-t-line';

  // Waiting state
  if (!response && !isStreaming) {
    return (
      <Card className={`border-t-[3px] ${colorClass}`}>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-text-tertiary"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
              />
            ))}
          </div>
          <span className="text-text-tertiary text-sm">Thinking...</span>
          <span className="text-text-tertiary text-xs ml-auto">{config?.name ?? personaId}</span>
        </div>
      </Card>
    );
  }

  // Streaming state
  if (isStreaming && !response) {
    return (
      <Card className={`border-t-[3px] ${colorClass} shadow-glow`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="font-medium text-text-primary text-sm">{config?.name ?? personaId}</span>
            <Badge variant="default">{config?.model ?? 'haiku'}</Badge>
          </div>
        </div>
        <div className="text-sm text-text-secondary whitespace-pre-wrap">
          {streamingText}
          <span className="inline-block w-0.5 h-4 bg-accent animate-pulse ml-0.5 align-text-bottom" />
        </div>
      </Card>
    );
  }

  // Complete state
  if (response) {
    return (
      <Card className={`border-t-[3px] ${colorClass}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="font-medium text-text-primary text-sm">{config?.name ?? personaId}</span>
            <Badge variant="default">{config?.model ?? 'haiku'}</Badge>
            {response.dissentFlag && <Badge variant="warning">DISSENTS</Badge>}
          </div>
        </div>

        <CollapsibleSection title="Situation Reading" defaultOpen>
          <p>{response.situationReading}</p>
        </CollapsibleSection>

        {response.keyAssumptions.length > 0 && (
          <CollapsibleSection title="Key Assumptions">
            <div className="flex flex-wrap gap-1.5">
              {response.keyAssumptions.map((a, i) => (
                <Badge key={i} variant="default">{a}</Badge>
              ))}
            </div>
          </CollapsibleSection>
        )}

        <div className="mt-3">
          <div className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-1">Analysis</div>
          <p className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">{response.analysis}</p>
        </div>

        <div className="mt-3 p-3 bg-accent-muted rounded-md">
          <div className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-1">Recommendation</div>
          <p className="text-sm text-text-primary">{response.recommendation}</p>
        </div>

        {response.uncertainties.length > 0 && (
          <CollapsibleSection title="Uncertainties">
            <ul className="list-disc list-inside space-y-1 text-text-secondary">
              {response.uncertainties.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          </CollapsibleSection>
        )}

        {/* Confidence */}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-text-tertiary">Confidence</span>
          <Progress value={response.confidence * 100} className="flex-1 h-1.5" />
          <span className="text-xs text-text-secondary">{Math.round(response.confidence * 100)}%</span>
        </div>
      </Card>
    );
  }

  return null;
});
