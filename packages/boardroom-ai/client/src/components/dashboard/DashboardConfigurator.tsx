import { useState } from 'react';
import type { WidgetConfig, WidgetType } from '@boardroom/shared';
import { WIDGET_LABELS } from '@boardroom/shared';
import { Modal } from '../shared/Modal';

interface DashboardConfiguratorProps {
  widgets: WidgetConfig[];
  onSave: (widgets: WidgetConfig[]) => Promise<void>;
  onReset: () => Promise<void>;
  onClose: () => void;
}

const SIZE_OPTIONS: WidgetConfig['size'][] = ['small', 'medium', 'large', 'full'];

export function DashboardConfigurator({
  widgets,
  onSave,
  onReset,
  onClose,
}: DashboardConfiguratorProps) {
  const [draft, setDraft] = useState<WidgetConfig[]>(
    [...widgets].sort((a, b) => a.position - b.position),
  );
  const [saving, setSaving] = useState(false);

  function toggleVisibility(id: string) {
    setDraft((prev) =>
      prev.map((w) => (w.id === id ? { ...w, visible: !w.visible } : w)),
    );
  }

  function changeSize(id: string, size: WidgetConfig['size']) {
    setDraft((prev) =>
      prev.map((w) => (w.id === id ? { ...w, size } : w)),
    );
  }

  function moveUp(index: number) {
    if (index === 0) return;
    setDraft((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next.map((w, i) => ({ ...w, position: i }));
    });
  }

  function moveDown(index: number) {
    setDraft((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next.map((w, i) => ({ ...w, position: i }));
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const reindexed = draft.map((w, i) => ({ ...w, position: i }));
      await onSave(reindexed);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    try {
      await onReset();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title="Customize Dashboard">
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {draft.map((widget, index) => (
          <div
            key={widget.id}
            className="flex items-center gap-3 bg-gray-800/50 rounded-lg px-3 py-2"
          >
            {/* Visibility toggle */}
            <input
              type="checkbox"
              checked={widget.visible}
              onChange={() => toggleVisibility(widget.id)}
              className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
            />

            {/* Widget name */}
            <span className="flex-1 text-sm text-white truncate">
              {WIDGET_LABELS[widget.type as WidgetType] ?? widget.type}
            </span>

            {/* Size selector */}
            <select
              value={widget.size}
              onChange={(e) =>
                changeSize(widget.id, e.target.value as WidgetConfig['size'])
              }
              className="bg-gray-700 border border-gray-600 text-gray-300 text-xs rounded px-2 py-1 focus:outline-none focus:border-blue-500"
            >
              {SIZE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            {/* Reorder buttons */}
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => moveUp(index)}
                disabled={index === 0}
                className="text-gray-400 hover:text-white disabled:text-gray-600 text-xs leading-none"
                aria-label="Move up"
              >
                &#9650;
              </button>
              <button
                onClick={() => moveDown(index)}
                disabled={index === draft.length - 1}
                className="text-gray-400 hover:text-white disabled:text-gray-600 text-xs leading-none"
                aria-label="Move down"
              >
                &#9660;
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-800">
        <button
          onClick={handleReset}
          disabled={saving}
          className="text-sm text-gray-400 hover:text-white disabled:text-gray-600"
        >
          Reset to Default
        </button>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white rounded-lg transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
