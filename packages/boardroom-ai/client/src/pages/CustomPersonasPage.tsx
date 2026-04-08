import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { usePageTitle } from '../hooks/usePageTitle';
import { getCustomPersonas, deleteCustomPersona, updateCustomPersona } from '../lib/api';
import { PersonaEditor } from '../components/settings/PersonaEditor';
import { PageWrapper, Card, Button, Badge, Skeleton, EmptyState, useToastStore } from '../components/ui';
import { ErrorBanner } from '../components/shared/ErrorBanner';
import { staggerContainer, staggerItem, scaleIn } from '../lib/motion';
import type { CustomPersona } from '@boardroom/shared';

export default function CustomPersonasPage() {
  usePageTitle('Custom Personas');
  const [personas, setPersonas] = useState<CustomPersona[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

  async function load() {
    try {
      setLoading(true);
      const data = await getCustomPersonas();
      setPersonas(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load personas');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this persona? This cannot be undone.')) return;
    try {
      await deleteCustomPersona(id);
      setPersonas((prev) => prev.filter((p) => p.id !== id));
      addToast('Persona deleted', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete', 'error');
    }
  }

  async function handleToggleActive(persona: CustomPersona) {
    try {
      const updated = await updateCustomPersona(persona.id, { isActive: !persona.isActive });
      setPersonas((prev) => prev.map((p) => (p.id === persona.id ? updated : p)));
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to update', 'error');
    }
  }

  function handleEditorDone() {
    setShowEditor(false);
    setEditingId(null);
    load();
  }

  const editingPersona = editingId ? personas.find((p) => p.id === editingId) : undefined;

  if (loading) {
    return (
      <PageWrapper>
        <div className="max-w-3xl mx-auto py-8 px-4 space-y-4">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-48 rounded-lg" />
            ))}
          </div>
        </div>
      </PageWrapper>
    );
  }

  if (showEditor || editingId) {
    return (
      <PageWrapper>
        <div className="max-w-2xl mx-auto py-8 px-4">
          <PersonaEditor
            persona={editingPersona}
            onDone={handleEditorDone}
            onCancel={() => { setShowEditor(false); setEditingId(null); }}
          />
        </div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">Custom Personas</h1>
            <p className="text-text-secondary text-sm mt-0.5">
              {personas.length}/3 personas created
            </p>
          </div>
          {personas.length < 3 && (
            <Button variant="primary" onClick={() => setShowEditor(true)}>
              Create Persona
            </Button>
          )}
        </div>

        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {personas.length === 0 ? (
          <EmptyState
            variant="no-data"
            title="No custom personas yet"
            description="Create custom personas to add unique perspectives to your decision analysis"
            action={{ label: 'Create Your First Persona', onClick: () => setShowEditor(true) }}
          />
        ) : (
          <motion.div {...staggerContainer} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {personas.map((persona) => (
              <motion.div key={persona.id} {...staggerItem}>
                <Card className="p-5">
                  {/* Icon + Header */}
                  {persona.icon && (
                    <span className="text-3xl block mb-2">{persona.icon}</span>
                  )}
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-lg text-text-primary">{persona.name}</h3>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant={persona.modelTier === 'sonnet' ? 'accent' : 'default'}>
                      {persona.modelTier}
                    </Badge>
                    {!persona.isActive && (
                      <Badge variant="warning">Inactive</Badge>
                    )}
                  </div>
                  {persona.description && (
                    <p className="text-text-secondary text-sm line-clamp-3 mb-3">{persona.description}</p>
                  )}

                  {/* Active toggle */}
                  <div className="flex items-center gap-3 mb-3">
                    <button
                      onClick={() => handleToggleActive(persona)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        persona.isActive ? 'bg-success' : 'bg-bg-hover'
                      }`}
                    >
                      <motion.span
                        layout
                        className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm"
                        style={{ marginLeft: persona.isActive ? 18 : 3 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      />
                    </button>
                    <span className="text-xs text-text-secondary">
                      {persona.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(persona.id)}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(persona.id)}>
                      <span className="text-danger">Delete</span>
                    </Button>
                  </div>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        )}

        {personas.length >= 3 && (
          <p className="text-text-tertiary text-xs text-center">
            Maximum of 3 custom personas reached. Delete one to create a new one.
          </p>
        )}
      </div>
    </PageWrapper>
  );
}
