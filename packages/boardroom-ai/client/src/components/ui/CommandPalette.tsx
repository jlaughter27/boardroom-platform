import { useState, useMemo, useEffect, useRef } from 'react';
import { Command } from 'cmdk';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { useEntitiesStore } from '../../stores/entities.store';
import { shouldRefetch, useCommandPaletteStore } from '../../stores/commandPalette.store';
import { useGraphStore } from '../../stores/graph.store';
import { useDebounce } from '../../hooks/useDebounce';
import { formatAsOf, type SpotlightHit } from '../graph/graph-search';
import { cn } from '../../lib/cn';

export { useCommandPaletteStore } from '../../stores/commandPalette.store';

const pages = [
  { name: 'Dashboard', path: '/', icon: '⌂' },
  { name: 'Decision Lab', path: '/decisions', icon: '⚖' },
  { name: 'Memory Explorer', path: '/memory', icon: '☁' },
  { name: 'Knowledge Graph', path: '/graph', icon: '⬡' },
  { name: 'People Directory', path: '/people', icon: '☆' },
  { name: 'Settings', path: '/settings', icon: '⚙' },
  { name: 'Custom Personas', path: '/personas', icon: '☺' },
  { name: 'Integrations', path: '/integrations', icon: '⚡' },
];

const GROUP_CLASS = '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground';
const ITEM_CLASS = 'flex items-center gap-3 rounded-md px-3 py-2 text-sm text-foreground cursor-pointer data-[selected=true]:bg-muted';

/** Opens the palette in "Search memory" mode (used by ⌘⇧K and the graph page's `/`). */
export function openMemorySearchPalette() {
  useGraphStore.getState().setPaletteMode('memory');
  const palette = useCommandPaletteStore.getState();
  if (!palette.open) palette.toggle();
}

function formatScore(score: number): string {
  if (!Number.isFinite(score)) return '';
  return score <= 1 ? `${Math.round(score * 100)}%` : score.toFixed(2);
}

