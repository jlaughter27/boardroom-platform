import { useState, useEffect, useMemo } from 'react';
import * as api from '../../lib/api';
import type { Person, Goal, Project } from '@boardroom/shared';

interface EntityLinkerProps {
  memoryId: string;
  onLink: () => void;
  onClose: () => void;
}

type EntityType = 'person' | 'goal' | 'project';

interface EntityOption {
  id: string;
  label: string;
  type: EntityType;
}

export function EntityLinker({ memoryId, onLink, onClose }: EntityLinkerProps) {
  const [entityType, setEntityType] = useState<EntityType>('person');
  const [search, setSearch] = useState('');
  const [entities, setEntities] = useState<EntityOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    let canceled = false;

    async function load() {
      try {
        let items: EntityOption[] = [];
        if (entityType === 'person') {
          const people = await api.getPeople();
          items = people.map((p: Person) => ({ id: p.id, label: p.name, type: 'person' as const }));
        } else if (entityType === 'goal') {
          const goals = await api.getGoals();
          items = goals.map((g: Goal) => ({ id: g.id, label: g.title, type: 'goal' as const }));
        } else {
          const projects = await api.getProjects();
          items = projects.map((p: Project) => ({ id: p.id, label: p.title, type: 'project' as const }));
        }
        if (!canceled) {
          setEntities(items);
          setLoading(false);
        }
      } catch {
        if (!canceled) setLoading(false);
      }
    }

    load();
    return () => { canceled = true; };
  }, [entityType]);

  const filtered = useMemo(() => {
    if (!search.trim()) return entities;
    const q = search.toLowerCase();
    return entities.filter(e => e.label.toLowerCase().includes(q));
  }, [entities, search]);

  async function handleLink(entity: EntityOption) {
    setLinking(entity.id);
    try {
      await api.createMemoryLink(memoryId, {
        entityType: entity.type,
        entityId: entity.id,
      });
      onLink();
    } catch {
      // ignore
    } finally {
      setLinking(null);
    }
  }

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-white">Link to Entity</p>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-200 text-xs">Close</button>
      </div>

      {/* Type selector */}
      <div className="flex gap-1">
        {(['person', 'goal', 'project'] as EntityType[]).map(t => (
          <button
            key={t}
            onClick={() => { setEntityType(t); setSearch(''); }}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              entityType === t
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}s
          </button>
        ))}
      </div>

      {/* Search input */}
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={`Search ${entityType}s...`}
        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-600"
      />

      {/* List */}
      <div className="max-h-40 overflow-y-auto space-y-1">
        {loading ? (
          <p className="text-xs text-gray-500 text-center py-2">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-2">No {entityType}s found</p>
        ) : (
          filtered.map(entity => (
            <button
              key={entity.id}
              onClick={() => handleLink(entity)}
              disabled={linking === entity.id}
              className="w-full text-left px-3 py-1.5 rounded text-sm text-gray-300 hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {linking === entity.id ? 'Linking...' : entity.label}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
