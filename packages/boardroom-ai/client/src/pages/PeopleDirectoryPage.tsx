import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { usePageTitle } from '../hooks/usePageTitle';
import { useEntitiesStore } from '../stores/entities.store';
import { PersonCard } from '../components/memory/PersonCard';
import { RelationshipGraph } from '../components/memory/RelationshipGraph';
import { useRelationshipData } from '../hooks/useRelationshipData';
import { PageWrapper, Button, Card, Input, Skeleton, EmptyState, Tabs, Avatar } from '../components/ui';
import { ErrorBanner } from '../components/shared/ErrorBanner';
import { staggerContainer, staggerItem, scaleIn } from '../lib/motion';

type Tab = 'directory' | 'map';

export default function PeopleDirectoryPage() {
  usePageTitle('People Directory');
  const { people, fetchPeople, createPerson, updatePerson, deletePerson, isLoading, error, clearError } =
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
    if (people.length === 0) fetchPeople();
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
      setNewName(''); setNewRole(''); setNewRelationship(''); setNewNotes('');
      setShowAdd(false);
    } catch {} finally { setCreating(false); }
  }

  return (
    <PageWrapper>
      <div className="p-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold text-text-primary">People Directory</h1>
          <Button variant="primary" size="sm" onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? 'Cancel' : '+ Add Person'}
          </Button>
        </div>

        {error && <ErrorBanner message={error} onDismiss={clearError} />}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-bg-elevated rounded-lg p-1 w-fit">
          {(['directory', 'map'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                activeTab === tab
                  ? 'bg-bg-surface text-text-primary font-medium shadow-sm'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              {tab === 'directory' ? 'Directory' : 'Relationship Map'}
            </button>
          ))}
        </div>

        {/* Add modal overlay */}
        <AnimatePresence>
          {showAdd && (
            <motion.div {...scaleIn} className="mb-4">
              <Card className="p-5">
                <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wide mb-3">Add Person</h3>
                <form onSubmit={handleCreate} className="space-y-3">
                  <Input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name (required)" label="Name" />
                  <div className="flex flex-wrap gap-3">
                    <Input value={newRole} onChange={(e) => setNewRole(e.target.value)} placeholder="Role" className="flex-1 min-w-[120px]" />
                    <Input value={newRelationship} onChange={(e) => setNewRelationship(e.target.value)} placeholder="Relationship" className="flex-1 min-w-[120px]" />
                  </div>
                  <textarea
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                    placeholder="Notes"
                    rows={2}
                    className="w-full bg-bg-base border border-line rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent/30 outline-none resize-y"
                  />
                  <div className="flex gap-2">
                    <Button type="submit" variant="primary" size="sm" disabled={creating || !newName.trim()}>
                      {creating ? 'Creating...' : 'Create Person'}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
                  </div>
                </form>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Directory Tab */}
        {activeTab === 'directory' && (
          <>
            {isLoading && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <Skeleton key={i} className="h-36 rounded-lg" />
                ))}
              </div>
            )}

            {!isLoading && (
              <>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search people by name, role, or domain..."
                  className="mb-4"
                />

                {filtered.length === 0 ? (
                  <EmptyState
                    variant="no-people"
                    title={people.length === 0 ? 'No people in your directory yet' : 'No people match your search'}
                    description={people.length === 0 ? 'Click "Add Person" to get started' : 'Try a different search term'}
                  />
                ) : (
                  <motion.div {...staggerContainer} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filtered.map((person) => (
                      <motion.div key={person.id} {...staggerItem}>
                        <PersonCard person={person} onEdit={updatePerson} onDelete={deletePerson} />
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </>
            )}
          </>
        )}

        {/* Map Tab */}
        {activeTab === 'map' && (
          <div>
            {graphLoading ? (
              <div className="flex items-center justify-center py-16">
                <Skeleton className="h-64 w-full rounded-lg" />
              </div>
            ) : !hasEnoughData ? (
              <EmptyState
                variant="no-people"
                title="Add more people to see your relationship map"
                description="You need at least 3 people or projects to generate a useful visualization."
              />
            ) : graphData ? (
              <RelationshipGraph data={graphData} />
            ) : null}
          </div>
        )}
      </div>
    </PageWrapper>
  );
}
