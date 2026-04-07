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
    <div className="bg-gray-900 rounded-xl p-8 shadow-2xl">
      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex justify-between text-xs text-gray-500 mb-2">
          <span>Step {stepNumber} of {totalSteps}</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Title + description */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-2">{title}</h2>
        <p className="text-gray-400 text-sm">{description}</p>
      </div>

      {/* Step content */}
      <div className="mb-8">
        {children}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <div>
          {!isFirst && (
            <button
              type="button"
              onClick={onPrev}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Back
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-300 transition-colors"
            >
              Skip
            </button>
          )}
          <button
            type="button"
            onClick={onNext}
            disabled={isLoading || nextDisabled}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Processing...
              </span>
            ) : (
              nextLabel || (isLast ? 'Complete Setup' : 'Continue')
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
