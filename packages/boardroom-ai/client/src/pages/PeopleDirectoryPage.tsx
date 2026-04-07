import { useEffect, useState, useMemo } from 'react';
import { useEntitiesStore } from '../stores/entities.store';
import { PersonCard } from '../components/memory/PersonCard';
import { RelationshipGraph } from '../components/memory/RelationshipGraph';
import { useRelationshipData } from '../hooks/useRelationshipData';

type Tab = 'directory' | 'map';

export default function PeopleDirectoryPage() {
  const { people, fetchPeople, createPerson, updatePerson, deletePerson } =
    useEntitiesStore();
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('');
  const [newRelationship, setNewRelationship] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [creating, setCreating] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('directory');
  const { data: graphData, isLoading: graphLoading, hasEnoughData } = useRelationshipData();

  useEffect(() => {
    if (people.length === 0) {
      fetchPeople();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (!search.trim()) return people;
    const q = search.toLowerCase();
    return people.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.role?.toLowerCase().includes(q) ||
        p.domains.some((d) => d.toLowerCase().includes(q)),
    );
  }, [people, search]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createPerson({
        name: newName.trim(),
        role: newRole.trim() || undefined,
        relationshipToUser: newRelationship.trim() || undefined,
        notes: newNotes.trim() || undefined,
      });
      setNewName('');
      setNewRole('');
      setNewRelationship('');
      setNewNotes('');
      setShowAdd(false);
    } catch {
      // error handled by store
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-bold text-white">People Directory</h1>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
        >
          {showAdd ? 'Cancel' : 'Add Person'}
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 bg-gray-800 rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab('directory')}
          className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
            activeTab === 'directory'
              ? 'bg-gray-700 text-white font-medium'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          Directory
        </button>
        <button
          onClick={() => setActiveTab('map')}
          className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
            activeTab === 'map'
              ? 'bg-gray-700 text-white font-medium'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          Relationship Map
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <form
          onSubmit={handleCreate}
          className="bg-gray-800 rounded-lg p-4 border border-gray-700 space-y-3 mb-4"
        >
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name (required)"
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-600"
          />
          <div className="flex flex-wrap gap-3">
            <input
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              placeholder="Role"
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-600 flex-1 min-w-[120px]"
            />
            <input
              value={newRelationship}
              onChange={(e) => setNewRelationship(e.target.value)}
              placeholder="Relationship"
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-600 flex-1 min-w-[120px]"
            />
          </div>
          <textarea
            value={newNotes}
            onChange={(e) => setNewNotes(e.target.value)}
            placeholder="Notes"
            rows={2}
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-600 resize-y"
          />
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded transition-colors"
          >
            {creating ? 'Creating...' : 'Create Person'}
          </button>
        </form>
      )}

      {/* Directory Tab */}
      {activeTab === 'directory' && (
        <>
          {/* Search */}
          <div className="relative mb-4">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
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
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people by name, role, or domain..."
              className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-600"
            />
          </div>

          {/* Grid */}
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <svg
                className="w-12 h-12 text-gray-600 mb-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
              <p className="text-gray-400 text-sm font-medium">
                {people.length === 0
                  ? 'No people in your directory yet'
                  : 'No people match your search'}
              </p>
              <p className="text-gray-500 text-xs mt-1">
                {people.length === 0
                  ? 'Click "Add Person" to get started'
                  : 'Try a different search term'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((person) => (
                <PersonCard
                  key={person.id}
                  person={person}
                  onEdit={updatePerson}
                  onDelete={deletePerson}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Map Tab */}
      {activeTab === 'map' && (
        <div>
          {graphLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
            </div>
          ) : !hasEnoughData ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <svg
                className="w-12 h-12 text-gray-600 mb-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                />
              </svg>
              <p className="text-gray-400 text-sm font-medium">
                Add more people to see your relationship map
              </p>
              <p className="text-gray-500 text-xs mt-1">
                You need at least 3 people or projects to generate a useful visualization.
              </p>
            </div>
          ) : graphData ? (
            <RelationshipGraph data={graphData} />
          ) : null}
        </div>
      )}
    </div>
  );
}
