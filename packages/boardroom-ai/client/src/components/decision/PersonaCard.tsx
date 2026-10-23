import { useLayoutEffect, useMemo, useRef, useState, memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PERSONA_CONFIGS } from '@boardroom/shared';
import type { PersonaId, PersonaResponse } from '@boardroom/shared';
import type { Rebuttal } from '../../types/debate';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { Card, Badge, Button, Progress, Skeleton } from '../ui';
import { readStreamingProse } from '../../lib/partial-json';
import { cn } from '../../lib/cn';

/**
 * Every state of the card occupies the same box (M1-C1): the streaming card is
 * exactly this tall (its prose scrolls inside it); waiting, failed and finished
 * cards are at least this tall and stretch to their grid row, with long
 * sections clamped behind "Show full analysis". Swapping one state for the
 * next therefore never pushes the grid around.
 */
export const PERSONA_CARD_HEIGHT = 'h-[32rem]';
export const PERSONA_CARD_MIN_HEIGHT = 'min-h-[32rem]';
/**
 * Waiting and failed cards (RD-9b): the same 32rem from `sm` up, 20rem on
 * phones. On a 390 px screen a waiting / failed card used to be two thirds
 * empty. Waiting → streaming grows the box, but that happens right after the
 * Analyze tap (inside the input window CLS ignores); streaming and finished
 * cards keep 32rem everywhere so the stream itself never moves the column.
 */
export const PERSONA_CARD_IDLE_MIN_HEIGHT = 'min-h-[20rem] sm:min-h-[32rem]';
/** Above this many characters the clamped analysis offers "Show full analysis". */
const LONG_TEXT = 200;

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
  /** Debate round 2: this persona is writing its rebuttal (`rebuttal_start`). */
  isRebutting?: boolean;
  /** Debate round 2: completed rebuttal (`rebuttal_complete`). */
  rebuttal?: Rebuttal;
  /** M1-C2: why this advisor has no answer (`persona_error`, or no answer when the dispatch ended). */
  error?: string;
  /** M1-C2: re-run only this advisor. */
  onRetry?: () => void;
  /** Retry waits while another dispatch is still streaming. */
  retryDisabled?: boolean;
}

