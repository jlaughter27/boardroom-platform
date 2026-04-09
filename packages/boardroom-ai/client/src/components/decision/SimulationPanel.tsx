import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { SimulationResult, RiskLevel } from '@boardroom/shared';
import { Card, Badge, Progress } from '../ui';

interface SimulationPanelProps {
  result: SimulationResult;
}

function riskVariant(risk: RiskLevel): 'success' | 'warning' | 'danger' {
  return risk === 'low' ? 'success' : risk === 'medium' ? 'warning' : 'danger';
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

export function SimulationPanel({ result }: SimulationPanelProps) {
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <span className="text-lg font-semibold text-foreground">{'\uD83E\uDDEA'} Decision Simulation</span>
        <Badge variant={riskVariant(result.overallRisk)} solid>
          {result.overallRisk} risk
        </Badge>
      </div>

      <CollapsibleSection title="Resource Impact">
        <Card className="bg-card space-y-3">
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Budget Required</div>
            <p className="text-sm text-muted-foreground">{result.resourceImpact.budgetRequired}</p>
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">People Required</div>
            <p className="text-sm text-muted-foreground">{result.resourceImpact.peopleRequired}</p>
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Gap Analysis</div>
            <p className="text-sm text-muted-foreground">{result.resourceImpact.gapAnalysis}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Confidence</span>
            <Progress value={result.resourceImpact.confidence * 100} className="flex-1 h-1.5" />
            <span className="text-xs text-muted-foreground">{Math.round(result.resourceImpact.confidence * 100)}%</span>
          </div>
        </Card>
      </CollapsibleSection>

      <CollapsibleSection title="Timeline">
        <Card className="bg-card space-y-3">
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Estimated Duration</div>
            <p className="text-sm text-foreground font-medium">{result.timelineImpact.estimatedDuration}</p>
          </div>

          {result.timelineImpact.milestones.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Milestones</div>
              <div className="relative pl-4 space-y-3">
                <div className="absolute left-[5px] top-1 bottom-1 w-px bg-border" />
                {result.timelineImpact.milestones.map((ms, i) => (
                  <div key={i} className="relative flex items-start gap-3">
                    <div className={`absolute -left-4 top-1.5 w-2.5 h-2.5 rounded-full ${
                      ms.risk === 'low' ? 'bg-success' : ms.risk === 'medium' ? 'bg-warning' : 'bg-danger'
                    }`} />
                    <div className="flex-1 ml-1">
                      <div className="text-sm text-foreground">{ms.name}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">{ms.date}</span>
                        <Badge variant={riskVariant(ms.risk)}>{ms.risk}</Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.timelineImpact.historicalComparison && (
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Historical Comparison</div>
              <p className="text-sm text-muted-foreground italic">{result.timelineImpact.historicalComparison}</p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Confidence</span>
            <Progress value={result.timelineImpact.confidence * 100} className="flex-1 h-1.5" />
            <span className="text-xs text-muted-foreground">{Math.round(result.timelineImpact.confidence * 100)}%</span>
          </div>
        </Card>
      </CollapsibleSection>

      <CollapsibleSection title="Stakeholder Impact">
        <Card className="bg-card space-y-3">
          {result.stakeholderImpact.impactedPeople.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Impacted People</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {result.stakeholderImpact.impactedPeople.map((p, i) => (
                  <Card key={i} className="bg-background p-2.5">
                    <div className="text-sm font-medium text-foreground">{p.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">{p.impact}</div>
                    <div className="text-xs text-primary mt-1">Action: {p.action}</div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {result.stakeholderImpact.rippleEffects.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Ripple Effects</div>
              <ul className="space-y-1">
                {result.stakeholderImpact.rippleEffects.map((effect, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="flex-shrink-0 mt-1 text-muted-foreground">{'\u2022'}</span>
                    <span>{effect}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.stakeholderImpact.communicationNeeded.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Communication Needed</div>
              <ul className="space-y-1">
                {result.stakeholderImpact.communicationNeeded.map((item, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="flex-shrink-0 mt-1 text-primary">{'\u2022'}</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </CollapsibleSection>
    </Card>
  );
}
