import { useState, useEffect, useMemo } from 'react';
import { MemoryClass, MemoryStatus } from '@boardroom/shared';
import { useMemoryStore } from '../../stores/memory.store';
import { useDebounce } from '../../hooks/useDebounce';
import { formatAsOf } from '../graph/graph-search';
import { cn } from '../../lib/cn';
import { Select } from '../ui/Select';

const MAX_TAG_CHIPS = 14;
/** Sentinel option for "no filter" (a Select value cannot be the empty string). */
const ALL = '__all__';

/** Tags present in the current result set, most frequent first (selected tags always included). */
export function collectTagChips(memories: ReadonlyArray<{ tags?: string[] }>, selected: readonly string[] = [], max = MAX_TAG_CHIPS): string[] {
  const freq = new Map<string, number>();
  for (const m of memories) for (const t of m.tags ?? []) if (t) freq.set(t, (freq.get(t) ?? 0) + 1);
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  const out: string[] = [...selected];
  for (const t of sorted) {
    if (out.length >= max) break;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

export function MemorySearch() {
  const { filters, setFilters, search, memories, engine, hybridActive } = useMemoryStore();
  const [query, setQuery] = useState(filters.q ?? '');
  const debouncedQuery = useDebounce(query, 300);
  // Domain is free text too — debounce it like `q` instead of firing per keystroke (C-113)
  const [domain, setDomain] = useState(filters.domain ?? '');
  const debouncedDomain = useDebounce(domain, 300);

  useEffect(() => {
    if (debouncedQuery !== (filters.q ?? '')) {
      setFilters({ q: debouncedQuery || undefined });
    }
  }, [debouncedQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (debouncedDomain !== (filters.domain ?? '')) {
      setFilters({ domain: debouncedDomain || undefined });
    }
  }, [debouncedDomain]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedTags = filters.tags ?? [];
  const tagChips = useMemo(() => collectTagChips(memories, selectedTags), [memories, selectedTags]);
  const asOfLabel = formatAsOf(filters.asOf);
  const hybridEligible = engine === 'hybrid';
  // Which endpoint answered decides which controls do anything: the hybrid
  // endpoint ignores class / sort, the list endpoint ignores as-of / archived.
  const listOnlyTitle = 'Not applied by hybrid search — clear the query to filter the list by it';

  function toggleTag(tag: string) {
    const next = selectedTags.includes(tag) ? selectedTags.filter((t) => t !== tag) : [...selectedTags, tag];
    setFilters({ tags: next.length ? next : undefined });
  }

  function clearAll() {
    setQuery('');
    setDomain('');
    // Reset all filters and re-search
    useMemoryStore.setState({ filters: {} });
    search({});
  }

  // One 36 px row: inputs, selects and toggles share the control radius and height.
  const selectClass =
    'h-9 bg-card border border-border rounded-control px-3 text-sm text-foreground outline-none hover:border-hairline-strong focus:border-primary/40 focus:ring-2 focus:ring-ring transition-[border-color,box-shadow] duration-fast ease-out';

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
          placeholder={hybridEligible ? 'Search memories (semantic + full-text + fuzzy)…' : 'Search memories...'}
          aria-label="Search memories"
          className="w-full bg-card border border-border rounded-lg pl-10 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
        />
        {hybridActive && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] text-foreground" title="Results come from hybrid search">
            hybrid
          </span>
        )}
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="Domain"
          aria-label="Domain"
          className={`${selectClass} w-28`}
        />

        <Select
          className="w-auto min-w-[8.5rem]"
          value={filters.memoryClass ?? ALL}
          onChange={(v) => setFilters({ memoryClass: v === ALL ? undefined : v })}
          aria-label="Memory class"
          disabled={hybridActive}
          title={hybridActive ? listOnlyTitle : undefined}
          options={[{ value: ALL, label: 'All Classes' }, ...Object.values(MemoryClass).map((mc) => ({ value: mc, label: mc }))]}
        />

        <Select
          className="w-auto min-w-[8.5rem]"
          value={filters.status ?? ALL}
          onChange={(v) => setFilters({ status: v === ALL ? undefined : v })}
          aria-label="Status"
          options={[{ value: ALL, label: 'All Statuses' }, ...Object.values(MemoryStatus).map((s) => ({ value: s, label: s }))]}
        />

        <Select
          className="w-auto min-w-[7.5rem]"
          value={filters.sortBy ?? 'createdAt'}
          onChange={(v) => setFilters({ sortBy: v })}
          aria-label="Sort by"
          disabled={hybridActive}
          title={hybridActive ? 'Hybrid results are ranked by relevance; sorting applies to the list' : undefined}
          options={[
            { value: 'createdAt', label: 'Created' },
            { value: 'importance', label: 'Importance' },
            { value: 'updatedAt', label: 'Updated' },
          ]}
        />

        <button
          type="button"
          onClick={() =>
            setFilters({
              sortOrder:
                filters.sortOrder === 'asc' ? 'desc' : 'asc',
            })
          }
          disabled={hybridActive}
          className={cn('h-9 bg-card border border-border rounded-control px-3 text-sm text-foreground hover:border-hairline-strong transition-[border-color,box-shadow] duration-fast ease-out', hybridActive && 'opacity-50 cursor-not-allowed')}
          title={hybridActive ? 'Hybrid results are ranked by relevance; sorting applies to the list' : `Sort ${filters.sortOrder === 'asc' ? 'ascending' : 'descending'}`}
        >
          {filters.sortOrder === 'asc' ? '↑ Asc' : '↓ Desc'}
        </button>

        {/* As-of date + archived (hybrid search only) — hidden while the list endpoint answers,
            because it ignores both; a stale chip stays visible so it can be cleared. */}
        {hybridEligible && hybridActive && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Only memories that were valid on this day (hybrid search)">
            <span>As of</span>
            <input
              type="date"
              value={filters.asOf ?? ''}
              onChange={(e) => setFilters({ asOf: e.target.value || undefined })}
              aria-label="As of date"
              className={`${selectClass} py-1`}
            />
          </label>
        )}
        {asOfLabel && (
          <span className="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-foreground" data-testid="memory-asof-chip" title={hybridActive ? undefined : 'Applies once you type a query (hybrid search)'}>
            {asOfLabel}
            <button type="button" onClick={() => setFilters({ asOf: undefined })} aria-label="Clear as-of date" className="text-muted-foreground hover:text-foreground">×</button>
          </span>
        )}

        {hybridEligible && hybridActive && (
          <button
            type="button"
            onClick={() => setFilters({ includeArchived: filters.includeArchived ? undefined : true })}
            aria-pressed={!!filters.includeArchived}
            className={cn(
              'h-9 rounded-control border px-3 text-sm transition-[background-color,color,border-color] duration-fast ease-out',
              filters.includeArchived ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border bg-card text-muted-foreground hover:text-foreground',
            )}
            title="Include archived memories (hybrid search)"
          >
            Include archived
          </button>
        )}

        <button
          type="button"
          onClick={clearAll}
          className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Clear Filters
        </button>
      </div>

      {/* Tag chips — multi-select over tags present in the results */}
      {tagChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by tag">
          {tagChips.map((tag) => {
            const on = selectedTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                aria-pressed={on}
                className={cn(
                  'h-6 rounded-full border px-2 text-[11px] transition-colors',
                  on ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border bg-card text-muted-foreground hover:text-foreground',
                )}
              >
                #{tag}
              </button>
            );
          })}
          {selectedTags.length > 0 && (
            <button type="button" onClick={() => setFilters({ tags: undefined })} className="text-[11px] text-muted-foreground underline-offset-2 hover:underline">
              clear tags
            </button>
          )}
        </div>
      )}
    </div>
  );
}
