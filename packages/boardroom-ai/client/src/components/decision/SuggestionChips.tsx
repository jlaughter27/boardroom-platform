import { motion, AnimatePresence } from 'motion/react';
import { SAMPLE_DECISION_QUESTIONS } from '../../lib/persona-metadata';
import { useReducedMotion } from '../../lib/motion';

interface SuggestionChipsProps {
  /** Current textarea value — chips only render when this is empty/whitespace. */
  value: string;
  /** Called with the chosen sample question. Caller is responsible for focusing the input. */
  onPick: (question: string) => void;
  className?: string;
}

/**
 * Empty-state suggestion chips below the decision input. Disappears as soon
 * as the textarea has any non-whitespace content.
 *
 * Audit ref: UX-#2-edu / Journey 2 friction 2.4
 */
export function SuggestionChips({ value, onPick, className }: SuggestionChipsProps) {
  const isEmpty = value.trim().length === 0;
  const reducedMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {isEmpty && (
        <motion.div
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
          className={className}
          data-testid="suggestion-chips"
        >
          <p className="text-xs text-muted-foreground mb-2">
            Stuck? Try one of these to get started:
          </p>
          <div className="flex flex-wrap gap-2">
            {SAMPLE_DECISION_QUESTIONS.map((q, i) => (
              <motion.button
                key={q}
                type="button"
                onClick={() => onPick(q)}
                initial={reducedMotion ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: reducedMotion ? 0 : i * 0.03 }}
                className="text-xs px-3 py-1.5 rounded-full border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground hover:border-primary/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {q}
              </motion.button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
