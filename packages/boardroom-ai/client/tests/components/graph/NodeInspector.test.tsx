import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as api from '../../../src/lib/api';
import { NodeInspector } from '../../../src/components/graph/NodeInspector';
import { edge, node } from './fixtures';

vi.mock('../../../src/lib/api', () => ({
  getGraphBacklinks: vi.fn(),
  getPeople: vi.fn().mockResolvedValue([]),
  getDecisions: vi.fn().mockResolvedValue([]),
  getTasks: vi.fn().mockResolvedValue([]),
  addProjectPerson: vi.fn(),
  linkProjectDecision: vi.fn(),
  addTaskDependency: vi.fn(),
}));

const project = node('project:p', { label: 'Pricing revamp', domain: 'business', status: 'active' });
const goal = node('goal:g', { label: 'Grow ARR' });
const person = node('person:x', { label: 'Ada' });
const mem = node('memory:m', { label: 'Call notes' });
const nodesById = new Map([project, goal, person, mem].map((n) => [n.id, n]));
const edges = [
  edge('goal:g', 'project:p', 'goal_project'),
  edge('project:p', 'person:x', 'project_person', 'lead'),
  edge('memory:m', 'project:p', 'memory_entity'),
];

function setup(overrides: Partial<React.ComponentProps<typeof NodeInspector>> = {}) {
  const onSelect = vi.fn();
  const onFocusLocal = vi.fn();
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <NodeInspector node={project} nodesById={nodesById} edges={edges} onSelect={onSelect} onFocusLocal={onFocusLocal} onClose={onClose} {...overrides} />
    </MemoryRouter>,
  );
  return { onSelect, onFocusLocal, onClose };
}

describe('NodeInspector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getGraphBacklinks).mockRejectedValue(new Error('offline')); // fall back to local edges
  });

  it('groups neighbours by edge type with counts by default and re-focuses on click', async () => {
    const { onSelect } = setup();
    const byEdge = await screen.findByTestId('neighbours-by-edge-type');
    expect(screen.getByTestId('edge-group-count-goal_project')).toHaveTextContent('1');
    expect(screen.getByTestId('edge-group-count-project_person')).toHaveTextContent('1');
    expect(screen.getByTestId('edge-group-count-memory_entity')).toHaveTextContent('1');
    expect(within(byEdge).getByText('lead')).toBeInTheDocument(); // role label shown as the verb
    fireEvent.click(within(byEdge).getByRole('button', { name: /Ada/ }));
    expect(onSelect).toHaveBeenCalledWith('person:x');
  });

  it('can switch to grouping by node type', async () => {
    setup();
    await screen.findByTestId('neighbours-by-edge-type');
    fireEvent.click(screen.getByRole('button', { name: 'By type' }));
    expect(screen.queryByTestId('neighbours-by-edge-type')).not.toBeInTheDocument();
    expect(screen.getByText('Goals')).toBeInTheDocument();
    expect(screen.getByText('People')).toBeInTheDocument();
    expect(screen.getByText('Memories')).toBeInTheDocument();
  });

  it('prefers /graph/backlinks when it answers (includes nodes beyond the loaded graph)', async () => {
    vi.mocked(api.getGraphBacklinks).mockResolvedValue({
      node: project,
      backlinks: [
        { node: goal, edge: edges[0] },
        { node: node('memory:far', { label: 'Far memory' }), edge: edge('memory:far', 'project:p', 'memory_entity') },
      ],
    });
    setup();
    await waitFor(() => expect(screen.getByText('Far memory')).toBeInTheDocument());
    expect(screen.getByTestId('edge-group-count-memory_entity')).toHaveTextContent('1');
    expect(screen.queryByTestId('edge-group-count-project_person')).not.toBeInTheDocument();
  });

  it('header shows type, label, metadata and the focus / close actions work', async () => {
    const { onFocusLocal, onClose } = setup();
    expect(screen.getByRole('heading', { name: 'Pricing revamp' })).toBeInTheDocument();
    expect(screen.getByText('business')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Focus local graph' }));
    expect(onFocusLocal).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(onClose).toHaveBeenCalled();
    await screen.findByTestId('neighbours-by-edge-type');
  });

  it('shows the empty copy for a node without links', async () => {
    setup({ node: node('goal:alone', { label: 'Alone' }), edges: [] });
    await waitFor(() => expect(screen.getByText(/Nothing links here yet/)).toBeInTheDocument());
  });
});
