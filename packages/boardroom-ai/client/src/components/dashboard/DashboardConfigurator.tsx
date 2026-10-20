import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { WidgetConfig, WidgetType } from '@boardroom/shared';
import { WIDGET_LABELS } from '@boardroom/shared';
import { Modal } from '../shared/Modal';
import { Button, Select, Switch } from '../ui';
import { cn } from '../../lib/cn';

interface DashboardConfiguratorProps {
  widgets: WidgetConfig[];
  onSave: (widgets: WidgetConfig[]) => Promise<void>;
  onReset: () => Promise<void>;
  onClose: () => void;
}

const SIZE_OPTIONS: { value: WidgetConfig['size']; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
  { value: 'full', label: 'Full width' },
];

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

  // On failure useWidgetLayout has already reverted + toasted (C-117);
  // we just keep the modal open so the user can retry.
  async function handleSave() {
    setSaving(true);
    try {
      const reindexed = draft.map((w, i) => ({ ...w, position: i }));
      await onSave(reindexed);
      onClose();
    } catch {
      /* reverted + toasted upstream */
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    try {
      await onReset();
      onClose();
    } catch {
      /* reverted + toasted upstream */
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Customize Dashboard"
      description="Show, size and order the widgets on your dashboard."
    >
      <ul className="max-h-96 space-y-1 overflow-y-auto -mx-2 px-2" data-testid="dashboard-configurator-list">
        {draft.map((widget, index) => {
          const label = WIDGET_LABELS[widget.type as WidgetType] ?? widget.type;
          const labelId = `widget-${widget.id}-label`;
          return (
            <li
              key={widget.id}
              className={cn(
                'flex items-center gap-3 rounded-control px-2 py-1.5',
                'transition-[background-color] duration-fast ease-out hover:bg-muted/60',
              )}
            >
              {/* Visibility */}
              <Switch
                size="sm"
                checked={widget.visible}
                onChange={() => toggleVisibility(widget.id)}
                aria-labelledby={labelId}
              />

              {/* Widget name */}
              <span
                id={labelId}
                className={cn('flex-1 truncate text-sm transition-colors duration-fast ease-out', widget.visible ? 'text-foreground' : 'text-muted-foreground')}
              >
                {label}
              </span>

              {/* Size */}
              <Select
                size="sm"
                className="w-28"
                aria-label={`${label} size`}
                options={SIZE_OPTIONS}
                value={widget.size}
                onChange={(v) => changeSize(widget.id, v as WidgetConfig['size'])}
              />

              {/* Reorder — two 32 px icon buttons */}
              <span className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => moveUp(index)}
                  disabled={index === 0}
                  aria-label={`Move ${label} up`}
                >
                  <ChevronUp size={16} strokeWidth={1.75} aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => moveDown(index)}
                  disabled={index === draft.length - 1}
                  aria-label={`Move ${label} down`}
                >
                  <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
                </Button>
              </span>
            </li>
          );
        })}
      </ul>

      {/* Actions */}
      <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
        <Button variant="ghost" size="sm" onClick={handleReset} disabled={saving}>
          Reset to default
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} loading={saving}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
