import { create } from 'zustand';
import * as api from '../lib/api';
import type { GoalInput, ProjectInput, TaskInput, PersonInput } from '../lib/api';
import type {
  Goal,
  Project,
  Task,
  Person,
  Decision,
  Commitment,
} from '@boardroom/shared';
import { useToastStore } from '../components/ui/Toast';

interface EntitiesState {
  goals: Goal[];
  projects: Project[];
  tasks: Task[];
  people: Person[];
  decisions: Decision[];
  commitments: Commitment[];
  isLoading: boolean;
  error: string | null;

  clearError: () => void;

  fetchGoals: () => Promise<void>;
  fetchProjects: () => Promise<void>;
  fetchTasks: () => Promise<void>;
  fetchPeople: () => Promise<void>;
  fetchDecisions: () => Promise<void>;
  fetchCommitments: () => Promise<void>;
  fetchAll: () => Promise<void>;

  createGoal: (input: Partial<GoalInput>) => Promise<void>;
  updateGoal: (id: string, input: Partial<GoalInput>) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;

  createProject: (input: Partial<ProjectInput>) => Promise<void>;
  updateProject: (id: string, input: Partial<ProjectInput>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;

  createTask: (input: Partial<TaskInput>) => Promise<void>;
  updateTask: (id: string, input: Partial<TaskInput>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;

  createPerson: (input: Partial<PersonInput>) => Promise<void>;
  updatePerson: (id: string, input: Partial<PersonInput>) => Promise<void>;
  deletePerson: (id: string) => Promise<void>;
}

export const useEntitiesStore = create<EntitiesState>((set, get) => ({
  goals: [],
  projects: [],
  tasks: [],
  people: [],
  decisions: [],
  commitments: [],
  isLoading: false,
  error: null,

  clearError: () => set({ error: null }),

  fetchGoals: async () => {
    try {
      const goals = await api.getGoals();
      set({ goals, error: null });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  fetchProjects: async () => {
    try {
      const projects = await api.getProjects();
      set({ projects, error: null });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  fetchTasks: async () => {
    try {
      const tasks = await api.getTasks();
      set({ tasks, error: null });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  fetchPeople: async () => {
    try {
      const people = await api.getPeople();
      set({ people, error: null });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  fetchDecisions: async () => {
    try {
      const decisions = await api.getDecisions();
      set({ decisions, error: null });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  fetchCommitments: async () => {
    try {
      const commitments = await api.getCommitments();
      set({ commitments, error: null });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  fetchAll: async () => {
    set({ isLoading: true, error: null });
    try {
      await Promise.all([
        get().fetchGoals(),
        get().fetchProjects(),
        get().fetchTasks(),
        get().fetchPeople(),
        get().fetchDecisions(),
        get().fetchCommitments(),
      ]);
    } finally {
      set({ isLoading: false });
    }
  },

  // Goal mutations
  createGoal: async (input) => {
    const toast = useToastStore.getState().addToast;
    try {
      await api.createGoal(input);
      await get().fetchGoals();
      toast('Goal created', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
      set({ error: (err as Error).message });
    }
  },
  updateGoal: async (id, input) => {
    const toast = useToastStore.getState().addToast;
    try {
      await api.updateGoal(id, input);
      await get().fetchGoals();
      toast('Goal updated', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
      set({ error: (err as Error).message });
    }
  },
  deleteGoal: async (id) => {
    const toast = useToastStore.getState().addToast;
    try {
      await api.deleteGoal(id);
      await get().fetchGoals();
      toast('Goal deleted', 'info');
    } catch (err) {
      toast((err as Error).message, 'error');
      set({ error: (err as Error).message });
    }
  },

  // Project mutations
  createProject: async (input) => {
    const toast = useToastStore.getState().addToast;
    try {
      await api.createProject(input);
      await get().fetchProjects();
      toast('Project created', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
      set({ error: (err as Error).message });
    }
  },
  updateProject: async (id, input) => {
    const toast = useToastStore.getState().addToast;
    try {
      await api.updateProject(id, input);
      await get().fetchProjects();
      toast('Project updated', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
      set({ error: (err as Error).message });
    }
  },
  deleteProject: async (id) => {
    const toast = useToastStore.getState().addToast;
    try {
      await api.deleteProject(id);
      await get().fetchProjects();
      toast('Project deleted', 'info');
    } catch (err) {
      toast((err as Error).message, 'error');
      set({ error: (err as Error).message });
    }
  },

  // Task mutations
  createTask: async (input) => {
    const toast = useToastStore.getState().addToast;
    try {
      await api.createTask(input);
      await get().fetchTasks();
      toast('Task created', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
      set({ error: (err as Error).message });
    }
  },
  updateTask: async (id, input) => {
    const toast = useToastStore.getState().addToast;
    try {
      await api.updateTask(id, input);
      await get().fetchTasks();
      toast('Task updated', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
      set({ error: (err as Error).message });
    }
  },
  deleteTask: async (id) => {
    const toast = useToastStore.getState().addToast;
    try {
      await api.deleteTask(id);
      await get().fetchTasks();
      toast('Task deleted', 'info');
    } catch (err) {
      toast((err as Error).message, 'error');
      set({ error: (err as Error).message });
    }
  },

  // Person mutations
  createPerson: async (input) => {
    const toast = useToastStore.getState().addToast;
    try {
      await api.createPerson(input);
      await get().fetchPeople();
      toast('Person added', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
      set({ error: (err as Error).message });
    }
  },
  updatePerson: async (id, input) => {
    const toast = useToastStore.getState().addToast;
    try {
      await api.updatePerson(id, input);
      await get().fetchPeople();
      toast('Person updated', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
      set({ error: (err as Error).message });
    }
  },
  deletePerson: async (id) => {
    const toast = useToastStore.getState().addToast;
    try {
      await api.deletePerson(id);
      await get().fetchPeople();
      toast('Person removed', 'info');
    } catch (err) {
      toast((err as Error).message, 'error');
      set({ error: (err as Error).message });
    }
  },
}));
