import { useState, useEffect, useMemo } from 'react';
import { MemoryClass, MemoryStatus } from '@boardroom/shared';
import { useMemoryStore } from '../../stores/memory.store';
import { useDebounce } from '../../hooks/useDebounce';
import { formatAsOf } from '../graph/graph-search';
import { cn } from '../../lib/cn';

const MAX_TAG_CHIPS = 14;

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

  const selectClass =
    'bg-card border border-border rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary/40';

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

        <select
          value={filters.memoryClass ?? ''}
          onChange={(e) =>
            setFilters({ memoryClass: e.target.value || undefined })
          }
          aria-label="Memory class"
          className={cn(selectClass, hybridActive && 'opacity-50 cursor-not-allowed')}
          disabled={hybridActive}
          title={hybridActive ? listOnlyTitle : undefined}
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
          aria-label="Status"
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
          aria-label="Sort by"
          className={cn(selectClass, hybridActive && 'opacity-50 cursor-not-allowed')}
          disabled={hybridActive}
          title={hybridActive ? 'Hybrid results are ranked by relevance; sorting applies to the list' : undefined}
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
          disabled={hybridActive}
          className={cn('bg-card border border-border rounded px-2 py-1.5 text-sm text-foreground hover:bg-card transition-colors', hybridActive && 'opacity-50 cursor-not-allowed')}
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
              'rounded border px-2 py-1.5 text-sm transition-colors',
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
