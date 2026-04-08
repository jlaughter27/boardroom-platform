import { useMemoryStore } from '../../stores/memory.store';
import { MemoryCard } from './MemoryCard';

function SkeletonCard() {
  return (
    <div className="p-3 rounded-lg border border-border bg-card animate-pulse space-y-2">
      <div className="h-4 bg-muted rounded w-3/4" />
      <div className="h-3 bg-muted rounded w-full" />
      <div className="h-3 bg-muted rounded w-1/2" />
      <div className="flex gap-1.5 mt-2">
        <div className="h-4 bg-muted rounded w-14" />
        <div className="h-4 bg-muted rounded w-16" />
        <div className="h-4 bg-muted rounded w-12" />
      </div>
    </div>
  );
}

export function MemoryList() {
  const { memories, selectedMemory, isLoading, total, offset, select, loadMore } =
    useMemoryStore();

  const hasMore = offset < total;

  if (!isLoading && memories.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <svg
          className="w-12 h-12 text-muted-foreground mb-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
          />
        </svg>
        <p className="text-muted-foreground text-sm font-medium">No memories found</p>
        <p className="text-muted-foreground text-xs mt-1">
          Try adjusting your search or filters
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 overflow-y-auto">
      {memories.map((memory) => (
        <MemoryCard
          key={memory.id}
          memory={memory}
          isSelected={selectedMemory?.id === memory.id}
          onClick={() => select(memory.id)}
        />
      ))}

      {isLoading && (
        <>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </>
      )}

      {hasMore && !isLoading && (
        <button
          type="button"
          onClick={loadMore}
          className="w-full py-2 text-sm text-info hover:text-foreground transition-colors"
        >
          Load more ({total - offset} remaining)
        </button>
      )}

      {!hasMore && memories.length > 0 && (
        <p className="text-center text-xs text-muted-foreground py-2">
          {total} {total === 1 ? 'memory' : 'memories'} total
        </p>
      )}
    </div>
  );
}
