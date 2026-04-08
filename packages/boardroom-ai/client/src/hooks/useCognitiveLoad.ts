import { useMemo } from 'react';
import { useEntitiesStore } from '../stores/entities.store';
import { COGNITIVE_LOAD, isOverdue } from '@boardroom/shared';

export interface CognitiveLoadWarning {
  type: 'overloaded' | 'too_many_overdue' | 'deadline_cluster';
  message: string;
  severity: 'warning' | 'critical';
}

export function useCognitiveLoad(): CognitiveLoadWarning[] {
  const tasks = useEntitiesStore((s) => s.tasks);
  const commitments = useEntitiesStore((s) => s.commitments);

  return useMemo(() => {
  const warnings: CognitiveLoadWarning[] = [];

  // Active tasks check
  const activeTasks = tasks.filter(t => t.status !== 'done');
  if (activeTasks.length > COGNITIVE_LOAD.maxActiveTasksBeforeWarning) {
    warnings.push({
      type: 'overloaded',
      message: `You have ${activeTasks.length} active tasks. Consider deferring or delegating.`,
      severity: activeTasks.length > COGNITIVE_LOAD.maxActiveTasksBeforeWarning * 1.5 ? 'critical' : 'warning',
    });
  }

  // Overdue check
  const overdueTasks = activeTasks.filter(t => t.deadline && isOverdue(new Date(t.deadline)));
  const overdueCommitments = commitments.filter(
    c => c.deadline && c.status === 'OPEN' && isOverdue(new Date(c.deadline))
  );
  const totalOverdue = overdueTasks.length + overdueCommitments.length;
  if (totalOverdue > COGNITIVE_LOAD.maxOverdueBeforeAlert) {
    warnings.push({
      type: 'too_many_overdue',
      message: `${totalOverdue} items are overdue. Address or reschedule them.`,
      severity: 'critical',
    });
  }

  // Deadline cluster check (deadlines this week)
  const now = new Date();
  const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const thisWeekDeadlines = activeTasks.filter(t => {
    if (!t.deadline) return false;
    const d = new Date(t.deadline);
    return d >= now && d <= weekEnd;
  });
  if (thisWeekDeadlines.length > COGNITIVE_LOAD.maxDeadlinesThisWeekBeforeWarning) {
    warnings.push({
      type: 'deadline_cluster',
      message: `${thisWeekDeadlines.length} deadlines this week. Consider spreading them out.`,
      severity: 'warning',
    });
  }

  return warnings;
  }, [tasks, commitments]);
}
