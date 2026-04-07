import { useProactiveQuestions } from '../../hooks/useProactiveQuestions';
import { useUIStore } from '../../stores/ui.store';

export function ProactiveQuestions() {
  const questions = useProactiveQuestions();
  const { dismissQuestion } = useUIStore();

  if (questions.length === 0) return null;

  return (
    <div className="space-y-2">
      {questions.map((q) => {
        const isOverdueType = q.type === 'overdue_commitment';
        const borderColor = isOverdueType ? 'border-amber-800' : 'border-blue-800';
        const bgColor = isOverdueType ? 'bg-amber-950/50' : 'bg-blue-950/50';
        const iconColor = isOverdueType ? 'text-amber-400' : 'text-blue-400';

        return (
          <div
            key={q.id}
            className={`flex items-start gap-3 rounded-lg border p-3 ${borderColor} ${bgColor}`}
          >
            {/* Icon */}
            <span className={`mt-0.5 flex-shrink-0 ${iconColor}`}>
              {isOverdueType ? (
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              ) : (
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </span>

            {/* Message */}
            <p className="flex-1 text-sm text-gray-200">{q.message}</p>

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {q.actions.map((action) =>
                action.action === 'dismiss' ? (
                  <button
                    key={action.label}
                    onClick={() => dismissQuestion(q.id)}
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    {action.label}
                  </button>
                ) : (
                  <button
                    key={action.label}
                    onClick={() => {
                      // v1: dismiss after action click — real editing comes later
                      dismissQuestion(q.id);
                    }}
                    className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-200 hover:bg-gray-700 transition-colors"
                  >
                    {action.label}
                  </button>
                ),
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
