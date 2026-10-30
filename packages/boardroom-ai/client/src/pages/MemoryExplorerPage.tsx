import { useEffect } from 'react';
import { motion } from 'motion/react';
import { usePageTitle } from '../hooks/usePageTitle';
import { useMemoryStore } from '../stores/memory.store';
import { MemorySearch } from '../components/memory/MemorySearch';
import { MemoryList } from '../components/memory/MemoryList';
import { MemoryDetail } from '../components/memory/MemoryDetail';
import { PageWrapper, PageHeader, Button } from '../components/ui';
import { AINudge } from '../components/shared/AINudge';
import { ErrorBanner } from '../components/shared/ErrorBanner';
import { slideIn } from '../lib/motion';

export default function MemoryExplorerPage() {
  usePageTitle('Memory Explorer');
  const { selectedMemory, clearSelection, search, memories, error, clearError, hybridActive, filters } = useMemoryStore();

  useEffect(() => {
    // The explorer answers queries with hybrid search (semantic + FTS + trigram,
    // `asOf`, tags, archived); the list endpoint still serves empty queries.
    useMemoryStore.getState().setEngine('hybrid');
    if (memories.length === 0) {
      search();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <PageWrapper>
      <div className="p-6 h-full flex flex-col min-h-0">
        <PageHeader
          className="mb-4"
          title="Memory Explorer"
          subtitle={hybridActive && filters.q ? (
            <span data-testid="hybrid-caption">
              Hybrid search for “{filters.q}” · semantic + full-text + fuzzy, ranked by relevance
            </span>
          ) : undefined}
        />

        {error && <ErrorBanner message={error} onDismiss={clearError} />}

        {memories.length > 0 && (
          <AINudge
            title={`You have memories that may benefit from entity links`}
            description="Linking memories to people, goals, or projects improves AI context during decisions."
            action={{
              label: 'Review Memories',
              // Every live memory: no status filter, so the server default
              // (everything but ARCHIVED) applies. `ACTIVE` is not a
              // MemoryStatus — sending it was a 422 (a 500 before 2026-10-30).
              onClick: () => search({}),
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
          <div className="hidden lg:block w-px bg-border" />

          {/* Right panel: detail (45%) */}
          <div className="w-full lg:w-[45%] min-h-0">
            <div className="bg-card border border-border rounded-lg p-4 h-full overflow-y-auto sticky top-0 scroll-mt-4" data-memory-panel>
              {selectedMemory ? (
                <motion.div {...slideIn} key={selectedMemory.id}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
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
                    className="w-10 h-10 text-muted-foreground mb-3"
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
                  <p className="text-muted-foreground text-sm font-medium">
                    Select a memory to view details
                  </p>
                  <p className="text-muted-foreground text-xs mt-1">
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