/** Inline debate outcome: Defended / Conceded badge, reason, and old → new recommendation. */
function RebuttalBlock({ rebuttal, original }: { rebuttal: Rebuttal; original: PersonaResponse }) {
  const defended = rebuttal.stance === 'defend';
  const revised = rebuttal.revisedRecommendation?.trim();
  const changed = !!revised && revised !== original.recommendation.trim();
  return (
    <div
      className={`mt-3 rounded-md border p-3 text-sm ${defended ? 'border-info/30 bg-info-muted' : 'border-warning/30 bg-warning-muted'}`}
      data-testid="rebuttal-block"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Badge variant={defended ? 'info' : 'warning'}>{defended ? 'Defended' : 'Conceded'}</Badge>
        <span className="text-xs text-muted-foreground">after hearing the other advisors</span>
      </div>
      <p className="text-muted-foreground leading-relaxed">{rebuttal.reason}</p>
      {changed && revised && (
        <div className="mt-2 space-y-1">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Revised recommendation</div>
          <p className="text-muted-foreground line-through decoration-muted-foreground/60">{original.recommendation}</p>
          <p className="text-foreground">{revised}</p>
        </div>
      )}
      {typeof rebuttal.revisedConfidence === 'number' && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span>Confidence</span>
          <span className="tabular-nums line-through decoration-muted-foreground/60">{Math.round(original.confidence * 100)}%</span>
          <span aria-hidden>{'\u2192'}</span>
          <span className="tabular-nums text-foreground">{Math.round(rebuttal.revisedConfidence * 100)}%</span>
        </div>
      )}
    </div>
  );
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
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-muted-foreground transition-colors"
      >
        <span className={`transition-transform duration-fast ${open ? 'rotate-90' : ''}`}>{'\u25B6'}</span>
        {title}
      </button>
      {/* initial={false}: a section that starts open is simply there — growing it from 0 on mount shifted the card. */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="mt-1.5 text-sm text-muted-foreground">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Streaming preview: prose only, read out of the partial JSON — never braces or keys. */
function StreamingBody({ text }: { text: string }) {
  const { situationReading, analysis } = useMemo(() => readStreamingProse(text), [text]);
  // The newest words stay in view by scrolling the clipped box, not by moving the
  // text: a scroll is not a layout shift, a paragraph sliding up inside its box is.
  const analysisBox = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = analysisBox.current;
    if (!box) return;
    box.scrollTop = box.scrollHeight;
    box.dataset.clipped = String(box.scrollHeight > box.clientHeight);
  }, [analysis]);
  const caret = <span className="inline-block w-0.5 h-4 bg-primary animate-pulse ml-0.5 align-text-bottom" aria-hidden />;

  if (!situationReading && !analysis) {
    return (
      <div className="space-y-2.5 pt-1" data-testid="persona-skeleton">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-11/12" />
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="mt-4 h-3 w-16" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-10/12" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 text-sm text-muted-foreground">
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Situation Reading</div>
        <p className="line-clamp-5 leading-relaxed">
          {situationReading}
          {!analysis && caret}
        </p>
      </div>
      {analysis && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Analysis</div>
          {/* Clipped at its own height; once it has scrolled, the top edge fades out. */}
          <div
            ref={analysisBox}
            className="relative min-h-0 flex-1 overflow-hidden data-[clipped=true]:[mask-image:linear-gradient(to_bottom,transparent,#000_1.5rem)]"
          >
            <p className="whitespace-pre-wrap leading-relaxed">
              {analysis}
              {caret}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export const PersonaCard = memo(function PersonaCard({ personaId, response, streamingText, isStreaming, isRebutting, rebuttal, error, onRetry, retryDisabled }: PersonaCardProps) {
  const config = PERSONA_CONFIGS[personaId];
  const name = config?.name ?? personaId;
  const colorClass = PERSONA_COLORS[personaId] ?? 'border-t-line';
  const [expanded, setExpanded] = useState(false);
  // `w-full`: the grid cell is a flex row, so a finished card stretches to its row (fixed-height states keep their box).
  const frame = `w-full border-t-[3px] border-x-hairline border-b-hairline ${colorClass}`;

  // Failed state (M1-C2): say so, show why, offer Retry — never "Thinking..." forever.
  if (!response && !isStreaming && error) {
    return (
      <Card className={cn(frame, PERSONA_CARD_IDLE_MIN_HEIGHT, 'flex flex-col')} data-testid="persona-card" data-state="error">
        <div className="flex items-center gap-2 mb-4">
          <span className="font-medium text-foreground text-sm">{name}</span>
          <Badge variant="warning">No answer</Badge>
        </div>
        <div className="rounded-md border border-warning/30 bg-warning-muted p-3 text-sm" role="group" aria-label={`${name} failed`}>
          <div className="flex items-start gap-2">
            <TriangleAlert size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-medium text-foreground">{name} couldn&rsquo;t finish this analysis.</p>
              <p className="mt-1 line-clamp-3 break-words text-muted-foreground" data-testid="persona-error-detail">{error}</p>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {onRetry && (
            <Button variant="secondary" size="sm" onClick={onRetry} disabled={retryDisabled}>
              <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />
              Retry
            </Button>
          )}
          {retryDisabled && <span className="text-xs text-muted-foreground">Available when the other advisors finish.</span>}
        </div>
        <p className="mt-auto text-xs text-muted-foreground">
          The CEO can still synthesize without this advisor; the synthesis will say so.
        </p>
      </Card>
    );
  }

  // Waiting state: queued, not started yet. A static skeleton in the reserved box (no endless loop).
  if (!response && !isStreaming) {
    return (
      <Card className={cn(frame, PERSONA_CARD_IDLE_MIN_HEIGHT, 'flex flex-col')} data-testid="persona-card" data-state="waiting">
        <div className="flex items-center justify-between mb-3">
          <span className="font-medium text-foreground text-sm">{name}</span>
          <span className="text-xs text-muted-foreground">Waiting to start</span>
        </div>
        <div className="space-y-2.5 pt-1" aria-hidden="true">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-11/12" />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
      </Card>
    );
  }

  // Streaming state — fixed height; prose grows inside it.
  if (isStreaming && !response) {
    return (
      <Card
        className={cn(frame, PERSONA_CARD_HEIGHT, 'flex flex-col shadow-md')}
        data-testid="persona-card"
        data-state="streaming"
        aria-busy="true"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground text-sm">{config?.name ?? personaId}</span>
            <Badge variant="default">{config?.model ?? 'haiku'}</Badge>
          </div>
        </div>
        <StreamingBody text={streamingText ?? ''} />
      </Card>
    );
  }

  // Complete state — the Zod-validated `persona_complete` payload.
  if (response) {
    const long = response.analysis.length > LONG_TEXT || response.situationReading.length > LONG_TEXT;
    return (
      <Card className={cn(frame, PERSONA_CARD_MIN_HEIGHT)} data-testid="persona-card" data-state="complete">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground text-sm">{config?.name ?? personaId}</span>
            <Badge variant="default">{config?.model ?? 'haiku'}</Badge>
            {response.dissentFlag && <Badge variant="warning">DISSENTS</Badge>}
            {isRebutting && !rebuttal && (
              <Badge variant="info">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse mr-1.5" aria-hidden />
                Rebutting…
              </Badge>
            )}
            {rebuttal && !isRebutting && (
              <Badge variant={rebuttal.stance === 'defend' ? 'info' : 'warning'}>
                {rebuttal.stance === 'defend' ? 'Defended' : 'Conceded'}
              </Badge>
            )}
          </div>
        </div>

        <CollapsibleSection title="Situation Reading" defaultOpen>
          <p className={cn(!expanded && 'line-clamp-4')}>{response.situationReading}</p>
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
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Analysis</div>
          <p className={cn('text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed', !expanded && 'line-clamp-5')}>{response.analysis}</p>
          {long && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
              className="mt-1 text-xs font-medium text-primary hover:underline"
            >
              {expanded ? 'Show less' : 'Show full analysis'}
            </button>
          )}
        </div>

        <div className="mt-3 p-3 bg-primary/10 rounded-md">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Recommendation</div>
          <p className="text-sm text-foreground">{response.recommendation}</p>
        </div>

        {rebuttal && <RebuttalBlock rebuttal={rebuttal} original={response} />}

        {response.uncertainties.length > 0 && (
          <CollapsibleSection title="Uncertainties">
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              {response.uncertainties.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          </CollapsibleSection>
        )}

        {/* Confidence */}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Confidence</span>
          <Progress value={response.confidence * 100} className="flex-1 h-1.5" />
          <span className="text-xs text-muted-foreground">{Math.round(response.confidence * 100)}%</span>
        </div>
      </Card>
    );
  }

  return null;
});
