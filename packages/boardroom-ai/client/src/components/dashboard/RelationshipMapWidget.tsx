import { useRelationshipData } from '../../hooks/useRelationshipData';
import { RelationshipGraph } from '../memory/RelationshipGraph';

export function RelationshipMapWidget() {
  const { data, isLoading, hasEnoughData } = useRelationshipData();

  if (isLoading) {
    return (
      <div className="bg-card rounded-xl p-4 border border-border">
        <h3 className="text-sm font-medium text-muted-foreground mb-3">Relationship Map</h3>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
        </div>
      </div>
    );
  }

  if (!hasEnoughData || !data) {
    return (
      <div className="bg-card rounded-xl p-4 border border-border">
        <h3 className="text-sm font-medium text-muted-foreground mb-3">Relationship Map</h3>
        <p className="text-xs text-muted-foreground text-center py-4">
          Add more people and projects to see your relationship map.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl p-4 border border-border">
      <h3 className="text-sm font-medium text-muted-foreground mb-3">Relationship Map</h3>
      <RelationshipGraph data={data} compact />
    </div>
  );
}
