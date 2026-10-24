import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Briefcase, PanelRight } from 'lucide-react';
import * as api from '../../lib/api';
import type { ExtendedSynthesisReport } from '../../types/debate';
import type { StopAction } from '@boardroom/shared';
import { Card, Badge, Button } from '../ui';
import { Modal } from '../shared/Modal';

/** RD-11 — the verb shown before each named stop in "What this displaces". */
export const STOP_ACTION_LABEL: Record<StopAction, string> = {
  stop: 'Stop',
  pause: 'Pause',
  delegate: 'Delegate',
  renegotiate: 'Renegotiate',
  defer: 'Defer',
};

/** Most memory ids resolved per synthesis; the rest render as shortened ids. */
export const DROPPED_RESOLVE_CAP = 10;

export function shortMemoryId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

/**
 * `droppedConsiderations` are memory ids (server-computed). Resolve them to
 * titles via `GET /memories/:id` (settled in one batch, capped) and link each
 * to the Memory Explorer; an unresolvable id falls back to a shortened id.
 */
function DroppedConsiderations({ ids }: { ids: string[] }) {
  const [titles, setTitles] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const toResolve = ids.slice(0, DROPPED_RESOLVE_CAP);
    if (toResolve.length === 0) return;
    Promise.allSettled(toResolve.map((id) => api.getMemory(id))).then((results) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.title) next[toResolve[i]] = r.value.title;
      });
      setTitles(next);
    });
    return () => { cancelled = true; };
  }, [ids]);

  return (
    <ul className="list-disc list-inside space-y-1 text-sm text-foreground">
      {ids.map((id) => {
        const title = titles[id];
        return (
          <li key={id}>
            <Link to={`/memory?id=${encodeURIComponent(id)}`} className="text-foreground hover:text-primary-text underline-offset-2 hover:underline">
              {title ?? shortMemoryId(id)}
            </Link>
            {!title && <span className="ml-1 text-[11px] text-muted-foreground">memory</span>}
          </li>
        );
      })}
    </ul>
  );
}

interface SynthesisPanelProps {
  report?: ExtendedSynthesisReport;
  streamingText?: string;
  isStreaming: boolean;
  /** When given, the card header offers "Open as sheet" (see `SynthesisSheet`). */
  onExpand?: () => void;
  /** M1-C2: advisors (short names) that had no answer when the synthesis started. */
  without?: string[];
}

/** The honest CEO step: a synthesis made without some advisors says so up front. */
function WithoutNote({ names }: { names?: string[] }) {
  if (!names || names.length === 0) return null;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return (
    <p className="mb-4 rounded-md border border-warning/30 bg-warning-muted px-3 py-2 text-sm text-foreground" data-testid="synthesis-without">
      Synthesized without {list}: {names.length === 1 ? 'that advisor' : 'those advisors'} did not answer, so {names.length === 1 ? 'its' : 'their'} perspective is missing here.
    </p>
  );
}

/** Card / sheet title row: the CEO mark, the model badge and optional controls. */
function SynthesisTitle({ children }: { children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <span className="flex items-center gap-2 text-lg font-semibold tracking-title text-foreground">
        <Briefcase size={18} strokeWidth={1.75} aria-hidden="true" className="text-persona-ceo" />
        CEO Synthesis
      </span>
      <Badge variant="accent">sonnet</Badge>
      {children && <span className="ml-auto flex items-center gap-1">{children}</span>}
    </div>
  );
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-sm font-medium text-primary-text hover:text-foreground transition-colors"
      >
        <span className={`transition-transform text-xs ${open ? 'rotate-90' : ''}`}>{'\u25B6'}</span>
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
            <div className="mt-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function SynthesisPanel({ report, streamingText, isStreaming, onExpand, without }: SynthesisPanelProps) {
  if (isStreaming && !report) {
    return (
      <Card className="border-t-2 border-primary border-x-hairline border-b-hairline p-6" data-testid="synthesis-panel">
        <SynthesisTitle />
        <WithoutNote names={without} />
        <div className="text-sm text-muted-foreground whitespace-pre-wrap">
          {streamingText}
          <span className="inline-block w-0.5 h-4 bg-primary animate-pulse ml-0.5 align-text-bottom" />
        </div>
      </Card>
    );
  }

  if (!report) return null;

  // Content layer: a flat card with the hairline edge; only the top rule carries colour.
  return (
    <Card className="border-t-2 border-primary border-x-hairline border-b-hairline p-6" data-testid="synthesis-panel">
      <SynthesisTitle>
        {onExpand && (
          <Button variant="ghost" size="icon" onClick={onExpand} aria-label="Open synthesis as a sheet" title="Open as sheet">
            <PanelRight size={16} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        )}
      </SynthesisTitle>
      <WithoutNote names={without} />
      <SynthesisReportBody report={report} />
    </Card>
  );
}

