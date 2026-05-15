import { useState, useEffect } from 'react';
import { MemoryClass, MemoryStatus } from '@boardroom/shared';
import { useMemoryStore } from '../../stores/memory.store';
import { useDebounce } from '../../hooks/useDebounce';

export function MemorySearch() {
  const { filters, setFilters, search } = useMemoryStore();
  const [query, setQuery] = useState(filters.q ?? '');
  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    if (debouncedQuery !== (filters.q ?? '')) {
      setFilters({ q: debouncedQuery || undefined });
    }
  }, [debouncedQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  function clearAll() {
    setQuery('');
    // Reset all filters and re-search
    useMemoryStore.setState({ filters: {} });
    search({});
  }

  const selectClass =
    'bg-card border border-border px-2 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary/40';

  return (
    <div className="space-y-3">
      {/* Search input */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search memories..."
          className="w-full bg-card border border-border rounded-lg pl-10 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
        />
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={filters.domain ?? ''}
          onChange={(e) => setFilters({ domain: e.target.value || undefined })}
          placeholder="Domain"
          className={`${selectClass} w-28`}
        />

        <select
          value={filters.memoryClass ?? ''}
          onChange={(e) =>
            setFilters({ memoryClass: e.target.value || undefined })
          }
          className={selectClass}
        >
          <option value="">All Classes</option>
          {Object.values(MemoryClass).map((mc) => (
            <option key={mc} value={mc}>
              {mc}
            </option>
          ))}
        </select>

        <select
          value={filters.status ?? ''}
          onChange={(e) => setFilters({ status: e.target.value || undefined })}
          className={selectClass}
        >
          <option value="">All Statuses</option>
          {Object.values(MemoryStatus).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          value={filters.sortBy ?? 'createdAt'}
          onChange={(e) => setFilters({ sortBy: e.target.value })}
          className={selectClass}
        >
          <option value="createdAt">Created</option>
          <option value="importance">Importance</option>
          <option value="updatedAt">Updated</option>
        </select>

        <button
          type="button"
          onClick={() =>
            setFilters({
              sortOrder:
                filters.sortOrder === 'asc' ? 'desc' : 'asc',
            })
          }
          className="bg-card border border-border px-2 py-1.5 text-sm text-foreground hover:bg-card transition-colors"
          title={`Sort ${filters.sortOrder === 'asc' ? 'ascending' : 'descending'}`}
        >
          {filters.sortOrder === 'asc' ? '\u2191 Asc' : '\u2193 Desc'}
        </button>

        <button
          type="button"
          onClick={clearAll}
          className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Clear Filters
        </button>
      </div>
    </div>
  );
}
