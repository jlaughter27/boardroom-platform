import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEntitiesStore } from '../../src/stores/entities.store';
import * as api from '../../src/lib/api';

/**
 * The tree follows real links now, so a project added under a goal (or a task
 * under a project) must be linked, or it would vanish from the tree. Invented
 * data only.
 */

vi.mock('../../src/lib/api', () => ({
  createProject: vi.fn(async () => ({ id: 'p-new' })),
  createTask: vi.fn(async () => ({ id: 't-new' })),
  linkGoalProject: vi.fn(async () => ({ id: 'l1' })),
  linkProjectTask: vi.fn(async () => ({ id: 'l2' })),
  getProjects: vi.fn(async () => [{ id: 'p-new', goalIds: ['g1'], taskIds: ['t-new'] }]),
  getTasks: vi.fn(async () => [{ id: 't-new' }]),
}));
vi.mock('../../src/components/ui/Toast', () => ({ useToastStore: { getState: () => ({ addToast: vi.fn() }) } }));

beforeEach(() => vi.clearAllMocks());

describe('entities store — create under a parent links it (C-111)', () => {
  it('createProject(input, goalId) links the new project to the goal, then refetches projects', async () => {
    await useEntitiesStore.getState().createProject({ title: 'Saturday market stall' }, 'g1');
    expect(api.linkGoalProject).toHaveBeenCalledWith('g1', 'p-new');
    expect(api.getProjects).toHaveBeenCalled();
    expect(useEntitiesStore.getState().projects[0]).toMatchObject({ id: 'p-new', goalIds: ['g1'] });
  });

  it('createTask(input, projectId) links the task and refetches projects (taskIds) and tasks', async () => {
    await useEntitiesStore.getState().createTask({ title: 'Book the pitch' }, 'p-new');
    expect(api.linkProjectTask).toHaveBeenCalledWith('p-new', 't-new');
    expect(api.getProjects).toHaveBeenCalled();
    expect(api.getTasks).toHaveBeenCalled();
  });

  it('without a parent nothing is linked', async () => {
    await useEntitiesStore.getState().createProject({ title: 'Loose project' });
    await useEntitiesStore.getState().createTask({ title: 'Loose task' });
    expect(api.linkGoalProject).not.toHaveBeenCalled();
    expect(api.linkProjectTask).not.toHaveBeenCalled();
  });
});
