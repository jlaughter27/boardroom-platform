import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { SynthesisReport } from '@boardroom/shared';
import { Card, Badge } from '../ui';

interface SynthesisPanelProps {
  report?: SynthesisReport;
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
        className="flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-hover transition-colors"
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
      <Card className="border-t-2 border-t-transparent p-6" style={{ borderImage: 'linear-gradient(to right, var(--color-accent-primary), var(--color-accent-secondary)) 1' }}>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg font-semibold text-text-primary">{'\uD83D\uDCBC'} CEO Synthesis</span>
          <Badge variant="accent">sonnet</Badge>
        </div>
        <div className="text-sm text-text-secondary whitespace-pre-wrap">
          {streamingText}
          <span className="inline-block w-0.5 h-4 bg-accent animate-pulse ml-0.5 align-text-bottom" />
        </div>
      </Card>
    );
  }

  if (!report) return null;

  return (
    <Card className="border-t-2 border-t-transparent p-6" style={{ borderImage: 'linear-gradient(to right, var(--color-accent-primary), var(--color-accent-secondary)) 1' }}>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg font-semibold text-text-primary">{'\uD83D\uDCBC'} CEO Synthesis</span>
        <Badge variant="accent">sonnet</Badge>
      </div>

      <CollapsibleSection title="Disagreement Map" defaultOpen={false}>
        <p className="text-sm text-text-secondary whitespace-pre-wrap">{report.disagreementMap}</p>
      </CollapsibleSection>

      <CollapsibleSection title="Decisive Tradeoff">
        <div className="p-3 bg-accent-muted rounded-lg text-sm text-text-primary">
          {report.decisiveTradeoff}
        </div>
      </CollapsibleSection>

      <div className="mt-4 p-4 bg-accent-muted rounded-lg">
        <div className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-2">Recommendation</div>
        <p className="text-lg font-medium text-text-primary">{report.recommendation}</p>
      </div>

      <CollapsibleSection title="Next Actions">
        <ol className="space-y-2">
          {report.nextActions.map((action, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
              <span className="flex-shrink-0 w-5 h-5 rounded-md bg-bg-elevated text-text-tertiary text-xs flex items-center justify-center mt-0.5">
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

      {report.sourceMemoryIds.length > 0 && (
        <div className="mt-4 text-xs text-text-tertiary">
          Sources: {report.sourceMemoryIds.join(', ')}
        </div>
      )}
    </Card>
  );
}
