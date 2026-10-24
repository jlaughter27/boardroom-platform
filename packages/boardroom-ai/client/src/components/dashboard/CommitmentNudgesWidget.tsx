import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Commitment, CommitmentNudgeItem } from '@boardroom/shared';
import { endOfUtcDay } from '@boardroom/shared';
import * as api from '../../lib/api';
import { copyToClipboard } from '../settings/CopyField';
import { addDaysYmd, COMMITMENTS_CHANGED_EVENT, composeCheckIn, delegationDueLabel, localYmd, partitionNudges } from '../../lib/delegation';
import { useEntitiesStore } from '../../stores/entities.store';
import { useVizSlice, useVizStore } from '../../stores/viz.store';
import type { CommitmentNudgesResponse } from '../../types/debate';
import { Card, Badge, Skeleton, useToastStore } from '../ui';
import { CommitmentHorizon, HORIZON_DAYS, isOpenCommitment } from './CommitmentHorizon';
import { horizon } from '../viz/aggregate';

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

interface WaitingRowProps {
  commitment: CommitmentNudgeItem;
  personName: string;
  overdue: boolean;
  busy: boolean;
  onCheckIn(c: CommitmentNudgeItem, name: string): void;
  onNewDate(id: string, ymd: string): void;
  onReceived(id: string): void;
  onDrop(id: string): void;
}

const ROW_ACTION = 'h-7 inline-flex items-center rounded-md border border-border px-2.5 text-xs text-foreground hover:bg-muted disabled:opacity-50 transition-colors';

