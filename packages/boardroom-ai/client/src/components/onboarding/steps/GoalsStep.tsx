import type { OnboardingData } from '../../../hooks/useOnboarding';

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
      {/* Freeform input */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          What are you working toward? Describe your goals in your own words.
        </label>
        <textarea
          value={data.goalsText}
          onChange={e => onUpdate({ goalsText: e.target.value })}
          placeholder="e.g. I want to grow my startup to $10M ARR this year, improve my team's velocity, and launch our enterprise product by Q3..."
          rows={4}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm resize-none"
        />
        <button
          type="button"
          onClick={onExtract}
          disabled={isExtracting || !data.goalsText.trim()}
          className="mt-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {isExtracting ? 'Extracting...' : 'Extract Goals'}
        </button>
      </div>

      {/* Extracted goals */}
      {data.extractedGoals.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">Review and edit your goals:</p>
          {data.extractedGoals.map((goal, i) => (
            <div key={i} className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <input
                  type="text"
                  value={goal.title}
                  onChange={e => updateGoal(i, 'title', e.target.value)}
                  className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
                  placeholder="Goal title"
                />
                <button
                  type="button"
                  onClick={() => removeGoal(i)}
                  className="text-gray-500 hover:text-red-400 text-sm px-2 py-1"
                >
                  Remove
                </button>
              </div>
              <div className="flex gap-3">
                <select
                  value={goal.level}
                  onChange={e => updateGoal(i, 'level', parseInt(e.target.value))}
                  className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
                >
                  {Object.entries(LEVEL_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={goal.domain}
                  onChange={e => updateGoal(i, 'domain', e.target.value)}
                  className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
                  placeholder="Domain (e.g. business, personal)"
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addGoal}
            className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            + Add another goal
          </button>
        </div>
      )}
    </div>
  );
}
