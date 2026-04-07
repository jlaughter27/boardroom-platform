import { useMemo } from 'react';
import { useEntitiesStore } from '../stores/entities.store';
import { useUIStore } from '../stores/ui.store';
import { isOverdue } from '@boardroom/shared';

export interface ProactiveQuestion {
  id: string;
  type: 'missing_deadline' | 'missing_metrics' | 'overdue_commitment' | 'stale_project';
  message: string;
  entityId: string;
  entityType: string;
  actions: { label: string; action: string }[];
}

export function useProactiveQuestions(): ProactiveQuestion[] {
  const { goals, projects, tasks, commitments } = useEntitiesStore();
  const { dismissedQuestions } = useUIStore();

  return useMemo(() => {
    const questions: ProactiveQuestion[] = [];

    // Check projects with no deadline
    for (const project of projects) {
      if (!project.deadline && project.status === 'active') {
        questions.push({
          id: `missing-deadline-project-${project.id}`,
          type: 'missing_deadline',
          message: `Project "${project.title}" has no deadline set.`,
          entityId: project.id,
          entityType: 'project',
          actions: [
            { label: 'Set Deadline', action: 'edit' },
            { label: 'Skip', action: 'dismiss' },
          ],
        });
      }
    }

    // Check goals with empty success metrics
    for (const goal of goals) {
      if (
        (!goal.successMetrics || goal.successMetrics.length === 0) &&
        goal.status === 'active'
      ) {
        questions.push({
          id: `missing-metrics-goal-${goal.id}`,
          type: 'missing_metrics',
          message: `Goal "${goal.title}" has no success metrics defined.`,
          entityId: goal.id,
          entityType: 'goal',
          actions: [
            { label: 'Define Metrics', action: 'edit' },
            { label: 'Skip', action: 'dismiss' },
          ],
        });
      }
    }

    // Check overdue commitments
    for (const commitment of commitments) {
      if (
        commitment.deadline &&
        isOverdue(new Date(commitment.deadline)) &&
        commitment.status === 'OPEN'
      ) {
        questions.push({
          id: `overdue-commitment-${commitment.id}`,
          type: 'overdue_commitment',
          message: `Commitment "${commitment.description}" is overdue.`,
          entityId: commitment.id,
          entityType: 'commitment',
          actions: [
            { label: 'Resolve', action: 'edit' },
            { label: 'Skip', action: 'dismiss' },
          ],
        });
      }
    }

    // Check tasks with no deadline
    for (const task of tasks) {
      if (!task.deadline && task.status !== 'done') {
        questions.push({
          id: `missing-deadline-task-${task.id}`,
          type: 'missing_deadline',
          message: `Task "${task.title}" has no deadline.`,
          entityId: task.id,
          entityType: 'task',
          actions: [
            { label: 'Set Deadline', action: 'edit' },
            { label: 'Skip', action: 'dismiss' },
          ],
        });
      }
    }

    // Filter dismissed, cap at 3 (intervention budget)
    return questions.filter((q) => !dismissedQuestions.has(q.id)).slice(0, 3);
  }, [goals, projects, tasks, commitments, dismissedQuestions]);
}
