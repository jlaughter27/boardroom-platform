import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Task } from '@boardroom/shared';
import { useEntitiesStore } from '../../../src/stores/entities.store';
import { TaskNode } from '../../../src/components/dashboard/TaskNode';

/** RD-12 — Entry B: an always-visible Delegate button on every open task. */

vi.mock('../../../src/lib/api', () => ({ createCommitment: vi.fn(), createPerson: vi.fn() }));

const task = (status: string): Task => ({ id: 't1', title: 'Fix the projector', status, deadline: null, priority: 1, owner: null } as unknown as Task);

beforeEach(() => {
  useEntitiesStore.setState({ people: [{ id: 'p1', name: 'Sam Rivera', role: null, domains: [] }] as never, fetchPeople: vi.fn(async () => {}) });
});

describe('TaskNode — Delegate', () => {
  it('one click opens the dialog with What = the task title', () => {
    render(<TaskNode task={task('pending')} project={{ id: 'pr1', title: 'Harvest fair' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delegate: Fix the projector' }));
    expect(screen.getByTestId('delegate-dialog')).toBeInTheDocument();
    expect((screen.getByLabelText('What') as HTMLInputElement).value).toBe('Fix the projector');
    expect(screen.getByText('Part of Harvest fair')).toBeInTheDocument();
  });

  it('is hidden on a done task', () => {
    render(<TaskNode task={task('done')} />);
    expect(screen.queryByRole('button', { name: /^Delegate:/ })).toBeNull();
  });
});
