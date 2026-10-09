import { useEffect, useState } from 'react';
import * as api from '../../lib/api';
import type { PersonDuplicatePair } from '../../types/debate';
import { Badge } from '../ui';

const STORAGE_KEY = 'boardroom.people.duplicates.dismissed.v1';

export function pairKey(aId: string, bId: string): string {
  return [aId, bId].sort().join(':');
}

function loadDismissed(): Set<string> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch { return new Set(); }
}

function saveDismissed(set: Set<string>) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...set])); } catch { /* storage unavailable */ }
}

interface Props {
  /** Select both cards in the directory (scroll + highlight). */
  onOpenBoth(aId: string, bId: string): void;
  /** Re-fetch trigger (e.g. after a person is deleted). */
  refreshKey?: number;
}

/**
 * Possible duplicate people from `GET /people/duplicates` (pg_trgm name
 * similarity ≥ 0.6). Nothing is merged automatically: the user opens both
 * cards and decides, or marks the pair "Not duplicates" (remembered for the
 * session only).
 */
export function PeopleDuplicatesBanner({ onOpenBoth, refreshKey = 0 }: Props) {
  const [pairs, setPairs] = useState<PersonDuplicatePair[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed);

  useEffect(() => {
    let cancelled = false;
    api.getPeopleDuplicates()
      .then((res) => { if (!cancelled) setPairs(res.pairs ?? []); })
      .catch(() => { if (!cancelled) setPairs([]); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const visible = pairs.filter((p) => !dismissed.has(pairKey(p.a.id, p.b.id)));
  if (visible.length === 0) return null;

  function dismiss(p: PersonDuplicatePair) {
    const next = new Set(dismissed);
    next.add(pairKey(p.a.id, p.b.id));
    setDismissed(next);
    saveDismissed(next);
  }

  return (
    <div className="mb-4 rounded-lg border border-warning/30 bg-warning-muted p-4" role="region" aria-label="Possible duplicate people" data-testid="people-duplicates">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-warning" aria-hidden>{'⚠'}</span>
        <h3 className="text-sm font-medium text-foreground">
          {visible.length} possible duplicate{visible.length === 1 ? '' : 's'}
        </h3>
        <span className="text-xs text-muted-foreground">Names look alike. Open both to compare, or mark them as different people.</span>
      </div>
      <ul className="divide-y divide-border/60">
        {visible.map((p) => (
          <li key={pairKey(p.a.id, p.b.id)} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-foreground font-medium">{p.a.name}</span>
              <span className="text-muted-foreground" aria-hidden>{'↔'}</span>
              <span className="text-foreground font-medium">{p.b.name}</span>
              <Badge variant="warning">{Math.round(p.similarity * 100)} % similar</Badge>
              {(p.a.role || p.b.role) && (
                <span className="text-xs text-muted-foreground">{[p.a.role, p.b.role].filter(Boolean).join(' / ')}</span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onOpenBoth(p.a.id, p.b.id)}
                className="h-7 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:opacity-90"
              >
                Open both
              </button>
              <button
                type="button"
                onClick={() => dismiss(p)}
                className="h-7 rounded-md border border-border bg-card px-2.5 text-xs text-foreground hover:bg-muted"
              >
                Not duplicates
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
