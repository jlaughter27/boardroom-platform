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
      <h3 className="text-lg font-medium text-muted-foreground mb-2">{title}</h3>
      {description && (
        <p className="text-muted-foreground text-sm max-w-sm mb-6">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-sm rounded-xl transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
