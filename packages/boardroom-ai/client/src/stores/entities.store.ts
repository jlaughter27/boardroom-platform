import { create } from 'zustand';
import * as api from '../lib/api';
import type {
  Goal,
  Project,
  Task,
  Person,
  Decision,
  Commitment,
} from '@boardroom/shared';

interface EntitiesState {
  goals: Goal[];
  projects: Project[];
  tasks: Task[];
  people: Person[];
  decisions: Decision[];
  commitments: Commitment[];
  isLoading: boolean;

  fetchGoals: () => Promise<void>;
  fetchProjects: () => Promise<void>;
  fetchTasks: () => Promise<void>;
  fetchPeople: () => Promise<void>;
  fetchDecisions: () => Promise<void>;
  fetchCommitments: () => Promise<void>;
  fetchAll: () => Promise<void>;

  createGoal: (input: Record<string, unknown>) => Promise<void>;
  updateGoal: (id: string, input: Record<string, unknown>) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;

  createProject: (input: Record<string, unknown>) => Promise<void>;
  updateProject: (id: string, input: Record<string, unknown>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;

  createTask: (input: Record<string, unknown>) => Promise<void>;
  updateTask: (id: string, input: Record<string, unknown>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;

  createPerson: (input: Record<string, unknown>) => Promise<void>;
  updatePerson: (id: string, input: Record<string, unknown>) => Promise<void>;
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

  fetchGoals: async () => {
    const goals = await api.getGoals();
    set({ goals });
  },

  fetchProjects: async () => {
    const projects = await api.getProjects();
    set({ projects });
  },

  fetchTasks: async () => {
    const tasks = await api.getTasks();
    set({ tasks });
  },

  fetchPeople: async () => {
    const people = await api.getPeople();
    set({ people });
  },

  fetchDecisions: async () => {
    const decisions = await api.getDecisions();
    set({ decisions });
  },

  fetchCommitments: async () => {
    const commitments = await api.getCommitments();
    set({ commitments });
  },

  fetchAll: async () => {
    set({ isLoading: true });
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
    await api.createGoal(input);
    await get().fetchGoals();
  },
  updateGoal: async (id, input) => {
    await api.updateGoal(id, input);
    await get().fetchGoals();
  },
  deleteGoal: async (id) => {
    await api.deleteGoal(id);
    await get().fetchGoals();
  },

  // Project mutations
  createProject: async (input) => {
    await api.createProject(input);
    await get().fetchProjects();
  },
  updateProject: async (id, input) => {
    await api.updateProject(id, input);
    await get().fetchProjects();
  },
  deleteProject: async (id) => {
    await api.deleteProject(id);
    await get().fetchProjects();
  },

  // Task mutations
  createTask: async (input) => {
    await api.createTask(input);
    await get().fetchTasks();
  },
  updateTask: async (id, input) => {
    await api.updateTask(id, input);
    await get().fetchTasks();
  },
  deleteTask: async (id) => {
    await api.deleteTask(id);
    await get().fetchTasks();
  },

  // Person mutations
  createPerson: async (input) => {
    await api.createPerson(input);
    await get().fetchPeople();
  },
  updatePerson: async (id, input) => {
    await api.updatePerson(id, input);
    await get().fetchPeople();
  },
  deletePerson: async (id) => {
    await api.deletePerson(id);
    await get().fetchPeople();
  },
}));
