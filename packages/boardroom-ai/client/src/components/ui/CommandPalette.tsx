import { useState, useCallback, useEffect, useMemo } from 'react';
import { Command } from 'cmdk';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import { useEntitiesStore } from '../../stores/entities.store';
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut';

interface CommandPaletteStore {
  open: boolean;
  toggle: () => void;
  close: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteStore>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
}));

const pages = [
  { name: 'Dashboard', path: '/', icon: '\u2302' },
  { name: 'Decision Lab', path: '/decisions', icon: '\u2696' },
  { name: 'Memory Explorer', path: '/memory', icon: '\u2601' },
  { name: 'People Directory', path: '/people', icon: '\u2606' },
  { name: 'Settings', path: '/settings', icon: '\u2699' },
  { name: 'Custom Personas', path: '/personas', icon: '\u263A' },
  { name: 'Integrations', path: '/integrations', icon: '\u26A1' },
];

export function CommandPalette() {
  const { open, toggle, close } = useCommandPaletteStore();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const { goals, projects, people, decisions } = useEntitiesStore();

  const toggleCb = useCallback(() => toggle(), [toggle]);
  useKeyboardShortcut('k', toggleCb, { meta: true });

  // Also support Ctrl+K for non-Mac
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.metaKey && e.key === 'k') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggle]);

  const filteredGoals = useMemo(
    () => goals.filter((g) => g.title.toLowerCase().includes(search.toLowerCase())).slice(0, 5),
    [goals, search]
  );
  const filteredProjects = useMemo(
    () => projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())).slice(0, 5),
    [projects, search]
  );
  const filteredPeople = useMemo(
    () => people.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())).slice(0, 5),
    [people, search]
  );
  const filteredDecisions = useMemo(
    () => decisions.filter((d) => d.question.toLowerCase().includes(search.toLowerCase())).slice(0, 5),
    [decisions, search]
  );

  const navigateTo = (path: string) => {
    navigate(path);
    close();
    setSearch('');
  };

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
            onClick={close}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -10 }}
            transition={{ duration: 0.15 }}
            className="fixed top-[20%] left-1/2 -translate-x-1/2 z-[var(--z-command-palette)] w-full max-w-xl"
          >
            <Command
              className="rounded-xl border border-line bg-bg-elevated/95 backdrop-blur-xl shadow-lg overflow-hidden"
              shouldFilter={false}
            >
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder="Search or type a command..."
                className="w-full bg-transparent px-4 py-3 text-sm text-text-primary placeholder:text-text-tertiary outline-none border-b border-line"
              />
              <Command.List className="max-h-80 overflow-y-auto p-2">
                <Command.Empty className="px-4 py-8 text-center text-sm text-text-tertiary">
                  No results found.
                </Command.Empty>

                <Command.Group heading="Navigation" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-text-tertiary">
                  {pages.map((page) => (
                    <Command.Item
                      key={page.path}
                      value={page.name}
                      onSelect={() => navigateTo(page.path)}
                      className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-text-primary cursor-pointer data-[selected=true]:bg-bg-hover"
                    >
                      <span className="text-base w-5 text-center">{page.icon}</span>
                      {page.name}
                    </Command.Item>
                  ))}
                </Command.Group>

                {filteredGoals.length > 0 && (
                  <Command.Group heading="Goals" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-text-tertiary">
                    {filteredGoals.map((goal) => (
                      <Command.Item
                        key={goal.id}
                        value={`goal-${goal.title}`}
                        onSelect={() => navigateTo('/')}
                        className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-text-primary cursor-pointer data-[selected=true]:bg-bg-hover"
                      >
                        <span className="text-base w-5 text-center text-accent">{'\u25CE'}</span>
                        {goal.title}
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {filteredProjects.length > 0 && (
                  <Command.Group heading="Projects" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-text-tertiary">
                    {filteredProjects.map((project) => (
                      <Command.Item
                        key={project.id}
                        value={`project-${project.name}`}
                        onSelect={() => navigateTo('/')}
                        className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-text-primary cursor-pointer data-[selected=true]:bg-bg-hover"
                      >
                        <span className="text-base w-5 text-center text-accent-secondary">{'\u25A3'}</span>
                        {project.name}
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {filteredPeople.length > 0 && (
                  <Command.Group heading="People" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-text-tertiary">
                    {filteredPeople.map((person) => (
                      <Command.Item
                        key={person.id}
                        value={`person-${person.name}`}
                        onSelect={() => navigateTo('/people')}
                        className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-text-primary cursor-pointer data-[selected=true]:bg-bg-hover"
                      >
                        <span className="text-base w-5 text-center text-info">{'\u2605'}</span>
                        {person.name}
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {filteredDecisions.length > 0 && (
                  <Command.Group heading="Recent Decisions" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-text-tertiary">
                    {filteredDecisions.map((decision) => (
                      <Command.Item
                        key={decision.id}
                        value={`decision-${decision.question}`}
                        onSelect={() => navigateTo(`/decisions/${decision.id}`)}
                        className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-text-primary cursor-pointer data-[selected=true]:bg-bg-hover"
                      >
                        <span className="text-base w-5 text-center text-warning">{'\u2696'}</span>
                        <span className="truncate">{decision.question}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-text-tertiary">
                  <Command.Item
                    value="new-decision"
                    onSelect={() => navigateTo('/decisions')}
                    className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-text-primary cursor-pointer data-[selected=true]:bg-bg-hover"
                  >
                    <span className="text-base w-5 text-center text-success">+</span>
                    New Decision Session
                  </Command.Item>
                </Command.Group>
              </Command.List>

              <div className="border-t border-line px-4 py-2 flex items-center justify-between text-xs text-text-tertiary">
                <span>Type to search across everything</span>
                <span>
                  <kbd className="px-1.5 py-0.5 rounded bg-bg-hover text-text-secondary font-mono">esc</kbd>
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
