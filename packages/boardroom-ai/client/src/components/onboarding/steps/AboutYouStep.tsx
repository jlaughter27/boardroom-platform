import type { OnboardingData } from '../../../hooks/useOnboarding';

const INDUSTRIES = [
  { value: 'tech', label: 'Technology' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'education', label: 'Education' },
  { value: 'finance', label: 'Finance' },
  { value: 'consulting', label: 'Consulting' },
  { value: 'creative', label: 'Creative / Media' },
  { value: 'retail', label: 'Retail / E-Commerce' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'other', label: 'Other' },
];

const FREQUENCIES = [
  { value: 'daily', label: 'Daily' },
  { value: 'several_per_week', label: 'Several times a week' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

interface Props {
  data: OnboardingData;
  onUpdate: (partial: Partial<OnboardingData>) => void;
}

export function AboutYouStep({ data, onUpdate }: Props) {
  return (
    <div className="space-y-5">
      {/* Role */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          What's your role?
        </label>
        <input
          type="text"
          value={data.role}
          onChange={e => onUpdate({ role: e.target.value })}
          placeholder="e.g. CEO, VP of Engineering, Product Manager"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm"
        />
      </div>

      {/* Industry */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          What industry are you in?
        </label>
        <select
          value={data.industry}
          onChange={e => onUpdate({ industry: e.target.value })}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm"
        >
          <option value="">Select your industry</option>
          {INDUSTRIES.map(ind => (
            <option key={ind.value} value={ind.value}>{ind.label}</option>
          ))}
        </select>
      </div>

      {/* Decision frequency */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          How often do you make important decisions?
        </label>
        <div className="grid grid-cols-2 gap-2">
          {FREQUENCIES.map(freq => (
            <button
              key={freq.value}
              type="button"
              onClick={() => onUpdate({ decisionFrequency: freq.value })}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                data.decisionFrequency === freq.value
                  ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                  : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'
              }`}
            >
              {freq.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
