import { useState, useEffect, useCallback } from 'react';
import type { WidgetConfig } from '@boardroom/shared';
import { DEFAULT_WIDGETS } from '@boardroom/shared';
import * as api from '../lib/api';

export function useWidgetLayout() {
  const [widgets, setWidgets] = useState<WidgetConfig[]>(DEFAULT_WIDGETS);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    api
      .getUserProfile()
      .then((profile: any) => {
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

  const updateLayout = useCallback(async (newWidgets: WidgetConfig[]) => {
    setWidgets(newWidgets);
    await api.updateUserProfile({ dashboardLayout: newWidgets });
  }, []);

  const resetToDefault = useCallback(async () => {
    setWidgets(DEFAULT_WIDGETS);
    await api.updateUserProfile({ dashboardLayout: DEFAULT_WIDGETS });
  }, []);

  const visibleWidgets = widgets
    .filter((w) => w.visible)
    .sort((a, b) => a.position - b.position)
    .slice(0, 8); // max 8 visible

  return { widgets, visibleWidgets, isLoading, updateLayout, resetToDefault };
}
