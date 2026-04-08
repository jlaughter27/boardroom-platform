import { useState } from 'react';
import type { ContradictionAlert } from '@boardroom/shared';
import { Card, Badge, Button } from '../ui';

interface ContradictionCardProps {
  contradiction: ContradictionAlert;
  onResolve: (id: string, resolution: string) => void;
  onDismiss: (id: string) => void;
  onAcceptTension: (id: string) => void;
}

const SEVERITY_VARIANT: Record<string, 'danger' | 'warning' | 'default'> = {
  high: 'danger',
  medium: 'warning',
  low: 'default',
};

export function ContradictionCard({ contradiction, onResolve, onDismiss, onAcceptTension }: ContradictionCardProps) {
  const [showResolve, setShowResolve] = useState(false);
  const [resolution, setResolution] = useState('');

  const variant = SEVERITY_VARIANT[contradiction.severity] ?? 'default';
  const entityA = contradiction.entityA as { type: string; id: string; title: string };
  const entityB = contradiction.entityB as { type: string; id: string; title: string };

  const bgClass = variant === 'danger' ? 'bg-danger-muted' : variant === 'warning' ? 'bg-warning-muted' : '';

  const handleResolve = () => {
    if (resolution.trim()) {
      onResolve(contradiction.id, resolution.trim());
      setShowResolve(false);
      setResolution('');
    }
  };

  return (
    <div className={`py-3 border-b border-line last:border-0 ${bgClass} rounded-md px-2 my-1`}>
      <div className="flex items-start gap-2 mb-2">
        <Badge variant={variant}>{contradiction.severity}</Badge>
        <p className="text-sm text-text-primary">{contradiction.description}</p>
      </div>

      <div className="flex items-center gap-1 text-xs text-text-tertiary mb-2 ml-1">
        <span className="font-medium text-text-secondary">{entityA.title}</span>
        <span>vs</span>
        <span className="font-medium text-text-secondary">{entityB.title}</span>
      </div>

      {showResolve ? (
        <div className="ml-1 space-y-2">
          <textarea
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            placeholder="How was this resolved?"
            className="w-full bg-bg-base border border-line rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary resize-none outline-none focus:border-accent"
            rows={2}
          />
          <div className="flex gap-2">
            <Button variant="success" size="sm" onClick={handleResolve}>Submit</Button>
            <Button variant="ghost" size="sm" onClick={() => { setShowResolve(false); setResolution(''); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 ml-1">
          <Button variant="ghost" size="sm" onClick={() => setShowResolve(true)}>Resolve</Button>
          <Button variant="ghost" size="sm" onClick={() => onAcceptTension(contradiction.id)}>Accept Tension</Button>
          <Button variant="ghost" size="sm" onClick={() => onDismiss(contradiction.id)}>Dismiss</Button>
        </div>
      )}
    </div>
  );
}
