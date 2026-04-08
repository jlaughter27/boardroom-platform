import { motion } from 'motion/react';
import { Button, Progress } from '../ui';

const STEP_LABELS = ['About You', 'Goals', 'Projects', 'People', 'Context'];

interface WizardStepProps {
  title: string;
  description: string;
  stepNumber: number;
  totalSteps: number;
  children: React.ReactNode;
  onNext?: () => void;
  onPrev?: () => void;
  onSkip?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  isLoading?: boolean;
  nextLabel?: string;
  nextDisabled?: boolean;
}

export function WizardStep({
  title,
  description,
  stepNumber,
  totalSteps,
  children,
  onNext,
  onPrev,
  onSkip,
  isFirst = false,
  isLast = false,
  isLoading = false,
  nextLabel,
  nextDisabled = false,
}: WizardStepProps) {
  const progress = (stepNumber / totalSteps) * 100;

  return (
    <div className="bg-bg-surface rounded-xl border border-line shadow-lg p-8">
      {/* Progress bar */}
      <div className="mb-6">
        <Progress value={progress} className="mb-3" />
        <div className="flex justify-between">
          {STEP_LABELS.map((label, i) => {
            const stepIdx = i + 1;
            const isComplete = stepIdx < stepNumber;
            const isCurrent = stepIdx === stepNumber;
            return (
              <span
                key={label}
                className={`text-xs font-medium transition-colors ${
                  isComplete
                    ? 'text-success'
                    : isCurrent
                      ? 'text-accent'
                      : 'text-text-tertiary'
                }`}
              >
                {isComplete ? '\u2713 ' : ''}{label}
              </span>
            );
          })}
        </div>
      </div>

      {/* Title + description */}
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-text-primary mb-2">{title}</h2>
        <p className="text-text-secondary text-sm">{description}</p>
      </div>

      {/* Step content */}
      <div className="mb-8">
        {children}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <div>
          {!isFirst && (
            <Button variant="ghost" size="sm" onClick={onPrev}>
              Back
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {onSkip && (
            <Button variant="ghost" size="sm" onClick={onSkip}>
              Skip
            </Button>
          )}
          <Button
            variant="primary"
            size="lg"
            onClick={onNext}
            disabled={isLoading || nextDisabled}
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                />
                Processing...
              </span>
            ) : (
              nextLabel || (isLast ? 'Complete Setup' : 'Continue')
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
