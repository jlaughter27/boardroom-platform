import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Commitment } from '@boardroom/shared';
import * as api from '../../lib/api';
import { useEntitiesStore } from '../../stores/entities.store';
import type { CommitmentNudgesResponse } from '../../types/debate';
import { Card, Badge, Skeleton, useToastStore } from '../ui';

/** "in 2 days" / "today" / "3 days overdue" — relative to now, day granularity. */
export function relativeDue(deadline: Date | string | null, now: number = Date.now()): string {
  if (!deadline) return 'no deadline';
  const d = new Date(deadline).getTime();
  if (Number.isNaN(d)) return 'no deadline';
  const dayMs = 86_400_000;
  const days = Math.round((d - now) / dayMs);
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  if (days > 1) return `due in ${days} days`;
  if (days === -1) return '1 day overdue';
  return `${-days} days overdue`;
}

interface RowProps {
  commitment: Commitment;
  personName: string | null;
  overdue: boolean;
  onDone(id: string): void;
  busy: boolean;
}

function NudgeRow({ commitment, personName, overdue, onDone, busy }: RowProps) {
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm text-foreground leading-snug">{commitment.description}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {personName ? <>to <span className="text-foreground">{personName}</span> · </> : null}
          <span className={overdue ? 'text-danger' : ''}>{relativeDue(commitment.deadline)}</span>
        </p>
      </div>
      <button
        type="button"
        onClick={() => onDone(commitment.id)}
        disabled={busy}
        className="shrink-0 h-7 inline-flex items-center rounded-md border border-border px-2.5 text-xs text-foreground hover:bg-muted disabled:opacity-50"
        title="Mark this commitment completed"
      >
        Mark done
      </button>
    </li>
  );
}

/**
 * Commitment follow-through nudges (Phase 6): open commitments due within 3
 * days or overdue, from `GET /commitments/nudges`. SQL-only on the server,
 * so this widget is cheap to show on every dashboard load.
 */
export function CommitmentNudgesWidget() {
  const [data, setData] = useState<CommitmentNudgesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { people, fetchPeople } = useEntitiesStore();

  useEffect(() => {
    let cancelled = false;
    api.getCommitmentNudges()
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load nudges'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    if (people.length === 0) void fetchPeople();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nameById = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  /** Optimistic: drop the row now, PATCH, and put it back (with a toast) if the server says no. */
  const markDone = useCallback(async (id: string) => {
    const snapshot = data;
    if (!snapshot) return;
    setBusyIds((s) => new Set(s).add(id));
    setData({
      overdue: snapshot.overdue.filter((c) => c.id !== id),
      dueSoon: snapshot.dueSoon.filter((c) => c.id !== id),
    });
    try {
      await api.updateCommitment(id, { status: 'COMPLETED', completedAt: new Date().toISOString() });
      useToastStore.getState().addToast('Commitment marked done', 'success');
    } catch (e: unknown) {
      setData((cur) => {
        const put = (list: Commitment[], from: Commitment[]) => {
          const row = from.find((c) => c.id === id);
          return row && !list.some((c) => c.id === id) ? [...list, row] : list;
        };
        return cur
          ? { overdue: put(cur.overdue, snapshot.overdue), dueSoon: put(cur.dueSoon, snapshot.dueSoon) }
          : snapshot;
      });
      useToastStore.getState().addToast(e instanceof Error ? e.message : 'Could not update the commitment', 'error');
    } finally {
      setBusyIds((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }, [data]);

  if (loading) {
    return (
      <Card className="border-t-2 border-t-warning">
        <Skeleton className="h-4 w-40 mb-3" />
        <Skeleton className="h-10 w-full mb-2" />
        <Skeleton className="h-10 w-3/4" />
      </Card>
    );
  }

  // Quietly disappear when the endpoint is unavailable or there is nothing to nudge.
  if (error || !data) return null;
  const total = data.overdue.length + data.dueSoon.length;
  if (total === 0) return null;

  return (
    <Card className="border-t-2 border-t-warning" data-testid="commitment-nudges">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Commitments to keep
        </h3>
        <div className="flex gap-1.5">
          {data.overdue.length > 0 && <Badge variant="danger">{data.overdue.length} overdue</Badge>}
          {data.dueSoon.length > 0 && <Badge variant="warning">{data.dueSoon.length} due soon</Badge>}
        </div>
      </div>
      <ul className="divide-y divide-border">
        {data.overdue.map((c) => (
          <NudgeRow key={c.id} commitment={c} personName={c.stakeholderId ? nameById.get(c.stakeholderId) ?? null : null} overdue onDone={markDone} busy={busyIds.has(c.id)} />
        ))}
        {data.dueSoon.map((c) => (
          <NudgeRow key={c.id} commitment={c} personName={c.stakeholderId ? nameById.get(c.stakeholderId) ?? null : null} overdue={false} onDone={markDone} busy={busyIds.has(c.id)} />
        ))}
      </ul>
    </Card>
  );
}
