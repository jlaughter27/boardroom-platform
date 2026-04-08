interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <span className="text-5xl mb-4">{icon}</span>}
      <h3 className="text-lg font-medium text-text-secondary mb-2">{title}</h3>
      {description && (
        <p className="text-text-tertiary text-sm max-w-sm mb-6">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 bg-accent hover:bg-accent/80 text-text-primary text-sm rounded-lg transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
