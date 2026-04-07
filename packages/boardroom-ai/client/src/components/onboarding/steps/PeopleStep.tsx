import type { OnboardingData } from '../../../hooks/useOnboarding';

const RELATIONSHIP_OPTIONS = [
  { value: 'direct_report', label: 'Direct Report' },
  { value: 'manager', label: 'Manager' },
  { value: 'peer', label: 'Peer / Colleague' },
  { value: 'stakeholder', label: 'Stakeholder' },
  { value: 'client', label: 'Client / Customer' },
  { value: 'advisor', label: 'Advisor / Mentor' },
  { value: 'partner', label: 'Business Partner' },
  { value: 'other', label: 'Other' },
];

interface Props {
  data: OnboardingData;
  onUpdate: (partial: Partial<OnboardingData>) => void;
}

export function PeopleStep({ data, onUpdate }: Props) {
  const updatePerson = (index: number, field: string, value: string) => {
    const updated = [...data.people];
    updated[index] = { ...updated[index], [field]: value };
    onUpdate({ people: updated });
  };

  const removePerson = (index: number) => {
    const updated = data.people.filter((_, i) => i !== index);
    onUpdate({ people: updated.length > 0 ? updated : [{ name: '', role: '', relationship: '' }] });
  };

  const addPerson = () => {
    onUpdate({
      people: [...data.people, { name: '', role: '', relationship: '' }],
    });
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-400">
        Add 3-5 key people you work with regularly. BoardRoom will remember them and factor them into advice.
      </p>

      <div className="space-y-3">
        {data.people.map((person, i) => (
          <div key={i} className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs text-gray-500 mt-1.5">Person {i + 1}</span>
              {data.people.length > 1 && (
                <button
                  type="button"
                  onClick={() => removePerson(i)}
                  className="text-gray-500 hover:text-red-400 text-sm px-2 py-1"
                >
                  Remove
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                value={person.name}
                onChange={e => updatePerson(i, 'name', e.target.value)}
                placeholder="Name"
                className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
              />
              <input
                type="text"
                value={person.role}
                onChange={e => updatePerson(i, 'role', e.target.value)}
                placeholder="Their role"
                className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
              />
              <select
                value={person.relationship}
                onChange={e => updatePerson(i, 'relationship', e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
              >
                <option value="">Relationship</option>
                {RELATIONSHIP_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addPerson}
        className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
      >
        + Add another person
      </button>
    </div>
  );
}
