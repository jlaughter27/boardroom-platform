import { useCallback, useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarClock, ChevronDown } from 'lucide-react';
import type { MeetingBriefEvent, MeetingBriefsResponse, PersonBrief } from '@boardroom/shared';
import { getMeetingBriefs } from '../../lib/api';
import { Card, Button } from '../ui';
import { AINudge } from '../shared/AINudge';
import { cn } from '../../lib/cn';

/**
 * RD-13 — "Meeting prep · next 24 h". One request on mount
 * (`GET /calendar/briefs`); deterministic briefs, no LLM. Rows start
 * collapsed (headlines only — safe on a shared screen); one click shows the
 * person's open commitments, what they owe, related decisions, recently
 * linked notes and their nightly capsule.
 */

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDue(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function More({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null;
  return <li className="text-xs text-muted-foreground">+{total - shown} more</li>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div data-section={title}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <ul className="mt-1 space-y-1">{children}</ul>
    </div>
  );
}

function PersonDetail({ brief }: { brief: PersonBrief }) {
  const { counts } = brief;
  return (
    <div className="space-y-3" data-testid={`brief-${brief.personId}`}>
      <p className="text-sm font-semibold text-foreground">
        {brief.name}
        {brief.role ? <span className="font-normal text-muted-foreground"> · {brief.role}</span> : null}
        <span className="block text-xs font-medium text-foreground/90">{brief.headline}</span>
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {brief.youOwe.length > 0 && (
          <Section title="You owe">
            {brief.youOwe.map((c) => (
              <li key={c.id} className="text-sm leading-snug text-foreground">
                {c.description}
                {c.deadline && (
                  <span className={cn('ml-1 text-xs', c.overdue ? 'text-danger' : 'text-muted-foreground')}>
                    · {c.overdue ? 'overdue ' : 'due '}{formatDue(c.deadline)}
                  </span>
                )}
              </li>
            ))}
            <More shown={brief.youOwe.length} total={counts.youOwe} />
          </Section>
        )}
        {brief.theyOwe.length > 0 && (
          <Section title="They owe you">
            {brief.theyOwe.map((t) => (
              <li key={t.id} className="text-sm leading-snug text-foreground">
                {t.title}
                <span className="ml-1 text-xs text-muted-foreground">
                  · {t.status}{t.deadline ? ` · due ${formatDue(t.deadline)}` : ''}
                </span>
              </li>
            ))}
            <More shown={brief.theyOwe.length} total={counts.theyOwe} />
          </Section>
        )}
        {brief.decisions.length > 0 && (
          <Section title="Decisions">
            {brief.decisions.map((d) => (
              <li key={d.id} className="text-sm leading-snug">
                <Link to={`/decisions/${d.id}`} className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground">
                  {d.title}
                </Link>
                <span className="ml-1 text-xs text-muted-foreground">· {d.status.toLowerCase()}</span>
              </li>
            ))}
            <More shown={brief.decisions.length} total={counts.decisions} />
          </Section>
        )}
        {brief.recentMemories.length > 0 && (
          <Section title="Recent">
            {brief.recentMemories.map((m) => (
              <li key={m.id} className="text-sm leading-snug text-foreground">
                {m.title}
                <span className="block truncate text-xs text-muted-foreground">{m.excerpt}</span>
              </li>
            ))}
            <More shown={brief.recentMemories.length} total={counts.memories} />
          </Section>
        )}
      </div>
      {brief.capsule && (
        <p className="text-xs leading-relaxed text-muted-foreground" data-section="capsule">
          {brief.capsule.summary}
          {brief.capsule.stale ? ' (stale)' : ''}
        </p>
      )}
    </div>
  );
}

function EventRow({ event, briefs }: { event: MeetingBriefEvent; briefs: Record<string, PersonBrief> }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const extra = event.unknownAttendees + event.ambiguousAttendees + event.morePeople;
  const people = event.knownPeople.filter((p) => briefs[p.personId]);

  return (
    <li className="py-3 first:pt-0 last:pb-0" data-testid="meeting-brief-row">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-start gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="mt-0.5 w-11 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{formatTime(event.startTime)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{event.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {people.map((p) => (
              <span
                key={p.personId}
                className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-foreground"
                title={p.method === 'title_first_name' ? 'matched from event title' : undefined}
              >
                {p.displayName}{p.method === 'title_first_name' ? ' ~' : ''}
              </span>
            ))}
            {extra > 0 && <span className="text-xs text-muted-foreground">+{extra}</span>}
          </span>
          {!open && (
            <span className="mt-1 block space-y-0.5">
              {people.map((p) => (
                <span key={p.personId} className="block text-xs text-muted-foreground" data-testid="meeting-brief-headline">
                  {briefs[p.personId].headline}
                </span>
              ))}
            </span>
          )}
        </span>
        <ChevronDown
          size={16}
          strokeWidth={1.75}
          aria-hidden="true"
          className={cn('mt-0.5 shrink-0 text-muted-foreground transition-transform duration-normal ease-out', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div id={panelId} className="mt-3 space-y-4 border-l border-border pl-3 sm:ml-14">
          {people.map((p) => <PersonDetail key={p.personId} brief={briefs[p.personId]} />)}
        </div>
      )}
    </li>
  );
}

export function MeetingBriefsCard() {
  const navigate = useNavigate();
  const [data, setData] = useState<MeetingBriefsResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback((refresh: boolean) => {
    let cancelled = false;
    getMeetingBriefs(refresh ? { refresh: true } : undefined)
      .then((res) => { if (!cancelled) setData(res); })
      .catch(() => {
        if (!cancelled) {
          setData({ calendar: 'unavailable', generatedAt: '', windowEnd: '', events: [], briefs: {}, omitted: { noKnownPeople: 0, overCap: 0, allDayOrDeclined: 0 }, partial: false });
        }
      })
      .finally(() => { if (!cancelled) { setLoaded(true); setRetrying(false); } });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => load(false), [load]);

  if (!loaded || !data || data.calendar === 'not_configured') return null;

  if (data.calendar === 'not_connected') {
    return (
      <AINudge
        title="Connect your calendar for meeting prep"
        description="See what you owe and what's open with each person before you meet."
        action={{ label: 'Settings', onClick: () => navigate('/settings') }}
        dismissKey="nudge-calendar-briefs"
        variant="suggestion"
      />
    );
  }

  if (data.calendar === 'unavailable') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="meeting-briefs">
        <CalendarClock size={14} strokeWidth={1.75} aria-hidden="true" />
        <span>Calendar unavailable</span>
        <Button variant="ghost" size="sm" loading={retrying} onClick={() => { setRetrying(true); load(true); }}>
          Retry
        </Button>
      </div>
    );
  }

  if (data.events.length === 0) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="meeting-briefs">
        <CalendarClock size={14} strokeWidth={1.75} aria-hidden="true" />
        No meetings with people you track in the next 24 h.
      </p>
    );
  }

  return (
    <Card data-testid="meeting-briefs">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        <CalendarClock size={16} strokeWidth={1.75} aria-hidden="true" />
        Meeting prep · next 24 h
      </h3>
      <ul className="divide-y divide-border">
        {data.events.map((e) => <EventRow key={e.id} event={e} briefs={data.briefs} />)}
      </ul>
    </Card>
  );
}
