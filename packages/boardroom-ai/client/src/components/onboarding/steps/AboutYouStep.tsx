import type { OnboardingData } from '../../../hooks/useOnboarding';
import { Input } from '../../ui';
import { Select } from '../../ui/Select';

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
      <Input
        label="What's your role?"
        type="text"
        value={data.role}
        onChange={(e) => onUpdate({ role: e.target.value })}
        placeholder="e.g. CEO, VP of Engineering, Product Manager"
      />

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-text-secondary">
          What industry are you in?
        </label>
        <Select
          options={INDUSTRIES}
          value={data.industry}
          onChange={(v) => onUpdate({ industry: v })}
          placeholder="Select your industry"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-secondary mb-2">
          How often do you make important decisions?
        </label>
        <div className="grid grid-cols-2 gap-2">
          {FREQUENCIES.map((freq) => (
            <button
              key={freq.value}
              type="button"
              onClick={() => onUpdate({ decisionFrequency: freq.value })}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium border transition-all duration-fast ${
                data.decisionFrequency === freq.value
                  ? 'border-accent bg-accent-muted text-accent'
                  : 'border-line bg-bg-base text-text-secondary hover:border-line-strong'
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
