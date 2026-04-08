import { useEffect } from 'react';
import { motion } from 'motion/react';
import { usePageTitle } from '../hooks/usePageTitle';
import { useMemoryStore } from '../stores/memory.store';
import { MemorySearch } from '../components/memory/MemorySearch';
import { MemoryList } from '../components/memory/MemoryList';
import { MemoryDetail } from '../components/memory/MemoryDetail';
import { PageWrapper, Button } from '../components/ui';
import { AINudge } from '../components/shared/AINudge';
import { ErrorBanner } from '../components/shared/ErrorBanner';
import { slideIn } from '../lib/motion';

export default function MemoryExplorerPage() {
  usePageTitle('Memory Explorer');
  const { selectedMemory, clearSelection, search, memories, error, clearError } = useMemoryStore();

  useEffect(() => {
    if (memories.length === 0) {
      search();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <PageWrapper>
      <div className="p-6 h-full flex flex-col min-h-0">
        <h1 className="text-2xl font-semibold text-text-primary mb-4">Memory Explorer</h1>

        {error && <ErrorBanner message={error} onDismiss={clearError} />}

        {memories.length > 0 && (
          <AINudge
            title={`You have memories that may benefit from entity links`}
            description="Linking memories to people, goals, or projects improves AI context during decisions."
            action={{
              label: 'Review Memories',
              onClick: () => search({ status: 'ACTIVE' }),
            }}
            dismissKey="nudge-unlinked-memories"
            variant="suggestion"
          />
        )}

        <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
          {/* Left panel: search + list (55%) */}
          <div className="w-full lg:w-[55%] flex flex-col min-h-0">
            <MemorySearch />
            <div className="mt-3 flex-1 overflow-y-auto min-h-0 pr-1">
              <MemoryList />
            </div>
          </div>

          {/* Divider */}
          <div className="hidden lg:block w-px bg-line-subtle" />

          {/* Right panel: detail (45%) */}
          <div className="w-full lg:w-[45%] min-h-0">
            <div className="bg-bg-surface border border-line rounded-lg p-4 h-full overflow-y-auto sticky top-0">
              {selectedMemory ? (
                <motion.div {...slideIn} key={selectedMemory.id}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-medium text-text-tertiary uppercase tracking-wide">
                      Memory Detail
                    </p>
                    <Button variant="ghost" size="sm" onClick={clearSelection}>
                      Close
                    </Button>
                  </div>
                  <MemoryDetail memory={selectedMemory} />
                </motion.div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                  <svg
                    className="w-10 h-10 text-text-tertiary mb-3"
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
                  <p className="text-text-secondary text-sm font-medium">
                    Select a memory to view details
                  </p>
                  <p className="text-text-tertiary text-xs mt-1">
                    Click on any memory card in the list
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </PageWrapper>
  );
}
