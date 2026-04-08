import { useEffect, useRef } from 'react';
import { useCortexStore } from '../stores/cortex.store';
import { useNotificationStore } from '../stores/notification.store';
import { useCognitiveLoad } from './useCognitiveLoad';
import * as api from '../lib/api';

export function useNotificationAggregator() {
  const contradictions = useCortexStore((s) => s.contradictions);
  const patterns = useCortexStore((s) => s.patterns);
  const latestMemo = useCortexStore((s) => s.latestMemo);
  const addNotification = useNotificationStore((s) => s.addNotification);
  const cognitiveWarnings = useCognitiveLoad();
  const fetchedReviews = useRef(false);

  // Cortex contradictions → notifications
  useEffect(() => {
    for (const c of contradictions) {
      addNotification({
        type: 'contradiction',
        title: 'Contradiction Detected',
        description: c.description,
        severity: c.severity === 'HIGH' ? 'critical' : 'warning',
        actionUrl: '/',
        actionLabel: 'Review',
        entityId: c.id,
      });
    }
  }, [contradictions, addNotification]);

  // Cortex patterns → notifications
  useEffect(() => {
    for (const p of patterns) {
      addNotification({
        type: 'pattern',
        title: 'Thinking Pattern Found',
        description: `${p.patternType}: ${p.description}`,
        severity: 'info',
        actionUrl: '/',
        actionLabel: 'View Details',
        entityId: p.id,
      });
    }
  }, [patterns, addNotification]);

  // Latest memo → notification
  useEffect(() => {
    if (!latestMemo) return;
    const memoDate = new Date(latestMemo.createdAt);
    const today = new Date();
    const isToday =
      memoDate.getFullYear() === today.getFullYear() &&
      memoDate.getMonth() === today.getMonth() &&
      memoDate.getDate() === today.getDate();
    if (isToday) {
      addNotification({
        type: 'memo',
        title: 'Weekly Memo Available',
        description: `Your thinking quality score: ${latestMemo.thinkingQualityScore}/10`,
        severity: 'info',
        actionUrl: '/',
        actionLabel: 'Read Memo',
        entityId: latestMemo.id,
      });
    }
  }, [latestMemo, addNotification]);

  // Pending outcome reviews (one-time fetch)
  useEffect(() => {
    if (fetchedReviews.current) return;
    fetchedReviews.current = true;
    api.getPendingReviews().then((reviews) => {
      for (const r of reviews) {
        addNotification({
          type: 'outcome_review',
          title: 'Outcome Review Due',
          description: `Review the outcome of: ${r.decisionTitle}`,
          severity: 'warning',
          actionUrl: '/',
          actionLabel: 'Review Now',
          entityId: r.id,
        });
      }
    }).catch(() => {
      // Silently ignore — reviews are best-effort
    });
  }, [addNotification]);

  // Cognitive load warnings → notifications
  useEffect(() => {
    for (const w of cognitiveWarnings) {
      addNotification({
        type: 'cognitive_load',
        title: 'Cognitive Load Alert',
        description: w.message,
        severity: w.severity === 'critical' ? 'critical' : 'warning',
        entityId: `cognitive-${w.type}`,
      });
    }
  }, [cognitiveWarnings, addNotification]);
}
