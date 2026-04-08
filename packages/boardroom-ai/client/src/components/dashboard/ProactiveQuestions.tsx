import { motion, AnimatePresence } from 'motion/react';
import { useProactiveQuestions } from '../../hooks/useProactiveQuestions';
import { useUIStore } from '../../stores/ui.store';
import { Card, Button } from '../ui';
import { staggerContainer, staggerItem } from '../../lib/motion';

export function ProactiveQuestions() {
  const questions = useProactiveQuestions();
  const { dismissQuestion } = useUIStore();

  if (questions.length === 0) return null;

  return (
    <motion.div {...staggerContainer} className="space-y-2">
      <AnimatePresence>
        {questions.map((q) => {
          const isOverdueType = q.type === 'overdue_commitment';
          const borderClass = isOverdueType ? 'border-warning/30 bg-warning-muted' : 'border-info/30 bg-info-muted';
          const iconColor = isOverdueType ? 'text-warning' : 'text-info';

          return (
            <motion.div key={q.id} {...staggerItem} exit={{ opacity: 0, height: 0, marginBottom: 0 }}>
              <Card hover className={`${borderClass} flex items-start gap-3 p-3`}>
                <span className={`mt-0.5 flex-shrink-0 ${iconColor}`}>
                  {isOverdueType ? '\u26A0' : '\u2139'}
                </span>
                <p className="flex-1 text-sm text-text-primary">{q.message}</p>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {q.actions.map((action) =>
                    action.action === 'dismiss' ? (
                      <Button
                        key={action.label}
                        variant="ghost"
                        size="sm"
                        onClick={() => dismissQuestion(q.id)}
                      >
                        {action.label}
                      </Button>
                    ) : (
                      <Button
                        key={action.label}
                        variant="secondary"
                        size="sm"
                        onClick={() => dismissQuestion(q.id)}
                      >
                        {action.label}
                      </Button>
                    ),
                  )}
                </div>
              </Card>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </motion.div>
  );
}
