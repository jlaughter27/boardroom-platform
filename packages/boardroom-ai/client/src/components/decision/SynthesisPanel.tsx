import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import * as api from '../../lib/api';
import type { ExtendedSynthesisReport } from '../../types/debate';
import { Card, Badge } from '../ui';

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
            <Link to={`/memory?id=${encodeURIComponent(id)}`} className="text-foreground hover:text-primary underline-offset-2 hover:underline">
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
        className="flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/90 transition-colors"
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

export function SynthesisPanel({ report, streamingText, isStreaming }: SynthesisPanelProps) {
  if (isStreaming && !report) {
    return (
      <Card className="border-t-2 border-primary p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg font-semibold text-foreground">{'\uD83D\uDCBC'} CEO Synthesis</span>
          <Badge variant="accent">sonnet</Badge>
        </div>
        <div className="text-sm text-muted-foreground whitespace-pre-wrap">
          {streamingText}
          <span className="inline-block w-0.5 h-4 bg-primary animate-pulse ml-0.5 align-text-bottom" />
        </div>
      </Card>
    );
  }

  if (!report) return null;

  return (
    <Card className="border-t-2 border-primary p-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg font-semibold text-foreground">{'\uD83D\uDCBC'} CEO Synthesis</span>
        <Badge variant="accent">sonnet</Badge>
      </div>

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

      <CollapsibleSection title="Next Actions">
        <ol className="space-y-2">
          {report.nextActions.map((action, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
              <span className="flex-shrink-0 w-5 h-5 rounded-md bg-card text-muted-foreground text-xs flex items-center justify-center mt-0.5">
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
    </Card>
  );
}
