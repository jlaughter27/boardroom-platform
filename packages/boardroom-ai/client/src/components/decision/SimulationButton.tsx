import { useState } from 'react';

interface SimulationButtonProps {
  defaultPath?: string;
  isSimulating: boolean;
  onSimulate: (chosenPath: string) => void;
}

export function SimulationButton({ defaultPath, isSimulating, onSimulate }: SimulationButtonProps) {
  const [chosenPath, setChosenPath] = useState(defaultPath ?? '');
  const [expanded, setExpanded] = useState(false);

  function handleSubmit() {
    if (!chosenPath.trim()) return;
    onSimulate(chosenPath.trim());
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        disabled={isSimulating}
        className="w-full px-6 py-3 rounded-lg text-sm font-medium bg-purple-600/20 text-purple-300 hover:bg-purple-600/30 border border-purple-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSimulating ? 'Simulating...' : 'What happens if...?'}
      </button>
    );
  }

  return (
    <div className="bg-purple-950/20 border border-purple-800 rounded-lg p-4 space-y-3">
      <div className="text-sm font-medium text-purple-300">Simulate a decision path</div>
      <textarea
        value={chosenPath}
        onChange={e => setChosenPath(e.target.value)}
        placeholder="Describe the path you want to simulate (e.g. the CEO recommendation, or an alternative)..."
        rows={2}
        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm text-white placeholder-gray-600 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none resize-y"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!chosenPath.trim() || isSimulating}
          className="px-5 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
        >
          {isSimulating ? (
            <span className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Simulating...
            </span>
          ) : 'Run Simulation'}
        </button>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-300 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