/** RD-12 — something another person owes the user: "from {name} · 2 days overdue". */
function WaitingRow({ commitment, personName, overdue, busy, onCheckIn, onNewDate, onReceived, onDrop }: WaitingRowProps) {
  const [picking, setPicking] = useState(false);
  const minYmd = addDaysYmd(localYmd(new Date()), 1);
  return (
    <li className="py-2" data-testid="waiting-row">
      <p className="text-sm text-foreground leading-snug">{commitment.description}</p>
      <p className="text-xs text-muted-foreground mt-0.5">
        from <span className="text-foreground">{personName}</span> ·{' '}
        <span className={overdue ? 'text-danger' : ''}>{delegationDueLabel(commitment.deadline, Date.now())}</span>
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <button type="button" className={ROW_ACTION} disabled={busy} onClick={() => onCheckIn(commitment, personName)}>Copy check-in</button>
        {picking ? (
          <input
            type="date"
            autoFocus
            min={minYmd}
            aria-label={`New date for ${commitment.description}`}
            className="h-7 rounded-md border border-border bg-card px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
            onChange={(e) => { if (e.target.value) { onNewDate(commitment.id, e.target.value); setPicking(false); } }}
            onBlur={() => setPicking(false)}
          />
        ) : (
          <button type="button" className={ROW_ACTION} disabled={busy} onClick={() => setPicking(true)}>New date</button>
        )}
        <button type="button" className={ROW_ACTION} disabled={busy} onClick={() => onReceived(commitment.id)} title="They delivered: mark it completed">Received</button>
        <button type="button" className={ROW_ACTION} disabled={busy} onClick={() => onDrop(commitment.id)} title="No longer needed: mark it deferred">Drop</button>
      </div>
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
  // Every open commitment (cached 60 s) feeds the 14-day horizon above the nudge list.
  const allCommitments = useVizSlice('commitments');

  // RD-12: one nudges request on mount (as before) and one more only after a
  // delegation write announces itself with `boardroom:commitments-changed`.
  const [alive] = useState(() => ({ current: true }));
  const reload = useCallback(() => {
    return api.getCommitmentNudges()
      .then((res) => { if (alive.current) { setData(res); setError(null); } })
      .catch((e: unknown) => { if (alive.current) setError(e instanceof Error ? e.message : 'Could not load nudges'); })
      .finally(() => { if (alive.current) setLoading(false); });
  }, [alive]);

  useEffect(() => {
    alive.current = true;
    void reload();
    if (people.length === 0) void fetchPeople();
    const onChanged = () => { void reload(); };
    window.addEventListener(COMMITMENTS_CHANGED_EVENT, onChanged);
    return () => { alive.current = false; window.removeEventListener(COMMITMENTS_CHANGED_EVENT, onChanged); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nameById = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  /** Optimistic: drop the row now, PATCH, and put it back (with a toast) if the server says no. */
  const resolveRow = useCallback(async (id: string, patch: api.UpdateCommitmentInput, okMessage: string) => {
    const snapshot = data;
    if (!snapshot) return;
    setBusyIds((s) => new Set(s).add(id));
    setData({
      overdue: snapshot.overdue.filter((c) => c.id !== id),
      dueSoon: snapshot.dueSoon.filter((c) => c.id !== id),
    });
    try {
      await api.updateCommitment(id, patch);
      useToastStore.getState().addToast(okMessage, 'success');
      // Drop the dot from the horizon without waiting for a refetch, then refresh the cache.
      const viz = useVizStore.getState();
      if (viz.commitments.data) {
        useVizStore.setState({ commitments: { ...viz.commitments, data: viz.commitments.data.filter((c) => c.id !== id) } });
      }
      void viz.load('commitments', true);
    } catch (e: unknown) {
      setData((cur) => {
        const put = (list: CommitmentNudgeItem[], from: CommitmentNudgeItem[]) => {
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

  const markDone = useCallback((id: string) => resolveRow(id, { status: 'COMPLETED', completedAt: new Date().toISOString() }, 'Commitment marked done'), [resolveRow]);
  // RD-12 — delegation row actions.
  const markReceived = useCallback((id: string) => resolveRow(id, { status: 'COMPLETED', completedAt: new Date().toISOString() }, 'Marked received'), [resolveRow]);
  const dropDelegation = useCallback((id: string) => resolveRow(id, { status: 'DEFERRED' }, 'Delegation dropped'), [resolveRow]);
  const copyCheckIn = useCallback(async (c: CommitmentNudgeItem, name: string) => {
    if (!c.deadline) return;
    const ok = await copyToClipboard(composeCheckIn({ name, description: c.description, deadline: c.deadline }, Date.now()));
    useToastStore.getState().addToast(ok ? 'Check-in copied' : 'Could not copy the check-in', ok ? 'success' : 'error');
  }, []);
  const setNewDate = useCallback(async (id: string, ymd: string) => {
    setBusyIds((s) => new Set(s).add(id));
    try {
      await api.updateCommitment(id, { deadline: endOfUtcDay(ymd).toISOString() });
      useToastStore.getState().addToast('New date saved', 'success');
      await reload();
    } catch (e: unknown) {
      useToastStore.getState().addToast(e instanceof Error ? e.message : 'Could not change the date', 'error');
    } finally {
      setBusyIds((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }, [reload]);
  const parts = useMemo(() => (data ? partitionNudges(data) : null), [data]);

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
  const mine = parts?.mine ?? { overdue: [], dueSoon: [] };
  const waiting = parts?.waiting ?? { overdue: [], dueSoon: [] };
  const mineTotal = mine.overdue.length + mine.dueSoon.length;
  const waitingTotal = waiting.overdue.length + waiting.dueSoon.length;
  const total = mineTotal + waitingTotal;
  const onHorizon = allCommitments.data
    ? (() => { const h = horizon(allCommitments.data, (c) => c.deadline, isOpenCommitment, HORIZON_DAYS); return h.overdue.length + h.upcoming.length; })()
    : 0;
  if ((error || !data || total === 0) && onHorizon === 0) return null;

  return (
    <Card className="border-t-2 border-t-warning" data-testid="commitment-nudges">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Commitments to keep
        </h3>
        <div className="flex gap-1.5">
          {mine.overdue.length > 0 && <Badge variant="danger">{mine.overdue.length} overdue</Badge>}
          {mine.dueSoon.length > 0 && <Badge variant="warning">{mine.dueSoon.length} due soon</Badge>}
          {onHorizon > 0 && <Badge variant="default">{onHorizon} in {HORIZON_DAYS} d</Badge>}
        </div>
      </div>
      {onHorizon > 0 && allCommitments.data && (
        <CommitmentHorizon commitments={allCommitments.data} nameById={nameById} className="mb-3 border-b border-border pb-3" />
      )}
      {mineTotal > 0 && <ul className="divide-y divide-border">
        {mine.overdue.map((c) => (
          <NudgeRow key={c.id} commitment={c} personName={c.stakeholderId ? nameById.get(c.stakeholderId) ?? null : null} overdue onDone={markDone} busy={busyIds.has(c.id)} />
        ))}
        {mine.dueSoon.map((c) => (
          <NudgeRow key={c.id} commitment={c} personName={c.stakeholderId ? nameById.get(c.stakeholderId) ?? null : null} overdue={false} onDone={markDone} busy={busyIds.has(c.id)} />
        ))}
      </ul>}
      {waitingTotal > 0 && (
        <section className={mineTotal > 0 || onHorizon > 0 ? 'mt-3 border-t border-border pt-3' : ''} data-testid="waiting-on-others">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Waiting on others</h3>
            <div className="flex gap-1.5">
              {waiting.overdue.length > 0 && <Badge variant="danger">{waiting.overdue.length} overdue</Badge>}
              {waiting.dueSoon.length > 0 && <Badge variant="warning">{waiting.dueSoon.length} due soon</Badge>}
            </div>
          </div>
          <ul className="divide-y divide-border">
            {[...waiting.overdue.map((c) => [c, true] as const), ...waiting.dueSoon.map((c) => [c, false] as const)].map(([c, isOver]) => (
              <WaitingRow
                key={c.id}
                commitment={c}
                personName={c.stakeholderName ?? (c.stakeholderId ? nameById.get(c.stakeholderId) : undefined) ?? 'someone'}
                overdue={isOver}
                busy={busyIds.has(c.id)}
                onCheckIn={copyCheckIn}
                onNewDate={setNewDate}
                onReceived={markReceived}
                onDrop={dropDelegation}
              />
            ))}
          </ul>
        </section>
      )}
    </Card>
  );
}