interface SynthesisSheetProps {
  report: ExtendedSynthesisReport;
  isOpen: boolean;
  onClose: () => void;
  /** The question under the title, so the sheet stands on its own. */
  question?: string;
}

/**
 * The synthesis as a sheet (shared Modal, `variant="sheet"`): a side sheet on
 * desktop, a draggable bottom sheet on phones. The inline panel stays on the
 * page underneath, so dismissing never loses the report.
 */
export function SynthesisSheet({ report, isOpen, onClose, question }: SynthesisSheetProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      variant="sheet"
      size="lg"
      title="CEO Synthesis"
      description={question ?? report.recommendation}
    >
      <div data-testid="synthesis-sheet-body" className="-mt-4">
        <SynthesisReportBody report={report} />
      </div>
    </Modal>
  );
}

/** The report sections \u2014 shared by the inline card and the sheet. */
export function SynthesisReportBody({ report }: { report: ExtendedSynthesisReport }) {
  return (
    <>
      <CollapsibleSection title="Disagreement Map" defaultOpen={false}>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{report.disagreementMap}</p>
      </CollapsibleSection>

      <CollapsibleSection title="Decisive Tradeoff">
        <div className="p-3 bg-primary/10 rounded-lg text-sm text-foreground">
          {report.decisiveTradeoff}
        </div>
      </CollapsibleSection>

      <div className="mt-4 p-4 bg-primary/10 rounded-lg">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Recommendation</div>
        <p className="text-lg font-medium text-foreground">{report.recommendation}</p>
      </div>

      {/* RD-11 — load check. Absent in review mode, on malformed output and on pre-RD-11 reports. */}
      {report.displacement && (
        <CollapsibleSection title="What this displaces">
          <div data-testid="synthesis-displacement">
            <p className="text-sm text-foreground">{report.displacement.answer}</p>
            {report.displacement.stops.length > 0 && (
              <ul className="mt-2 space-y-1">
                {report.displacement.stops.map((s, i) => (
                  <li key={i} className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{STOP_ACTION_LABEL[s.action]}</span> — {s.title}
                  </li>
                ))}
              </ul>
            )}
            {report.displacement.netNew && report.displacement.stops.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">Net new: nothing named to stop.</p>
            )}
          </div>
        </CollapsibleSection>
      )}

      <CollapsibleSection title="Next Actions">
        <ol className="space-y-2">
          {report.nextActions.map((action, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
              <span className="flex-shrink-0 w-5 h-5 rounded-md bg-muted text-muted-foreground text-xs tnum flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <span>{action}</span>
            </li>
          ))}
        </ol>
      </CollapsibleSection>

      {report.topRisks.length > 0 && (
        <CollapsibleSection title="Top Risks">
          <div className="flex flex-wrap gap-2">
            {report.topRisks.map((risk, i) => (
              <Badge key={i} variant="danger">{risk}</Badge>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {report.assumptionsToMonitor.length > 0 && (
        <CollapsibleSection title="Assumptions to Monitor" defaultOpen={false}>
          <div className="flex flex-wrap gap-2">
            {report.assumptionsToMonitor.map((item, i) => (
              <Badge key={i} variant="warning">{item.assumption}</Badge>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {(report.ledgerResolutions?.length ?? 0) > 0 && (
        <CollapsibleSection title="Disagreements resolved">
          <ul className="space-y-2" data-testid="ledger-resolutions">
            {report.ledgerResolutions!.map((entry, i) => (
              <li key={i} className="rounded-md border border-border bg-card p-3 text-sm">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Claim</div>
                <p className="text-foreground">{entry.claim}</p>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mt-2 mb-1">Resolution</div>
                <p className="text-muted-foreground">{entry.resolution}</p>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {(report.droppedConsiderations?.length ?? 0) > 0 && (
        <CollapsibleSection title="Not addressed by the CEO" defaultOpen={false}>
          <div className="rounded-md border border-warning/30 bg-warning-muted p-3" data-testid="dropped-considerations">
            <p className="text-xs text-muted-foreground mb-2">
              Advisors cited these points in round one; the synthesis did not use them. Worth a second look before you commit.
            </p>
            <DroppedConsiderations ids={report.droppedConsiderations!} />
          </div>
        </CollapsibleSection>
      )}

      {report.sourceMemoryIds.length > 0 && (
        <div className="mt-4 text-xs text-muted-foreground">
          Sources: {report.sourceMemoryIds.join(', ')}
        </div>
      )}
    </>
  );
}
