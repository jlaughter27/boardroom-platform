import { useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgeGraphNode, KnowledgeGraphNodeType } from '@boardroom/shared';
import { cn } from '../../lib/cn';
import { NODE_TYPES, TYPE_LABEL, TYPE_SHAPE, TYPE_SINGULAR, type NodeShape } from './graph-theme';

export interface GraphFilters {
  types: Set<KnowledgeGraphNodeType>;
  domain: string | 'all';
  showOrphans: boolean;
  showLabels: boolean;
  /** 0 = whole graph; 1..3 = local graph around the selected node */
  depth: 0 | 1 | 2 | 3;
}

interface Props {
  filters: GraphFilters;
  onChange(next: GraphFilters): void;
  counts: Record<KnowledgeGraphNodeType, number>;
  domains: string[];
  nodes: KnowledgeGraphNode[];
  hasSelection: boolean;
  onPick(id: string): void;
  onFit(): void;
  searchRef?: React.RefObject<HTMLInputElement | null>;
}

/** Tiny SVG glyph matching the canvas shape, used in chips + legend. */
export function ShapeGlyph({ shape, color, size = 12 }: { shape: NodeShape; color: string; size?: number }) {
  const h = size / 2;
  const common = { fill: color, stroke: 'none' } as const;
  let el: React.ReactNode;
  switch (shape) {
    case 'diamond': el = <polygon points={`${h},0 ${size},${h} ${h},${size} 0,${h}`} {...common} />; break;
    case 'square': el = <rect x={1} y={1} width={size - 2} height={size - 2} rx={2} {...common} />; break;
    case 'triangle': el = <polygon points={`${h},0.5 ${size},${size - 1} 0,${size - 1}`} {...common} />; break;
    case 'hexagon': {
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        return `${h + Math.cos(a) * h},${h + Math.sin(a) * h}`;
      }).join(' ');
      el = <polygon points={pts} {...common} />; break;
    }
    case 'ring': el = <circle cx={h} cy={h} r={h - 1.5} fill="none" stroke={color} strokeWidth={2.2} />; break;
    case 'dot': el = <circle cx={h} cy={h} r={h * 0.5} {...common} />; break;
    default: el = <circle cx={h} cy={h} r={h - 1} {...common} />;
  }
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">{el}</svg>;
}

export function GraphControls({ filters, onChange, counts, domains, nodes, hasSelection, onPick, onFit, searchRef }: Props) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const localRef = useRef<HTMLInputElement>(null);
  const inputRef = (searchRef as React.RefObject<HTMLInputElement>) ?? localRef;

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const scored: Array<{ n: KnowledgeGraphNode; score: number }> = [];
    for (const n of nodes) {
      const l = n.label.toLowerCase();
      const i = l.indexOf(s);
      if (i === -1) continue;
      scored.push({ n, score: (i === 0 ? 0 : 1) + (n.type === 'memory' ? 2 : 0) + l.length / 200 });
    }
    return scored.sort((a, b) => a.score - b.score).slice(0, 8).map((r) => r.n);
  }, [q, nodes]);

  useEffect(() => { setActive(0); }, [results.length]);

  const toggleType = (t: KnowledgeGraphNodeType) => {
    const next = new Set(filters.types);
    if (next.has(t)) { if (next.size > 1) next.delete(t); } else next.add(t);
    onChange({ ...filters, types: next });
  };

  const pick = (n: KnowledgeGraphNode) => { onPick(n.id); setQ(''); setOpen(false); inputRef.current?.blur(); };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative min-w-[200px] flex-1 max-w-sm">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
          <input
            id="graph-search"
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === 'Enter' && results[active]) { e.preventDefault(); pick(results[active]); }
              else if (e.key === 'Escape') { setQ(''); setOpen(false); inputRef.current?.blur(); }
            }}
            placeholder="Search nodes…  ( / )"
            autoComplete="off"
            className="h-9 w-full rounded-md border border-border bg-card pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Search graph nodes"
            aria-expanded={open && results.length > 0}
            aria-controls="graph-search-results"
          />
          {open && results.length > 0 && (
            <ul id="graph-search-results" role="listbox" className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-lg">
              {results.map((n, i) => (
                <li
                  key={n.id}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => { e.preventDefault(); pick(n); }}
                  onMouseEnter={() => setActive(i)}
                  className={cn('flex cursor-pointer items-center gap-2 px-3 py-2 text-sm', i === active ? 'bg-muted' : '')}
                >
                  <span className="shrink-0" style={{ color: `var(--color-entity-${n.type})` }}>
                    <ShapeGlyph shape={TYPE_SHAPE[n.type]} color="currentColor" />
                  </span>
                  <span className="truncate text-foreground">{n.label}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{TYPE_SINGULAR[n.type]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Domain */}
        <select
          id="graph-domain"
          value={filters.domain}
          onChange={(e) => onChange({ ...filters, domain: e.target.value })}
          className="h-9 rounded-md border border-border bg-card px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="Filter by domain"
        >
          <option value="all">All domains</option>
          {domains.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>

        {/* Local graph depth */}
        <label className={cn('flex h-9 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-xs text-muted-foreground', !hasSelection && 'opacity-60')}>
          <span className="whitespace-nowrap">Local graph</span>
          <input
            id="graph-depth"
            type="range"
            min={0}
            max={3}
            step={1}
            value={filters.depth}
            disabled={!hasSelection}
            onChange={(e) => onChange({ ...filters, depth: Number(e.target.value) as GraphFilters['depth'] })}
            className="w-20 accent-[var(--color-primary)]"
            aria-label="Local graph depth (0 = whole graph)"
          />
          <span className="w-7 tabular-nums text-foreground">{filters.depth === 0 ? 'off' : `${filters.depth}°`}</span>
        </label>

        {/* Toggles */}
        <button
          type="button"
          onClick={() => onChange({ ...filters, showLabels: !filters.showLabels })}
          aria-pressed={filters.showLabels}
          className={cn('h-9 rounded-md border px-3 text-sm', filters.showLabels ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border bg-card text-muted-foreground')}
        >
          Labels
        </button>
        <button
          type="button"
          onClick={() => onChange({ ...filters, showOrphans: !filters.showOrphans })}
          aria-pressed={filters.showOrphans}
          className={cn('h-9 rounded-md border px-3 text-sm', filters.showOrphans ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border bg-card text-muted-foreground')}
          title="Show nodes with no links"
        >
          Orphans
        </button>
        <button type="button" onClick={onFit} className="h-9 rounded-md border border-border bg-card px-3 text-sm text-muted-foreground hover:text-foreground" title="Fit graph to view">
          Fit
        </button>
      </div>

      {/* Type chips double as legend + filter */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Node types">
        {NODE_TYPES.map((t) => {
          const on = filters.types.has(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggleType(t)}
              aria-pressed={on}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors',
                on ? 'border-border bg-card text-foreground' : 'border-transparent bg-muted text-muted-foreground line-through decoration-muted-foreground/60',
              )}
              style={{ color: on ? undefined : undefined }}
            >
              <span style={{ color: `var(--color-entity-${t})`, opacity: on ? 1 : 0.4 }}>
                <ShapeGlyph shape={TYPE_SHAPE[t]} color="currentColor" size={11} />
              </span>
              <span>{TYPE_LABEL[t]}</span>
              <span className="tabular-nums text-muted-foreground">{counts[t]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
