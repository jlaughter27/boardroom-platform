import type { OnboardingData } from '../../../hooks/useOnboarding';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'planning', label: 'Planning' },
  { value: 'paused', label: 'Paused' },
];

interface Props {
  data: OnboardingData;
  onUpdate: (partial: Partial<OnboardingData>) => void;
  onExtract: () => void;
  isExtracting: boolean;
}

export function ProjectsStep({ data, onUpdate, onExtract, isExtracting }: Props) {
  const updateProject = (index: number, field: string, value: string) => {
    const updated = [...data.extractedProjects];
    updated[index] = { ...updated[index], [field]: value };
    onUpdate({ extractedProjects: updated });
  };

  const removeProject = (index: number) => {
    onUpdate({ extractedProjects: data.extractedProjects.filter((_, i) => i !== index) });
  };

  const addProject = () => {
    onUpdate({
      extractedProjects: [...data.extractedProjects, { title: '', domain: 'business', status: 'active' }],
    });
  };

  return (
    <div className="space-y-5">
      {/* Freeform input */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          What projects are you actively working on?
        </label>
        <textarea
          value={data.projectsText}
          onChange={e => onUpdate({ projectsText: e.target.value })}
          placeholder="e.g. We're rebuilding our mobile app, migrating to a new CRM, preparing for a Series B fundraise, and launching a new product line in EMEA..."
          rows={4}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm resize-none"
        />
        <button
          type="button"
          onClick={onExtract}
          disabled={isExtracting || !data.projectsText.trim()}
          className="mt-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {isExtracting ? 'Extracting...' : 'Extract Projects'}
        </button>
      </div>

      {/* Extracted projects */}
      {data.extractedProjects.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">Review and edit your projects:</p>
          {data.extractedProjects.map((project, i) => (
            <div key={i} className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <input
                  type="text"
                  value={project.title}
                  onChange={e => updateProject(i, 'title', e.target.value)}
                  className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
                  placeholder="Project title"
                />
                <button
                  type="button"
                  onClick={() => removeProject(i)}
                  className="text-gray-500 hover:text-red-400 text-sm px-2 py-1"
                >
                  Remove
                </button>
              </div>
              <div className="flex gap-3">
                <select
                  value={project.status}
                  onChange={e => updateProject(i, 'status', e.target.value)}
                  className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
                >
                  {STATUS_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={project.domain}
                  onChange={e => updateProject(i, 'domain', e.target.value)}
                  className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
                  placeholder="Domain (e.g. business, personal)"
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addProject}
            className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            + Add another project
          </button>
        </div>
      )}
    </div>
  );
}
