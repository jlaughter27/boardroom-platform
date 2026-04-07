import type { OnboardingData } from '../../../hooks/useOnboarding';

interface Props {
  data: OnboardingData;
  onUpdate: (partial: Partial<OnboardingData>) => void;
}

export function ContextStep({ data, onUpdate }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          What's the most important decision you're facing right now?
        </label>
        <textarea
          value={data.biggestDecision}
          onChange={e => onUpdate({ biggestDecision: e.target.value })}
          placeholder="e.g. Whether to raise a Series B now or wait until we hit profitability, whether to hire a VP of Sales or promote from within..."
          rows={4}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm resize-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          What keeps you up at night about your work?
        </label>
        <textarea
          value={data.worries}
          onChange={e => onUpdate({ worries: e.target.value })}
          placeholder="e.g. Our runway is shorter than I'd like, two key engineers might leave, we're behind on the product roadmap..."
          rows={4}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm resize-none"
        />
      </div>

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
        <p className="text-sm text-blue-300">
          These answers will be stored as high-priority memories, helping BoardRoom give you more relevant advice from day one.
        </p>
      </div>
    </div>
  );
}
