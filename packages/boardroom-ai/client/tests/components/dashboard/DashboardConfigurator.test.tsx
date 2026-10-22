import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { WidgetConfig } from '@boardroom/shared';
import { DashboardConfigurator } from '../../../src/components/dashboard/DashboardConfigurator';

const widgets: WidgetConfig[] = [
  { id: 'w1', type: 'cognitive_load', position: 0, size: 'full', visible: true },
  { id: 'w2', type: 'weekly_memo', position: 1, size: 'medium', visible: false },
] as WidgetConfig[];

describe('DashboardConfigurator', () => {
  it('uses a switch, a select and two labelled icon buttons per widget', () => {
    render(<DashboardConfigurator widgets={widgets} onSave={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />);
    const rows = within(screen.getByTestId('dashboard-configurator-list')).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(within(rows[1]).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(within(rows[0]).getByRole('combobox')).toHaveTextContent('Full width');
    expect(within(rows[0]).getByRole('button', { name: /move .* up/i })).toBeDisabled();
    expect(within(rows[0]).getByRole('button', { name: /move .* down/i })).toBeEnabled();
    expect(within(rows[1]).getByRole('button', { name: /move .* down/i })).toBeDisabled();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(document.querySelector('select')).toBeNull();
  });

  it('reorders with the icon buttons and saves re-indexed positions', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<DashboardConfigurator widgets={widgets} onSave={onSave} onReset={vi.fn()} onClose={vi.fn()} />);
    const rows = within(screen.getByTestId('dashboard-configurator-list')).getAllByRole('listitem');
    fireEvent.click(within(rows[0]).getByRole('button', { name: /move .* down/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0][0] as WidgetConfig[];
    expect(saved.map((w) => w.id)).toEqual(['w2', 'w1']);
    expect(saved.map((w) => w.position)).toEqual([0, 1]);
  });
});
