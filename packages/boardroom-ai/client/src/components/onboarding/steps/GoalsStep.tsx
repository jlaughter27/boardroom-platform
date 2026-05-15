import { motion, AnimatePresence } from 'motion/react';
import type { OnboardingData } from '../../../hooks/useOnboarding';
import { Button, Card, Badge, Input } from '../../ui';
import { staggerContainer, staggerItem } from '../../../lib/motion';

const LEVEL_LABELS: Record<number, string> = {
  0: 'Life Goal',
  1: 'Annual',
  2: 'Quarterly',
  3: 'Monthly',
};

interface Props {
  data: OnboardingData;
  onUpdate: (partial: Partial<OnboardingData>) => void;
  onExtract: () => void;
  isExtracting: boolean;
}

export function GoalsStep({ data, onUpdate, onExtract, isExtracting }: Props) {
  const updateGoal = (index: number, field: string, value: string | number) => {
    const updated = [...data.extractedGoals];
    updated[index] = { ...updated[index], [field]: value };
    onUpdate({ extractedGoals: updated });
  };

  const removeGoal = (index: number) => {
    onUpdate({ extractedGoals: data.extractedGoals.filter((_, i) => i !== index) });
  };

  const addGoal = () => {
    onUpdate({
      extractedGoals: [...data.extractedGoals, { title: '', level: 2, domain: 'business' }],
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1.5">
          What are you working toward? Describe your goals in your own words.
        </label>
        <textarea
          value={data.goalsText}
          onChange={(e) => onUpdate({ goalsText: e.target.value })}
          placeholder="e.g. I want to grow my startup to $10M ARR this year, improve my team's velocity, and launch our enterprise product by Q3..."
          rows={4}
          className="w-full bg-background border border-border rounded-md px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:ring-1 focus:ring-ring/30 transition-all duration-fast outline-none resize-none"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={onExtract}
          disabled={isExtracting || !data.goalsText.trim()}
          className="mt-2"
        >
          {isExtracting ? 'Extracting...' : '\u2728 Extract Goals'}
        </Button>
      </div>

      <AnimatePresence>
        {data.extractedGoals.length > 0 && (
          <motion.div {...staggerContainer} className="space-y-3">
            <p className="text-sm text-muted-foreground">Review and edit your goals:</p>
            {data.extractedGoals.map((goal, i) => (
              <motion.div key={i} {...staggerItem}>
                <Card hover className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <Input
                      value={goal.title}
                      onChange={(e) => updateGoal(i, 'title', e.target.value)}
                      placeholder="Goal title"
                      className="flex-1"
                    />
                    <Button variant="ghost" size="sm" onClick={() => removeGoal(i)}>
                      Remove
                    </Button>
                  </div>
                  <div className="flex gap-3 items-center">
                    <Badge variant="accent">{LEVEL_LABELS[goal.level] ?? 'Quarterly'}</Badge>
                    <Input
                      value={goal.domain}
                      onChange={(e) => updateGoal(i, 'domain', e.target.value)}
                      placeholder="Domain (e.g. business, personal)"
                      className="flex-1"
                    />
                  </div>
                </Card>
              </motion.div>
            ))}
            <Button variant="ghost" size="sm" onClick={addGoal}>
              + Add another goal
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
