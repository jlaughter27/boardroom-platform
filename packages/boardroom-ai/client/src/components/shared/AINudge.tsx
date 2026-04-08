import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { useUIStore } from '../../stores/ui.store';
import { cn } from '../../lib/cn';

interface AINudgeProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
  dismissKey: string;
  variant?: 'info' | 'suggestion' | 'warning';
}

const borderColors = {
  info: 'border-l-accent',
  suggestion: 'border-l-success',
  warning: 'border-l-warning',
} as const;

const defaultIcon = (
  <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
  </svg>
);

export function AINudge({
  icon,
  title,
  description,
  action,
  dismissKey,
  variant = 'info',
}: AINudgeProps) {
  const { dismissedQuestions, dismissQuestion } = useUIStore();
  const [visible, setVisible] = useState(true);

  if (dismissedQuestions.has(dismissKey) || !visible) return null;

  const handleDismiss = () => {
    setVisible(false);
    dismissQuestion(dismissKey);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0, overflow: 'hidden' }}
          transition={{ duration: 0.25, delay: 0.5 }}
        >
          <Card className={cn('border-l-2 relative', borderColors[variant])}>
            <div className="flex items-start gap-3">
              <span className="flex-shrink-0 mt-0.5">{icon || defaultIcon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-accent uppercase tracking-wide font-medium mb-1">
                  AI Insight
                </p>
                <p className="text-sm font-medium text-text-primary">{title}</p>
                <p className="text-xs text-text-secondary mt-0.5">{description}</p>
                {action && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={action.onClick}
                    className="mt-2 -ml-2"
                  >
                    {action.label}
                  </Button>
                )}
              </div>
              <button
                onClick={handleDismiss}
                className="flex-shrink-0 p-1 text-text-tertiary hover:text-text-secondary transition-colors"
                aria-label="Dismiss nudge"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
