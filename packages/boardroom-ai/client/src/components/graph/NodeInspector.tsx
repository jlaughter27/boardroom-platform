import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { KnowledgeGraphEdge, KnowledgeGraphNode, KnowledgeGraphNodeType } from '@boardroom/shared';
import * as api from '../../lib/api';
import { useEntitiesStore } from '../../stores/entities.store';
import { cn } from '../../lib/cn';
import { ShapeGlyph } from './GraphControls';
import { EntityPicker, type PickerOption } from './EntityPicker';
import { NODE_TYPES, TYPE_LABEL, TYPE_SHAPE, TYPE_SINGULAR, entityRoute } from './graph-theme';
import { useToastStore } from '../ui';

interface Props {
  node: KnowledgeGraphNode;
  nodesById: Map<string, KnowledgeGraphNode>;
  edges: KnowledgeGraphEdge[];
  onSelect(id: string): void;
  onFocusLocal(): void;
  onClose(): void;
  /** Called after a link is created so the page can refetch the graph. */
  onLinked?(): void;
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

type LinkedItem = { n: KnowledgeGraphNode; via: string };
type LinkedGroup = { type: KnowledgeGraphNodeType; items: LinkedItem[] };

function groupLinks(pairs: Array<{ other: KnowledgeGraphNode; edge: KnowledgeGraphEdge }>): LinkedGroup[] {
  const byType = new Map<KnowledgeGraphNodeType, LinkedItem[]>();
  const seen = new Set<string>();
  for (const { other, edge } of pairs) {
    const k = `${other.id}|${edge.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const via = edge.label && edge.label !== 'relates_to' ? edge.label : EDGE_VERB[edge.type];
    if (!byType.has(other.type)) byType.set(other.type, []);
    byType.get(other.type)!.push({ n: other, via });
  }
  for (const list of byType.values()) list.sort((a, b) => a.n.label.localeCompare(b.n.label));
  return NODE_TYPES.filter((t) => byType.has(t)).map((t) => ({ type: t, items: byType.get(t)! }));
}

// ---------------------------------------------------------------------------
// Link editors (Phase 6)
// ---------------------------------------------------------------------------

type EditorKind = 'person' | 'decision' | 'dependency';

function LinkEditors({ node, linkedIds, onLinked }: { node: KnowledgeGraphNode; linkedIds: Set<string>; onLinked?(): void }) {
  const { people, decisions, tasks, fetchPeople, fetchDecisions, fetchTasks } = useEntitiesStore();
  const [open, setOpen] = useState<EditorKind | null>(null);
  const [role, setRole] = useState('');
  const [pending, setPending] = useState<PickerOption | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (node.type === 'project') {
      if (people.length === 0) void fetchPeople();
      if (decisions.length === 0) void fetchDecisions();
    } else if (node.type === 'task' && tasks.length === 0) {
      void fetchTasks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, node.type]);

  useEffect(() => { setOpen(null); setPending(null); setRole(''); }, [node.id]);

  if (node.type !== 'project' && node.type !== 'task') return null;

  const personOptions: PickerOption[] = people.map((p) => ({ id: p.id, label: p.name, hint: p.role }));
  const decisionOptions: PickerOption[] = decisions.map((d) => ({ id: d.id, label: d.title, hint: d.status.toLowerCase() }));
  const taskOptions: PickerOption[] = tasks.map((t) => ({ id: t.id, label: t.title, hint: t.status.toLowerCase() }));

  const excludeFor = (type: KnowledgeGraphNodeType) => {
    const s = new Set<string>();
    for (const id of linkedIds) if (id.startsWith(`${type}:`)) s.add(id.slice(type.length + 1));
    if (type === node.type) s.add(node.refId);
    return s;
  };

  async function commit(kind: EditorKind, option: PickerOption) {
    setSaving(true);
    const toast = useToastStore.getState().addToast;
    try {
      if (kind === 'person') await api.addProjectPerson(node.refId, option.id, role.trim() || undefined);
      else if (kind === 'decision') await api.linkProjectDecision(node.refId, option.id);
      else await api.addTaskDependency(node.refId, option.id);
      toast(
        kind === 'person' ? `${option.label} added to ${node.label}` : kind === 'decision' ? `Linked decision “${option.label}”` : `${node.label} now depends on “${option.label}”`,
        'success',
      );
      setOpen(null); setPending(null); setRole('');
      onLinked?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create link', 'error');
    } finally {
      setSaving(false);
    }
  }

  const chip = (kind: EditorKind, label: string) => (
    <button
      key={kind}
      type="button"
      onClick={() => { setOpen(open === kind ? null : kind); setPending(null); }}
      aria-expanded={open === kind}
      className={cn('h-7 rounded-md border px-2.5 text-xs', open === kind ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border bg-card text-muted-foreground hover:text-foreground')}
    >
      {label}
    </button>
  );

  return (
    <section className="border-b border-border px-4 py-2.5" aria-label="Add links">
      <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">Add link</div>
      <div className="flex flex-wrap gap-1.5">
        {node.type === 'project' && chip('person', '+ Person (role)')}
        {node.type === 'project' && chip('decision', '+ Decision')}
        {node.type === 'task' && chip('dependency', 'Depends on…')}
      </div>

      {open === 'person' && (
        <div className="mt-2 space-y-2">
          {pending ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-foreground">{pending.label}</span>
              <button type="button" onClick={() => setPending(null)} className="text-xs text-muted-foreground hover:text-foreground">change</button>
            </div>
          ) : (
            <EntityPicker options={personOptions} exclude={excludeFor('person')} placeholder="Search people…" onPick={setPending} autoFocus aria-label="Person to add" />
          )}
          <div className="flex gap-2">
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Role (optional)"
              aria-label="Role on this project"
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-card px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="button"
              disabled={!pending || saving}
              onClick={() => pending && commit('person', pending)}
              className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {open === 'decision' && (
        <div className="mt-2">
          <EntityPicker options={decisionOptions} exclude={excludeFor('decision')} placeholder="Search decisions…" onPick={(o) => commit('decision', o)} autoFocus aria-label="Decision to link" />
          {saving && <p className="mt-1 text-xs text-muted-foreground">Linking…</p>}
        </div>
      )}

      {open === 'dependency' && (
        <div className="mt-2">
          <EntityPicker options={taskOptions} exclude={excludeFor('task')} placeholder="Search tasks this one depends on…" onPick={(o) => commit('dependency', o)} autoFocus aria-label="Task this task depends on" />
          {saving && <p className="mt-1 text-xs text-muted-foreground">Linking…</p>}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

/**
 * Backlinks panel for the selected node — the part of Obsidian's graph that
 * people actually use. Linked list comes from `GET /graph/backlinks/:id`
 * (includes memories beyond the page's capped set); falls back to the local
 * edges when the request fails. Groups neighbours by type, each row re-selects.
 */
export function NodeInspector({ node, nodesById, edges, onSelect, onFocusLocal, onClose, onLinked, className }: Props) {
  const [remote, setRemote] = useState<{ nodeId: string; groups: LinkedGroup[] } | null>(null);
  const [loadingRemote, setLoadingRemote] = useState(false);

  const localGroups = useMemo(() => {
    const pairs: Array<{ other: KnowledgeGraphNode; edge: KnowledgeGraphEdge }> = [];
    for (const e of edges) {
      let otherId: string | null = null;
      if (e.source === node.id) otherId = e.target;
      else if (e.target === node.id) otherId = e.source;
      if (!otherId) continue;
      const other = nodesById.get(otherId);
      if (other) pairs.push({ other, edge: e });
    }
    return groupLinks(pairs);
  }, [node.id, nodesById, edges]);

  useEffect(() => {
    let cancelled = false;
    setLoadingRemote(true);
    api.getGraphBacklinks(node.id)
      .then((res) => {
        if (cancelled) return;
        setRemote({ nodeId: node.id, groups: groupLinks(res.backlinks.map((b) => ({ other: b.node, edge: b.edge }))) });
      })
      .catch(() => { if (!cancelled) setRemote(null); }) // fall back to local edges
      .finally(() => { if (!cancelled) setLoadingRemote(false); });
    return () => { cancelled = true; };
  }, [node.id, edges]);

  const groups = remote && remote.nodeId === node.id ? remote.groups : localGroups;
  const usingRemote = !!remote && remote.nodeId === node.id;
  const total = groups.reduce((s, g) => s + g.items.length, 0);
  const linkedIds = useMemo(() => new Set(groups.flatMap((g) => g.items.map((i) => i.n.id))), [groups]);
  const route = entityRoute(node.type, node.refId, node.meta);
  const color = `var(--color-entity-${node.type})`;

  const selectRow = (id: string) => {
    if (nodesById.has(id)) onSelect(id);
    else useToastStore.getState().addToast('That node is outside the current graph view (memory cap or filters).', 'info');
  };

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

      <LinkEditors node={node} linkedIds={linkedIds} onLinked={onLinked} />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Linked{loadingRemote && !usingRemote ? <span className="ml-1 normal-case tracking-normal">· updating…</span> : null}
          </h3>
          <span className="text-xs tabular-nums text-muted-foreground" title={usingRemote ? 'From /graph/backlinks' : 'From the loaded graph'}>{total}</span>
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
                        onClick={() => selectRow(n.id)}
                        className={cn('flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-muted', !nodesById.has(n.id) && 'text-muted-foreground')}
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
