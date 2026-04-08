import { useState } from 'react';
import { createCustomPersona, updateCustomPersona } from '../../lib/api';
import { ErrorBanner } from '../shared/ErrorBanner';
import type { CustomPersona } from '@boardroom/shared';

const AVAILABLE_TOOLS = [
  { name: 'web_search', label: 'Web Search' },
  { name: 'calendar_lookup', label: 'Calendar Lookup' },
  { name: 'memory_search', label: 'Memory Search' },
];

interface PersonaEditorProps {
  persona?: CustomPersona;
  onDone: () => void;
  onCancel: () => void;
}

export function PersonaEditor({ persona, onDone, onCancel }: PersonaEditorProps) {
  const isEditing = !!persona;

  const [name, setName] = useState(persona?.name ?? '');
  const [description, setDescription] = useState(persona?.description ?? '');
  const [systemPrompt, setSystemPrompt] = useState(persona?.systemPrompt ?? '');
  const [modelTier, setModelTier] = useState<'haiku' | 'sonnet'>(
    (persona?.modelTier as 'haiku' | 'sonnet') ?? 'haiku'
  );
  const [maxOutputTokens, setMaxOutputTokens] = useState(persona?.maxOutputTokens ?? 1500);
  const [toolPermissions, setToolPermissions] = useState<string[]>(persona?.toolPermissions ?? []);
  const [icon, setIcon] = useState(persona?.icon ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleTool(toolName: string) {
    setToolPermissions(prev =>
      prev.includes(toolName)
        ? prev.filter(t => t !== toolName)
        : [...prev, toolName]
    );
  }

  async function handleSave() {
    setError(null);

    // Client-side validation
    if (name.length < 2 || name.length > 50) {
      setError('Name must be between 2 and 50 characters.');
      return;
    }
    if (systemPrompt.length < 50 || systemPrompt.length > 5000) {
      setError('System prompt must be between 50 and 5000 characters.');
      return;
    }

    setSaving(true);
    try {
      if (isEditing && persona) {
        await updateCustomPersona(persona.id, {
          name,
          description: description || undefined,
          systemPrompt,
          modelTier,
          maxOutputTokens,
          toolPermissions,
          icon: icon || undefined,
        });
      } else {
        await createCustomPersona({
          name,
          description: description || undefined,
          systemPrompt,
          modelTier,
          maxOutputTokens,
          toolPermissions,
          icon: icon || undefined,
        });
      }
      onDone();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save persona';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-text-primary">
          {isEditing ? 'Edit Persona' : 'Create Persona'}
        </h2>
        <button
          onClick={onCancel}
          className="text-text-secondary hover:text-text-primary text-sm"
        >
          Cancel
        </button>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="bg-bg-surface rounded-lg border border-line-subtle p-6 space-y-5">
        {/* Name */}
        <div>
          <label className="block text-sm text-text-secondary mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. The Strategist"
            maxLength={50}
            className="w-full bg-bg-elevated border border-line rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
          />
          <p className="text-xs text-text-tertiary mt-1">2-50 characters</p>
        </div>

        {/* Icon */}
        <div>
          <label className="block text-sm text-text-secondary mb-1">Icon (optional emoji)</label>
          <input
            type="text"
            value={icon}
            onChange={e => setIcon(e.target.value)}
            placeholder="e.g. \uD83E\uDDE0"
            maxLength={10}
            className="w-24 bg-bg-elevated border border-line rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm text-text-secondary mb-1">Description (optional)</label>
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="A brief description of this persona's perspective"
            maxLength={200}
            className="w-full bg-bg-elevated border border-line rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
          />
        </div>

        {/* System Prompt */}
        <div>
          <label className="block text-sm text-text-secondary mb-1">System Prompt</label>
          <textarea
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            rows={8}
            maxLength={5000}
            placeholder="You are [persona name], a [role/perspective]. When analyzing decisions, you focus on [specific lens]..."
            className="w-full bg-bg-elevated border border-line rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent resize-y font-mono"
          />
          <div className="flex justify-between mt-1">
            <p className="text-xs text-text-tertiary">
              Define the persona's perspective, expertise, and analysis style. Min 50 characters.
            </p>
            <span className={`text-xs ${systemPrompt.length < 50 ? 'text-danger' : 'text-text-tertiary'}`}>
              {systemPrompt.length}/5000
            </span>
          </div>
        </div>

        {/* Model Tier */}
        <div>
          <label className="block text-sm text-text-secondary mb-2">Model Tier</label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setModelTier('haiku')}
              className={`flex-1 px-4 py-3 rounded-lg border text-sm transition-colors ${
                modelTier === 'haiku'
                  ? 'border-accent bg-blue-900/20 text-text-primary'
                  : 'border-line bg-bg-elevated text-text-secondary hover:bg-bg-hover'
              }`}
            >
              <div className="font-medium">Haiku</div>
              <div className="text-xs text-text-tertiary mt-1">Fast, cost-effective</div>
            </button>
            <button
              type="button"
              onClick={() => setModelTier('sonnet')}
              className={`flex-1 px-4 py-3 rounded-lg border text-sm transition-colors ${
                modelTier === 'sonnet'
                  ? 'border-accent bg-blue-900/20 text-text-primary'
                  : 'border-line bg-bg-elevated text-text-secondary hover:bg-bg-hover'
              }`}
            >
              <div className="font-medium">Sonnet</div>
              <div className="text-xs text-yellow-500 mt-1">Costs 3x more</div>
            </button>
          </div>
        </div>

        {/* Max Output Tokens */}
        <div>
          <label className="block text-sm text-text-secondary mb-1">
            Max Output Tokens: {maxOutputTokens}
          </label>
          <input
            type="range"
            min={500}
            max={3000}
            step={100}
            value={maxOutputTokens}
            onChange={e => setMaxOutputTokens(parseInt(e.target.value, 10))}
            className="w-full accent-blue-500"
          />
          <div className="flex justify-between text-xs text-text-tertiary">
            <span>500</span>
            <span>3000</span>
          </div>
        </div>

        {/* Tool Permissions */}
        <div>
          <label className="block text-sm text-text-secondary mb-2">Tool Permissions</label>
          <div className="space-y-2">
            {AVAILABLE_TOOLS.map(tool => (
              <label
                key={tool.name}
                className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={toolPermissions.includes(tool.name)}
                  onChange={() => toggleTool(tool.name)}
                  className="accent-blue-500"
                />
                {tool.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-text-tertiary mt-1">
            Select which tools this persona can use during analysis.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2.5 bg-accent hover:bg-accent disabled:opacity-50 text-text-primary text-sm font-medium rounded-lg transition-colors"
          >
            {saving ? 'Saving...' : isEditing ? 'Update Persona' : 'Create Persona'}
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2.5 bg-bg-elevated hover:bg-bg-hover text-text-secondary text-sm rounded-lg transition-colors border border-line"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
