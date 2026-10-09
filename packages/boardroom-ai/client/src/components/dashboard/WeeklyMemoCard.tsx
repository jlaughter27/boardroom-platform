import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useCortexStore } from '../../stores/cortex.store';
import * as api from '../../lib/api';
import {
  MEMO_SECTIONS,
  MEMO_SECTION_LABEL,
  memoItemKey,
  type InteractiveWeeklyMemo,
  type MemoItemState,
  type MemoItemStateValue,
  type MemoSection,
} from '../../types/debate';
import { Card, Button, Skeleton, Progress, Badge, useToastStore } from '../ui';
import { cn } from '../../lib/cn';

const SNOOZE_DAYS = 7;

function snoozeUntil(): string {
  const d = new Date();
  d.setDate(d.getDate() + SNOOZE_DAYS);
  return d.toISOString();
}

/** A snoozed item whose `until` has passed is live again. */
export function effectiveState(state: MemoItemState | undefined, now: number = Date.now()): MemoItemState | undefined {
  if (!state) return undefined;
  if (state.state === 'snoozed' && state.until && new Date(state.until).getTime() <= now) return undefined;
  return state;
}

interface MemoItemRowProps {
  text: string;
  state?: MemoItemState;
  busy: boolean;
  onAct: (state: MemoItemStateValue) => void;
}

function MemoItemRow({ text, state, busy, onAct }: MemoItemRowProps) {
  const isReview = text.startsWith('review:');
  const label = isReview ? text.slice('review:'.length).trim() : text;
  const settled = state?.state === 'accepted' || state?.state === 'dismissed';
  return (
    <li className={cn('flex items-start gap-2 py-1.5', state?.state === 'dismissed' && 'opacity-60')}>
      <span className="text-primary mt-0.5" aria-hidden>{'•'}</span>
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm leading-relaxed text-foreground', state?.state === 'dismissed' && 'line-through decoration-muted-foreground/60')}>
          {isReview && <Badge variant="warning" className="mr-1.5 align-middle">Review due</Badge>}
          {label}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {state?.state === 'accepted' && <Badge variant="success">Saved to memory</Badge>}
          {state?.state === 'dismissed' && <Badge variant="default">Dismissed</Badge>}
          {state?.state === 'snoozed' && (
            <Badge variant="default">
              Snoozed{state.until ? ` until ${new Date(state.until).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}
            </Badge>
          )}
          {!settled && (
            <>
              <button type="button" disabled={busy} onClick={() => onAct('accepted')} className="h-6 rounded border border-border px-2 text-[11px] text-foreground hover:bg-muted disabled:opacity-50">
                Accept
              </button>
              <button type="button" disabled={busy} onClick={() => onAct('dismissed')} className="h-6 rounded border border-border px-2 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50">
                Dismiss
              </button>
              {state?.state !== 'snoozed' && (
                <button type="button" disabled={busy} onClick={() => onAct('snoozed')} className="h-6 rounded border border-border px-2 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50">
                  Snooze 1 w
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

export function WeeklyMemoCard() {
  const { latestMemo, isLoadingMemo, isGeneratingMemo, fetchLatestMemo, generateMemo } =
    useCortexStore();
  const [expanded, setExpanded] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    fetchLatestMemo();
  }, []);

  if (isLoadingMemo) {
    return (
      <Card className="border-t-2 border-t-primary">
        <div className="space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </Card>
    );
  }

  if (!latestMemo) {
    return (
      <Card className="border-t-2 border-t-primary">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
          Weekly Thinking Memo
        </h3>
        <p className="text-muted-foreground text-sm">
          Keep making decisions! Weekly insights start after 5 sessions.
        </p>
        <Button variant="secondary" size="sm" onClick={() => generateMemo()} className="mt-3">
          {'✨'} Generate Memo
        </Button>
      </Card>
    );
  }

  const memo = latestMemo as InteractiveWeeklyMemo;
  const itemStates = memo.itemStates ?? {};
  const score = memo.thinkingQualityScore;
  const weekLabel = `${new Date(memo.weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${new Date(memo.weekEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  async function act(section: MemoSection, index: number, state: MemoItemStateValue) {
    const key = memoItemKey(section, index);
    setBusyKey(key);
    try {
      const body = state === 'snoozed' ? { state, until: snoozeUntil() } : { state };
      const updated = await api.updateMemoItem(memo.id, key, body);
      // Server returns the updated memo; fall back to a local merge if it is thin.
      const nextStates = (updated && 'itemStates' in updated && updated.itemStates)
        ? updated.itemStates
        : { ...itemStates, [key]: { ...body } as MemoItemState };
      useCortexStore.setState({ latestMemo: { ...memo, ...(updated ?? {}), itemStates: nextStates } as InteractiveWeeklyMemo });
      useToastStore.getState().addToast(
        state === 'accepted' ? 'Saved to memory' : state === 'dismissed' ? 'Item dismissed' : `Snoozed for ${SNOOZE_DAYS} days`,
        state === 'accepted' ? 'success' : 'info',
      );
    } catch (err) {
      useToastStore.getState().addToast(err instanceof Error ? err.message : 'Could not update memo item', 'error');
    } finally {
      setBusyKey(null);
    }
  }

  const dismissedCount = Object.values(itemStates).filter((s) => s.state === 'dismissed').length;

  return (
    <Card className="border-t-2 border-primary" id="weekly-memo">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Weekly Thinking Memo
          </h3>
          <p className="text-xs text-muted-foreground">{weekLabel}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => generateMemo()}
          disabled={isGeneratingMemo}
        >
          {isGeneratingMemo ? 'Generating...' : '✨ Generate'}
        </Button>
      </div>

      {/* Score */}
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-2xl font-bold text-foreground">{score.toFixed(1)}</span>
        <span className="text-sm text-muted-foreground">/10</span>
        {memo.scoreChange !== 0 && (
          <Badge variant={memo.scoreChange > 0 ? 'success' : 'danger'}>
            {memo.scoreChange > 0 ? '↑' : '↓'} {Math.abs(memo.scoreChange).toFixed(1)}
          </Badge>
        )}
      </div>
      <Progress value={score * 10} className="mb-4" />

      {/* Interactive sections — accept / dismiss / snooze per item */}
      {MEMO_SECTIONS.map((section) => {
        const items = memo[section] ?? [];
        if (items.length === 0) return null;
        const rows = items
          .map((text, index) => ({ text, index, key: memoItemKey(section, index), state: effectiveState(itemStates[memoItemKey(section, index)]) }))
          .filter((r) => showDismissed || r.state?.state !== 'dismissed');
        if (rows.length === 0) return null;
        return (
          <div key={section} className="mb-3">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              {MEMO_SECTION_LABEL[section]}
            </h4>
            <ul>
              {rows.map((r) => (
                <MemoItemRow
                  key={r.key}
                  text={r.text}
                  state={r.state}
                  busy={busyKey === r.key}
                  onAct={(s) => act(section, r.index, s)}
                />
              ))}
            </ul>
          </div>
        );
      })}

      {dismissedCount > 0 && (
        <button type="button" onClick={() => setShowDismissed((v) => !v)} className="text-xs text-muted-foreground hover:text-foreground mb-2">
          {showDismissed ? 'Hide' : 'Show'} {dismissedCount} dismissed
        </button>
      )}

      {memo.fullMemoText && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Hide Full Memo' : 'View Full Memo'}
          </Button>
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-3 p-3 bg-background rounded-md text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                  {memo.fullMemoText}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </Card>
  );
}
