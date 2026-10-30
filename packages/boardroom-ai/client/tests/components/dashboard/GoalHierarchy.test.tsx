import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Goal, Project, Task } from '@boardroom/shared';
import { buildGoalTree, GoalHierarchy } from '../../../src/components/dashboard/GoalHierarchy';
import { useEntitiesStore } from '../../../src/stores/entities.store';
import * as api from '../../../src/lib/api';

/**
 * The Goals & Projects tree used to give every project the full task list and
 * to group projects under goals by matching `domain`. It now follows the real
 * links (GoalProjectLink → `goalIds`, ProjectTaskLink → `taskIds` from
 * GET /projects?include=links). Invented data only.
 */

vi.mock('../../../src/lib/api', () => ({
  getGoals: vi.fn(),
  getProjects: vi.fn(),
  getTasks: vi.fn(),
}));

const at = new Date('2026-10-01T00:00:00Z');
const goal = (id: string, domain = 'business'): Goal =>
  ({ id, userId: 'u1', title: `Goal ${id}`, level: 1, parentGoalId: null, successMetrics: [], deadline: null, status: 'active', domain, version: 1, createdAt: at, updatedAt: at }) as unknown as Goal;
const project = (id: string, goalIds: string[] | undefined, taskIds: string[] | undefined, domain = 'business') =>
  ({ id, userId: 'u1', title: `Project ${id}`, status: 'active', deadline: null, successMetrics: [], domain, version: 1, createdAt: at, updatedAt: at, ...(goalIds ? { goalIds } : {}), ...(taskIds ? { taskIds } : {}) }) as Project & { goalIds?: string[]; taskIds?: string[] };
const task = (id: string): Task =>
  ({ id, userId: 'u1', title: `Task ${id}`, owner: null, status: 'todo', deadline: null, priority: 2, estimatedEffort: null, actualEffort: null, version: 1, createdAt: at, updatedAt: at }) as unknown as Task;

