import { useState, useEffect, useCallback } from 'react';
import type { WidgetConfig } from '@boardroom/shared';
import { DEFAULT_WIDGETS } from '@boardroom/shared';
import * as api from '../lib/api';
import { useToastStore } from '../components/ui/Toast';

export function useWidgetLayout() {
  const [widgets, setWidgets] = useState<WidgetConfig[]>(DEFAULT_WIDGETS);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    api
      .getUserProfile()
      .then((profile) => {
        if (
          profile?.dashboardLayout &&
          Array.isArray(profile.dashboardLayout) &&
          profile.dashboardLayout.length > 0
        ) {
          setWidgets(profile.dashboardLayout);
        }
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, []);

  // Optimistic save with rollback + toast on failure (C-117). Rethrows so the
  // caller (DashboardConfigurator) can keep its modal open.
  const persist = useCallback(async (next: WidgetConfig[]) => {
    const previous = widgets;
    setWidgets(next);
    try {
      await api.updateUserProfile({ dashboardLayout: next });
    } catch (err) {
      setWidgets(previous);
      useToastStore.getState().addToast(
        err instanceof Error ? err.message : 'Could not save dashboard layout',
        'error',
      );
      throw err;
    }
  }, [widgets]);

  const updateLayout = useCallback((newWidgets: WidgetConfig[]) => persist(newWidgets), [persist]);

  const resetToDefault = useCallback(() => persist(DEFAULT_WIDGETS), [persist]);

  const visibleWidgets = widgets
    .filter((w) => w.visible)
    .sort((a, b) => a.position - b.position)
    .slice(0, 8); // max 8 visible

  return { widgets, visibleWidgets, isLoading, updateLayout, resetToDefault };
}