export function CommandPalette() {
  // Cmd/Ctrl+K is bound once, in useKeyboardShortcuts (Layout) — see C-116.
  const { open, close } = useCommandPaletteStore();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const { goals, projects, people, decisions, tasks, commitments, fetchTasks, fetchCommitments } = useEntitiesStore();
  const paletteMode = useGraphStore((s) => s.paletteMode);
  const spotlight = useGraphStore((s) => s.spotlight);
  const graphMounted = useGraphStore((s) => s.graphMounted);
  const memoryMode = paletteMode === 'memory';
  const debounced = useDebounce(search, 250);
  /** True once the user has typed in memory mode (so seeding the input never clears an existing spotlight). */
  const touched = useRef(false);

  // Tasks and commitments are not preloaded elsewhere — fetch them the first time
  // the palette opens, then at most once per PALETTE_ENTITY_TTL_MS for the rest of
  // the session (an empty list is cached too, so zero-task users stop refetching).
  useEffect(() => {
    if (!open) return;
    const { tasksFetchedAt, commitmentsFetchedAt, markFetched } = useCommandPaletteStore.getState();
    const now = Date.now();
    if (shouldRefetch(tasksFetchedAt, tasks.length, now)) { markFetched('tasks', now); void fetchTasks(); }
    if (shouldRefetch(commitmentsFetchedAt, commitments.length, now)) { markFetched('commitments', now); void fetchCommitments(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Entering memory mode: seed an empty input with the active spotlight query
  // (seeding must not re-run or clear the search); text the user already typed
  // in commands mode is searched straight away.
  useEffect(() => {
    if (!open || !memoryMode) return;
    if (search.trim()) { touched.current = true; return; }
    const q = useGraphStore.getState().spotlight.query;
    if (q) { touched.current = false; setSearch(q); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, memoryMode]);

  // Memory mode: debounced hybrid search.
  useEffect(() => {
    if (!open || !memoryMode || !touched.current) return;
    void useGraphStore.getState().runSearch(debounced);
  }, [debounced, open, memoryMode]);

  const q = search.toLowerCase();
  const filteredGoals = useMemo(() => goals.filter((g) => g.title.toLowerCase().includes(q)).slice(0, 5), [goals, q]);
  const filteredProjects = useMemo(() => projects.filter((p) => p.title.toLowerCase().includes(q)).slice(0, 5), [projects, q]);
  const filteredPeople = useMemo(() => people.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 5), [people, q]);
  const filteredDecisions = useMemo(() => decisions.filter((d) => d.question.toLowerCase().includes(q)).slice(0, 5), [decisions, q]);
  const filteredTasks = useMemo(() => (q ? tasks.filter((t) => t.title.toLowerCase().includes(q)).slice(0, 5) : []), [tasks, q]);
  const filteredCommitments = useMemo(
    () => (q ? commitments.filter((c) => c.description.toLowerCase().includes(q)).slice(0, 5) : []),
    [commitments, q],
  );

  const closePalette = () => {
    close();
    setSearch('');
    useGraphStore.getState().setPaletteMode('commands');
  };

  const navigateTo = (path: string) => {
    navigate(path);
    closePalette();
  };

  const enterMemoryMode = () => {
    touched.current = !!search.trim();
    useGraphStore.getState().setPaletteMode('memory');
  };

  const selectHit = (hit: SpotlightHit) => {
    const store = useGraphStore.getState();
    if (graphMounted) {
      store.requestFocus(hit.nodeId);
      closePalette();
    } else {
      navigateTo(`/graph?focus=${encodeURIComponent(hit.nodeId)}`);
    }
  };

  const asOfLabel = formatAsOf(spotlight.asOf);

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[var(--z-command-palette)] bg-black/60 backdrop-blur-sm"
            onClick={closePalette}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -10 }}
            transition={{ duration: 0.15 }}
            className="fixed top-[20%] left-1/2 -translate-x-1/2 z-[var(--z-command-palette)] w-full max-w-xl"
          >
            <Command
              className="rounded-xl border border-border bg-card/95 backdrop-blur-xl shadow-lg overflow-hidden"
              shouldFilter={false}
              label={memoryMode ? 'Search memory' : 'Command palette'}
            >
              <div className="flex items-center border-b border-border">
                {memoryMode && (
                  <button
                    type="button"
                    onClick={() => useGraphStore.getState().setPaletteMode('commands')}
                    className="ml-2 h-7 shrink-0 rounded-md border border-border bg-card px-2 text-xs text-muted-foreground hover:text-foreground"
                    aria-label="Back to commands"
                  >
                    ‹ Commands
                  </button>
                )}
                <Command.Input
                  value={search}
                  onValueChange={(v) => { if (memoryMode) touched.current = true; setSearch(v); }}
                  placeholder={memoryMode ? 'Search memory — semantic + full-text + fuzzy…' : 'Search or type a command...'}
                  aria-label={memoryMode ? 'Search memory' : 'Search or type a command'}
                  className="w-full bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none"
                />
                {memoryMode && spotlight.loading && <span className="mr-3 text-xs text-muted-foreground">Searching…</span>}
              </div>

              {memoryMode && (
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs">
                  <label className="flex items-center gap-1.5 text-muted-foreground">
                    <span>As of</span>
                    <input
                      type="date"
                      value={spotlight.asOf ?? ''}
                      onChange={(e) => useGraphStore.getState().setAsOf(e.target.value || null)}
                      aria-label="As of date"
                      className="h-7 rounded-md border border-border bg-card px-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                  {asOfLabel && (
                    <span className="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-foreground" data-testid="palette-asof-chip">
                      {asOfLabel}
                      <button type="button" onClick={() => useGraphStore.getState().setAsOf(null)} aria-label="Clear as-of date" className="text-muted-foreground hover:text-foreground">×</button>
                    </span>
                  )}
                  {spotlight.error && <span className="text-destructive">{spotlight.error}</span>}
                  <span className="ml-auto text-muted-foreground">
                    {graphMounted ? 'Hits light up in the graph' : 'Select a hit to open it in the graph'}
                  </span>
                </div>
              )}

              <Command.List className="max-h-80 overflow-y-auto p-2">
                {memoryMode ? (
                  <>
                    {spotlight.hits.length === 0 && !spotlight.loading && (
                      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                        {search.trim() ? 'No memories match.' : 'Type to search your memory.'}
                      </div>
                    )}
                    {spotlight.hits.length > 0 && (
                      <Command.Group heading={`Memory hits · ${spotlight.hits.length}`} className={GROUP_CLASS}>
                        {spotlight.hits.map((hit) => (
                          <Command.Item
                            key={hit.nodeId}
                            value={hit.nodeId}
                            onSelect={() => selectHit(hit)}
                            className={cn(ITEM_CLASS, 'items-start')}
                            data-testid="memory-hit"
                          >
                            <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--color-entity-memory)' }} aria-hidden="true" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{hit.label}</span>
                              {hit.snippet && <span className="block truncate text-xs text-muted-foreground">{hit.snippet}</span>}
                            </span>
                            <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                              {hit.layers.length > 0 && <span title="Matched layers">{hit.layers.join(' · ')}</span>}
                              <span className="rounded border border-border px-1">Memory</span>
                              <span className="tabular-nums text-foreground" title="Relevance score">{formatScore(hit.score)}</span>
                            </span>
                          </Command.Item>
                        ))}
                        {spotlight.nextCursor && (
                          <Command.Item
                            value="__load_more__"
                            onSelect={() => void useGraphStore.getState().loadMore()}
                            disabled={spotlight.loading}
                            className={cn(ITEM_CLASS, 'justify-center text-xs text-muted-foreground')}
                          >
                            {spotlight.loading ? 'Loading…' : 'Load more'}
                          </Command.Item>
                        )}
                      </Command.Group>
                    )}
                  </>
                ) : (
                  <>
                    <Command.Empty className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No results found.
                    </Command.Empty>

                    <Command.Group heading="Navigation" className={GROUP_CLASS}>
                      {pages.map((page) => (
                        <Command.Item key={page.path} value={page.name} onSelect={() => navigateTo(page.path)} className={ITEM_CLASS}>
                          <span className="text-base w-5 text-center">{page.icon}</span>
                          {page.name}
                        </Command.Item>
                      ))}
                    </Command.Group>

                    {filteredGoals.length > 0 && (
                      <Command.Group heading="Goals" className={GROUP_CLASS}>
                        {filteredGoals.map((goal) => (
                          <Command.Item key={goal.id} value={`goal-${goal.title}`} onSelect={() => navigateTo('/')} className={ITEM_CLASS}>
                            <span className="text-base w-5 text-center text-primary">{'◎'}</span>
                            {goal.title}
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}

                    {filteredProjects.length > 0 && (
                      <Command.Group heading="Projects" className={GROUP_CLASS}>
                        {filteredProjects.map((project) => (
                          <Command.Item key={project.id} value={`project-${project.title}`} onSelect={() => navigateTo('/')} className={ITEM_CLASS}>
                            <span className="text-base w-5 text-center text-primary">{'▣'}</span>
                            {project.title}
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}

                    {filteredTasks.length > 0 && (
                      <Command.Group heading="Tasks" className={GROUP_CLASS}>
                        {filteredTasks.map((task) => (
                          <Command.Item key={task.id} value={`task-${task.id}`} onSelect={() => navigateTo(`/graph?focus=${encodeURIComponent(`task:${task.id}`)}`)} className={ITEM_CLASS}>
                            <span className="text-base w-5 text-center" style={{ color: 'var(--color-entity-task)' }}>{'△'}</span>
                            <span className="truncate">{task.title}</span>
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">{task.status.toLowerCase().replace(/_/g, ' ')}</span>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}

                    {filteredCommitments.length > 0 && (
                      <Command.Group heading="Commitments" className={GROUP_CLASS}>
                        {filteredCommitments.map((c) => (
                          <Command.Item key={c.id} value={`commitment-${c.id}`} onSelect={() => navigateTo(`/graph?focus=${encodeURIComponent(`commitment:${c.id}`)}`)} className={ITEM_CLASS}>
                            <span className="text-base w-5 text-center" style={{ color: 'var(--color-entity-commitment)' }}>{'⬢'}</span>
                            <span className="truncate">{c.description}</span>
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">{String(c.status).toLowerCase().replace(/_/g, ' ')}</span>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}

                    {filteredPeople.length > 0 && (
                      <Command.Group heading="People" className={GROUP_CLASS}>
                        {filteredPeople.map((person) => (
                          <Command.Item key={person.id} value={`person-${person.name}`} onSelect={() => navigateTo('/people')} className={ITEM_CLASS}>
                            <span className="text-base w-5 text-center text-info">{'★'}</span>
                            {person.name}
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}

                    {filteredDecisions.length > 0 && (
                      <Command.Group heading="Recent Decisions" className={GROUP_CLASS}>
                        {filteredDecisions.map((decision) => (
                          <Command.Item key={decision.id} value={`decision-${decision.question}`} onSelect={() => navigateTo(`/decisions/${decision.id}`)} className={ITEM_CLASS}>
                            <span className="text-base w-5 text-center text-warning">{'⚖'}</span>
                            <span className="truncate">{decision.question}</span>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}

                    <Command.Group heading="Actions" className={GROUP_CLASS}>
                      <Command.Item value="search-memory" onSelect={enterMemoryMode} className={ITEM_CLASS}>
                        <span className="text-base w-5 text-center text-primary">{'⌕'}</span>
                        {search.trim() ? <>Search memory for <span className="truncate font-medium">“{search.trim()}”</span></> : 'Search memory'}
                        <kbd className="ml-auto rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">⌘⇧K</kbd>
                      </Command.Item>
                      <Command.Item value="new-decision" onSelect={() => navigateTo('/decisions')} className={ITEM_CLASS}>
                        <span className="text-base w-5 text-center text-success">+</span>
                        New Decision Session
                      </Command.Item>
                    </Command.Group>
                  </>
                )}
              </Command.List>

              <div className="border-t border-border px-4 py-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>{memoryMode ? (graphMounted ? '↵ focus hit in graph' : '↵ open hit in graph') : 'Type to search across everything'}</span>
                <span>
                  <kbd className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">esc</kbd>
                  {' '}to close
                </span>
              </div>
            </Command>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
