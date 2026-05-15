import { Card } from '../../ui';
import type { OnboardingData } from '../../../hooks/useOnboarding';

interface Props {
  data: OnboardingData;
  onUpdate: (partial: Partial<OnboardingData>) => void;
}

export function ContextStep({ data, onUpdate }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1.5">
          What's the most important decision you're facing right now?
        </label>
        <textarea
          value={data.biggestDecision}
          onChange={(e) => onUpdate({ biggestDecision: e.target.value })}
          placeholder="e.g. Whether to raise a Series B now or wait until we hit profitability, whether to hire a VP of Sales or promote from within..."
          rows={4}
          className="w-full bg-background border border-border rounded-md px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:ring-1 focus:ring-ring/30 transition-all duration-fast outline-none resize-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1.5">
          What keeps you up at night about your work?
        </label>
        <textarea
          value={data.worries}
          onChange={(e) => onUpdate({ worries: e.target.value })}
          placeholder="e.g. Our runway is shorter than I'd like, two key engineers might leave, we're behind on the product roadmap..."
          rows={4}
          className="w-full bg-background border border-border rounded-md px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:ring-1 focus:ring-ring/30 transition-all duration-fast outline-none resize-none"
        />
      </div>

      <Card className="bg-info-muted border-info/30">
        <p className="text-sm text-info">
          These answers will be stored as high-priority memories, helping BoardRoom give you more relevant advice from day one.
        </p>
      </Card>
    </div>
  );
}
