import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { KnowledgeGraphEdge, KnowledgeGraphNode, KnowledgeGraphNodeType } from '@boardroom/shared';
import { cn } from '../../lib/cn';
import { ShapeGlyph } from './GraphControls';
import { NODE_TYPES, TYPE_LABEL, TYPE_SHAPE, TYPE_SINGULAR, entityRoute } from './graph-theme';

interface Props {
  node: KnowledgeGraphNode;
  nodesById: Map<string, KnowledgeGraphNode>;
  edges: KnowledgeGraphEdge[];
  onSelect(id: string): void;
  onFocusLocal(): void;
  onClose(): void;
  className?: string;
}

const EDGE_VERB: Record<KnowledgeGraphEdge['type'], string> = {
  goal_hierarchy: 'sub-goal',
  goal_project: 'project',
  project_task: 'task',
  project_person: 'person',
  decision_project: 'decision',
  task_dependency: 'depends on',
  commitment_person: 'to',
  commitment_project: 'about',
  commitment_entity: 'about',
  memory_entity: 'memory',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Backlinks panel for the selected node — the part of Obsidian's graph that
 * people actually use. Groups neighbours by type, each row re-selects.
 */
export function NodeInspector({ node, nodesById, edges, onSelect, onFocusLocal, onClose, className }: Props) {
  const groups = useMemo(() => {
    const byType = new Map<KnowledgeGraphNodeType, Array<{ n: KnowledgeGraphNode; via: string }>>();
    for (const e of edges) {
      let otherId: string | null = null;
      if (e.source === node.id) otherId = e.target;
      else if (e.target === node.id) otherId = e.source;
      if (!otherId) continue;
      const other = nodesById.get(otherId);
      if (!other) continue;
      const via = e.label && e.label !== 'relates_to' ? e.label : EDGE_VERB[e.type];
      if (!byType.has(other.type)) byType.set(other.type, []);
      byType.get(other.type)!.push({ n: other, via });
    }
    for (const list of byType.values()) list.sort((a, b) => a.n.label.localeCompare(b.n.label));
    return NODE_TYPES.filter((t) => byType.has(t)).map((t) => ({ type: t, items: byType.get(t)! }));
  }, [node.id, nodesById, edges]);

  const total = groups.reduce((s, g) => s + g.items.length, 0);
  const route = entityRoute(node.type, node.refId, node.meta);
  const color = `var(--color-entity-${node.type})`;

  return (
    <aside className={cn('flex min-h-0 flex-col bg-card text-foreground', className)} aria-label={`${TYPE_SINGULAR[node.type]} details`}>
      <header className="flex items-start gap-3 border-b border-border px-4 py-3">
        <span className="mt-0.5 shrink-0" style={{ color }}>
          <ShapeGlyph shape={TYPE_SHAPE[node.type]} color="currentColor" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{TYPE_SINGULAR[node.type]}</div>
          <h2 className="text-balance text-base font-semibold leading-snug">{node.label}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close details" className="-mr-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </header>

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
        {node.status && <span>Status <span className="text-foreground">{node.status.toLowerCase().replace(/_/g, ' ')}</span></span>}
        {node.domain && <span>Domain <span className="text-foreground">{node.domain}</span></span>}
        {node.importance !== null && <span>Importance <span className="tabular-nums text-foreground">{Math.round(node.importance * 100)}%</span></span>}
        {typeof node.meta.level === 'number' && <span>Level <span className="tabular-nums text-foreground">{node.meta.level}</span></span>}
        {typeof node.meta.priority === 'number' && <span>Priority <span className="tabular-nums text-foreground">{node.meta.priority}</span></span>}
        {typeof node.meta.role === 'string' && node.meta.role && <span>Role <span className="text-foreground">{node.meta.role}</span></span>}
        {typeof node.meta.memoryClass === 'string' && <span>Class <span className="text-foreground">{node.meta.memoryClass.toLowerCase()}</span></span>}
        <span>Created <span className="text-foreground">{formatDate(node.createdAt)}</span></span>
      </div>

      <div className="flex gap-2 border-b border-border px-4 py-2.5">
        <button type="button" onClick={onFocusLocal} className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90">
          Focus local graph
        </button>
        {route && (
          <Link to={route} className="flex h-8 items-center rounded-md border border-border px-3 text-xs text-foreground hover:bg-muted">
            Open {TYPE_SINGULAR[node.type].toLowerCase()}
          </Link>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Linked</h3>
          <span className="text-xs tabular-nums text-muted-foreground">{total}</span>
        </div>
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing links here yet. Link this {TYPE_SINGULAR[node.type].toLowerCase()} from a memory, project or goal and it will appear in the graph.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {groups.map((g) => (
              <section key={g.type}>
                <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span style={{ color: `var(--color-entity-${g.type})` }}><ShapeGlyph shape={TYPE_SHAPE[g.type]} color="currentColor" size={10} /></span>
                  <span>{TYPE_LABEL[g.type]}</span>
                  <span className="tabular-nums">{g.items.length}</span>
                </div>
                <ul className="flex flex-col">
                  {g.items.map(({ n, via }) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(n.id)}
                        className="flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-muted"
                      >
                        <span className="min-w-0 flex-1 truncate">{n.label}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{via}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
