import { WidgetRenderer } from '../components/dashboard/WidgetRenderer';
import { DashboardConfigurator } from '../components/dashboard/DashboardConfigurator';
import { useWidgetLayout } from '../hooks/useWidgetLayout';
import { useUIStore } from '../stores/ui.store';
import { useEntitiesStore } from '../stores/entities.store';
import { useCortexStore } from '../stores/cortex.store';
import { LoadingSpinner } from '../components/shared/LoadingSpinner';
import { ErrorBanner } from '../components/shared/ErrorBanner';

export default function DashboardPage() {
  const { visibleWidgets, widgets, isLoading, updateLayout, resetToDefault } =
    useWidgetLayout();
  const { configuratorOpen, openConfigurator, closeConfigurator } = useUIStore();
  const { error: entitiesError, clearError: clearEntitiesError } = useEntitiesStore();
  const { error: cortexError, clearError: clearCortexError } = useCortexStore();

  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto flex items-center justify-center min-h-[50vh]">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <button
          onClick={openConfigurator}
          className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
        >
          Customize
        </button>
      </div>

      {(entitiesError || cortexError) && (
        <ErrorBanner
          message={entitiesError || cortexError || ''}
          onDismiss={() => { clearEntitiesError(); clearCortexError(); }}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {visibleWidgets.map((widget) => (
          <WidgetRenderer key={widget.id} config={widget} />
        ))}
      </div>

      {configuratorOpen && (
        <DashboardConfigurator
          widgets={widgets}
          onSave={updateLayout}
          onReset={resetToDefault}
          onClose={closeConfigurator}
        />
      )}
    </div>
  );
}