describe('buildGoalTree', () => {
  const goals = [goal('g1'), goal('g2')];
  const tasks = [task('t1'), task('t2'), task('t3')];

  it('a project lists only its own linked tasks', () => {
    const { tasksByProject } = buildGoalTree(goals, [project('p1', ['g1'], ['t1', 't2']), project('p2', ['g1'], ['t3'])], tasks);
    expect(tasksByProject.p1.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(tasksByProject.p2.map((t) => t.id)).toEqual(['t3']);
  });

  it('a project appears only under the goals it is linked to — never by shared domain', () => {
    const { projectsByGoal } = buildGoalTree(goals, [project('p1', ['g1'], []), project('p2', ['g1', 'g2'], []), project('p3', [], [])], tasks);
    expect(projectsByGoal.g1.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(projectsByGoal.g2.map((p) => p.id)).toEqual(['p2']);
    expect(Object.values(projectsByGoal).flat().map((p) => p.id)).not.toContain('p3');
  });

  it('missing link ids (e.g. a project row without include=links) mean no links, not "everything"', () => {
    const { projectsByGoal, tasksByProject } = buildGoalTree(goals, [project('p1', undefined, undefined)], tasks);
    expect(projectsByGoal.g1).toEqual([]);
    expect(tasksByProject.p1).toEqual([]);
  });

  it('ignores ids of goals / tasks that are not loaded (deleted or filtered)', () => {
    const { projectsByGoal, tasksByProject } = buildGoalTree(goals, [project('p1', ['g-gone', 'g2'], ['t-gone', 't3'])], tasks);
    expect(projectsByGoal.g2.map((p) => p.id)).toEqual(['p1']);
    expect(tasksByProject.p1.map((t) => t.id)).toEqual(['t3']);
  });
});

describe('GoalHierarchy', () => {
  beforeEach(() => {
    // Both goals and both projects share the domain "business": the old tree put p2 under g1 too.
    const goals = [goal('g1'), goal('g2')];
    const projects = [project('p1', ['g1'], ['t1']), project('p2', ['g2'], ['t2'])] as never;
    const tasks = [task('t1'), task('t2')];
    vi.mocked(api.getGoals).mockResolvedValue(goals);
    vi.mocked(api.getProjects).mockResolvedValue(projects);
    vi.mocked(api.getTasks).mockResolvedValue(tasks);
    useEntitiesStore.setState({ goals, projects, tasks, isLoading: false });
  });

  it('expanding a goal shows only its linked project, and that project only its own task', async () => {
    render(<GoalHierarchy />);
    const goalRow = screen.getByText('Goal g1').closest('[class*="border-l-2"]') as HTMLElement;
    fireEvent.click(goalRow.querySelector('button')!);
    expect(await screen.findByText('Project p1')).toBeInTheDocument();
    expect(screen.queryByText('Project p2')).toBeNull();
  });

  // Lane I · item 3 — the goal / project chevrons were unnamed icon buttons.
  it('goal and project chevrons are named "Expand/Collapse <title>" and carry aria-expanded', async () => {
    render(<GoalHierarchy />);
    const goalToggle = screen.getByRole('button', { name: 'Expand Goal g1' });
    expect(goalToggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(goalToggle);
    expect(screen.getByRole('button', { name: 'Collapse Goal g1' })).toHaveAttribute('aria-expanded', 'true');
    const projectToggle = await screen.findByRole('button', { name: 'Expand Project p1' });
    expect(projectToggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(projectToggle);
    expect(screen.getByRole('button', { name: 'Collapse Project p1' })).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('Task t1')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Lane I · item 2 — projects linked to no goal (and tasks linked to no project)
// were in no branch of the tree, so they could not be seen from the dashboard.
// They now sit in "Unassigned" groups at the end, shown only when non-empty.
// ─────────────────────────────────────────────────────────────────────────────

describe('buildGoalTree — unassigned', () => {
  const goals = [goal('g1')];
  const tasks = [task('t1'), task('t2'), task('t3')];

  it('collects projects linked to no loaded goal, in input order', () => {
    const { unassignedProjects } = buildGoalTree(goals, [project('p1', ['g1'], []), project('p2', [], []), project('p3', undefined, undefined), project('p4', ['g-gone'], [])], tasks);
    expect(unassignedProjects.map((p) => p.id)).toEqual(['p2', 'p3', 'p4']);
  });

  it('collects tasks linked to no loaded project', () => {
    const { unassignedTasks } = buildGoalTree(goals, [project('p1', ['g1'], ['t1']), project('p2', [], ['t2'])], tasks);
    // t2 belongs to an unassigned project — it is reachable through it, so it is not "unassigned".
    expect(unassignedTasks.map((t) => t.id)).toEqual(['t3']);
  });

  it('empty when everything is linked', () => {
    const { unassignedProjects, unassignedTasks } = buildGoalTree(goals, [project('p1', ['g1'], ['t1', 't2', 't3'])], tasks);
    expect(unassignedProjects).toEqual([]);
    expect(unassignedTasks).toEqual([]);
  });
});

describe('GoalHierarchy — unassigned groups', () => {
  function seed(goals: Goal[], projects: unknown[], tasks: Task[]) {
    vi.mocked(api.getGoals).mockResolvedValue(goals);
    vi.mocked(api.getProjects).mockResolvedValue(projects as never);
    vi.mocked(api.getTasks).mockResolvedValue(tasks);
    useEntitiesStore.setState({ goals, projects: projects as never, tasks, isLoading: false });
  }

  it('renders an "Unassigned projects" group after the goals; its toggle is a keyboard-reachable button', async () => {
    seed([goal('g1')], [project('p1', ['g1'], []), project('p-loose', [], [])], []);
    render(<GoalHierarchy />);
    const toggle = screen.getByRole('button', { name: 'Expand Unassigned projects' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle.tabIndex).toBe(0);
    // After every goal row in document order.
    const goalTitle = screen.getByText('Goal g1');
    expect(goalTitle.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('1 project')).toBeInTheDocument();
    expect(screen.queryByText('Project p-loose')).toBeNull();
    fireEvent.click(toggle);
    expect(await screen.findByText('Project p-loose')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse Unassigned projects' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders an "Unassigned tasks" group for tasks in no project', async () => {
    seed([goal('g1')], [project('p1', ['g1'], ['t1'])], [task('t1'), task('t-loose')]);
    render(<GoalHierarchy />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Unassigned tasks' }));
    expect(await screen.findByText('Task t-loose')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Unassigned projects/ })).toBeNull();
  });

  it('no unassigned groups when everything is linked', () => {
    seed([goal('g1')], [project('p1', ['g1'], ['t1'])], [task('t1')]);
    render(<GoalHierarchy />);
    expect(screen.queryByText(/Unassigned/)).toBeNull();
  });

  it('no goals but loose projects: the projects are still reachable (not the "No goals yet" empty state alone)', async () => {
    seed([], [project('p-loose', [], [])], []);
    render(<GoalHierarchy />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Unassigned projects' }));
    expect(await screen.findByText('Project p-loose')).toBeInTheDocument();
  });
});
