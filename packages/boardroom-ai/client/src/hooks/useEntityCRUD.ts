import { useCallback } from 'react';
import { useEntitiesStore } from '../stores/entities.store';

type EntityType = 'goals' | 'projects' | 'tasks' | 'people';

export function useEntityCRUD(entityType: EntityType) {
  const store = useEntitiesStore();

  const items = store[entityType];
  const isLoading = store.isLoading;

  const fetchMap = {
    goals: store.fetchGoals,
    projects: store.fetchProjects,
    tasks: store.fetchTasks,
    people: store.fetchPeople,
  } as const;

  const createMap = {
    goals: store.createGoal,
    projects: store.createProject,
    tasks: store.createTask,
    people: store.createPerson,
  } as const;

  const updateMap = {
    goals: store.updateGoal,
    projects: store.updateProject,
    tasks: store.updateTask,
    people: store.updatePerson,
  } as const;

  const deleteMap = {
    goals: store.deleteGoal,
    projects: store.deleteProject,
    tasks: store.deleteTask,
    people: store.deletePerson,
  } as const;

  const fetch = useCallback(() => fetchMap[entityType](), [entityType]);
  const create = useCallback(
    (input: Record<string, unknown>) => createMap[entityType](input),
    [entityType],
  );
  const update = useCallback(
    (id: string, input: Record<string, unknown>) =>
      updateMap[entityType](id, input),
    [entityType],
  );
  const remove = useCallback(
    (id: string) => deleteMap[entityType](id),
    [entityType],
  );

  return { items, isLoading, fetch, create, update, remove };
}
