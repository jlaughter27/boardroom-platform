import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { endOfUtcDay, isMinistryDomain } from '@boardroom/shared';
import type { Person } from '@boardroom/shared';
import * as api from '../../lib/api';
import { cn } from '../../lib/cn';
import {
  COMMITMENTS_CHANGED_EVENT,
  DELEGATION_DEFAULT_DONE_WHEN,
  DELEGATION_DONE_WHEN_LINES,
  DELEGATION_DONE_WHEN_MAX,
  DELEGATION_WHAT_MAX,
  addDaysYmd,
  composeBrief,
  dateLabel,
  defaultDeadlineYmd,
  firstName,
  localYmd,
} from '../../lib/delegation';
import { useEntitiesStore } from '../../stores/entities.store';
import { useVizStore } from '../../stores/viz.store';
import { Modal } from '../shared/Modal';
import { copyToClipboard } from '../settings/CopyField';
import { Button, useToastStore } from '../ui';

/** Where the Delegate click came from. Only these fields can reach the brief, and only when ticked. */
export interface DelegationSource {
  what: string;
  task?: { id: string; title: string; deadline: Date | string | null };
  project?: { id: string; title: string };
  decision?: { id: string; title: string; chosenPath: string | null; rationale: string | null; expectedOutcome: string | null };
}

interface DelegateDialogProps {
  open: boolean;
  onClose: () => void;
  source: DelegationSource;
}

