import { useEffect } from 'react';
import { useMemoryStore } from '../stores/memory.store';
import { MemorySearch } from '../components/memory/MemorySearch';
import { MemoryList } from '../components/memory/MemoryList';
import { MemoryDetail } from '../components/memory/MemoryDetail';
import { ErrorBanner } from '../components/shared/ErrorBanner';

export default function MemoryExplorerPage() {
  const { selectedMemory, clearSelection, search, memories, error, clearError } = useMemoryStore();

  // Initial load
  useEffect(() => {
    if (memories.length === 0) {
      search();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-6 h-full flex flex-col min-h-0">
      <h1 className="text-3xl font-bold text-white mb-4">Memory Explorer</h1>

      {error && <ErrorBanner message={error} onDismiss={clearError} />}

      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
        {/* Left panel: search + list */}
        <div className="w-full lg:w-2/3 flex flex-col min-h-0">
          <MemorySearch />
          <div className="mt-3 flex-1 overflow-y-auto min-h-0 pr-1">
            <MemoryList />
          </div>
        </div>

        {/* Right panel: detail */}
        <div className="w-full lg:w-1/3 min-h-0">
          <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-4 h-full overflow-y-auto">
            {selectedMemory ? (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                    Memory Detail
                  </p>
                  <button
                    onClick={clearSelection}
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    Close
                  </button>
                </div>
                <MemoryDetail memory={selectedMemory} />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center py-12">
                <svg
                  className="w-10 h-10 text-gray-600 mb-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                  />
                </svg>
                <p className="text-gray-400 text-sm font-medium">
                  Select a memory to view details
                </p>
                <p className="text-gray-500 text-xs mt-1">
                  Click on any memory card in the list
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
