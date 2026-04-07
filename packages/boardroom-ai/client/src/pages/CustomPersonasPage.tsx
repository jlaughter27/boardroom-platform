import { useEffect, useState } from 'react';
import { getCustomPersonas, deleteCustomPersona, updateCustomPersona } from '../lib/api';
import { PersonaEditor } from '../components/settings/PersonaEditor';
import { LoadingSpinner } from '../components/shared/LoadingSpinner';
import { ErrorBanner } from '../components/shared/ErrorBanner';
import type { CustomPersona } from '@boardroom/shared';

export default function CustomPersonasPage() {
  const [personas, setPersonas] = useState<CustomPersona[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);

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
      setPersonas(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete persona');
    }
  }

  async function handleToggleActive(persona: CustomPersona) {
    try {
      const updated = await updateCustomPersona(persona.id, { isActive: !persona.isActive });
      setPersonas(prev => prev.map(p => p.id === persona.id ? updated : p));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update persona');
    }
  }

  function handleEditorDone() {
    setShowEditor(false);
    setEditingId(null);
    load();
  }

  const editingPersona = editingId ? personas.find(p => p.id === editingId) : undefined;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (showEditor || editingId) {
    return (
      <div className="max-w-2xl mx-auto py-8 px-4">
        <PersonaEditor
          persona={editingPersona}
          onDone={handleEditorDone}
          onCancel={() => { setShowEditor(false); setEditingId(null); }}
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Custom Personas</h1>
          <p className="text-gray-500 text-sm mt-1">
            Create up to 3 custom personas that participate in decision analysis alongside built-in ones.
          </p>
        </div>
        {personas.length < 3 && (
          <button
            onClick={() => setShowEditor(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
          >
            Create Persona
          </button>
        )}
      </div>

      {error && (
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
      )}

      {personas.length === 0 ? (
        <div className="bg-gray-900 rounded-lg border border-gray-800 p-8 text-center">
          <p className="text-gray-400 text-sm mb-4">
            No custom personas yet. Create one to add a unique perspective to your boardroom.
          </p>
          <button
            onClick={() => setShowEditor(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
          >
            Create Your First Persona
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {personas.map(persona => (
            <div
              key={persona.id}
              className="bg-gray-900 rounded-lg border border-gray-800 p-5"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  {persona.icon && (
                    <span className="text-2xl">{persona.icon}</span>
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-white">{persona.name}</h3>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-800 text-gray-400 border border-gray-700">
                        {persona.modelTier}
                      </span>
                      {!persona.isActive && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-800 text-yellow-500 border border-yellow-800">
                          Inactive
                        </span>
                      )}
                    </div>
                    {persona.description && (
                      <p className="text-gray-500 text-sm mt-1">{persona.description}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-3 text-xs text-gray-600 line-clamp-2">
                {persona.systemPrompt.slice(0, 150)}...
              </div>

              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={() => handleToggleActive(persona)}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors border ${
                    persona.isActive
                      ? 'bg-green-900/30 text-green-400 border-green-800 hover:bg-green-900/50'
                      : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700'
                  }`}
                >
                  {persona.isActive ? 'Active' : 'Activate'}
                </button>
                <button
                  onClick={() => setEditingId(persona.id)}
                  className="px-3 py-1.5 rounded text-xs font-medium bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors border border-gray-700"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(persona.id)}
                  className="px-3 py-1.5 rounded text-xs font-medium bg-gray-800 text-red-400 hover:bg-red-900/30 transition-colors border border-gray-700 hover:border-red-800"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {personas.length >= 3 && (
        <p className="text-gray-600 text-xs text-center">
          Maximum of 3 custom personas reached. Delete one to create a new one.
        </p>
      )}
    </div>
  );
}