const newKey = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `deleg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** Share sheet on touch devices that have one; clipboard everywhere else. */
function detectShare(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
}

const FIELD = 'w-full bg-card border border-border rounded-control px-3 text-sm text-foreground placeholder:text-muted-foreground hover:border-hairline-strong focus:ring-2 focus:ring-ring focus:border-primary/40 outline-none transition-[border-color,box-shadow] duration-fast ease-out';
const LABEL = 'block text-sm font-medium text-muted-foreground mb-1.5';

/**
 * RD-12 — Delegate one item to a Person: pick who, edit a short brief built
 * only from fields the user typed or ticked, share or copy it, and only then
 * record one Commitment with owedBy=STAKEHOLDER. The brief itself is never
 * stored; the only network calls are POST /people (inline add) and
 * POST /commitments (with one Idempotency-Key per dialog open).
 */
export function DelegateDialog({ open, onClose, source }: DelegateDialogProps) {
  const uid = useId();
  const people = useEntitiesStore((s) => s.people);
  const fetchPeople = useEntitiesStore((s) => s.fetchPeople);
  const toast = useToastStore((s) => s.addToast);

  const [query, setQuery] = useState('');
  const [personId, setPersonId] = useState<string | null>(null);
  const [addedPerson, setAddedPerson] = useState<Person | null>(null);
  const [adding, setAdding] = useState(false);
  const [what, setWhat] = useState('');
  const [ymd, setYmd] = useState('');
  const [doneWhen, setDoneWhen] = useState<string[]>([DELEGATION_DEFAULT_DONE_WHEN]);
  const [tickWhyPath, setTickWhyPath] = useState(false);
  const [tickWhyRationale, setTickWhyRationale] = useState(false);
  const [tickWhyProject, setTickWhyProject] = useState(false);
  const [whyFree, setWhyFree] = useState('');
  const [tickOutcome, setTickOutcome] = useState(false);
  const [contextFree, setContextFree] = useState('');
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const keyRef = useRef<string>('');
  const [useShare, setUseShare] = useState(false);
  const minYmd = useMemo(() => addDaysYmd(localYmd(new Date()), 1), [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every open starts fresh: new Idempotency-Key, fields from the source, nothing ticked.
  useEffect(() => {
    if (!open) return;
    keyRef.current = newKey();
    setUseShare(detectShare());
    setQuery('');
    setPersonId(null);
    setAddedPerson(null);
    setWhat(source.what.slice(0, DELEGATION_WHAT_MAX));
    setYmd(defaultDeadlineYmd(source.task?.deadline ?? null, new Date()));
    setDoneWhen([DELEGATION_DEFAULT_DONE_WHEN]);
    setTickWhyPath(false);
    setTickWhyRationale(false);
    setTickWhyProject(false);
    setWhyFree('');
    setTickOutcome(false);
    setContextFree('');
    setDraft('');
    setDirty(false);
    setPending(false);
    setFailed(false);
    if (useEntitiesStore.getState().people.length === 0) void fetchPeople();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const person = useMemo<Person | null>(
    () => people.find((p) => p.id === personId) ?? (addedPerson?.id === personId ? addedPerson : null),
    [people, personId, addedPerson],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? people.filter((p) => p.name.toLowerCase().includes(q) || (p.role ?? '').toLowerCase().includes(q)) : people;
    return [...list].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8);
  }, [people, query]);
  const exact = people.some((p) => p.name.trim().toLowerCase() === query.trim().toLowerCase());

  const decision = source.decision;
  const why = [
    tickWhyPath && decision?.chosenPath ? `We decided: ${decision.chosenPath}` : '',
    tickWhyRationale && decision?.rationale ? `Reasoning: ${decision.rationale}` : '',
    tickWhyProject && source.project ? `Part of ${source.project.title}` : '',
    whyFree,
  ];
  const context = [
    tickOutcome && decision?.expectedOutcome ? `Expected outcome: ${decision.expectedOutcome}` : '',
    ...contextFree.split('\n'),
  ];
  const deadlineIso = useMemo(() => {
    try { return ymd ? endOfUtcDay(ymd).toISOString() : null; } catch { return null; }
  }, [ymd]);

  const composed = composeBrief({
    name: person?.name ?? 'there',
    what,
    why,
    deadline: deadlineIso ?? endOfUtcDay(minYmd).toISOString(),
    doneWhen,
    context,
  });
  /** Exactly what gets shared or copied. */
  const previewText = dirty ? draft : composed;

  const canSubmit = Boolean(person) && what.trim().length > 0 && Boolean(deadlineIso) && !pending;

  async function record(): Promise<void> {
    if (!person || !deadlineIso) return;
    setPending(true);
    const links = {
      ...(decision ? { decisionId: decision.id } : {}),
      ...(source.task ? { taskId: source.task.id } : {}),
    };
    try {
      await api.createCommitment({
        description: what.trim(),
        stakeholderId: person.id,
        deadline: deadlineIso,
        owedBy: 'STAKEHOLDER',
        ...(source.project ? { linkedProjectId: source.project.id } : {}),
        ...(Object.keys(links).length ? { links } : {}),
      }, keyRef.current);
      toast(`Recorded: waiting on ${firstName(person.name)} by ${dateLabel(deadlineIso)}`, 'success');
      window.dispatchEvent(new CustomEvent(COMMITMENTS_CHANGED_EVENT));
      void useVizStore.getState().load('commitments', true);
      void useEntitiesStore.getState().fetchCommitments();
      setFailed(false);
      setPending(false);
      onClose();
    } catch {
      toast('Copied, but not recorded', 'error');
      setFailed(true);
      setPending(false);
    }
  }

  async function shareAndRecord(): Promise<void> {
    const text = previewText;
    let delivered = false;
    if (useShare) {
      try { await navigator.share({ text }); delivered = true; }
      catch (e) { if ((e as DOMException)?.name === 'AbortError') return; delivered = await copyToClipboard(text); }
    } else {
      delivered = await copyToClipboard(text);
    }
    if (!delivered) { toast('Could not copy. Select the text and copy it yourself.', 'error'); return; }
    await record();
  }

  async function copyOnly(): Promise<void> {
    const ok = await copyToClipboard(previewText);
    toast(ok ? 'Brief copied. Nothing recorded.' : 'Could not copy. Select the text and copy it yourself.', ok ? 'info' : 'error');
  }

  async function addPerson(): Promise<void> {
    const name = query.trim();
    if (!name || adding) return;
    setAdding(true);
    try {
      const created = await api.createPerson({ name });
      setAddedPerson(created);
      setPersonId(created.id);
      setQuery('');
      await fetchPeople();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add that person', 'error');
    } finally {
      setAdding(false);
    }
  }

  const ministry = Boolean(person?.domains?.some((d) => isMinistryDomain(d)));
  const hasWhySources = Boolean(decision?.chosenPath || decision?.rationale || source.project);

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Delegate"
      description="Pick who, check the brief, then share or copy it. It is recorded only after that."
      size="md"
    >
      <div className="space-y-5" data-testid="delegate-dialog">
        {/* Who */}
        <section aria-labelledby={`${uid}-who`}>
          <h3 id={`${uid}-who`} className={LABEL}>Who</h3>
          {person ? (
            <div className="flex items-center justify-between gap-3 rounded-control border border-border bg-muted/40 px-3 py-2">
              <span className="min-w-0 text-sm text-foreground">
                <span className="font-medium">{person.name}</span>
                {person.role && <span className="text-muted-foreground"> · {person.role}</span>}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setPersonId(null)}>Change</Button>
            </div>
          ) : (
            <>
              <input
                type="search"
                aria-label="Search people"
                placeholder={people.length ? 'Search people' : 'Type a name to add someone'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={cn(FIELD, 'h-10')}
              />
              <ul className="mt-2 max-h-44 overflow-y-auto rounded-control border border-border divide-y divide-border empty:hidden" aria-label="People">
                {matches.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setPersonId(p.id)}
                      className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted outline-none"
                    >
                      <span className="text-foreground">{p.name}</span>
                      {p.role && <span className="truncate text-xs text-muted-foreground">{p.role}</span>}
                    </button>
                  </li>
                ))}
              </ul>
              {query.trim() && !exact && (
                <Button variant="secondary" size="sm" className="mt-2" onClick={addPerson} loading={adding}>
                  <span className="inline-flex items-center gap-1.5"><Plus size={14} aria-hidden="true" />Add person "{query.trim()}"</span>
                </Button>
              )}
            </>
          )}
          {ministry && (
            <p className="mt-2 text-xs text-muted-foreground" data-testid="delegate-ministry-note">
              Keep pastoral details out of the brief's What line. Delegations are stored like other commitments, not in the protected ministry store.
            </p>
          )}
        </section>

        {/* What */}
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor={`${uid}-what`} className={LABEL}>What</label>
            <span className="text-xs text-muted-foreground tnum" aria-live="polite">{what.length}/{DELEGATION_WHAT_MAX}</span>
          </div>
          <input
            id={`${uid}-what`}
            required
            maxLength={DELEGATION_WHAT_MAX}
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            className={cn(FIELD, 'h-10')}
          />
        </div>

        {/* By */}
        <div>
          <label htmlFor={`${uid}-by`} className={LABEL}>By</label>
          <input
            id={`${uid}-by`}
            type="date"
            min={minYmd}
            value={ymd}
            onChange={(e) => setYmd(e.target.value)}
            className={cn(FIELD, 'h-10 sm:w-56')}
          />
        </div>

        {/* Done when */}
        <fieldset>
          <legend className={LABEL}>Done when</legend>
          <div className="space-y-2">
            {doneWhen.map((line, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  aria-label={`Done when, line ${i + 1}`}
                  maxLength={DELEGATION_DONE_WHEN_MAX}
                  value={line}
                  onChange={(e) => setDoneWhen((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))}
                  className={cn(FIELD, 'h-9 flex-1')}
                />
                {doneWhen.length > 1 && (
                  <Button variant="ghost" size="icon" aria-label={`Remove line ${i + 1}`} onClick={() => setDoneWhen((xs) => xs.filter((_, j) => j !== i))}>
                    <X size={14} aria-hidden="true" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          {doneWhen.length < DELEGATION_DONE_WHEN_LINES && (
            <Button variant="ghost" size="sm" className="mt-1" onClick={() => setDoneWhen((xs) => [...xs, ''])}>
              <span className="inline-flex items-center gap-1.5"><Plus size={14} aria-hidden="true" />Add line</span>
            </Button>
          )}
        </fieldset>

        {/* Why */}
        <fieldset>
          <legend className={LABEL}>Why <span className="font-normal">(optional, only what you tick)</span></legend>
          {hasWhySources && (
            <div className="mb-2 space-y-1">
              {decision?.chosenPath && (
                <label className="flex items-start gap-2 rounded-md px-1 py-1 text-sm text-foreground hover:bg-muted">
                  <input type="checkbox" className="mt-0.5 accent-primary" checked={tickWhyPath} onChange={(e) => setTickWhyPath(e.target.checked)} />
                  <span>We decided: {decision.chosenPath}</span>
                </label>
              )}
              {decision?.rationale && (
                <label className="flex items-start gap-2 rounded-md px-1 py-1 text-sm text-foreground hover:bg-muted">
                  <input type="checkbox" className="mt-0.5 accent-primary" checked={tickWhyRationale} onChange={(e) => setTickWhyRationale(e.target.checked)} />
                  <span>Reasoning: {decision.rationale}</span>
                </label>
              )}
              {source.project && (
                <label className="flex items-start gap-2 rounded-md px-1 py-1 text-sm text-foreground hover:bg-muted">
                  <input type="checkbox" className="mt-0.5 accent-primary" checked={tickWhyProject} onChange={(e) => setTickWhyProject(e.target.checked)} />
                  <span>Part of {source.project.title}</span>
                </label>
              )}
            </div>
          )}
          <input
            aria-label="Why, in your words"
            placeholder="In your words (optional)"
            value={whyFree}
            onChange={(e) => setWhyFree(e.target.value)}
            className={cn(FIELD, 'h-9')}
          />
        </fieldset>

        {/* Context */}
        <fieldset>
          <legend className={LABEL}>Context <span className="font-normal">(optional)</span></legend>
          {decision?.expectedOutcome && (
            <label className="mb-2 flex items-start gap-2 rounded-md px-1 py-1 text-sm text-foreground hover:bg-muted">
              <input type="checkbox" className="mt-0.5 accent-primary" checked={tickOutcome} onChange={(e) => setTickOutcome(e.target.checked)} />
              <span>Expected outcome: {decision.expectedOutcome}</span>
            </label>
          )}
          <textarea
            aria-label="Context lines"
            placeholder="One point per line (optional)"
            rows={2}
            value={contextFree}
            onChange={(e) => setContextFree(e.target.value)}
            className={cn(FIELD, 'py-2 resize-y')}
          />
        </fieldset>

        {/* Preview */}
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor={`${uid}-preview`} className={LABEL}>Brief</label>
            {dirty && (
              <button type="button" className="text-xs text-primary-text hover:text-foreground underline-offset-2 hover:underline" onClick={() => { setDirty(false); setDraft(''); }}>
                Reset from fields
              </button>
            )}
          </div>
          <textarea
            id={`${uid}-preview`}
            data-testid="delegate-preview"
            rows={10}
            value={previewText}
            onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
            className={cn(FIELD, 'py-2 font-mono text-xs leading-relaxed resize-y')}
          />
          <p className="mt-1 text-xs text-muted-foreground">The brief is not saved. Only What, By and the person are recorded.</p>
        </div>

        {failed && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-foreground">
            <span>Copied, but not recorded.</span>
            <Button variant="secondary" size="sm" onClick={() => void record()} loading={pending}>Retry</Button>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-end">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" onClick={() => void copyOnly()}>Copy only</Button>
          <Button data-testid="delegate-primary" onClick={() => void shareAndRecord()} disabled={!canSubmit} loading={pending}>
            {useShare ? 'Share & record' : 'Copy & record'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
