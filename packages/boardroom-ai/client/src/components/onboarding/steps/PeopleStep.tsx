import type { OnboardingData } from '../../../hooks/useOnboarding';
import { Button, Card, Avatar, Input } from '../../ui';
import { Select } from '../../ui/Select';

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
      <p className="text-sm text-text-secondary">
        Add 3-5 key people you work with regularly. BoardRoom will remember them and factor them into advice.
      </p>

      <div className="space-y-3">
        {data.people.map((person, i) => (
          <Card key={i} className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Avatar name={person.name || `Person ${i + 1}`} size="sm" />
                <span className="text-xs text-text-tertiary">Person {i + 1}</span>
              </div>
              {data.people.length > 1 && (
                <Button variant="ghost" size="sm" onClick={() => removePerson(i)}>
                  Remove
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                value={person.name}
                onChange={(e) => updatePerson(i, 'name', e.target.value)}
                placeholder="Name"
              />
              <Input
                value={person.role}
                onChange={(e) => updatePerson(i, 'role', e.target.value)}
                placeholder="Their role"
              />
              <Select
                options={RELATIONSHIP_OPTIONS}
                value={person.relationship}
                onChange={(v) => updatePerson(i, 'relationship', v)}
                placeholder="Relationship"
              />
            </div>
          </Card>
        ))}
      </div>

      <Button variant="ghost" size="sm" onClick={addPerson}>
        + Add another person
      </Button>
    </div>
  );
}
